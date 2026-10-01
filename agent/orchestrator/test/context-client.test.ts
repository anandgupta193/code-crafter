import { describe, expect, it } from 'vitest';
import type { ServiceFacts } from '../src/context/briefing.ts';
import { ContextClient, mentionedServices, type GraphReader } from '../src/context/context-client.ts';

const facts = (name: string, over: Partial<ServiceFacts> = {}): ServiceFacts => ({
  name,
  repo: `https://github.com/anandgupta193/${name}`,
  description: '',
  stack: [],
  endpoints: [{ method: 'GET', path: `/${name}`, auth: '', handler: '', description: '', calledBy: [] }],
  calls: [],
  databases: [],
  libraries: [],
  ...over,
});

class FakeReader implements GraphReader {
  queries: string[] = [];
  async services() {
    return ['expense-manager', 'billing', 'notifier', 'reports'].map((name) => ({ name, repo: `https://github.com/anandgupta193/${name}` }));
  }
  async facts(name: string) {
    return name === 'ghost' ? undefined : facts(name);
  }
  async neighbours(name: string) {
    return name === 'expense-manager' ? { calls: ['billing'], calledBy: ['notifier'] } : { calls: [], calledBy: [] };
  }
  async similarChunks(service: string, vector: number[], k: number, minScore: number) {
    this.queries.push(`${service}:${vector.length}:${k}:${minScore}`);
    return [
      { path: 'docs/architecture.md', heading: 'Auth Flow', text: 'Google sign-in.', score: 0.83 },
      { path: 'docs/hooks.md', heading: 'useAuth', text: 'Auth hook.', score: 0.82 },
      { path: 'docs/pwa.md', heading: 'Notifications', text: 'Loosely related.', score: 0.8 },
    ];
  }
}

const issue = { summary: 'Show the reports total on the dashboard', description: 'Use the Reports service numbers.' };

describe('mentionedServices', () => {
  it('finds other service names as whole words, case-insensitively', () => {
    expect(mentionedServices('Call the BILLING api, not billings or e-billing-x', ['billing', 'expense-manager'], 'expense-manager')).toEqual(['billing']);
    expect(mentionedServices('nothing here', ['billing'], 'expense-manager')).toEqual([]);
  });
});

describe('ContextClient', () => {
  it('builds the briefing: this repo, one-hop neighbours, services named in the ticket, top doc chunks', async () => {
    const reader = new FakeReader();
    const client = new ContextClient(reader, async (texts) => texts.map(() => [0.1, 0.2, 0.3]));
    const r = await client.build('https://github.com/anandgupta193/expense-manager.git', issue);
    if (!r.ok) throw new Error(r.reason);
    expect(r.briefing.self.name).toBe('expense-manager');
    expect(r.briefing.related.map((x) => `${x.facts.name}: ${x.relation}`)).toEqual([
      'billing: called by expense-manager',
      'notifier: calls expense-manager',
      'reports: mentioned in the ticket',
    ]);
    // Only chunks within 0.015 of the best score survive.
    expect(r.briefing.chunks.map((c) => c.heading)).toEqual(['Auth Flow', 'useAuth']);
    expect(reader.queries).toEqual(['expense-manager:3:3:0.6']);
    expect(r.summary).toBe('1 fact, 2 doc chunks, 3 related services');
  });

  it('embeds the ticket with the search_query prefix', async () => {
    const seen: string[] = [];
    const client = new ContextClient(new FakeReader(), async (texts) => {
      seen.push(...texts);
      return texts.map(() => [1]);
    });
    await client.build('https://github.com/anandgupta193/expense-manager', issue);
    expect(seen).toEqual(['search_query: Show the reports total on the dashboard\nUse the Reports service numbers.']);
  });

  it('still returns graph facts when embeddings fail', async () => {
    const client = new ContextClient(new FakeReader(), async () => {
      throw new Error('ollama down');
    });
    const r = await client.build('https://github.com/anandgupta193/expense-manager', issue);
    expect(r.ok && r.briefing.chunks).toEqual([]);
    expect(r.ok && r.summary).toContain('docs skipped: ollama down');
  });

  it('skips cleanly when the repo is not in the graph or the graph is down', async () => {
    const client = new ContextClient(new FakeReader(), async () => [[1]]);
    expect(await client.build('https://github.com/someone/else', issue)).toEqual({ ok: false, reason: 'repo https://github.com/someone/else is not in the graph' });

    const down = new FakeReader();
    down.services = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await new ContextClient(down, async () => [[1]]).build('https://github.com/anandgupta193/expense-manager', issue)).toEqual({ ok: false, reason: 'ECONNREFUSED' });
  });

  it('gives up after the timeout instead of delaying the ticket', async () => {
    const slow = new FakeReader();
    slow.services = () => new Promise(() => {});
    const r = await new ContextClient(slow, async () => [[1]], { timeoutMs: 20 }).build('https://github.com/anandgupta193/expense-manager', issue);
    expect(r).toEqual({ ok: false, reason: 'timed out after 20 ms' });
  });
});
