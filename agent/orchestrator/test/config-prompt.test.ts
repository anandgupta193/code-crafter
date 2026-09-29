import { describe, expect, it } from 'vitest';
import { applyLabels, parseRepoConfig } from '../src/config.ts';
import type { JiraIssue } from '../src/clients/jira.ts';
import { buildInitialPrompt, ensureMarkers, prBodyTemplate, readSlackMarker } from '../src/prompt.ts';

const EXPENSE_MANAGER_YAML = `
system:
  setup:
    volta:
      enabled: true
      node: '24'
    command: 'npm'
    args: ['ci']
codecrafter:
  agent:
    provider: claude
    model: haiku
    fallback: []
    on_usage_limit: pause
  pull_request:
    draft: true
  commands:
    lint: 'npm run lint'
    build: 'npm run build'
`;

const issue: JiraIssue = {
  key: 'SCRUM-2',
  url: 'https://code-crafter.atlassian.net/browse/SCRUM-2',
  summary: 'Make agent code modular',
  description: 'Split `expenseAgent.ts`',
  labels: [],
  status: 'In Progress',
  attachments: [],
};

describe('parseRepoConfig', () => {
  it('reads the expense-manager contract', () => {
    const cfg = parseRepoConfig(EXPENSE_MANAGER_YAML);
    expect(cfg.agent).toEqual({ provider: 'claude', model: 'haiku', fallback: [], onUsageLimit: 'pause' });
    expect(cfg.setup).toEqual({ command: 'npm', args: ['ci'] });
    expect(cfg.nodeVersion).toBe('24');
    expect(cfg.commands).toEqual({ lint: 'npm run lint', build: 'npm run build' });
    expect(cfg.pullRequest.draft).toBe(true);
  });

  it('falls back to defaults without a file', () => {
    const cfg = parseRepoConfig(undefined);
    expect(cfg.agent.onUsageLimit).toBe('pause');
    expect(cfg.pullRequest.draft).toBe(true);
    expect(cfg.setup).toBeUndefined();
  });

  it('applies model and plan-first labels', () => {
    const cfg = parseRepoConfig(EXPENSE_MANAGER_YAML);
    expect(applyLabels(cfg, [])).toEqual({ model: 'haiku', planFirst: false });
    expect(applyLabels(cfg, ['model:opus', 'plan-first'])).toEqual({ model: 'opus', planFirst: true });
  });
});

describe('PR body markers', () => {
  it('template carries key and slack markers that can be read back', () => {
    const body = prBodyTemplate(issue, '1727000000.123');
    expect(body).toContain('<!-- CODECRAFTER_KEY: SCRUM-2 -->');
    expect(readSlackMarker(body)).toBe('1727000000.123');
  });

  it('ensureMarkers restores what the model deleted, idempotently', () => {
    const fixed = ensureMarkers('## Plan\nstuff', 'SCRUM-2', '1.2');
    expect(readSlackMarker(fixed)).toBe('1.2');
    expect(ensureMarkers(fixed, 'SCRUM-2', '1.2')).toBe(fixed);
  });
});

describe('buildInitialPrompt', () => {
  const base = {
    issue,
    repoUrl: 'https://github.com/anandgupta193/expense-manager.git',
    baseBranch: 'main',
    branch: 'CODE-CRAFTER-SCRUM-2',
    planFirst: false,
    prBodyFile: '.codecrafter/harness/pr-body.md',
    attachments: [],
    commands: { lint: 'npm run lint' },
  };

  it('fresh branch: fresh analysis + PR instructions', () => {
    const p = buildInitialPrompt({ ...base, branchIsNew: true });
    expect(p).toContain('## Fresh analysis');
    expect(p).toContain('gh pr create --draft --base main --title "SCRUM-2: Make agent code modular"');
    expect(p).toContain('- lint: `npm run lint`');
  });

  it('existing branch: includes prior commits and PR digest', () => {
    const p = buildInitialPrompt({ ...base, branchIsNew: false, existingWork: { log: 'abc123 SCRUM-2: split tools', prUrl: 'https://github.com/x/pull/7', prDigest: 'Draft: true' } });
    expect(p).toContain('## Existing work analysis');
    expect(p).toContain('abc123 SCRUM-2: split tools');
    expect(p).toContain('Do not redo finished work');
  });

  it('plan-first tells the agent to stop after the plan', () => {
    expect(buildInitialPrompt({ ...base, branchIsNew: true, planFirst: true })).toContain('STOP');
  });
});
