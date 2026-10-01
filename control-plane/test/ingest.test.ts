import { beforeEach, describe, expect, it } from 'vitest';
import type { Chat } from '../src/clients.ts';
import type { Embedder, GraphStore, StoredChunk } from '../src/context/graph-store.ts';
import type { GraphParams } from '../src/context/graph-plan.ts';
import { Ingestor, type RepoFiles } from '../src/context/ingest.ts';
import { MemoryStore } from '../src/store.ts';

const services = [{ name: 'expense-manager', repo: 'https://github.com/anandgupta193/expense-manager.git', defaultBaseBranch: 'main' }];

const MANIFEST = `
service: expense-manager
repo: https://github.com/anandgupta193/expense-manager.git
exposes: [{ method: POST, path: /api/chat }]
calls: [{ service: openrouter, external: true }]
docs: [docs/a.md, docs/b.md]
`;

class FakeGraph implements GraphStore {
  written: { params: GraphParams; chunks: StoredChunk[]; keep: string[] }[] = [];
  ids = new Set<string>();
  async ping() {
    return true;
  }
  async ensureSchema() {}
  async chunkIds() {
    return new Set(this.ids);
  }
  async writeService(params: GraphParams, newChunks: StoredChunk[], keep: string[]) {
    this.written.push({ params, chunks: newChunks, keep });
    this.ids = new Set(keep);
  }
  async lastIngest() {
    return undefined;
  }
}

class FakeEmbedder implements Embedder {
  calls: string[][] = [];
  async embed(texts: string[]) {
    this.calls.push(texts);
    return texts.map(() => [0.1, 0.2]);
  }
}

class RecChat implements Chat {
  posts: string[] = [];
  async post(channel: string, text: string) {
    this.posts.push(`${channel}|${text}`);
    return '1';
  }
  async react() {}
}

let files: Map<string, string>;
let graph: FakeGraph;
let embedder: FakeEmbedder;
let chat: RecChat;
let store: MemoryStore;
let ingestor: Ingestor;

beforeEach(() => {
  files = new Map([
    ['.codecrafter/context.yaml', MANIFEST],
    ['docs/a.md', '## One\n\nFirst.\n\n## Two\n\nSecond.'],
    ['docs/b.md', '## Three\n\nThird.'],
  ]);
  const repoFiles: RepoFiles = { read: async (_repo, path) => files.get(path) };
  graph = new FakeGraph();
  embedder = new FakeEmbedder();
  chat = new RecChat();
  store = new MemoryStore();
  ingestor = new Ingestor({ services, files: repoFiles, graph, embedder, store, chat, opsChannel: 'OPS' });
});

describe('Ingestor', () => {
  it('writes the service subgraph and embeds every chunk on the first run', async () => {
    const r = await ingestor.ingest('expense-manager', 'reindex');
    expect(r).toBe('ingested expense-manager: 1 endpoint, 1 call, 0 DBs, 3 doc chunks (3 embedded)');
    expect(graph.written[0].params.endpoints[0].key).toBe('expense-manager POST /api/chat');
    expect(embedder.calls[0][0]).toBe('search_document: docs/a.md › One\nFirst.');
    expect(graph.written[0].chunks.map((c) => c.heading)).toEqual(['One', 'Two', 'Three']);
    expect(graph.written[0].chunks.every((c) => c.embedding.length === 2)).toBe(true);
  });

  it('re-embeds only new or changed chunks and drops removed ones', async () => {
    await ingestor.ingest('expense-manager', 'reindex');
    files.set('docs/a.md', '## One\n\nFirst, edited.\n\n## Two\n\nSecond.');
    files.set('docs/b.md', '');
    const r = await ingestor.ingest('expense-manager', 'merge #13');
    expect(r).toContain('2 doc chunks (1 embedded)');
    expect(embedder.calls[1]).toEqual(['search_document: docs/a.md › One\nFirst, edited.']);
    expect(graph.written[1].keep).toHaveLength(2);
  });

  it('rejects a bad manifest, leaves the graph alone and tells #ops', async () => {
    files.set('.codecrafter/context.yaml', 'service: wrong\nrepo: https://github.com/anandgupta193/expense-manager.git');
    const r = await ingestor.ingest('expense-manager', 'merge #13');
    expect(r).toMatch(/^rejected/);
    expect(graph.written).toHaveLength(0);
    expect(chat.posts[0]).toMatch(/^OPS\|🕸️ Context graph: rejected `expense-manager`'s `.codecrafter\/context.yaml` \(merge #13\)/);
    expect(chat.posts[0]).toContain('• service is "wrong" but this repo is registered as "expense-manager"');
  });

  it('skips repos without a manifest, and reports missing docs without failing', async () => {
    files.delete('docs/b.md');
    expect(await ingestor.ingest('expense-manager', 'reindex')).toContain('missing docs: docs/b.md');
    files.delete('.codecrafter/context.yaml');
    expect(await ingestor.ingest('expense-manager', 'reindex')).toBe('skipped expense-manager: no .codecrafter/context.yaml on main');
  });

  it('runs one ingestion per service at a time and reports failures', async () => {
    await store.acquire('codecrafter:lock:ingest:expense-manager', 300);
    expect(await ingestor.ingest('expense-manager', 'reindex')).toBe('skipped expense-manager: an ingestion is already running');
    await store.release('codecrafter:lock:ingest:expense-manager');

    embedder.embed = async () => {
      throw new Error('ollama down');
    };
    expect(await ingestor.ingest('expense-manager', 'reindex')).toBe('error: ollama down');
    expect(chat.posts.at(-1)).toContain('ollama down');
    expect(await store.acquire('codecrafter:lock:ingest:expense-manager', 1)).toBe(true); // lock released
    expect(await ingestor.ingest('nope', 'reindex')).toBe('unknown service nope');
  });
});
