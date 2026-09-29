import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

/** Everything the container was started with (see scripts/entrypoint.sh). */
export interface TicketContext {
  jiraKey: string;
  repoUrl: string;
  baseBranch: string;
  branch: string;
  branchIsNew: boolean;
  repoDir: string;
  stateDir: string;
  harnessDir: string;
  slackThreadTs?: string;
}

export interface Timers {
  softTimeoutMs: number;
  maxContinuations: number;
  idleTtlMs: number;
  hardCapMs: number;
  graceMs: number;
}

/** Parsed `codecrafter.yaml` from the target repo, with defaults. */
export interface RepoConfig {
  agent: {
    provider: string;
    model: string;
    fallback: string[];
    onUsageLimit: 'pause' | 'fallback';
  };
  pullRequest: { draft: boolean };
  setup?: { command: string; args: string[] };
  nodeVersion?: string;
  commands: Record<string, string>;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

const minutes = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 60_000;

export function loadTicketContext(): TicketContext {
  const jiraKey = required('JIRA_TASK_KEY');
  const repoDir = process.env.REPO_DIR ?? '/workspace/repo';
  const stateDir = process.env.STATE_DIR ?? path.join(process.env.HOME ?? '/home/node', '.codecrafter', jiraKey);
  return {
    jiraKey,
    repoUrl: required('WORKSPACE_REPO'),
    baseBranch: process.env.WORKSPACE_BASE_BRANCH ?? 'main',
    branch: required('BRANCH_NAME'),
    branchIsNew: process.env.BRANCH_IS_NEW === 'true',
    repoDir,
    stateDir,
    harnessDir: process.env.HARNESS_DIR ?? '/workspace/harness',
    slackThreadTs: process.env.SLACK_THREAD_TS || undefined,
  };
}

export function loadTimers(): Timers {
  return {
    softTimeoutMs: minutes('CC_SOFT_TIMEOUT_MIN', 10),
    maxContinuations: Number(process.env.CC_MAX_CONTINUATIONS ?? 3),
    idleTtlMs: minutes('CC_IDLE_TTL_MIN', 40),
    hardCapMs: minutes('CC_HARD_CAP_MIN', 90),
    graceMs: minutes('CC_GRACE_MIN', 2),
  };
}

export function parseRepoConfig(text: string | undefined): RepoConfig {
  const raw = (text ? parse(text) : {}) ?? {};
  const cc = raw.codecrafter ?? {};
  const agent = cc.agent ?? {};
  const setup = raw.system?.setup ?? {};
  const onUsageLimit = agent.on_usage_limit === 'fallback' ? 'fallback' : 'pause';
  return {
    agent: {
      provider: agent.provider ?? process.env.AGENT_PROVIDER ?? 'claude',
      model: agent.model ?? 'sonnet',
      fallback: Array.isArray(agent.fallback) ? agent.fallback.map(String) : [],
      onUsageLimit,
    },
    pullRequest: { draft: cc.pull_request?.draft ?? true },
    setup: setup.command ? { command: String(setup.command), args: (setup.args ?? []).map(String) } : undefined,
    nodeVersion: setup.volta?.enabled ? String(setup.volta.node ?? '') || undefined : undefined,
    commands: Object.fromEntries(Object.entries(cc.commands ?? {}).map(([k, v]) => [k, String(v)])),
  };
}

export async function loadRepoConfig(repoDir: string): Promise<RepoConfig> {
  const text = await readFile(path.join(repoDir, 'codecrafter.yaml'), 'utf8').catch(() => undefined);
  return parseRepoConfig(text);
}

/** Per-ticket overrides carried as Jira labels: `model:opus`, `plan-first`. */
export function applyLabels(cfg: RepoConfig, labels: string[]): { model: string; planFirst: boolean } {
  const modelLabel = labels.find((l) => l.startsWith('model:'));
  return {
    model: modelLabel ? modelLabel.slice('model:'.length) : cfg.agent.model,
    planFirst: labels.includes('plan-first'),
  };
}
