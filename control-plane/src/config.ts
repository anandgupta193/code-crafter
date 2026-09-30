import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface Service {
  name: string;
  repo: string;
  defaultBaseBranch: string;
}

export interface Config {
  port: number;
  internalToken: string;
  redisUrl: string;
  n8nWebhookBase: string;
  agentImage: string;
  network: string;
  maxConcurrent: number;
  hardCapMs: number;
  slack: { botToken?: string; appToken?: string; channel?: string; allowedUsers: string[] };
  jira: { baseUrl: string; email: string; token: string };
  services: Service[];
  /** Env var names forwarded into each agent container (D17: full env for now, but only what the agent uses). */
  agentEnvNames: string[];
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

export function parseServices(text: string): Service[] {
  const raw = parse(text)?.services ?? {};
  return Object.entries(raw).map(([name, s]: [string, any]) => ({
    name,
    repo: String(s.repo),
    defaultBaseBranch: String(s.default_base_branch ?? 'main'),
  }));
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    internalToken: required('INTERNAL_API_TOKEN'),
    redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
    n8nWebhookBase: process.env.N8N_WEBHOOK_BASE ?? 'http://n8n:5678/webhook',
    agentImage: process.env.AGENT_IMAGE ?? 'code-crafter-agent',
    network: process.env.AGENT_NETWORK ?? 'codecrafter',
    maxConcurrent: Number(process.env.CC_MAX_CONCURRENT ?? 2),
    hardCapMs: Number(process.env.CC_HARD_CAP_MIN ?? 90) * 60_000,
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      channel: process.env.SLACK_TRIGGER_CHANNEL_ID,
      allowedUsers: (process.env.SLACK_ALLOWED_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    },
    jira: { baseUrl: required('JIRA_BASE_URL').replace(/\/$/, ''), email: required('JIRA_EMAIL'), token: required('JIRA_API_TOKEN') },
    services: parseServices(readFileSync(process.env.SERVICES_FILE ?? '/config/services.yaml', 'utf8')),
    agentEnvNames: [
      'GITHUB_TOKEN',
      'JIRA_BASE_URL',
      'JIRA_EMAIL',
      'JIRA_API_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'SLACK_BOT_TOKEN',
      'SLACK_TRIGGER_CHANNEL_ID',
      'GIT_USER_NAME',
      'GIT_USER_EMAIL',
      'TZ',
      'CC_SOFT_TIMEOUT_MIN',
      'CC_MAX_CONTINUATIONS',
      'CC_IDLE_TTL_MIN',
      'CC_HARD_CAP_MIN',
      'CC_GRACE_MIN',
    ],
  };
}

export const containerName = (jiraKey: string) => `code-crafter-${jiraKey.toLowerCase()}`;
export const volumeName = (jiraKey: string) => `codecrafter-home-${jiraKey.toLowerCase()}`;
