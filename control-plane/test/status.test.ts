import { describe, expect, it } from 'vitest';
import { demuxLogs } from '../src/docker.ts';
import { cached, computePrStats } from '../src/pr-stats.ts';
import { gatherHealth, gatherTickets, prSearchLink, readLogs, slackPermalink, smeeConnected, sortTickets, type StatusDeps, type TicketRow } from '../src/status.ts';
import { MemoryStore, keys } from '../src/store.ts';
import { FakeDocker } from './fakes.ts';

const services = [{ name: 'expense-manager', repo: 'https://github.com/anandgupta193/expense-manager.git', defaultBaseBranch: 'main' }];
const NOW = 1_800_000_000_000;

function deps(over: Partial<StatusDeps> = {}): StatusDeps & { docker: FakeDocker; store: MemoryStore } {
  const docker = new FakeDocker();
  const store = new MemoryStore();
  return {
    docker,
    store,
    services,
    jiraBaseUrl: 'https://code-crafter.atlassian.net',
    slack: { channel: 'C1', workspaceUrl: 'https://code-crafter.slack.com/' },
    bridge: { connected: true, changedAt: NOW - 5 * 60_000 },
    n8nHealthy: async () => true,
    agentPhase: async (c) => (c === 'code-crafter-scrum-9' ? 'working' : 'idle'),
    now: () => NOW,
    ...over,
  } as StatusDeps & { docker: FakeDocker; store: MemoryStore };
}

describe('tickets table', () => {
  it('builds rows with state, queue, title and links; problems first', async () => {
    const d = deps();
    d.docker.containers.push(
      { name: 'code-crafter-scrum-8', key: 'SCRUM-8', state: 'running', startedAt: NOW - 20 * 60_000, service: 'expense-manager' },
      { name: 'code-crafter-scrum-9', key: 'SCRUM-9', state: 'running', startedAt: NOW - 2 * 60_000 },
      { name: 'code-crafter-scrum-7', key: 'SCRUM-7', state: 'exited', startedAt: NOW - 60 * 60_000, exitCode: 1 },
      { name: 'code-crafter-scrum-6', key: 'SCRUM-6', state: 'exited', startedAt: NOW - 90 * 60_000, exitCode: 0 },
    );
    await d.store.set(keys.title('SCRUM-8'), 'Add a search box');
    await d.store.set(keys.thread('SCRUM-8'), '1790751084.595079');
    await d.store.push(keys.commands('SCRUM-10'), '{}'); // queued, container gone
    const rows = await gatherTickets(d);
    expect(rows.map((r) => `${r.key}:${r.state}`)).toEqual(['SCRUM-7:crashed', 'SCRUM-10:queued', 'SCRUM-9:working', 'SCRUM-8:idle', 'SCRUM-6:exited']);
    const s8 = rows.find((r) => r.key === 'SCRUM-8')!;
    expect(s8.title).toBe('Add a search box');
    expect(s8.links).toEqual({
      jira: 'https://code-crafter.atlassian.net/browse/SCRUM-8',
      slack: 'https://code-crafter.slack.com/archives/C1/p1790751084595079',
      pr: 'https://github.com/anandgupta193/expense-manager/pulls?q=is%3Apr%20head%3ACODE-CRAFTER-SCRUM-8',
      logs: 'code-crafter-scrum-8',
    });
    expect(rows.find((r) => r.key === 'SCRUM-7')!.exitCode).toBe(1);
    expect(rows.find((r) => r.key === 'SCRUM-10')).toMatchObject({ queued: 1, container: undefined });
  });

  it('sorts newest first inside a state', () => {
    const r = (key: string, ageMs: number): TicketRow => ({ key, state: 'idle', ageMs, queued: 0, links: { jira: '', pr: '' } });
    expect(sortTickets([r('A-1', 50), r('A-2', 10)]).map((x) => x.key)).toEqual(['A-2', 'A-1']);
  });
});

describe('health bar', () => {
  it('reports the four pills', async () => {
    const d = deps();
    d.docker.logLines.set('code-crafter-smee-1', 'Forwarding https://smee.io/x\nConnected https://smee.io/x\n');
    const h = await gatherHealth(d);
    expect(h.map((x) => `${x.name}:${x.ok}`)).toEqual(['Slack bridge:true', 'n8n:true', 'smee:true', 'Redis:true']);
    expect(h[0].detail).toBe('connected 5 min ago');
  });

  it('flags smee errors, a stopped smee and a dead n8n', async () => {
    expect(smeeConnected("Connected x\nEvent { type: 'error', message: 'getaddrinfo EAI_AGAIN smee.io' }").ok).toBe(false);
    const d = deps({ n8nHealthy: async () => false });
    d.docker.services.set('smee', 'exited');
    const h = await gatherHealth(d);
    expect(h.find((x) => x.name === 'n8n')!.ok).toBe(false);
    expect(h.find((x) => x.name === 'smee')).toMatchObject({ ok: false, detail: 'container exited' });
  });
});

describe('logs', () => {
  it('demultiplexes Docker log frames', () => {
    const frame = (stream: number, text: string) => {
      const payload = Buffer.from(text);
      const head = Buffer.alloc(8);
      head[0] = stream;
      head.writeUInt32BE(payload.length, 4);
      return Buffer.concat([head, payload]);
    };
    expect(demuxLogs(Buffer.concat([frame(1, 'out line\n'), frame(2, 'err line\n')]))).toBe('out line\nerr line\n');
    expect(demuxLogs(Buffer.from('plain tty text'))).toBe('plain tty text');
  });

  it('redacts tokens and only reads code-crafter containers', async () => {
    const d = deps();
    d.docker.logLines.set('code-crafter-scrum-8', 'pushing with ghp_abcdefghijklmnopqrstuvwxyz123456 now');
    expect(await readLogs(d.docker, 'code-crafter-scrum-8')).toBe('pushing with ghp_«redacted» now');
    await expect(readLogs(d.docker, 'postgres')).rejects.toThrow('only code-crafter-*');
  });
});

describe('PR stats', () => {
  it('counts merged/open/closed per repo with search links', async () => {
    const seen: string[] = [];
    const s = await computePrStats(services, 'codecrafterbot', async (q) => {
      seen.push(q);
      return q.includes('is:merged') ? 3 : 0;
    }, NOW);
    expect(s.repos[0]).toMatchObject({ repo: 'anandgupta193/expense-manager', merged: 3, open: 0, closed: 0 });
    expect(s.total).toEqual({ merged: 3, open: 0, closed: 0 });
    expect(seen).toContain('repo:anandgupta193/expense-manager is:pr author:codecrafterbot is:closed is:unmerged');
  });

  it('caches for the TTL', async () => {
    let t = 0;
    let loads = 0;
    const get = cached(async () => ++loads, 1000, () => t);
    await get();
    await get();
    t = 1500;
    await get();
    expect(loads).toBe(2);
  });
});

describe('links', () => {
  it('builds Slack permalinks and PR search links', () => {
    expect(slackPermalink(undefined, 'C1', '1.2')).toBeUndefined();
    expect(prSearchLink('https://github.com/a/b.git', 'X-1')).toBe('https://github.com/a/b/pulls?q=is%3Apr%20head%3ACODE-CRAFTER-X-1');
  });
});
