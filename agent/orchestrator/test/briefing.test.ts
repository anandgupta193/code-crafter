import { describe, expect, it } from 'vitest';
import type { JiraIssue } from '../src/clients/jira.ts';
import { renderBriefing, type Briefing, type ServiceFacts } from '../src/context/briefing.ts';
import { buildInitialPrompt } from '../src/prompt.ts';

const self: ServiceFacts = {
  name: 'expense-manager',
  repo: 'https://github.com/anandgupta193/expense-manager',
  description: 'Personal expense tracker (INR).',
  stack: ['next.js 16', 'react 19'],
  endpoints: [{ method: 'POST', path: '/api/chat', auth: 'firebase-id-token', handler: 'app/api/chat/route.ts', description: 'Agentic chat.', calledBy: ['hooks/useChat.ts'] }],
  calls: [
    { target: 'openrouter', external: true, purpose: 'Chat LLM when AI_PROVIDER=openrouter', via: ['lib/agent/openaiCompatLlm.ts'], env: ['OPENROUTER_API_KEY'] },
    { target: 'billing', external: false, purpose: 'charge the user', via: [], env: [] },
  ],
  databases: [{ name: 'firestore', kind: 'firestore', details: { layout: 'users/{uid}/{collection}/{docId}', collections: ['expenses', 'categories'] } }],
  libraries: [{ name: '@google/adk', why: 'chat agent runtime' }],
};

const billing: ServiceFacts = {
  name: 'billing',
  repo: 'https://github.com/anandgupta193/billing',
  description: '',
  stack: [],
  endpoints: [{ method: 'POST', path: '/charge', auth: 'service-token', handler: '', description: '', calledBy: [] }],
  calls: [],
  databases: [],
  libraries: [],
};

const briefing = (over: Partial<Briefing> = {}): Briefing => ({
  self,
  related: [{ relation: 'called by expense-manager', facts: billing }],
  chunks: [
    { path: 'docs/architecture.md', heading: 'Auth Flow', text: 'Users sign in with Google via Firebase.', score: 0.82 },
    { path: 'docs/data-model.md', heading: 'Firestore Schema', text: 'Path: users/{uid}/{collection}/{docId}.', score: 0.74 },
  ],
  ...over,
});

describe('renderBriefing', () => {
  it('renders the service, its neighbours and the relevant docs', () => {
    const md = renderBriefing(briefing());
    expect(md).toContain('### expense-manager (this repo)');
    expect(md).toContain('- `POST /api/chat` — auth: firebase-id-token · handler: `app/api/chat/route.ts` · called by: `hooks/useChat.ts` — Agentic chat.');
    expect(md).toContain('- **openrouter** (external) — Chat LLM when AI_PROVIDER=openrouter · via `lib/agent/openaiCompatLlm.ts` · env `OPENROUTER_API_KEY`');
    expect(md).toContain('- **firestore** (firestore) — layout: users/{uid}/{collection}/{docId} · collections: expenses, categories');
    expect(md).toContain('### billing (called by expense-manager)');
    expect(md).toContain('- `POST /charge` — auth: service-token');
    expect(md).toContain('#### docs/architecture.md › Auth Flow');
    expect(md).toContain('.codecrafter/context.yaml');
    expect(md).toContain('neo4j');
  });

  it('drops the lowest-scoring doc chunks first to fit the size cap', () => {
    const long = 'z'.repeat(900);
    const chunks = [0.9, 0.8, 0.7, 0.6].map((score, i) => ({ path: `docs/${i}.md`, heading: `H${i}`, text: long, score }));
    const md = renderBriefing(briefing({ chunks }), 3000);
    expect(md.length).toBeLessThanOrEqual(3000);
    expect(md).toContain('docs/0.md');
    expect(md).not.toContain('docs/3.md');
  });

  it('then drops related services, and finally truncates', () => {
    const md = renderBriefing(briefing({ chunks: [] }), 900);
    expect(md.length).toBeLessThanOrEqual(900);
    expect(md).not.toContain('### billing');
    expect(renderBriefing(briefing(), 300).length).toBeLessThanOrEqual(300);
  });
});

describe('buildInitialPrompt with architecture context', () => {
  const issue: JiraIssue = { key: 'SCRUM-11', url: 'u', summary: 'Do a thing', description: 'desc', status: 'To Do', labels: [], attachments: [] } as unknown as JiraIssue;
  const base = { issue, repoUrl: 'r', baseBranch: 'main', branch: 'CODE-CRAFTER-SCRUM-11', branchIsNew: true, planFirst: false, prBodyFile: 'p', attachments: [], commands: {} };

  it('places the section after the attachments and before the analysis', () => {
    const p = buildInitialPrompt({ ...base, architectureContext: 'GRAPH FACTS' });
    const at = (s: string) => p.indexOf(s);
    expect(at('## Jira Attachments')).toBeLessThan(at('## Architecture Context'));
    expect(at('## Architecture Context')).toBeLessThan(at('GRAPH FACTS'));
    expect(at('GRAPH FACTS')).toBeLessThan(at('## Fresh analysis'));
  });

  it('leaves the section out when there is no context', () => {
    expect(buildInitialPrompt(base)).not.toContain('## Architecture Context');
  });
});
