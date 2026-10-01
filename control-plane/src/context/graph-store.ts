// Neo4j + Ollama adapters for the context graph (docs/10-context-graph.md). Ingestion logic lives in ingest.ts.
import neo4j, { type Driver } from 'neo4j-driver';
import type { GraphParams } from './graph-plan.ts';

export interface StoredChunk {
  id: string; // `${service}:${hash}`
  path: string;
  heading: string;
  index: number;
  text: string;
  hash: string;
  embedding: number[];
}

export interface GraphStore {
  ping(): Promise<boolean>;
  ensureSchema(): Promise<void>;
  /** Ids of the service's DocChunks already in the graph. */
  chunkIds(service: string): Promise<Set<string>>;
  /** Replace the service's subgraph; add `newChunks`, keep the chunks listed in `keep`, delete the rest. */
  writeService(params: GraphParams, newChunks: StoredChunk[], keep: string[]): Promise<void>;
  lastIngest(service: string): Promise<string | undefined>;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_DIMS = 768; // nomic-embed-text

export class Neo4jGraph implements GraphStore {
  private driver: Driver;

  constructor(url: string, password: string) {
    this.driver = neo4j.driver(url, neo4j.auth.basic('neo4j', password), { disableLosslessIntegers: true });
  }

  async ping() {
    try {
      await this.driver.executeQuery('RETURN 1', {}, { routing: neo4j.routing.READ });
      return true;
    } catch {
      return false;
    }
  }

  async ensureSchema() {
    for (const q of [
      'CREATE CONSTRAINT service_name IF NOT EXISTS FOR (n:Service) REQUIRE n.name IS UNIQUE',
      'CREATE CONSTRAINT external_name IF NOT EXISTS FOR (n:ExternalService) REQUIRE n.name IS UNIQUE',
      'CREATE CONSTRAINT library_name IF NOT EXISTS FOR (n:Library) REQUIRE n.name IS UNIQUE',
      'CREATE CONSTRAINT doc_chunk_id IF NOT EXISTS FOR (n:DocChunk) REQUIRE n.id IS UNIQUE',
      `CREATE VECTOR INDEX doc_chunk_embedding IF NOT EXISTS FOR (d:DocChunk) ON d.embedding
         OPTIONS { indexConfig: { \`vector.dimensions\`: ${EMBEDDING_DIMS}, \`vector.similarity_function\`: 'cosine' } }`,
    ])
      await this.driver.executeQuery(q);
  }

  async chunkIds(service: string) {
    const { records } = await this.driver.executeQuery(
      'MATCH (d:DocChunk {service: $service}) RETURN d.id AS id',
      { service },
      { routing: neo4j.routing.READ },
    );
    return new Set(records.map((r) => r.get('id') as string));
  }

  async writeService(p: GraphParams, newChunks: StoredChunk[], keep: string[]) {
    const name = p.service.name;
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run('MERGE (s:Service {name: $name}) SET s += $props, s.ingestedAt = toString(datetime())', { name, props: p.service });
        // Owned nodes and outgoing relationships are rebuilt from the manifest every time.
        await tx.run('MATCH (s:Service {name: $name})-[:EXPOSES|OWNS]->(n) DETACH DELETE n', { name });
        await tx.run('MATCH (s:Service {name: $name})-[r:CALLS|DEPENDS_ON]->() DELETE r', { name });
        await tx.run(
          `MATCH (s:Service {name: $name})
           UNWIND $endpoints AS e CREATE (s)-[:EXPOSES]->(n:Endpoint) SET n = e, n.service = $name`,
          { name, endpoints: p.endpoints },
        );
        await tx.run(
          `MATCH (s:Service {name: $name})
           UNWIND $databases AS d CREATE (s)-[:OWNS]->(n:Database) SET n = d, n.service = $name`,
          { name, databases: p.databases },
        );
        await tx.run(
          `MATCH (s:Service {name: $name})
           UNWIND $calls AS c MERGE (x:ExternalService {name: c.target})
           CREATE (s)-[:CALLS {purpose: c.purpose, via: c.via, env: c.env}]->(x)`,
          { name, calls: p.externalCalls },
        );
        await tx.run(
          `MATCH (s:Service {name: $name})
           UNWIND $calls AS c MERGE (t:Service {name: c.target})
           CREATE (s)-[:CALLS {purpose: c.purpose, via: c.via, env: c.env}]->(t)`,
          { name, calls: p.internalCalls },
        );
        await tx.run(
          `MATCH (s:Service {name: $name})
           UNWIND $libs AS l MERGE (x:Library {name: l.name}) CREATE (s)-[:DEPENDS_ON {why: l.why}]->(x)`,
          { name, libs: p.libraries },
        );
        await tx.run('MATCH (d:DocChunk {service: $name}) WHERE NOT d.id IN $keep DETACH DELETE d', { name, keep });
        await tx.run(
          `MATCH (s:Service {name: $name})
           UNWIND $chunks AS c
           MERGE (d:DocChunk {id: c.id})
           SET d.service = $name, d.path = c.path, d.heading = c.heading, d.idx = c.index, d.text = c.text, d.hash = c.hash, d.embedding = c.embedding
           MERGE (d)-[:DESCRIBES]->(s)`,
          { name, chunks: newChunks },
        );
        // Shared nodes nobody points at any more.
        await tx.run('MATCH (n) WHERE (n:ExternalService OR n:Library) AND NOT (n)<--() DELETE n');
      });
    } finally {
      await session.close();
    }
  }

  async lastIngest(service: string) {
    const { records } = await this.driver.executeQuery(
      'MATCH (s:Service {name: $service}) RETURN s.ingestedAt AS at',
      { service },
      { routing: neo4j.routing.READ },
    );
    return (records[0]?.get('at') as string | null) ?? undefined;
  }

  async close() {
    await this.driver.close();
  }
}

export class OllamaEmbedder implements Embedder {
  private url: string;
  private model: string;

  constructor(url: string, model = 'nomic-embed-text') {
    this.url = url.replace(/\/+$/, '');
    this.model = model;
  }

  async embed(texts: string[]) {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const res = await fetch(`${this.url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts.slice(i, i + 16) }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Ollama embed → ${res.status} ${await res.text()}`);
      out.push(...((await res.json()) as { embeddings: number[][] }).embeddings);
    }
    return out;
  }
}
