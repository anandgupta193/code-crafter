import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlackTrigger } from './slack-trigger.js';
import { summarizeGithubEvent } from './github-event.js';

test('full trigger format with Slack link wrapping and bold', () => {
  const text = [
    '*Jira ticket url* <https://code-crafter.atlassian.net/browse/SCRUM-2>',
    '*Service* expense-manager',
    '*Base branch* main',
    '*Environment* qa',
  ].join('\n');
  assert.deepEqual(parseSlackTrigger(text), {
    ok: true,
    jiraKey: 'SCRUM-2',
    jiraUrl: 'https://code-crafter.atlassian.net/browse/SCRUM-2',
    service: 'expense-manager',
    baseBranch: 'main',
    environment: 'qa',
  });
});

test('link with label', () => {
  const r = parseSlackTrigger('<https://code-crafter.atlassian.net/browse/SCRUM-7|SCRUM-7>');
  assert.equal(r.ok, true);
  assert.equal(r.jiraKey, 'SCRUM-7');
  assert.equal(r.service, undefined);
});

test('shorthand forms', () => {
  assert.equal(parseSlackTrigger('SCRUM-2').jiraKey, 'SCRUM-2');
  assert.equal(parseSlackTrigger('work on SCRUM-12 please').jiraKey, 'SCRUM-12');
});

test('colon-separated fields', () => {
  const r = parseSlackTrigger('Jira: SCRUM-3\nService: expense-manager\nBase branch: develop');
  assert.equal(r.jiraKey, 'SCRUM-3');
  assert.equal(r.service, 'expense-manager');
  assert.equal(r.baseBranch, 'develop');
});

test('rejects messages without a ticket', () => {
  assert.equal(parseSlackTrigger('hello team').ok, false);
  assert.equal(parseSlackTrigger('').ok, false);
  assert.equal(parseSlackTrigger('scrum-2 lowercase').ok, false);
});

test('rejects suspicious service / branch values', () => {
  assert.equal(parseSlackTrigger('SCRUM-2\nService: foo;rm -rf').ok, false);
  assert.equal(parseSlackTrigger('SCRUM-2\nBase branch: $(whoami)').ok, false);
});

test('github: PR comment on a code-crafter branch is routable', () => {
  const s = summarizeGithubEvent(
    { 'x-github-event': 'pull_request_review_comment', 'x-github-delivery': 'd1' },
    { action: 'created', pull_request: { number: 6, head: { ref: 'CODE-CRAFTER-SCRUM-2' } }, repository: { full_name: 'a/b' }, sender: { login: 'anandgupta193' } },
  );
  assert.equal(s.jiraKey, 'SCRUM-2');
  assert.equal(s.container, 'code-crafter-scrum-2');
  assert.equal(s.routable, true);
});

test('github: workflow run on another branch is not routable', () => {
  const s = summarizeGithubEvent({ 'x-github-event': 'workflow_run' }, { action: 'completed', workflow_run: { head_branch: 'main' } });
  assert.equal(s.routable, false);
  assert.equal(s.jiraKey, undefined);
});

test('github: review comment carries path, line and hunk', () => {
  const s = summarizeGithubEvent(
    { 'x-github-event': 'pull_request_review_comment', 'x-github-delivery': 'd2' },
    {
      action: 'created',
      pull_request: { number: 7, html_url: 'u', head: { ref: 'CODE-CRAFTER-SCRUM-6' } },
      comment: { id: 11, body: 'rename this', path: 'lib/a.ts', line: 12, diff_hunk: '@@ -1 +1 @@', html_url: 'c' },
      sender: { login: 'anandgupta193', type: 'User' },
    },
  );
  assert.deepEqual(s.comment, { id: 11, body: 'rename this', url: 'c', path: 'lib/a.ts', line: 12, diffHunk: '@@ -1 +1 @@', inReplyTo: undefined, kind: 'review_comment' });
  assert.equal(s.senderType, 'User');
});

test('github: PR conversation comment needs a branch lookup', () => {
  const s = summarizeGithubEvent(
    { 'x-github-event': 'issue_comment' },
    { action: 'created', issue: { number: 7, pull_request: {}, html_url: 'u' }, comment: { id: 5, body: '/codecrafter pause' } },
  );
  assert.equal(s.routable, false);
  assert.equal(s.needsBranchLookup, true);
  assert.equal(s.prNumber, 7);
  assert.equal(s.comment.kind, 'issue_comment');
});

test('github: merged PR and failed workflow run', () => {
  const merged = summarizeGithubEvent({ 'x-github-event': 'pull_request' }, { action: 'closed', pull_request: { number: 6, merged: true, head: { ref: 'CODE-CRAFTER-SCRUM-2' } } });
  assert.equal(merged.merged, true);
  const run = summarizeGithubEvent(
    { 'x-github-event': 'workflow_run' },
    { action: 'completed', workflow_run: { id: 99, name: 'CI', status: 'completed', conclusion: 'failure', head_sha: 'abc', head_branch: 'CODE-CRAFTER-SCRUM-2', html_url: 'r' } },
  );
  assert.deepEqual(run.run, { id: 99, name: 'CI', status: 'completed', conclusion: 'failure', headSha: 'abc', url: 'r' });
  assert.equal(run.jiraKey, 'SCRUM-2');
});
