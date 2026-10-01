// The "## Architecture Context" briefing (docs/10-context-graph.md, "Briefing note"). Pure rendering:
// ContextClient gathers the facts from Neo4j, this turns them into markdown under a size cap.

export interface ServiceFacts {
  name: string;
  repo: string;
  description: string;
  stack: string[];
  endpoints: { method: string; path: string; auth: string; handler: string; description: string; calledBy: string[] }[];
  calls: { target: string; external: boolean; purpose: string; via: string[]; env: string[] }[];
  databases: { name: string; kind: string; details: Record<string, string | string[]> }[];
  libraries: { name: string; why: string }[];
}

export interface Briefing {
  self: ServiceFacts;
  /** One-hop neighbours, e.g. "called by expense-manager", "calls expense-manager", "mentioned in the ticket". */
  related: { relation: string; facts: ServiceFacts }[];
  chunks: { path: string; heading: string; text: string; score: number }[];
}

const code = (xs: string[]) => xs.map((x) => `\`${x}\``).join(', ');
const join = (parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' · ');

function endpoint(e: ServiceFacts['endpoints'][number]): string {
  const meta = join([e.auth && `auth: ${e.auth}`, e.handler && `handler: \`${e.handler}\``, e.calledBy.length > 0 && `called by: ${code(e.calledBy)}`]);
  return `- \`${e.method} ${e.path}\`${meta ? ` — ${meta}` : ''}${e.description ? ` — ${e.description.trim()}` : ''}`;
}

function service(f: ServiceFacts, label: string, full: boolean): string {
  const lines = [`### ${f.name} (${label})`];
  if (f.description) lines.push(f.description.trim());
  if (full && f.stack.length) lines.push(`Stack: ${f.stack.join(', ')}`);
  if (f.endpoints.length) lines.push('', '**Exposes**', ...f.endpoints.map(endpoint));
  if (full && f.calls.length) {
    lines.push('', '**Calls**');
    for (const c of f.calls) {
      const meta = join([c.purpose, c.via.length > 0 && `via ${code(c.via)}`, c.env.length > 0 && `env ${code(c.env)}`]);
      lines.push(`- **${c.target}**${c.external ? ' (external)' : ''}${meta ? ` — ${meta}` : ''}`);
    }
  }
  if (full && f.databases.length) {
    lines.push('', '**Data**');
    for (const d of f.databases) {
      const meta = Object.entries(d.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
      lines.push(`- **${d.name}** (${d.kind})${meta.length ? ` — ${meta.join(' · ')}` : ''}`);
    }
  }
  if (full && f.libraries.length) lines.push('', `**Key libraries**: ${f.libraries.map((l) => (l.why ? `${l.name} (${l.why})` : l.name)).join(', ')}`);
  return lines.join('\n');
}

function render(b: Briefing): string {
  const parts = [
    'From the architecture graph (source: `.codecrafter/context.yaml` + `docs/`). Trust the code if they disagree — and then fix `.codecrafter/context.yaml` in this PR.',
    service(b.self, 'this repo', true),
    ...b.related.map((r) => service(r.facts, r.relation, false)),
  ];
  if (b.chunks.length) {
    parts.push('### Relevant docs');
    for (const c of b.chunks) parts.push(`#### ${c.path} › ${c.heading}\n${c.text.trim()}`);
  }
  parts.push('For anything not shown here, query the graph with the neo4j MCP tools (read-only).');
  return parts.join('\n\n');
}

/** Render, shrinking to `maxChars`: drop the weakest doc chunks, then related services, then truncate. */
export function renderBriefing(b: Briefing, maxChars = 6000): string {
  let cur: Briefing = { ...b, chunks: [...b.chunks].sort((x, y) => y.score - x.score), related: [...b.related] };
  let md = render(cur);
  while (md.length > maxChars && cur.chunks.length) {
    cur = { ...cur, chunks: cur.chunks.slice(0, -1) };
    md = render(cur);
  }
  while (md.length > maxChars && cur.related.length) {
    cur = { ...cur, related: cur.related.slice(0, -1) };
    md = render(cur);
  }
  return md.length > maxChars ? `${md.slice(0, maxChars - 20).trimEnd()}\n…(truncated)` : md;
}
