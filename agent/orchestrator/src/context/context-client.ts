// ContextClient (docs/10-context-graph.md, "Briefing note", D39): gathers the ticket's architecture context
// from the graph at startup. It never blocks a ticket: any failure or timeout returns { ok: false }.
import type { Briefing, ServiceFacts } from './briefing.ts';

export interface GraphReader {
  services(): Promise<{ name: string; repo: string }[]>;
  facts(name: string): Promise<ServiceFacts | undefined>;
  /** Registered services this one calls, and those that call it. */
  neighbours(name: string): Promise<{ calls: string[]; calledBy: string[] }>;
  similarChunks(service: string, vector: number[], k: number, minScore: number): Promise<Briefing['chunks']>;
}

export type Embed = (texts: string[]) => Promise<number[][]>;

export type BuildResult = { ok: true; briefing: Briefing; summary: string } | { ok: false; reason: string };

const normalise = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Other services named in the ticket text (whole words, so "billing" doesn't match "billings"). */
export function mentionedServices(text: string, names: string[], self: string): string[] {
  return names.filter((n) => n !== self && new RegExp(`(^|[^\\w-])${escape(n)}($|[^\\w-])`, 'i').test(text));
}

const factCount = (f: ServiceFacts) => f.endpoints.length + f.calls.length + f.databases.length + f.libraries.length;

export class ContextClient {
  private reader: GraphReader;
  private embed: Embed;
  private opts: { timeoutMs: number; topK: number; minScore: number; margin: number };

  /**
   * nomic-embed-text scores bunch together (0.78–0.84 on expense-manager's docs), so besides an absolute floor
   * only chunks within `margin` of the best one are kept: a few on-topic chunks beat five loosely related ones.
   */
  constructor(reader: GraphReader, embed: Embed, opts: Partial<{ timeoutMs: number; topK: number; minScore: number; margin: number }> = {}) {
    this.reader = reader;
    this.embed = embed;
    this.opts = { timeoutMs: 10_000, topK: 3, minScore: 0.6, margin: 0.015, ...opts };
  }

  async build(repoUrl: string, issue: { summary: string; description: string }): Promise<BuildResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<BuildResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: `timed out after ${this.opts.timeoutMs} ms` }), this.opts.timeoutMs);
    });
    try {
      return await Promise.race([this.gather(repoUrl, issue), timeout]);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async gather(repoUrl: string, issue: { summary: string; description: string }): Promise<BuildResult> {
    const all = await this.reader.services();
    const me = all.find((s) => normalise(s.repo) === normalise(repoUrl));
    if (!me) return { ok: false, reason: `repo ${repoUrl} is not in the graph` };
    const self = await this.reader.facts(me.name);
    if (!self) return { ok: false, reason: `service ${me.name} has no facts` };

    const { calls, calledBy } = await this.reader.neighbours(me.name);
    const ticketText = `${issue.summary}\n${issue.description}`;
    const wanted: [string, string][] = [
      ...calls.map((n): [string, string] => [n, `called by ${me.name}`]),
      ...calledBy.map((n): [string, string] => [n, `calls ${me.name}`]),
      ...mentionedServices(ticketText, all.map((s) => s.name), me.name).map((n): [string, string] => [n, 'mentioned in the ticket']),
    ];
    const seen = new Set<string>();
    const related: Briefing['related'] = [];
    for (const [name, relation] of wanted) {
      if (seen.has(name)) continue;
      seen.add(name);
      const f = await this.reader.facts(name);
      if (f) related.push({ relation, facts: f });
    }

    let chunks: Briefing['chunks'] = [];
    let docsNote = '';
    try {
      const [vector] = await this.embed([`search_query: ${ticketText.trim()}`]);
      const found = await this.reader.similarChunks(me.name, vector, this.opts.topK, this.opts.minScore);
      const best = Math.max(...found.map((c) => c.score));
      chunks = found.filter((c) => c.score >= best - this.opts.margin);
    } catch (err) {
      docsNote = ` (docs skipped: ${err instanceof Error ? err.message : String(err)})`;
    }

    const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
    return {
      ok: true,
      briefing: { self, related, chunks },
      summary: `${n(factCount(self), 'fact')}, ${n(chunks.length, 'doc chunk')}, ${n(related.length, 'related service')}${docsNote}`,
    };
  }
}
