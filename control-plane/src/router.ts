// GitHub event router (docs/09-feedback-and-merge.md). n8n parsed the webhook; here we verify, decide and deliver.
//
//   PR merged              → Jira Done, ✅ on the Slack trigger, container + volume removed
//   PR closed (unmerged)   → Slack note, container stopped
//   ready_for_review       → Jira In Review (D11)
//   comment / review       → handle_comment command   (allow-listed humans only, D17)
//   /codecrafter <verb>    → pause | resume | stop | approve
//   CI failed on HEAD      → fix_pipeline command
// Commands go to the live container; if it isn't running they are queued and the container is respawned.

import type { Chat, Tickets } from './clients.ts';
import { containerName, volumeName, type Service } from './config.ts';
import type { DockerApi } from './docker.ts';
import type { GitHubReader } from './github.ts';
import { log } from './log.ts';
import type { Spawner } from './spawner.ts';
import { keys, type Store } from './store.ts';

export interface GithubEvent {
  event: string;
  action?: string;
  delivery?: string;
  repo?: string;
  sender?: string;
  senderType?: string;
  prNumber?: number;
  prUrl?: string;
  branch?: string;
  jiraKey?: string;
  routable?: boolean;
  needsBranchLookup?: boolean;
  merged?: boolean;
  comment?: { id: number; body: string; url?: string; path?: string; line?: number; diffHunk?: string; inReplyTo?: number; kind: 'review_comment' | 'issue_comment' };
  review?: { id: number; state: string; body?: string; url?: string };
  run?: { id: number; name?: string; status?: string; conclusion?: string; headSha?: string; url?: string };
}

export type CommandType = 'handle_comment' | 'fix_pipeline' | 'pause' | 'resume' | 'stop' | 'approve';

export interface AgentCommand {
  type: CommandType;
  jiraKey: string;
  prNumber?: number;
  delivery?: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export type Deliver = (container: string, cmd: AgentCommand) => Promise<boolean>;

export async function httpDeliver(container: string, cmd: AgentCommand, token: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${container}:8080/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codecrafter-token': token },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const PREFIX = 'CODE-CRAFTER-';
const CONTROL = /^\s*\/codecrafter\s+(pause|resume|stop|approve)\b/i;
const THREAD_MARKER = /<!-- SLACK_THREAD_TS: ([0-9.]+) -->/;

export interface RouterDeps {
  services: Service[];
  allowedUsers: string[];
  slackChannel?: string;
  github: GitHubReader;
  tickets: Tickets;
  chat: Chat;
  store: Store;
  docker: DockerApi;
  spawner: Spawner;
  deliver: Deliver;
}

export class EventRouter {
  private d: RouterDeps;

  constructor(deps: RouterDeps) {
    this.d = deps;
  }

  /** Returns a short description of what was done (logged and returned to n8n). */
  async handle(e: GithubEvent): Promise<string> {
    const result = await this.route(e).catch((err) => `error: ${err instanceof Error ? err.message : String(err)}`);
    log.info(`github ${e.event}${e.action ? `.${e.action}` : ''}${e.jiraKey ? ` ${e.jiraKey}` : ''} by ${e.sender ?? '?'} → ${result}`);
    return result;
  }

  private async route(e: GithubEvent): Promise<string> {
    const { store, github } = this.d;
    if (e.delivery && !(await store.acquire(keys.delivery(e.delivery), 24 * 3600))) return 'duplicate delivery';
    if (!e.repo) return 'ignored (no repo)';
    const service = this.d.services.find((s) => s.repo.replace(/\.git$/, '').endsWith(`/${e.repo}`));
    if (!service) return `ignored (repo ${e.repo} not registered)`;

    // issue_comment carries no branch — look the PR up.
    if (!e.branch && e.needsBranchLookup && e.prNumber) {
      e.branch = (await github.getPr(e.repo, e.prNumber)).headRef;
    }
    if (!e.branch?.startsWith(PREFIX)) return 'ignored (not a code-crafter branch)';
    const key = e.branch.slice(PREFIX.length);

    switch (e.event) {
      case 'pull_request':
        return this.onPullRequest(e, key, service);
      case 'pull_request_review_comment':
      case 'issue_comment':
        return e.action === 'created' ? this.onComment(e, key, service) : `ignored (${e.action})`;
      case 'pull_request_review':
        return this.onReview(e, key, service);
      case 'workflow_run':
        return this.onWorkflowRun(e, key, service);
      default:
        return `ignored (${e.event})`;
    }
  }

  private async onPullRequest(e: GithubEvent, key: string, service: Service): Promise<string> {
    if (!e.prNumber || !e.repo) return 'ignored (no PR number)';
    if (e.action === 'ready_for_review') {
      const moved = await this.d.tickets.transitionForward?.(key, 'In Review').catch(() => false);
      await this.threadNote(key, e, `👀 ${this.prLink(e)} marked ready for review${moved ? ' · Jira → In Review' : ''}`);
      return moved ? 'Jira → In Review' : 'ready for review (Jira unchanged)';
    }
    if (e.action !== 'closed') return `ignored (pull_request.${e.action})`;

    const pr = await this.d.github.getPr(e.repo, e.prNumber); // verify, don't trust the payload
    if (pr.merged) return this.onMerged(key, e, pr.body);
    await this.d.spawner.stop(key).catch(() => false);
    await this.threadNote(key, e, `🚫 ${this.prLink(e)} was closed without merging. Container stopped; Jira unchanged.`, pr.body);
    void service;
    return 'closed unmerged → container stopped';
  }

  private async onMerged(key: string, e: GithubEvent, prBody: string): Promise<string> {
    const { tickets, chat, docker, store } = this.d;
    const done = await tickets.transitionForward?.(key, 'Done').catch((err) => {
      log.warn(`jira done ${key}: ${err}`);
      return false;
    });
    await tickets.comment?.(key, 'code-crafter: pull request merged — ', { text: `PR #${e.prNumber}`, href: e.prUrl ?? '' }).catch(() => {});

    const thread = await this.threadFor(key, prBody);
    if (thread && this.d.slackChannel) {
      await chat.react(this.d.slackChannel, thread, 'white_check_mark');
      await chat.post(this.d.slackChannel, `🎉 ${this.prLink(e)} merged${done ? ' · Jira → Done' : ''}. Cleaning up the container.`, thread);
    }

    await docker.remove(containerName(key)).catch(() => {});
    await docker.removeVolume(volumeName(key)).catch(() => {});
    for (const k of [keys.thread(key), keys.lastActive(key), keys.commands(key)]) await store.del(k);
    return `merged → ${done ? 'Jira Done, ' : ''}✅, container + volume removed`;
  }

  private async onComment(e: GithubEvent, key: string, service: Service): Promise<string> {
    const c = e.comment;
    if (!c || !e.repo) return 'ignored (no comment)';
    const verdict = await this.checkHuman(e);
    if (verdict) return verdict;
    const author = await this.d.github.commentAuthor(e.repo, c.kind, c.id);
    if (author !== e.sender) return 'ignored (comment not found / author mismatch)';

    const control = c.body.match(CONTROL);
    if (control) return this.dispatch(key, service, e, control[1].toLowerCase() as CommandType, { by: e.sender });

    return this.dispatch(key, service, e, 'handle_comment', {
      id: c.id,
      author: e.sender,
      body: c.body,
      kind: c.kind,
      url: c.url,
      path: c.path,
      line: c.line,
      diffHunk: c.diffHunk,
      inReplyTo: c.inReplyTo,
    });
  }

  private async onReview(e: GithubEvent, key: string, service: Service): Promise<string> {
    const r = e.review;
    if (!r || e.action !== 'submitted') return 'ignored';
    const verdict = await this.checkHuman(e);
    if (verdict) return verdict;
    const state = r.state.toLowerCase();
    if (state === 'approved') {
      await this.threadNote(key, e, `✅ ${this.prLink(e)} approved by ${e.sender}`);
      return 'approved (noted)';
    }
    // Inline review comments arrive as their own events; only the review's summary body is a command here.
    if (!r.body?.trim()) return 'ignored (review without a summary body)';
    return this.dispatch(key, service, e, 'handle_comment', { id: r.id, author: e.sender, body: r.body, kind: 'review', reviewState: state, url: r.url });
  }

  private async onWorkflowRun(e: GithubEvent, key: string, service: Service): Promise<string> {
    const run = e.run;
    if (e.action !== 'completed' || !run) return 'ignored (run not completed)';
    if (!['failure', 'timed_out'].includes(String(run.conclusion))) return `ignored (run ${run.conclusion})`;
    const head = await this.d.github.branchHead(e.repo!, e.branch!);
    if (head && run.headSha && head !== run.headSha) return 'ignored (failure on a superseded commit)';
    return this.dispatch(key, service, e, 'fix_pipeline', { runId: run.id, workflow: run.name, url: run.url, headSha: run.headSha, conclusion: run.conclusion });
  }

  /** Only allow-listed humans can make the agent work (D17). Returns a reason to ignore, or undefined. */
  private async checkHuman(e: GithubEvent): Promise<string | undefined> {
    if (e.senderType === 'Bot' || e.sender?.endsWith('[bot]')) return 'ignored (bot)';
    if (!e.sender || !this.d.allowedUsers.includes(e.sender)) return `ignored (${e.sender} not allow-listed)`;
    return undefined;
  }

  private async dispatch(key: string, service: Service, e: GithubEvent, type: CommandType, payload: Record<string, unknown>): Promise<string> {
    const cmd: AgentCommand = { type, jiraKey: key, prNumber: e.prNumber, delivery: e.delivery, receivedAt: new Date().toISOString(), payload };
    const name = containerName(key);
    if (await this.d.deliver(name, cmd)) return `${type} → ${name}`;

    // Not running: queue it; the container drains the queue on boot. `stop` needs nobody to wake up.
    if (type === 'stop') return 'stop ignored (container not running)';
    await this.d.store.push(keys.commands(key), JSON.stringify(cmd));
    const thread = await this.threadFor(key);
    const r = await this.d.spawner.spawn({ jiraKey: key, service: service.name, slackThreadTs: thread, resume: true });
    if (r.status === 'queue-full' && thread && this.d.slackChannel) {
      await this.d.chat.post(this.d.slackChannel, `⏳ Feedback on ${key} is queued — ${r.message}.`, thread);
    }
    return `${type} queued, respawn: ${r.status}`;
  }

  private async threadFor(key: string, prBody?: string): Promise<string | undefined> {
    return (await this.d.store.get(keys.thread(key))) ?? prBody?.match(THREAD_MARKER)?.[1];
  }

  private async threadNote(key: string, e: GithubEvent, text: string, prBody?: string): Promise<void> {
    let body = prBody;
    if (!body && e.repo && e.prNumber && !(await this.d.store.get(keys.thread(key)))) {
      body = (await this.d.github.getPr(e.repo, e.prNumber).catch(() => undefined))?.body;
    }
    const thread = await this.threadFor(key, body);
    if (thread && this.d.slackChannel) await this.d.chat.post(this.d.slackChannel, text, thread);
  }

  private prLink(e: GithubEvent): string {
    return e.prUrl ? `<${e.prUrl}|PR #${e.prNumber}>` : `PR #${e.prNumber}`;
  }
}
