// Context graph ingestion (docs/10-context-graph.md, "Ingestion"): on a merge to main or a manual reindex,
// read .codecrafter/context.yaml + its docs from GitHub, validate, and replace the service's subgraph.
import type { Chat } from '../clients.ts';
import type { Service } from '../config.ts';
import { log } from '../log.ts';
import type { Store } from '../store.ts';
import { chunkMarkdown } from './chunker.ts';
import { graphParams } from './graph-plan.ts';
import type { Embedder, GraphStore, StoredChunk } from './graph-store.ts';
import { parseManifest } from './manifest.ts';

export const MANIFEST_PATH = '.codecrafter/context.yaml';

export interface RepoFiles {
  /** File contents at `ref`, or undefined if it doesn't exist. */
  read(repo: string, path: string, ref: string): Promise<string | undefined>;
}

export interface IngestDeps {
  services: Service[];
  files: RepoFiles;
  graph: GraphStore;
  embedder: Embedder;
  store: Store;
  chat: Chat;
  opsChannel?: string;
}

const slugOf = (repoUrl: string) => repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class Ingestor {
  private d: IngestDeps;

  constructor(deps: IngestDeps) {
    this.d = deps;
  }

  /** Never throws: returns a one-line outcome (logged, and returned by the reindex endpoint). */
  async ingest(serviceName: string, reason: string): Promise<string> {
    const service = this.d.services.find((s) => s.name === serviceName);
    if (!service) return `unknown service ${serviceName}`;
    const lock = `codecrafter:lock:ingest:${service.name}`;
    if (!(await this.d.store.acquire(lock, 300))) return `skipped ${service.name}: an ingestion is already running`;
    try {
      const result = await this.run(service, reason);
      (result.startsWith('ingested') ? log.ok : log.warn)(`context graph · ${result} (${reason})`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`context graph · ${service.name}: ${message}`);
      await this.notify(`🕸️ Context graph: ingesting \`${service.name}\` failed (${reason}): ${message}`);
      return `error: ${message}`;
    } finally {
      await this.d.store.release(lock);
    }
  }

  private async run(service: Service, reason: string): Promise<string> {
    const repo = slugOf(service.repo);
    const ref = service.defaultBaseBranch;
    const text = await this.d.files.read(repo, MANIFEST_PATH, ref);
    if (text === undefined) return `skipped ${service.name}: no ${MANIFEST_PATH} on ${ref}`;

    const parsed = parseManifest(text, service);
    if (!parsed.ok) {
      await this.notify(
        `🕸️ Context graph: rejected \`${service.name}\`'s \`${MANIFEST_PATH}\` (${reason}). The graph was not changed. Fix:\n${parsed.errors.map((e) => `• ${e}`).join('\n')}`,
      );
      return `rejected ${service.name}: ${parsed.errors.join('; ')}`;
    }
    const m = parsed.manifest;
    const params = graphParams(m, this.d.services.map((s) => s.name));

    const missing: string[] = [];
    const chunks = [];
    for (const path of m.docs) {
      const md = await this.d.files.read(repo, path, ref);
      if (md === undefined) missing.push(path);
      else chunks.push(...chunkMarkdown(path, md));
    }

    // Identity is the content hash, so moving a section doesn't re-embed it; identical sections collapse into one.
    const byId = new Map(chunks.map((c) => [`${service.name}:${c.hash}`, c]));
    const existing = await this.d.graph.chunkIds(service.name);
    const fresh = [...byId].filter(([id]) => !existing.has(id));
    const vectors = fresh.length ? await this.d.embedder.embed(fresh.map(([, c]) => `search_document: ${c.path} › ${c.heading}\n${c.text}`)) : [];
    const newChunks: StoredChunk[] = fresh.map(([id, c], i) => ({ id, ...c, embedding: vectors[i] }));

    await this.d.graph.writeService(params, newChunks, [...byId.keys()]);
    return [
      `ingested ${service.name}: ${plural(params.endpoints.length, 'endpoint')}, ${plural(m.calls.length, 'call')}, ${m.databases.length} DBs, ${plural(byId.size, 'doc chunk')} (${fresh.length} embedded)`,
      missing.length ? ` · missing docs: ${missing.join(', ')}` : '',
    ].join('');
  }

  private async notify(text: string) {
    if (this.d.opsChannel) await this.d.chat.post(this.d.opsChannel, text).catch(() => {});
  }
}
