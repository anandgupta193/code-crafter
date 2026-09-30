import { beforeEach, describe, expect, it } from 'vitest';
import { Spawner } from '../src/spawner.ts';
import { MemoryStore, keys } from '../src/store.ts';
import { FakeDocker } from './fakes.ts';

const services = [{ name: 'expense-manager', repo: 'https://github.com/anandgupta193/expense-manager.git', defaultBaseBranch: 'main' }];
const cfg = { agentImage: 'code-crafter-agent', network: 'codecrafter', maxConcurrent: 2, services, agentEnvNames: ['GITHUB_TOKEN', 'JIRA_API_TOKEN'] };
const env = { GITHUB_TOKEN: 'ghp_x', JIRA_API_TOKEN: 'j', UNRELATED_SECRET: 'nope' };

let docker: FakeDocker;
let store: MemoryStore;
let healthy: boolean;
let spawner: Spawner;

beforeEach(() => {
  docker = new FakeDocker();
  store = new MemoryStore();
  healthy = true;
  spawner = new Spawner(cfg, docker, store, async () => healthy, env);
});

describe('Spawner', () => {
  it('starts a container with the four-variable contract, volume and allow-listed env only', async () => {
    const r = await spawner.spawn({ jiraKey: 'SCRUM-2', slackThreadTs: '1.2' });
    expect(r).toMatchObject({ status: 'started', container: 'code-crafter-scrum-2', service: 'expense-manager', baseBranch: 'main' });
    const spec = docker.created[0];
    expect(spec.env).toEqual({
      GITHUB_TOKEN: 'ghp_x',
      JIRA_API_TOKEN: 'j',
      WORKSPACE_REPO: services[0].repo,
      WORKSPACE_BASE_BRANCH: 'main',
      JIRA_TASK_KEY: 'SCRUM-2',
      SLACK_THREAD_TS: '1.2',
    });
    expect(spec.volume).toEqual({ name: 'codecrafter-home-scrum-2', mountPath: '/home/node' });
    expect(spec.network).toBe('codecrafter');
    expect(await store.get(keys.thread('SCRUM-2'))).toBe('1.2');
    expect(store.data.has(keys.spawnLock('SCRUM-2'))).toBe(false); // lock released
  });

  it('dedupes a running healthy container', async () => {
    docker.containers.push({ name: 'code-crafter-scrum-2', key: 'SCRUM-2', state: 'running', startedAt: Date.now() - 10 * 60_000 });
    const r = await spawner.spawn({ jiraKey: 'SCRUM-2' });
    expect(r.status).toBe('already-running');
    expect(docker.created).toHaveLength(0);
  });

  it('replaces a running but unhealthy container past the start grace', async () => {
    healthy = false;
    docker.containers.push({ name: 'code-crafter-scrum-2', key: 'SCRUM-2', state: 'running', startedAt: Date.now() - 10 * 60_000 });
    expect((await spawner.spawn({ jiraKey: 'SCRUM-2' })).status).toBe('started');
  });

  it('replaces an exited container (resume path)', async () => {
    docker.containers.push({ name: 'code-crafter-scrum-2', key: 'SCRUM-2', state: 'exited', startedAt: 0 });
    expect((await spawner.spawn({ jiraKey: 'SCRUM-2', resume: true })).status).toBe('started');
    expect(docker.containers.filter((c) => c.name === 'code-crafter-scrum-2')).toHaveLength(1);
  });

  it('enforces the concurrency cap (D3), not counting exited containers', async () => {
    docker.containers.push(
      { name: 'code-crafter-scrum-3', key: 'SCRUM-3', state: 'running', startedAt: Date.now() },
      { name: 'code-crafter-scrum-4', key: 'SCRUM-4', state: 'running', startedAt: Date.now() },
      { name: 'code-crafter-scrum-5', key: 'SCRUM-5', state: 'exited', startedAt: 0 },
    );
    const r = await spawner.spawn({ jiraKey: 'SCRUM-2' });
    expect(r.status).toBe('queue-full');
    expect(r.message).toContain('SCRUM-3, SCRUM-4');
  });

  it('serialises spawns per ticket with a lock', async () => {
    await store.acquire(keys.spawnLock('SCRUM-2'), 60);
    expect((await spawner.spawn({ jiraKey: 'SCRUM-2' })).status).toBe('busy');
  });

  it('rejects unknown services and bad keys, and reports a missing image', async () => {
    expect((await spawner.spawn({ jiraKey: 'SCRUM-2', service: 'nope' })).status).toBe('rejected');
    expect((await spawner.spawn({ jiraKey: 'scrum-2' })).status).toBe('rejected');
    docker.image = false;
    expect((await spawner.spawn({ jiraKey: 'SCRUM-2' })).status).toBe('error');
  });
});
