// The per-ticket workflow (docs/07-orchestrator.md). One instance per container.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RepoConfig, TicketContext, Timers } from './config.ts';
import { applyLabels } from './config.ts';
import { checksTable, runChecks, type CheckResult } from './checks.ts';
import type { GitHub, PullRequest } from './clients/github.ts';
import type { JiraClient, JiraIssue } from './clients/jira.ts';
import type { SlackClient } from './clients/slack.ts';
import { run, sh, tail } from './exec.ts';
import type { Git } from './git.ts';
import { log } from './log.ts';
import {
  buildFixChecksPrompt,
  buildInitialPrompt,
  ensureMarkers,
  prBodyTemplate,
  prTitle,
  readSlackMarker,
} from './prompt.ts';
import type { AgentEvent, AgentRunner } from './runners/types.ts';
import type { StateStore } from './state.ts';
import { supervise, type Outcome } from './supervisor.ts';

export type FinalStatus = 'done' | 'paused' | 'needs-human' | 'waiting-approval' | 'killed';

const MAX_FIX_ROUNDS = 2;
const CHECKPOINT_NOTIFY_EVERY_MS = 3 * 60_000;

export interface Deps {
  ctx: TicketContext;
  timers: Timers;
  repoConfig: RepoConfig;
  store: StateStore;
  git: Git;
  gh: GitHub;
  jira: JiraClient;
  slack: SlackClient;
  runner: AgentRunner;
  rules: string;
  onActivity: () => void;
}

export class TicketAgent {
  spawned = false;
  private issue!: JiraIssue;
  private model!: string;
  private planFirst = false;
  private threadTs?: string;
  private pr?: PullRequest;
  private lastCheckpointNotice = 0;
  private pendingPrCheck = false;
  private pendingPush = false;

  private d: Deps;

  constructor(deps: Deps) {
    this.d = deps;
  }

  private get bodyFileRel(): string {
    return path.relative(this.d.ctx.repoDir, path.join(this.d.ctx.harnessDir, 'pr-body.md'));
  }

  private get bodyFileAbs(): string {
    return path.join(this.d.ctx.harnessDir, 'pr-body.md');
  }

  // ───────────────────────────── main workflow ─────────────────────────────

  async run(signal: AbortSignal): Promise<FinalStatus> {
    const { ctx, store, jira } = this.d;
    const state = await store.load();

    if (state.status === 'paused' && state.pausedUntil && Date.now() / 1000 < state.pausedUntil) {
      log.warn(`ticket is paused until ${fmtTime(state.pausedUntil)} (usage limit) — exiting`);
      this.threadTs = ctx.slackThreadTs ?? state.slackThreadTs;
      await this.notify(`⏸ Still paused until ${fmtTime(state.pausedUntil)} (Claude usage limit).`);
      return 'paused';
    }

    log.step(`loading ${ctx.jiraKey} from Jira`);
    this.issue = await jira.getIssue(ctx.jiraKey);
    ({ model: this.model, planFirst: this.planFirst } = applyLabels(this.d.repoConfig, this.issue.labels));
    log.ok(`"${this.issue.summary}" [${this.issue.status}] model=${this.model}${this.planFirst ? ' plan-first' : ''}`);

    this.pr = await this.d.gh.findPr(ctx.branch).catch(() => undefined);
    await this.resolveSlackThread();

    if (await jira.transitionForward(ctx.jiraKey, this.issue.status, 'In Progress').catch(() => false)) {
      log.ok('Jira → In Progress');
    }

    const setupNote = await this.bootstrap();
    await this.prepareBodyFile();
    const attachments = await jira.downloadAttachments(this.issue, '/workspace/attachments').catch(() => []);

    let prompt =
      buildInitialPrompt({
        issue: this.issue,
        repoUrl: ctx.repoUrl,
        baseBranch: ctx.baseBranch,
        branch: ctx.branch,
        branchIsNew: ctx.branchIsNew,
        planFirst: this.planFirst,
        prBodyFile: this.bodyFileRel,
        attachments,
        commands: this.d.repoConfig.commands,
        existingWork: ctx.branchIsNew ? undefined : await this.existingWork(),
      }) + (setupNote ? `\n\n## Environment note\n${setupNote}` : '');

    let resume = state.sessionId;
    let fixRounds = 0;

    while (true) {
      const outcome = await this.round(prompt, resume, signal);
      if (outcome.sessionId) await store.update({ sessionId: outcome.sessionId });
      await this.afterRound();

      switch (outcome.kind) {
        case 'killed':
          return 'killed';
        case 'usage_limit':
          return this.pause(outcome.resetsAt);
        case 'stalled':
        case 'exhausted':
        case 'error':
          await this.emergencyCheckpoint();
          await this.ensurePr();
          return this.needsHuman(reasonText(outcome), outcome.summary);
        case 'done':
          break;
      }

      if (this.planFirst) {
        await this.ensurePr();
        await this.notify(`📋 Plan ready on ${this.prLink()} — waiting for \`/codecrafter approve\` (plan-first).`);
        return 'waiting-approval';
      }

      const results = await runChecks(this.d.repoConfig.commands, ctx.repoDir);
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) return this.finish(outcome.summary, results);
      if (fixRounds >= MAX_FIX_ROUNDS) {
        await this.emergencyCheckpoint();
        await this.ensurePr();
        return this.needsHuman(`checks still failing after ${MAX_FIX_ROUNDS} fix rounds: ${failed.map((f) => f.name).join(', ')}`, checksTable(results));
      }
      fixRounds++;
      log.warn(`checks failed (${failed.map((f) => f.name).join(', ')}) — fix round ${fixRounds}/${MAX_FIX_ROUNDS}`);
      prompt = buildFixChecksPrompt(failed);
      resume = this.d.store.get().sessionId;
    }
  }

  /** Save work before the container dies (D14). Safe to call anytime. */
  async emergencyCheckpoint(): Promise<void> {
    const { git } = this.d;
    try {
      if (await git.isDirty()) {
        log.warn('uncommitted work — emergency checkpoint (hooks skipped)');
        await git.emergencyCommit();
      }
      if ((await git.unpushedCount()) > 0) {
        await git.push();
        log.ok('pushed checkpoint');
      }
    } catch (err) {
      log.error(`emergency checkpoint failed: ${String(err)}`);
    }
  }

  // ───────────────────────────── agent rounds ─────────────────────────────

  private async round(prompt: string, resumeSessionId: string | undefined, signal: AbortSignal): Promise<Outcome> {
    let sawSession = false;
    const attempt = (resumeId?: string) =>
      supervise(
        this.d.runner,
        {
          cwd: this.d.ctx.repoDir,
          prompt,
          model: this.model,
          resumeSessionId: resumeId,
          systemPromptAppend: this.d.rules,
          transcriptFile: path.join(this.d.ctx.stateDir, 'transcript.jsonl'),
        },
        {
          softTimeoutMs: this.d.timers.softTimeoutMs,
          maxContinuations: this.d.timers.maxContinuations,
          head: () => this.d.git.head(),
          signal,
          onTick: ({ continuation, progressing }) =>
            log.info(`soft timeout: ${progressing ? `progressing, extension ${continuation + 1}` : 'no progress'}`),
          onEvent: async (e) => {
            if (e.kind === 'session') sawSession = true;
            await this.onEvent(e);
          },
        },
      );

    log.step(resumeSessionId ? `resuming agent session ${resumeSessionId.slice(0, 8)}` : 'starting agent (fresh session)');
    let outcome = await attempt(resumeSessionId);
    if (resumeSessionId && !sawSession && outcome.kind === 'error') {
      log.warn('could not resume the previous session — starting fresh (branch/PR context is in the prompt)');
      await this.d.store.update({ sessionId: undefined });
      outcome = await attempt(undefined);
    }
    log.info(`round ended: ${outcome.kind}`);
    return outcome;
  }

  private async onEvent(e: AgentEvent): Promise<void> {
    this.spawned = true;
    this.d.onActivity();
    switch (e.kind) {
      case 'session':
        log.info(`session ${e.id.slice(0, 8)} (${e.model ?? this.model})`);
        await this.d.store.update({ sessionId: e.id });
        break;
      case 'text':
        log.agent(oneLine(e.text, 400));
        break;
      case 'tool': {
        const cmd = typeof e.input.command === 'string' ? e.input.command : '';
        const target = cmd || String(e.input.file_path ?? e.input.path ?? e.input.pattern ?? '');
        log.tool(`${e.name} ${oneLine(target, 160)}`);
        if (/\bgh pr create\b/.test(cmd)) this.pendingPrCheck = true;
        if (/\bgit push\b/.test(cmd)) this.pendingPush = true;
        break;
      }
      case 'tool_result':
        if (this.pendingPrCheck) {
          this.pendingPrCheck = false;
          await this.announcePrIfNew();
        }
        if (this.pendingPush) {
          this.pendingPush = false;
          await this.notifyCheckpoint();
        }
        break;
      case 'usage':
        if (e.utilization !== undefined) log.info(`usage: ${Math.round(e.utilization * 100)}% of ${e.window} window`);
        break;
      case 'usage_limit':
        log.warn(`usage limit hit (resets ${e.resetsAt ? fmtTime(e.resetsAt) : 'unknown'})`);
        break;
      case 'result':
        log.info(`agent result: ${e.ok ? 'ok' : 'error'}${e.turns ? `, ${e.turns} turns` : ''}${e.costUsd ? `, ~$${e.costUsd.toFixed(2)} equiv` : ''}`);
        break;
      case 'raw':
        log.info(oneLine(e.line, 200));
        break;
    }
  }

  // ───────────────────────────── outcomes ─────────────────────────────

  private async finish(summary: string, checks: CheckResult[]): Promise<FinalStatus> {
    const { git, store } = this.d;
    if (await git.isDirty()) {
      const ok = await git.commitAll(`${this.issue.key}: final checkpoint`);
      if (!ok) await git.emergencyCommit();
    }
    if ((await git.unpushedCount()) > 0) await git.push();
    await this.ensurePr();
    await this.afterRound();

    const head = await git.head();
    if (store.get().lastDoneSha === head) {
      log.info('already reported done for this commit');
    } else if (this.pr) {
      await this.d.gh.comment(
        this.pr.number,
        [
          '✅ **code-crafter: done** — ready for your review',
          '',
          summary.trim() || '_(no summary)_',
          '',
          '**Local checks**',
          checksTable(checks),
          '',
          `HEAD: \`${head.slice(0, 7)}\` · This PR stays a draft — mark it *Ready for review* when you're happy.`,
        ].join('\n'),
      );
      await this.notify(`✅ Done — ${this.prLink()} is ready for your review (local checks pass).`);
    }
    await store.update({ status: 'done', lastDoneSha: head });
    log.ok('ticket done');
    return 'done';
  }

  private async pause(resetsAt?: number): Promise<FinalStatus> {
    await this.emergencyCheckpoint();
    await this.ensurePr();
    const until = resetsAt ?? Math.floor(Date.now() / 1000) + 60 * 60;
    await this.d.store.update({ status: 'paused', pausedUntil: until });
    const msg = `⏸ Paused: Claude usage limit reached. Work is checkpointed; resumes after ${fmtTime(until)}.`;
    if (this.pr) await this.d.gh.comment(this.pr.number, msg).catch(() => {});
    await this.notify(msg);
    return 'paused';
  }

  private async needsHuman(reason: string, detail: string): Promise<FinalStatus> {
    await this.d.store.update({ status: 'needs-human' });
    const body = `❓ **code-crafter needs a human:** ${reason}\n\n<details><summary>last agent output</summary>\n\n${tail(detail || '(none)', 40)}\n\n</details>`;
    if (this.pr) await this.d.gh.comment(this.pr.number, body).catch(() => {});
    await this.notify(`❓ Needs a human: ${reason}${this.pr ? ` — ${this.prLink()}` : ''}`);
    return 'needs-human';
  }

  // ───────────────────────────── PR guardrails ─────────────────────────────

  /** Make sure a draft PR exists if the branch has commits (the model is asked to open it; we don't rely on that). */
  private async ensurePr(): Promise<void> {
    const { gh, git, ctx } = this.d;
    this.pr = (await gh.findPr(ctx.branch).catch(() => undefined)) ?? this.pr;
    if (this.pr && this.pr.state === 'OPEN') return;
    if (this.pr) return; // closed/merged: leave it alone
    if ((await git.commitsAheadOfBase().catch(() => 0)) === 0) return;
    if ((await git.unpushedCount()) > 0) await git.push();
    const body = ensureMarkers(await readFile(this.bodyFileAbs, 'utf8').catch(() => prBodyTemplate(this.issue, this.threadTs)), this.issue.key, this.threadTs);
    await writeFile(this.bodyFileAbs, body);
    this.pr = await gh.createPr({ base: ctx.baseBranch, head: ctx.branch, title: prTitle(this.issue), bodyFile: this.bodyFileAbs, draft: true });
    log.ok(`opened draft PR #${this.pr.number} (guardrail)`);
    await this.announcePrIfNew();
  }

  /** After every round: force draft + restore markers (D12). */
  private async afterRound(): Promise<void> {
    const { gh, ctx } = this.d;
    const pr = await gh.findPr(ctx.branch).catch(() => undefined);
    if (!pr) return;
    this.pr = pr;
    if (pr.state !== 'OPEN') return;
    if (this.d.repoConfig.pullRequest.draft && (await gh.ensureDraft(pr).catch(() => false))) {
      log.warn(`PR #${pr.number} was marked ready — converted back to draft (guardrail)`);
    }
    const fixed = ensureMarkers(pr.body ?? '', this.issue.key, this.threadTs);
    if (fixed !== (pr.body ?? '').trimEnd()) {
      await gh.setBody(pr.number, fixed).catch((e) => log.warn(`could not restore PR markers: ${e}`));
      log.info('restored PR body markers (guardrail)');
    }
    await this.announcePrIfNew();
  }

  private async announcePrIfNew(): Promise<void> {
    const { store, gh, ctx, jira } = this.d;
    if (!this.pr) this.pr = await gh.findPr(ctx.branch).catch(() => undefined);
    if (!this.pr) return;
    if (!store.get().planAnnounced) {
      await store.update({ planAnnounced: true });
      log.ok(`draft PR: ${this.pr.url}`);
      await this.notify(`📋 Plan & draft PR: ${this.prLink()}`);
    }
    if (!store.get().jiraPrCommented) {
      await store.update({ jiraPrCommented: true });
      await jira
        .comment(ctx.jiraKey, 'code-crafter opened a draft pull request: ', { text: `PR #${this.pr.number}`, href: this.pr.url })
        .catch((e) => log.warn(`jira comment failed: ${e}`));
    }
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async resolveSlackThread(): Promise<void> {
    const { ctx, store, slack } = this.d;
    const known = ctx.slackThreadTs ?? store.get().slackThreadTs ?? readSlackMarker(this.pr?.body);
    if (known) {
      this.threadTs = known;
      await slack.post(`🚀 Container started (${ctx.branchIsNew ? 'fresh' : 'resuming'}) · model \`${this.model}\``, known);
    } else {
      // Phase 1a: started by hand, no trigger message — open our own thread.
      this.threadTs = await slack.post(`🚀 *code-crafter* started on <${this.issue.url}|${this.issue.key}>: ${this.issue.summary}\nmodel \`${this.model}\` · branch \`${ctx.branch}\``);
    }
    if (this.threadTs) await store.update({ slackThreadTs: this.threadTs });
  }

  private async notify(text: string): Promise<void> {
    await this.d.slack.post(text, this.threadTs);
  }

  private async notifyCheckpoint(): Promise<void> {
    if (Date.now() - this.lastCheckpointNotice < CHECKPOINT_NOTIFY_EVERY_MS) return;
    this.lastCheckpointNotice = Date.now();
    const subject = await this.d.git.lastCommitSubject().catch(() => 'checkpoint');
    await this.notify(`💾 ${subject}`);
  }

  private prLink(): string {
    return this.pr ? `<${this.pr.url}|PR #${this.pr.number}>` : 'the PR';
  }

  private async existingWork() {
    const { git, gh } = this.d;
    return {
      log: await git.logSinceBase().catch(() => ''),
      prUrl: this.pr?.url,
      prDigest: this.pr ? await gh.prDigest(this.pr.number) : undefined,
    };
  }

  /** Write the PR body file the agent edits: the live PR body if one exists, else our template. */
  private async prepareBodyFile(): Promise<void> {
    await mkdir(this.d.ctx.harnessDir, { recursive: true });
    const body = this.pr?.body ? ensureMarkers(this.pr.body, this.issue.key, this.threadTs) : prBodyTemplate(this.issue, this.threadTs);
    await writeFile(this.bodyFileAbs, body + '\n');
  }

  /** Build the repo's own environment from codecrafter.yaml. Returns a note for the prompt if something failed. */
  private async bootstrap(): Promise<string | undefined> {
    const { repoConfig, ctx } = this.d;
    if (repoConfig.nodeVersion) {
      const current = (await run('node', ['--version'])).stdout.trim().replace(/^v/, '');
      if (current.split('.')[0] !== repoConfig.nodeVersion.split('.')[0]) {
        log.warn(`repo wants Node ${repoConfig.nodeVersion}, container has ${current} (volta install not implemented yet)`);
      }
    }
    if (!repoConfig.setup) return undefined;
    const line = [repoConfig.setup.command, ...repoConfig.setup.args].join(' ');
    log.step(`setup: ${line}`);
    const r = await sh(line, { cwd: ctx.repoDir, timeoutMs: 20 * 60_000 });
    if (r.code === 0) {
      log.ok('setup done');
      return undefined;
    }
    log.warn(`setup failed (exit ${r.code})`);
    return `The repo setup command \`${line}\` failed. Output tail:\n\`\`\`\n${tail(r.stdout + r.stderr, 40)}\n\`\`\`\nFix it if it blocks the task; otherwise continue.`;
  }
}

function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function fmtTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('en-IN', { timeZone: process.env.TZ ?? 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

function reasonText(o: Outcome): string {
  switch (o.kind) {
    case 'stalled':
      return 'the agent stopped making progress (no new commits or output)';
    case 'exhausted':
      return 'the agent used all its time extensions without finishing';
    default:
      return 'the agent exited with an error';
  }
}
