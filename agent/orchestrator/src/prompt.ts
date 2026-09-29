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
1. If no PR exists yet: write your plan into the "## Plan" section of \`${p.prBodyFile}\`, make a first commit, push, and open the draft PR:
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
