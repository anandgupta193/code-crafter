import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../src/context/chunker.ts';
import { graphParams } from '../src/context/graph-plan.ts';
import { parseManifest } from '../src/context/manifest.ts';

const services = [
  { name: 'expense-manager', repo: 'https://github.com/anandgupta193/expense-manager.git', defaultBaseBranch: 'main' },
  { name: 'billing', repo: 'https://github.com/anandgupta193/billing.git', defaultBaseBranch: 'main' },
];
const em = services[0];

const MANIFEST = `
version: 1
service: expense-manager
repo: https://github.com/anandgupta193/expense-manager
description: Personal expense tracker
team: anandgupta193
domain: personal-finance
stack: [next.js 16, react 19]
exposes:
  - method: post
    path: /api/chat
    handler: app/api/chat/route.ts
    auth: firebase-id-token
    called_by: [hooks/useChat.ts]
calls:
  - service: openrouter
    external: true
    purpose: Chat LLM
    via: [lib/agent/openaiCompatLlm.ts]
    env: [OPENROUTER_API_KEY]
  - service: billing
    purpose: charge the user
publishes: []
subscribes: []
databases:
  - name: firestore
    kind: firestore
    layout: users/{uid}/{collection}/{docId}
    collections: [expenses, categories]
libraries:
  - { name: '@google/adk', why: chat agent runtime }
  - { name: zod }
docs: [docs/architecture.md]
checks: [npm run lint]
`;

describe('parseManifest', () => {
  it('normalises a valid manifest', () => {
    const r = parseManifest(MANIFEST, em);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.manifest;
    expect(m.service).toBe('expense-manager');
    expect(m.exposes[0]).toMatchObject({ method: 'POST', path: '/api/chat', auth: 'firebase-id-token', calledBy: ['hooks/useChat.ts'] });
    expect(m.calls).toEqual([
      { service: 'openrouter', external: true, purpose: 'Chat LLM', via: ['lib/agent/openaiCompatLlm.ts'], env: ['OPENROUTER_API_KEY'] },
      { service: 'billing', external: false, purpose: 'charge the user', via: [], env: [] },
    ]);
    expect(m.databases[0]).toEqual({
      name: 'firestore',
      kind: 'firestore',
      details: { layout: 'users/{uid}/{collection}/{docId}', collections: ['expenses', 'categories'] },
    });
    expect(m.libraries).toEqual([{ name: '@google/adk', why: 'chat agent runtime' }, { name: 'zod', why: '' }]);
    expect(m.docs).toEqual(['docs/architecture.md']);
  });

  it('collects every problem instead of stopping at the first', () => {
    const r = parseManifest(
      `service: other\nrepo: https://github.com/someone/else.git\nsurprise: 1\nexposes: [{ path: /x }]\ncalls: [{ purpose: y }]\ndocs: [../secrets.md, /etc/passwd, notes.txt]`,
      em,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      'unknown key "surprise"',
      'service is "other" but this repo is registered as "expense-manager"',
      'repo https://github.com/someone/else.git does not match the registered repo https://github.com/anandgupta193/expense-manager.git',
      'exposes[0]: method is required',
      'calls[0]: service is required',
      'docs[0]: "../secrets.md" must be a relative .md path inside the repo',
      'docs[1]: "/etc/passwd" must be a relative .md path inside the repo',
      'docs[2]: "notes.txt" must be a relative .md path inside the repo',
    ]);
  });

  it('rejects YAML that does not parse or is not a mapping', () => {
    expect(parseManifest('service: [unclosed', em)).toMatchObject({ ok: false });
    expect(parseManifest('- a list', em)).toMatchObject({ ok: false, errors: ['manifest must be a YAML mapping'] });
  });
});

describe('graphParams', () => {
  it('links calls to registered services, everything else becomes an ExternalService', () => {
    const r = parseManifest(MANIFEST, em);
    if (!r.ok) throw new Error(r.errors.join());
    const p = graphParams(r.manifest, services.map((s) => s.name));
    expect(p.service).toMatchObject({ name: 'expense-manager', repo: 'https://github.com/anandgupta193/expense-manager', stack: ['next.js 16', 'react 19'] });
    expect(p.internalCalls).toEqual([{ target: 'billing', purpose: 'charge the user', via: [], env: [] }]);
    expect(p.externalCalls.map((c) => c.target)).toEqual(['openrouter']);
    expect(p.endpoints[0]).toMatchObject({ key: 'expense-manager POST /api/chat', method: 'POST' });
    // Neo4j properties must be primitives or arrays of primitives.
    expect(p.databases[0]).toMatchObject({ key: 'expense-manager/firestore', layout: 'users/{uid}/{collection}/{docId}', collections: ['expenses', 'categories'] });
  });
});

describe('chunkMarkdown', () => {
  const doc = `# Architecture

Intro paragraph.

## Auth Flow

Users sign in with Google.

\`\`\`
## not a heading inside code
\`\`\`

## Data Flow

Firestore holds expenses.

## Empty

## Data Flow

Second section with the same heading.
`;

  it('splits at ## headings, ignores headings inside code, skips empty sections', () => {
    const chunks = chunkMarkdown('docs/architecture.md', doc);
    expect(chunks.map((c) => c.heading)).toEqual(['Architecture', 'Auth Flow', 'Data Flow', 'Data Flow']);
    expect(chunks[1].text).toContain('## not a heading inside code');
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(new Set(chunks.map((c) => c.hash)).size).toBe(4);
  });

  it('keeps hashes stable and changes them only when the text changes', () => {
    const a = chunkMarkdown('d.md', doc);
    const b = chunkMarkdown('d.md', doc.replace('Firestore holds expenses.', 'Firestore holds expenses and budgets.'));
    expect(a[0].hash).toBe(b[0].hash);
    expect(a[2].hash).not.toBe(b[2].hash);
  });

  it('splits long sections on paragraph boundaries under the size limit', () => {
    const para = (n: number) => `Paragraph ${n} ${'x'.repeat(400)}`;
    const long = `## Big\n\n${[1, 2, 3, 4, 5].map(para).join('\n\n')}`;
    const chunks = chunkMarkdown('d.md', long, 1000);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.text.length <= 1000)).toBe(true);
    expect(chunks.every((c) => c.heading === 'Big')).toBe(true);
    expect(chunks[0].text.startsWith('Paragraph 1')).toBe(true);
  });

  it('hard-splits a single paragraph that is longer than the limit', () => {
    const chunks = chunkMarkdown('d.md', `## Wall\n\n${'y'.repeat(2500)}`, 1000);
    expect(chunks.map((c) => c.text.length)).toEqual([1000, 1000, 500]);
  });
});
