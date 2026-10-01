// .codecrafter/context.yaml → a validated, normalised manifest (docs/10-context-graph.md).
// Collects every problem so one rejection message lists everything to fix.
import { parse } from 'yaml';
import type { Service } from '../config.ts';

export interface EndpointSpec {
  method: string;
  path: string;
  handler: string;
  auth: string;
  response: string;
  description: string;
  calledBy: string[];
}

export interface CallSpec {
  service: string;
  external: boolean;
  purpose: string;
  via: string[];
  env: string[];
}

export interface DatabaseSpec {
  name: string;
  kind: string;
  /** Every other field, flattened to Neo4j-safe values. */
  details: Record<string, string | string[]>;
}

export interface Manifest {
  version: number;
  service: string;
  repo: string;
  description: string;
  team: string;
  domain: string;
  stack: string[];
  exposes: EndpointSpec[];
  calls: CallSpec[];
  publishes: string[];
  subscribes: string[];
  databases: DatabaseSpec[];
  libraries: { name: string; why: string }[];
  docs: string[];
  checks: string[];
}

export type ParseResult = { ok: true; manifest: Manifest } | { ok: false; errors: string[] };

const KNOWN_KEYS = new Set([
  'version', 'service', 'repo', 'description', 'team', 'domain', 'stack', 'exposes', 'calls',
  'publishes', 'subscribes', 'databases', 'libraries', 'docs', 'checks',
]);

export function normaliseRepo(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : v === undefined || v === null || v === '' ? [] : [str(v)]);
const items = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {})) : [];

/** Neo4j properties must be primitives or arrays of primitives: nested values become strings. */
function flatten(v: unknown): string | string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : str(x)));
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : str(v);
}

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const ITEM_KEYS: Record<string, Set<string> | undefined> = {
  exposes: new Set(['method', 'path', 'handler', 'auth', 'response', 'description', 'called_by']),
  calls: new Set(['service', 'external', 'purpose', 'via', 'env']),
  libraries: new Set(['name', 'why']),
  databases: undefined, // free-form: extra fields become details
};

/** Unknown keys, and keys with no value — the signature of an unquoted comma inside a `{ … }` flow mapping. */
function checkItems(doc: Record<string, unknown>, errors: string[]) {
  for (const [section, allowed] of Object.entries(ITEM_KEYS)) {
    items(doc[section]).forEach((item, i) => {
      for (const [k, v] of Object.entries(item)) {
        if (v === null) errors.push(`${section}[${i}]: "${k}" has no value (quote values that contain commas)`);
        else if (allowed && !allowed.has(k)) errors.push(`${section}[${i}]: unknown key "${k}"`);
      }
    });
  }
}

export function parseManifest(text: string, registered: Service): ParseResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    return { ok: false, errors: [`YAML does not parse: ${(err as Error).message.split('\n')[0]}`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['manifest must be a YAML mapping'] };
  const doc = raw as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(doc)) if (!KNOWN_KEYS.has(key)) errors.push(`unknown key "${key}"`);
  checkItems(doc, errors);

  const service = str(doc.service);
  if (!service) errors.push('service is required');
  else if (service !== registered.name) errors.push(`service is "${service}" but this repo is registered as "${registered.name}"`);

  const repo = str(doc.repo);
  if (!repo) errors.push('repo is required');
  else if (normaliseRepo(repo) !== normaliseRepo(registered.repo))
    errors.push(`repo ${repo} does not match the registered repo ${registered.repo}`);

  const exposes = items(doc.exposes).map((e, i): EndpointSpec => {
    if (!str(e.method)) errors.push(`exposes[${i}]: method is required`);
    if (!str(e.path)) errors.push(`exposes[${i}]: path is required`);
    return {
      method: str(e.method).toUpperCase(),
      path: str(e.path),
      handler: str(e.handler),
      auth: str(e.auth),
      response: str(e.response),
      description: str(e.description),
      calledBy: list(e.called_by),
    };
  });

  const calls = items(doc.calls).map((c, i): CallSpec => {
    if (!str(c.service)) errors.push(`calls[${i}]: service is required`);
    return { service: str(c.service), external: c.external === true, purpose: str(c.purpose), via: list(c.via), env: list(c.env) };
  });

  const databases = items(doc.databases).map((d, i): DatabaseSpec => {
    if (!str(d.name)) errors.push(`databases[${i}]: name is required`);
    if (!str(d.kind)) errors.push(`databases[${i}]: kind is required`);
    const details: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(d)) if (k !== 'name' && k !== 'kind') details[camel(k)] = flatten(v);
    return { name: str(d.name), kind: str(d.kind), details };
  });

  const libraries = items(doc.libraries).map((l, i) => {
    if (!str(l.name)) errors.push(`libraries[${i}]: name is required`);
    return { name: str(l.name), why: str(l.why) };
  });

  const docs = list(doc.docs);
  docs.forEach((d, i) => {
    if (d.startsWith('/') || d.split('/').includes('..') || !d.endsWith('.md'))
      errors.push(`docs[${i}]: "${d}" must be a relative .md path inside the repo`);
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      version: Number(doc.version ?? 1),
      service,
      repo,
      description: str(doc.description),
      team: str(doc.team),
      domain: str(doc.domain),
      stack: list(doc.stack),
      exposes,
      calls,
      publishes: list(doc.publishes),
      subscribes: list(doc.subscribes),
      databases,
      libraries,
      docs,
      checks: list(doc.checks),
    },
  };
}
