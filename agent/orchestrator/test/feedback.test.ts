import { describe, expect, it } from 'vitest';
import { buildFeedbackPrompt, describeBatch, type AgentCommand } from '../src/prompt.ts';

const ctx = { repo: 'anandgupta193/expense-manager', prNumber: 7, prBodyFile: '/workspace/harness/pr-body.md', commands: { lint: 'npm run lint' } };
const cmd = (type: AgentCommand['type'], payload: Record<string, unknown>): AgentCommand => ({ type, jiraKey: 'SCRUM-6', prNumber: 7, receivedAt: 'now', payload });

describe('feedback prompt', () => {
  const inline = cmd('handle_comment', { id: 11, author: 'anandgupta193', kind: 'review_comment', body: 'rename `x`', path: 'lib/a.ts', line: 3, diffHunk: '@@ -1 +1 @@\n-x\n+y' });
  const convo = cmd('handle_comment', { author: 'anandgupta193', kind: 'issue_comment', body: 'also update docs' });
  const ci = cmd('fix_pipeline', { runId: 99, workflow: 'CI', conclusion: 'failure', url: 'https://r', headSha: 'abcdef1234' });

  it('describes a batch for Slack', () => {
    expect(describeBatch([inline, convo, ci])).toBe('2 comments from anandgupta193 and a CI failure (CI)');
  });

  it('includes location, hunk, reply instructions and CI log command', () => {
    const p = buildFeedbackPrompt([inline, convo, ci], ctx);
    expect(p).toContain('`lib/a.ts:3`');
    expect(p).toContain('```diff\n@@ -1 +1 @@');
    expect(p).toContain('gh api repos/anandgupta193/expense-manager/pulls/7/comments/11/replies');
    expect(p).toContain('gh pr comment 7');
    expect(p).toContain('gh run view 99 --log-failed');
    expect(p).toContain('never the CI config');
    expect(p).toContain('- lint: `npm run lint`');
  });
});
