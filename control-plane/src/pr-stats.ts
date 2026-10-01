// PR stats (docs/17-status-page.md, D33): PRs authored by the bot, per registered repo, cached 10 minutes.
import type { Service } from './config.ts';

export interface RepoStats {
  repo: string; // owner/name
  merged: number;
  open: number;
  closed: number; // closed without merging
  links: { merged: string; open: string; closed: string };
}

export interface PrStats {
  author: string;
  repos: RepoStats[];
  total: { merged: number; open: number; closed: number };
  fetchedAt: string;
}

/** Counts issues/PRs matching a GitHub search query. */
export type SearchCount = (query: string) => Promise<number>;

const slugOf = (repoUrl: string) => repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
const searchUrl = (q: string) => `https://github.com/search?type=pullrequests&q=${encodeURIComponent(q)}`;

export async function computePrStats(services: Service[], author: string, count: SearchCount, now = Date.now()): Promise<PrStats> {
  const repos = await Promise.all(
    services.map(async (s): Promise<RepoStats> => {
      const repo = slugOf(s.repo);
      const base = `repo:${repo} is:pr author:${author}`;
      const q = { merged: `${base} is:merged`, open: `${base} is:open`, closed: `${base} is:closed is:unmerged` };
      const [merged, open, closed] = await Promise.all([count(q.merged), count(q.open), count(q.closed)]);
      return { repo, merged, open, closed, links: { merged: searchUrl(q.merged), open: searchUrl(q.open), closed: searchUrl(q.closed) } };
    }),
  );
  const total = repos.reduce((t, r) => ({ merged: t.merged + r.merged, open: t.open + r.open, closed: t.closed + r.closed }), { merged: 0, open: 0, closed: 0 });
  return { author, repos, total, fetchedAt: new Date(now).toISOString() };
}

/** Wraps a loader with a time-based cache (one in-flight load at a time). */
export function cached<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let value: T | undefined;
  let at = 0;
  let inflight: Promise<T> | undefined;
  return async () => {
    if (value !== undefined && now() - at < ttlMs) return value;
    inflight ??= load()
      .then((v) => {
        value = v;
        at = now();
        return v;
      })
      .finally(() => (inflight = undefined));
    return inflight;
  };
}

/** GitHub search with the bot token. */
export function githubSearchCount(token: string): SearchCount {
  return async (query) => {
    const res = await fetch(`https://api.github.com/search/issues?per_page=1&q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub search → ${res.status}`);
    return ((await res.json()) as { total_count: number }).total_count;
  };
}

export async function githubLogin(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub /user → ${res.status}`);
  return ((await res.json()) as { login: string }).login;
}
