import { describe, expect, it } from 'vitest';
import type { Chat, Tickets } from '../src/clients.ts';
import { parseServices } from '../src/config.ts';
import { Intake } from '../src/intake.ts';
import { reapOnce } from '../src/reaper.ts';
import { decide } from '../src/slack-bridge.ts';
import { Spawner } from '../src/spawner.ts';
import { MemoryStore, keys } from '../src/store.ts';
import { FakeDocker } from './fakes.ts';

describe('slack bridge filter', () => {
  const ok = { type: 'message', channel: 'C1', user: 'U1', text: 'SCRUM-2', ts: '1.1' };
  it('forwards top-level messages from allowed users in the trigger channel', () => {
    expect(decide(ok, 'C1', ['U1'])).toEqual({ forward: true });
  });
  it('ignores bots, edits, thread replies and other channels', () => {
    expect(decide({ ...ok, bot_id: 'B1' }, 'C1', ['U1']).forward).toBe(false);
    expect(decide({ ...ok, subtype: 'message_changed' }, 'C1', ['U1']).forward).toBe(false);
    expect(decide({ ...ok, thread_ts: '0.9' }, 'C1', ['U1']).forward).toBe(false);
    expect(decide({ ...ok, channel: 'C2' }, 'C1', ['U1']).forward).toBe(false);
  });
  it('flags non-allow-listed users for a polite reply', () => {
    expect(decide({ ...ok, user: 'U9' }, 'C1', ['U1'])).toMatchObject({ forward: false, notify: true });
  });
});

describe('services.yaml', () => {
  it('parses the registry', () => {
    const s = parseServices('services:\n  expense-manager:\n    repo: https://x/y.git\n    default_base_branch: main\n');
    expect(s).toEqual([{ name: 'expense-manager', repo: 'https://x/y.git', defaultBaseBranch: 'main' }]);
  });
});

class FakeChat implements Chat {
  posts: string[] = [];
  reactions: string[] = [];
  async post(_c: string, text: string) {
    this.posts.push(text);
    return '9.9';
  }
  async react(_c: string, _ts: string, emoji: string) {
    this.reactions.push(emoji);
  }
}

describe('Intake', () => {
  const services = [{ name: 'expense-manager', repo: 'r', defaultBaseBranch: 'main' }];
  const make = (known: string[]) => {
    const chat = new FakeChat();
    const tickets: Tickets = { lookup: async (k) => (known.includes(k) ? { summary: 'Make agent code modular', url: `https://j/browse/${k}` } : undefined) };
    const spawner = new Spawner({ agentImage: 'i', network: 'n', maxConcurrent: 2, services, agentEnvNames: [] }, new FakeDocker(), new MemoryStore(), async () => true, {});
    return { chat, intake: new Intake(spawner, chat, tickets, ['U1']) };
  };
  const slack = { channel: 'C1', ts: '1.1', user: 'U1' };

  it('spawns and replies in the thread with 👀', async () => {
    const { chat, intake } = make(['SCRUM-2']);
    const r = await intake.handle({ ok: true, jiraKey: 'SCRUM-2', slack });
    expect(r.status).toBe('started');
    expect(chat.reactions).toEqual(['eyes']);
    expect(chat.posts[0]).toContain('Picked up');
  });

  it('explains parse failures and unknown tickets', async () => {
    const { chat, intake } = make([]);
    await intake.handle({ ok: false, reason: 'no Jira ticket found', slack });
    await intake.handle({ ok: true, jiraKey: 'SCRUM-99', slack });
    expect(chat.posts[0]).toContain('no Jira ticket found');
    expect(chat.posts[1]).toContain('SCRUM-99 was not found');
    expect(chat.reactions).toEqual(['x', 'x']);
  });

  it('ignores users outside the allow-list', async () => {
    const { chat, intake } = make(['SCRUM-2']);
    expect((await intake.handle({ ok: true, jiraKey: 'SCRUM-2', slack: { ...slack, user: 'U9' } })).status).toBe('rejected');
    expect(chat.posts).toHaveLength(0);
  });
});

describe('reaper', () => {
  const now = 1_000_000_000_000;
  it('stops containers past the hard cap and removes old exited ones', async () => {
    const docker = new FakeDocker();
    docker.containers.push(
      { name: 'code-crafter-a-1', key: 'A-1', state: 'running', startedAt: now - 120 * 60_000 },
      { name: 'code-crafter-a-2', key: 'A-2', state: 'running', startedAt: now - 30 * 60_000 },
      { name: 'code-crafter-a-3', key: 'A-3', state: 'exited', startedAt: now - 3 * 3600_000 },
    );
    const actions = await reapOnce(docker, new MemoryStore(), { hardCapMs: 90 * 60_000, now: () => now });
    expect(docker.stopped).toEqual(['code-crafter-a-1']);
    expect(docker.containers.map((c) => c.name)).toEqual(['code-crafter-a-1', 'code-crafter-a-2']);
    expect(actions).toHaveLength(2);
  });

  it('removes volumes idle for 7 days, starts tracking unknown ones', async () => {
    const docker = new FakeDocker();
    const store = new MemoryStore();
    docker.volumes = ['codecrafter-home-scrum-2', 'codecrafter-home-scrum-3'];
    await store.set(keys.lastActive('SCRUM-2'), String(now - 8 * 24 * 3600_000));
    await reapOnce(docker, store, { hardCapMs: 90 * 60_000, now: () => now });
    expect(docker.volumes).toEqual(['codecrafter-home-scrum-3']);
    expect(await store.get(keys.lastActive('SCRUM-3'))).toBe(String(now));
  });
});

describe('reaper crash reports', () => {
  it('reports a crashed container once', async () => {
    const docker = new FakeDocker();
    const store = new MemoryStore();
    const now = Date.now();
    docker.containers.push({ name: 'code-crafter-scrum-7', key: 'SCRUM-7', state: 'exited', startedAt: now - 60_000, exitCode: 1 });
    const reported: string[] = [];
    const opts = { hardCapMs: 90 * 60_000, now: () => now, reportCrash: async (k: string, _n: string, code: number) => void reported.push(`${k}:${code}`) };
    await reapOnce(docker, store, opts);
    await reapOnce(docker, store, opts);
    expect(reported).toEqual(['SCRUM-7:1']);
  });
});
