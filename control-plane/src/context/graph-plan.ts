// Manifest → Cypher parameters for one service's subgraph (docs/10-context-graph.md, "Graph model").
// Pure, so the shape that lands in Neo4j is unit-tested; neo4j.ts only runs the query.
import type { Manifest } from './manifest.ts';

export interface GraphParams {
  service: { name: string; repo: string; description: string; team: string; domain: string; stack: string[]; checks: string[] };
  endpoints: { key: string; method: string; path: string; handler: string; auth: string; response: string; description: string; calledBy: string[] }[];
  /** Calls to services registered in config/services.yaml → (Service)-[:CALLS]->(Service). */
  internalCalls: { target: string; purpose: string; via: string[]; env: string[] }[];
  externalCalls: { target: string; purpose: string; via: string[]; env: string[] }[];
  databases: Record<string, string | string[]>[];
  libraries: { name: string; why: string }[];
}

export function graphParams(m: Manifest, registeredServices: string[]): GraphParams {
  const registered = new Set(registeredServices);
  const call = (c: Manifest['calls'][number]) => ({ target: c.service, purpose: c.purpose, via: c.via, env: c.env });
  return {
    service: { name: m.service, repo: m.repo, description: m.description, team: m.team, domain: m.domain, stack: m.stack, checks: m.checks },
    endpoints: m.exposes.map((e) => ({ key: `${m.service} ${e.method} ${e.path}`, ...e })),
    internalCalls: m.calls.filter((c) => !c.external && registered.has(c.service)).map(call),
    externalCalls: m.calls.filter((c) => c.external || !registered.has(c.service)).map(call),
    databases: m.databases.map((d) => ({ ...d.details, key: `${m.service}/${d.name}`, name: d.name, kind: d.kind })),
    libraries: m.libraries,
  };
}
