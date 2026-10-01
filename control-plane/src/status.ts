// Status page data (docs/17-status-page.md): one job — show what broke and why.
//   health bar (Slack bridge · n8n · smee · Redis · Graph) · tickets table · logs · PR stats

import { containerName, type Service } from './config.ts';
import type { DockerApi, TicketContainer } from './docker.ts';
import { redact } from './log.ts';
import type { PrStats } from './pr-stats.ts';
import { keys, type Store } from './store.ts';

export interface Health {
  name: 'Slack bridge' | 'n8n' | 'smee' | 'Redis' | 'Graph';
  ok: boolean;
  detail: string;
}

export type TicketState = 'crashed' | 'queued' | 'working' | 'idle' | 'exited';

export interface TicketRow {
  key: string;
  title?: string;
  state: TicketState;
  exitCode?: number;
  ageMs?: number;
  queued: number;
  container?: string;
  links: { jira: string; slack?: string; pr: string; logs?: string };
}

export interface StatusDeps {
  docker: DockerApi;
  store: Store;
  services: Service[];
  jiraBaseUrl: string;
  slack: { channel?: string; workspaceUrl?: string };
  bridge?: { connected: boolean; changedAt: number };
  /** n8n reachability (GET /healthz). */
  n8nHealthy: () => Promise<boolean>;
  /** Running agent's own phase: 'working' | 'idle' | … (GET :8080/state). */
  agentPhase: (container: string) => Promise<string | undefined>;
  prStats?: () => Promise<PrStats>;
  /** Context graph health (Neo4j answers + last ingest), when configured (docs/10). */
  graph?: () => Promise<{ ok: boolean; detail: string }>;
  now?: () => number;
}

const ORDER: Record<TicketState, number> = { crashed: 0, queued: 1, working: 2, idle: 3, exited: 4 };

export const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
};

/** Slack permalink for a message ts: https://<workspace>.slack.com/archives/<channel>/p<ts without dot>. */
export function slackPermalink(workspaceUrl: string | undefined, channel: string | undefined, ts: string | undefined): string | undefined {
  if (!workspaceUrl || !channel || !ts) return undefined;
  return `${workspaceUrl.replace(/\/$/, '')}/archives/${channel}/p${ts.replace('.', '')}`;
}

export function prSearchLink(repoUrl: string, key: string): string {
  const slug = repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  return `https://github.com/${slug}/pulls?q=${encodeURIComponent(`is:pr head:CODE-CRAFTER-${key}`)}`;
}

/** smee's last connection-related log line decides whether GitHub events can reach us. */
export function smeeConnected(logText: string): { ok: boolean; detail: string } {
  const lines = logText.trim().split('\n').filter((l) => /Connected|error|Forwarding/i.test(l));
  const last = lines[lines.length - 1] ?? '';
  if (/Connected/i.test(last)) return { ok: true, detail: 'connected to smee.io' };
  if (/error/i.test(last)) return { ok: false, detail: `disconnected: ${last.replace(/\s+/g, ' ').slice(0, 120)}` };
  return { ok: false, detail: 'no connection yet' };
}

export async function gatherHealth(d: StatusDeps): Promise<Health[]> {
  const now = d.now?.() ?? Date.now();
  const slack: Health = d.bridge
    ? {
        name: 'Slack bridge',
        ok: d.bridge.connected,
        detail: d.bridge.connected ? `connected ${ago(now - d.bridge.changedAt)}` : `disconnected ${ago(now - d.bridge.changedAt)}`,
      }
    : { name: 'Slack bridge', ok: false, detail: 'disabled (no SLACK_APP_TOKEN)' };

  const n8nOk = await d.n8nHealthy().catch(() => false);
  const smeeC = await d.docker.composeService('smee').catch(() => undefined);
  let smee: Health;
  if (!smeeC) smee = { name: 'smee', ok: false, detail: 'container not found' };
  else if (smeeC.state !== 'running') smee = { name: 'smee', ok: false, detail: `container ${smeeC.state}` };
  else {
    const c = smeeConnected(await d.docker.logs(smeeC.name, 30).catch(() => ''));
    smee = { name: 'smee', ...c };
  }
  const redisOk = await d.store.ping().catch(() => false);

  return [
    slack,
    { name: 'n8n', ok: n8nOk, detail: n8nOk ? 'healthy' : 'not answering /healthz' },
    smee,
    { name: 'Redis', ok: redisOk, detail: redisOk ? 'PONG' : 'not answering PING' },
    ...(d.graph ? [{ name: 'Graph' as const, ...(await d.graph().catch(() => ({ ok: false, detail: 'Neo4j not answering' }))) }] : []),
  ];
}

export async function gatherTickets(d: StatusDeps): Promise<TicketRow[]> {
  const now = d.now?.() ?? Date.now();
  const containers = await d.docker.listTicketContainers();
  const byKey = new Map<string, TicketContainer>(containers.map((c) => [c.key, c]));

  // Tickets with queued commands but possibly no container ("my comment is waiting").
  const queuedKeys = (await d.store.scan('codecrafter:commands:*')).map((k) => k.slice('codecrafter:commands:'.length));
  const allKeys = [...new Set([...byKey.keys(), ...queuedKeys])];

  const rows = await Promise.all(
    allKeys.map(async (key): Promise<TicketRow> => {
      const c = byKey.get(key);
      const queued = await d.store.llen(keys.commands(key));
      const service = d.services.find((s) => s.name === c?.service) ?? d.services[0];
      let state: TicketState;
      if (!c) state = 'queued';
      else if (c.state === 'running') state = (await d.agentPhase(c.name).catch(() => undefined)) === 'working' ? 'working' : 'idle';
      else if (c.exitCode) state = 'crashed';
      else state = queued ? 'queued' : 'exited';
      return {
        key,
        title: await d.store.get(keys.title(key)),
        state,
        exitCode: c?.exitCode,
        ageMs: c ? now - c.startedAt : undefined,
        queued,
        container: c?.name,
        links: {
          jira: `${d.jiraBaseUrl}/browse/${key}`,
          slack: slackPermalink(d.slack.workspaceUrl, d.slack.channel, await d.store.get(keys.thread(key))),
          pr: service ? prSearchLink(service.repo, key) : '',
          logs: c ? containerName(key) : undefined,
        },
      };
    }),
  );
  return sortTickets(rows);
}

/** Problems first: crashed → queued → working → idle → exited; newest first inside a group. */
export function sortTickets(rows: TicketRow[]): TicketRow[] {
  return [...rows].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.ageMs ?? 0) - (b.ageMs ?? 0));
}

export async function gatherStatus(d: StatusDeps) {
  const [health, tickets, prStats] = await Promise.all([
    gatherHealth(d),
    gatherTickets(d).catch((e) => ({ error: String(e) })),
    d.prStats ? d.prStats().catch((e) => ({ error: String(e) })) : Promise.resolve(undefined),
  ]);
  return { generatedAt: new Date(d.now?.() ?? Date.now()).toISOString(), health, tickets, prStats };
}

const LOG_NAME = /^code-crafter-[a-z0-9-]+$/;

/** Last 300 lines of a code-crafter container, redacted. Only code-crafter-* containers may be read. */
export async function readLogs(docker: DockerApi, name: string, tail = 300): Promise<string> {
  if (!LOG_NAME.test(name)) throw new Error('only code-crafter-* containers');
  return redact(await docker.logs(name, tail));
}
