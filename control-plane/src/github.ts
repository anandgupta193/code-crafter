// GitHub REST reads used to verify webhook claims against the source of truth before acting on them.

export interface PrInfo {
  number: number;
  state: string; // open | closed
  merged: boolean;
  draft: boolean;
  headRef: string;
  headSha: string;
  body: string;
  url: string;
}

export interface GitHubReader {
  getPr(repo: string, n: number): Promise<PrInfo>;
  /** Author login of a comment, or undefined if it doesn't exist. */
  commentAuthor(repo: string, kind: 'review_comment' | 'issue_comment', id: number): Promise<string | undefined>;
  branchHead(repo: string, branch: string): Promise<string | undefined>;
}

export class GitHubRest implements GitHubReader {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async get(path: string): Promise<any | undefined> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}`);
    return res.json();
  }

  async getPr(repo: string, n: number): Promise<PrInfo> {
    const p = await this.get(`/repos/${repo}/pulls/${n}`);
    if (!p) throw new Error(`PR ${repo}#${n} not found`);
    return {
      number: p.number,
      state: p.state,
      merged: Boolean(p.merged),
      draft: Boolean(p.draft),
      headRef: p.head?.ref,
      headSha: p.head?.sha,
      body: p.body ?? '',
      url: p.html_url,
    };
  }

  async commentAuthor(repo: string, kind: 'review_comment' | 'issue_comment', id: number) {
    const path = kind === 'review_comment' ? `/repos/${repo}/pulls/comments/${id}` : `/repos/${repo}/issues/comments/${id}`;
    return (await this.get(path))?.user?.login as string | undefined;
  }

  async branchHead(repo: string, branch: string) {
    return (await this.get(`/repos/${repo}/branches/${encodeURIComponent(branch)}`))?.commit?.sha as string | undefined;
  }
}
