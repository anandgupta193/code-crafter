// Prompt assembly (docs/07-orchestrator.md §1). Pure functions: easy to test and to eyeball.

import type { JiraIssue } from './clients/jira.ts';

export const SLACK_MARKER = 'SLACK_THREAD_TS';
export const KEY_MARKER = 'CODECRAFTER_KEY';

export interface PromptInput {
  issue: JiraIssue;
  repoUrl: string;
  baseBranch: string;
  branch: string;
  branchIsNew: boolean;
  planFirst: boolean;
  prBodyFile: string; // path relative to repo root
  attachments: string[];
  commands: Record<string, string>;
  existingWork?: { log: string; prUrl?: string; prDigest?: string };
  /** Rendered "## Architecture Context" body from the context graph (docs/10); omitted when unavailable. */
  architectureContext?: string;
}

export function prTitle(issue: JiraIssue): string {
  return `${issue.key}: ${issue.summary}`.slice(0, 120);
}

export function prBodyTemplate(issue: JiraIssue, slackThreadTs?: string): string {
  return [
    `Resolves [${issue.key}](${issue.url})`,
    '',
    '## Plan',
    '<!-- code-crafter agent: replace with your plan (files to touch, approach, risks) -->',
    '',
    '## Changes',
    '<!-- code-crafter agent: fill in before finishing -->',
    '',
    '---',
    '🤖 Opened by code-crafter. This PR stays a **draft** until a human marks it ready.',
    `<!-- ${KEY_MARKER}: ${issue.key} -->`,
    slackThreadTs ? `<!-- ${SLACK_MARKER}: ${slackThreadTs} -->` : '',
  ]
    .join('\n')
    .trimEnd();
}

/** Ensure the durable markers are present (D12 guardrail: don't trust the model with them). */
export function ensureMarkers(body: string, key: string, slackThreadTs?: string): string {
  let out = body.trimEnd();
  if (!out.includes(`${KEY_MARKER}:`)) out += `\n<!-- ${KEY_MARKER}: ${key} -->`;
  if (slackThreadTs && !out.includes(`${SLACK_MARKER}:`)) out += `\n<!-- ${SLACK_MARKER}: ${slackThreadTs} -->`;
  return out;
}

export function readSlackMarker(body: string | undefined): string | undefined {
  return body?.match(new RegExp(`<!-- ${SLACK_MARKER}: ([0-9.]+) -->`))?.[1];
}

function commandsList(commands: Record<string, string>): string {
  const entries = Object.entries(commands);
  return entries.length ? entries.map(([name, cmd]) => `- ${name}: \`${cmd}\``).join('\n') : '- (none declared)';
}

export function buildInitialPrompt(p: PromptInput): string {
  const { issue } = p;
  const sections = [
    `## Task Context
- Jira: ${issue.key} — ${issue.url}
- Repository: ${p.repoUrl}
- Base branch: \`${p.baseBranch}\`
- Your branch (already checked out): \`${p.branch}\``,

    `## Task Requirements
**${issue.summary}**

${issue.description || '_(no description)_'}`,

    `## Jira Attachments
${p.attachments.length ? p.attachments.map((a) => `- ${a}`).join('\n') : '- none'}`,
  ];

  if (p.architectureContext) sections.push(`## Architecture Context\n${p.architectureContext}`);

  if (p.branchIsNew || !p.existingWork) {
    sections.push(`## Fresh analysis
This is a new branch. Read the relevant code first (and the repo's CLAUDE.md), then plan.`);
  } else {
    sections.push(`## Existing work analysis
This branch already has work from an earlier run (the previous container stopped). **Do not redo finished work.**
Inspect the diff against \`origin/${p.baseBranch}\`, then continue from where it stopped.

Commits so far:
\`\`\`
${p.existingWork.log || '(none)'}
\`\`\`
${p.existingWork.prUrl ? `Pull request: ${p.existingWork.prUrl}\n\n${p.existingWork.prDigest ?? ''}` : 'No pull request exists yet.'}`);
  }

  sections.push(`## Workflow Context
1. If no PR exists yet: write your plan into the "## Plan" section of \`${p.prBodyFile}\` (it lives outside the repo on purpose — never copy it into the repo), then open the draft PR with an empty starting commit:
   \`git commit --allow-empty -m "${issue.key}: start work" && git push -u origin ${p.branch}\`
   \`gh pr create --draft --base ${p.baseBranch} --title "${prTitle(issue)}" --body-file ${p.prBodyFile}\`
   Keep the HTML comments at the bottom of that file untouched.
2. ${
    p.planFirst
      ? '**This ticket is labelled `plan-first`: after opening the PR with your plan, STOP. Reply with a short summary and do not write code.**'
      : 'Then implement the task, committing and pushing at the checkpoints listed in your rules.'
  }
3. Before finishing, run the repo's checks and make them pass:
${commandsList(p.commands)}
4. Update the "## Changes" section and push it with \`gh pr edit --body-file ${p.prBodyFile}\`.
5. Finish with a short summary of what you changed and anything a reviewer should look at.`);

  return sections.join('\n\n');
}

export function buildFixChecksPrompt(failures: { name: string; command: string; output: string }[]): string {
  return `The repo checks failed after your last round. Fix the code (never the CI/config to hide the failure), commit, push, and re-run the checks until they pass.

${failures.map((f) => `### ${f.name} — \`${f.command}\`\n\`\`\`\n${f.output}\n\`\`\``).join('\n\n')}`;
}

export const CONTINUE_PROMPT =
  'Continue the task from where you stopped. Check `git status` and `git log` first, commit and push any pending work, then carry on.';

// ───────────────────────────── feedback rounds (Phase 1c) ─────────────────────────────

/** Mirrors control-plane/src/router.ts AgentCommand. */
export interface AgentCommand {
  type: 'handle_comment' | 'fix_pipeline' | 'pause' | 'resume' | 'stop' | 'approve';
  jiraKey: string;
  prNumber?: number;
  delivery?: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export interface FeedbackContext {
  repo: string; // owner/name
  prNumber?: number;
  prBodyFile: string;
  commands: Record<string, string>;
}

export function describeBatch(cmds: AgentCommand[]): string {
  const comments = cmds.filter((c) => c.type === 'handle_comment');
  const ci = cmds.filter((c) => c.type === 'fix_pipeline');
  const authors = [...new Set(comments.map((c) => String(c.payload.author ?? '?')))];
  const parts = [];
  if (comments.length) parts.push(`${comments.length} comment${comments.length > 1 ? 's' : ''} from ${authors.join(', ')}`);
  if (ci.length) parts.push(`a CI failure (${ci.map((c) => c.payload.workflow ?? 'workflow').join(', ')})`);
  return parts.join(' and ');
}

function replyHow(c: AgentCommand, ctx: FeedbackContext): string {
  const p = c.payload;
  if (p.kind === 'review_comment' && p.id !== undefined) {
    return `reply in its thread: \`gh api repos/${ctx.repo}/pulls/${ctx.prNumber}/comments/${p.id}/replies -f body='…'\``;
  }
  return `reply with \`gh pr comment ${ctx.prNumber ?? ''} --body '…'\``;
}

export function buildFeedbackPrompt(cmds: AgentCommand[], ctx: FeedbackContext): string {
  const items = cmds.map((c, i) => {
    const p = c.payload;
    if (c.type === 'fix_pipeline') {
      return `### ${i + 1}. CI failed — ${p.workflow ?? 'workflow'} (${p.conclusion})
Run: ${p.url} on commit \`${String(p.headSha ?? '').slice(0, 7)}\`
Read the failure with \`gh run view ${p.runId} --log-failed\`. Fix the **code**, never the CI config.`;
    }
    if (p.kind === 'control') return `### ${i + 1}. From ${p.author}\n${p.body}`;
    const where = p.path ? `\`${p.path}${p.line ? `:${p.line}` : ''}\`` : 'the PR conversation';
    return `### ${i + 1}. ${p.kind === 'review' ? `Review (${p.reviewState})` : 'Comment'} by ${p.author} on ${where}
${p.diffHunk ? `\`\`\`diff\n${p.diffHunk}\n\`\`\`\n` : ''}> ${String(p.body ?? '').split('\n').join('\n> ')}
${p.url ? `Link: ${p.url}\n` : ''}When done, ${replyHow(c, ctx)} saying what you changed (or why you didn't).`;
  });

  return `New feedback arrived on your pull request${ctx.prNumber ? ` #${ctx.prNumber}` : ''}. Handle every item below, staying within the original ticket.

${items.join('\n\n')}

Then:
1. Commit and push (one commit per item is fine).
2. Re-run the repo checks and make them pass:
${Object.entries(ctx.commands).map(([n, c]) => `   - ${n}: \`${c}\``).join('\n') || '   - (none declared)'}
3. Update the "## Changes" section in \`${ctx.prBodyFile}\` and push it with \`gh pr edit --body-file ${ctx.prBodyFile}\`.
4. Finish with a short summary of what you changed for each item.`;
}
