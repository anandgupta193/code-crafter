// Read-only GraphReader over Neo4j (docs/10-context-graph.md). Every query runs in a READ session:
// Community Edition has no per-user roles, so this is what keeps the agent side read-only.
import neo4j, { type Driver } from 'neo4j-driver';
import type { Briefing, ServiceFacts } from './briefing.ts';
import type { Embed, GraphReader } from './context-client.ts';

const FACTS = `
MATCH (s:Service {name: $name})
OPTIONAL MATCH (s)-[:EXPOSES]->(e:Endpoint)
WITH s, collect(e {.method, .path, .auth, .handler, .description, .calledBy}) AS endpoints
OPTIONAL MATCH (s)-[c:CALLS]->(t)
WITH s, endpoints, collect(CASE WHEN t IS NULL THEN null ELSE
  {target: t.name, external: t:ExternalService, purpose: c.purpose, via: c.via, env: c.env} END) AS calls
OPTIONAL MATCH (s)-[:OWNS]->(d:Database)
WITH s, endpoints, calls, collect(properties(d)) AS databases
OPTIONAL MATCH (s)-[l:DEPENDS_ON]->(lib:Library)
RETURN s {.*} AS service, endpoints, calls, databases,
       collect(CASE WHEN lib IS NULL THEN null ELSE {name: lib.name, why: l.why} END) AS libraries`;

const SIMILAR = `
CALL db.index.vector.queryNodes('doc_chunk_embedding', $candidates, $vector) YIELD node, score
WHERE node.service = $service AND score >= $minScore
RETURN node.path AS path, node.heading AS heading, node.text AS text, score
ORDER BY score DESC LIMIT $k`;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const a = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export class Neo4jReader implements GraphReader {
  private driver: Driver;

  constructor(url: string, password: string) {
    this.driver = neo4j.driver(url, neo4j.auth.basic('neo4j', password), { disableLosslessIntegers: true, connectionTimeout: 5000 });
  }

  private async read(query: string, params: Record<string, unknown> = {}) {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      return (await session.executeRead((tx) => tx.run(query, params))).records;
    } finally {
      await session.close();
    }
  }

  async services() {
    return (await this.read('MATCH (s:Service) WHERE s.repo IS NOT NULL RETURN s.name AS name, s.repo AS repo')).map((r) => ({
      name: r.get('name') as string,
      repo: r.get('repo') as string,
    }));
  }

  async facts(name: string): Promise<ServiceFacts | undefined> {
    const [r] = await this.read(FACTS, { name });
    if (!r) return undefined;
    const svc = r.get('service') as Record<string, unknown>;
    return {
      name: s(svc.name),
      repo: s(svc.repo),
      description: s(svc.description),
      stack: a(svc.stack),
      endpoints: (r.get('endpoints') as Record<string, unknown>[]).map((e) => ({
        method: s(e.method), path: s(e.path), auth: s(e.auth), handler: s(e.handler), description: s(e.description), calledBy: a(e.calledBy),
      })),
      calls: (r.get('calls') as Record<string, unknown>[]).map((c) => ({
        target: s(c.target), external: c.external === true, purpose: s(c.purpose), via: a(c.via), env: a(c.env),
      })),
      databases: (r.get('databases') as Record<string, unknown>[]).map((d) => {
        const details: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(d)) if (!['name', 'kind', 'key', 'service'].includes(k)) details[k] = Array.isArray(v) ? v.map(String) : s(v);
        return { name: s(d.name), kind: s(d.kind), details };
      }),
      libraries: (r.get('libraries') as Record<string, unknown>[]).map((l) => ({ name: s(l.name), why: s(l.why) })),
    };
  }

  async neighbours(name: string) {
    const [r] = await this.read(
      `MATCH (s:Service {name: $name})
       OPTIONAL MATCH (s)-[:CALLS]->(out:Service) WITH s, collect(DISTINCT out.name) AS calls
       OPTIONAL MATCH (in:Service)-[:CALLS]->(s) RETURN calls, collect(DISTINCT in.name) AS calledBy`,
      { name },
    );
    return { calls: a(r?.get('calls')), calledBy: a(r?.get('calledBy')) };
  }

  async similarChunks(service: string, vector: number[], k: number, minScore: number): Promise<Briefing['chunks']> {
    // The index is shared by every service: over-fetch, then filter to this one.
    const records = await this.read(SIMILAR, { service, vector, k: neo4j.int(k), candidates: neo4j.int(k * 10), minScore });
    return records.map((r) => ({ path: r.get('path'), heading: r.get('heading'), text: r.get('text'), score: r.get('score') }));
  }

  async close() {
    await this.driver.close();
  }
}

export function ollamaEmbed(url: string, model = 'nomic-embed-text'): Embed {
  return async (texts) => {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Ollama embed → ${res.status}`);
    return ((await res.json()) as { embeddings: number[][] }).embeddings;
  };
}
