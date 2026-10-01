import { beforeEach, describe, expect, it } from 'vitest';
import type { Chat, Tickets } from '../src/clients.ts';
import type { GitHubReader, PrInfo } from '../src/github.ts';
import { EventRouter, type AgentCommand, type GithubEvent } from '../src/router.ts';
import { Spawner } from '../src/spawner.ts';
import { MemoryStore, keys } from '../src/store.ts';
import { FakeDocker } from './fakes.ts';

const services = [{ name: 'expense-manager', repo: 'https://github.com/anandgupta193/expense-manager.git', defaultBaseBranch: 'main' }];
const repo = 'anandgupta193/expense-manager';
const branch = 'CODE-CRAFTER-SCRUM-2';

class FakeGitHub implements GitHubReader {
  pr: PrInfo = { number: 6, state: 'closed', merged: true, draft: false, headRef: branch, headSha: 'sha2', body: '<!-- SLACK_THREAD_TS: 111.222 -->', url: 'u' };
  authors = new Map<number, string>([[11, 'anandgupta193']]);
  head = 'sha2';
  async getPr() {
    return this.pr;
  }
  async commentAuthor(_r: string, _k: string, id: number) {
    return this.authors.get(id);
  }
  async branchHead() {
    return this.head;
  }
}

class RecChat implements Chat {
  posts: string[] = [];
  reactions: string[] = [];
  async post(_c: string, t: string, thread?: string) {
    this.posts.push(`${thread}|${t}`);
    return '1';
  }
  async react(_c: string, ts: string, e: string) {
    this.reactions.push(`${ts}:${e}`);
  }
}

let gh: FakeGitHub, chat: RecChat, docker: FakeDocker, store: MemoryStore, delivered: AgentCommand[], alive: boolean, transitions: string[], router: EventRouter;

beforeEach(() => {
  gh = new FakeGitHub();
  chat = new RecChat();
  docker = new FakeDocker();
  store = new MemoryStore();
  delivered = [];
  alive = true;
  transitions = [];
  const tickets: Tickets = {
    lookup: async () => ({ summary: 's', url: 'u', status: 'In Progress' }),
    transitionForward: async (_k, t) => {
      transitions.push(t);
      return true;
    },
    comment: async () => {},
  };
  const spawner = new Spawner({ agentImage: 'i', network: 'n', maxConcurrent: 2, services, agentEnvNames: [] }, docker, store, async () => true, {});
  router = new EventRouter({
    services,
    allowedUsers: ['anandgupta193'],
    slackChannel: 'C1',
    github: gh,
    tickets,
    chat,
    store,
    docker,
    spawner,
    deliver: async (_c, cmd) => {
      if (alive) delivered.push(cmd);
      return alive;
    },
  });
});

const comment = (over: Partial<GithubEvent> = {}): GithubEvent => ({
  event: 'pull_request_review_comment',
  action: 'created',
  delivery: `d-${Math.random()}`,
  repo,
  sender: 'anandgupta193',
  senderType: 'User',
  prNumber: 6,
  branch,
  comment: { id: 11, body: 'please rename', kind: 'review_comment', path: 'lib/a.ts', line: 3 },
  ...over,
});

describe('EventRouter', () => {
  it('merge → Jira Done, ✅ on the trigger thread, container + volume removed', async () => {
    docker.containers.push({ name: 'code-crafter-scrum-2', key: 'SCRUM-2', state: 'exited', startedAt: 0 });
    docker.volumes.push('codecrafter-home-scrum-2');
    const r = await router.handle({ event: 'pull_request', action: 'closed', repo, prNumber: 6, branch, merged: true, sender: 'anandgupta193' });
    expect(r).toContain('merged');
    expect(transitions).toEqual(['Done']);
    expect(chat.reactions).toEqual(['111.222:white_check_mark']);
    expect(docker.containers).toHaveLength(0);
    expect(docker.volumes).toHaveLength(0);
  });

  it('does not trust a forged merge payload', async () => {
    gh.pr = { ...gh.pr, merged: false };
    const r = await router.handle({ event: 'pull_request', action: 'closed', repo, prNumber: 6, branch, merged: true });
    expect(r).toContain('closed unmerged');
    expect(transitions).toEqual([]);
  });

  it('refreshes PR stats when a code-crafter PR opens or closes', async () => {
    let changes = 0;
    (router as any).d.onPrChange = () => changes++;
    await router.handle({ event: 'pull_request', action: 'closed', repo, prNumber: 6, branch, merged: true });
    await router.handle({ event: 'pull_request', action: 'opened', repo, prNumber: 9, branch });
    await router.handle({ event: 'pull_request', action: 'synchronize', repo, prNumber: 9, branch });
    expect(changes).toBe(2);
  });

  it('ready_for_review → Jira In Review', async () => {
    await router.handle({ event: 'pull_request', action: 'ready_for_review', repo, prNumber: 6, branch });
    expect(transitions).toEqual(['In Review']);
  });

  it('delivers an allow-listed review comment to the live container', async () => {
    const r = await router.handle(comment());
    expect(r).toBe('handle_comment → code-crafter-scrum-2');
    expect(delivered[0]).toMatchObject({ type: 'handle_comment', jiraKey: 'SCRUM-2', payload: { body: 'please rename', path: 'lib/a.ts', line: 3 } });
  });

  it('queues and respawns when the container is gone', async () => {
    alive = false;
    const r = await router.handle(comment());
    expect(r).toBe('handle_comment queued, respawn: started');
    expect(await store.drain(keys.commands('SCRUM-2'))).toHaveLength(1);
    expect(docker.created[0].env.SLACK_THREAD_TS).toBeUndefined(); // no thread known in this test
  });

  it('ignores bots, strangers, forged comments and duplicates', async () => {
    expect(await router.handle(comment({ sender: 'vercel[bot]', senderType: 'Bot' }))).toBe('ignored (bot)');
    expect(await router.handle(comment({ sender: 'stranger' }))).toContain('not allow-listed');
    gh.authors.clear();
    expect(await router.handle(comment())).toContain('author mismatch');
    gh.authors.set(11, 'anandgupta193');
    const e = comment({ delivery: 'same' });
    await router.handle(e);
    expect(await router.handle(e)).toBe('duplicate delivery');
    expect(delivered).toHaveLength(1);
  });

  it('turns /codecrafter verbs into control commands', async () => {
    await router.handle(comment({ comment: { id: 11, body: '/codecrafter pause', kind: 'issue_comment' } }));
    expect(delivered[0].type).toBe('pause');
  });

  it('looks up the branch for PR conversation comments', async () => {
    const r = await router.handle(comment({ event: 'issue_comment', branch: undefined, needsBranchLookup: true, comment: { id: 11, body: 'hi', kind: 'issue_comment' } }));
    expect(r).toBe('handle_comment → code-crafter-scrum-2');
  });

  it('CI failure on HEAD → fix_pipeline; on a superseded commit → ignored', async () => {
    const run = (sha: string): GithubEvent => ({ event: 'workflow_run', action: 'completed', repo, branch, run: { id: 9, conclusion: 'failure', headSha: sha, url: 'r' } });
    expect(await router.handle(run('sha1'))).toContain('superseded');
    expect(await router.handle(run('sha2'))).toBe('fix_pipeline → code-crafter-scrum-2');
    expect(await router.handle({ ...run('sha2'), run: { id: 9, conclusion: 'success' } })).toContain('ignored');
  });

  it('ignores branches and repos that are not ours', async () => {
    expect(await router.handle(comment({ branch: 'feature/x' }))).toContain('not a code-crafter branch');
    expect(await router.handle(comment({ repo: 'someone/else' }))).toContain('not registered');
  });
});
