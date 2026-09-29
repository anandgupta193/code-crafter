import { run, runOk } from '../exec.ts';

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  state: string; // OPEN | CLOSED | MERGED
}

/** Thin wrapper over the `gh` CLI, run inside the cloned repo (auth via GH_TOKEN). */
export class GitHub {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  private gh(args: string[], input?: string) {
    return runOk('gh', args, { cwd: this.cwd, input });
  }

  async findPr(branch: string): Promise<PullRequest | undefined> {
    const out = await this.gh([
      'pr', 'list', '--head', branch, '--state', 'all', '--limit', '1',
      '--json', 'number,url,title,body,isDraft,state',
    ]);
    const list = JSON.parse(out || '[]') as PullRequest[];
    return list[0];
  }

  async createPr(opts: { base: string; head: string; title: string; bodyFile: string; draft: boolean }): Promise<PullRequest> {
    const args = ['pr', 'create', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body-file', opts.bodyFile];
    if (opts.draft) args.push('--draft');
    await this.gh(args);
    const pr = await this.findPr(opts.head);
    if (!pr) throw new Error('PR creation reported success but the PR was not found');
    return pr;
  }

  async setBody(pr: number, body: string): Promise<void> {
    await this.gh(['pr', 'edit', String(pr), '--body-file', '-'], body);
  }

  /** Force draft (D12). `gh pr ready --undo` converts a ready PR back to draft. */
  async ensureDraft(pr: PullRequest): Promise<boolean> {
    if (pr.isDraft || pr.state !== 'OPEN') return false;
    await this.gh(['pr', 'ready', String(pr.number), '--undo']);
    return true;
  }

  async comment(pr: number, body: string): Promise<void> {
    await this.gh(['pr', 'comment', String(pr), '--body-file', '-'], body);
  }

  /** Conversation + review state, for the "existing work" section of a resume prompt. */
  async prDigest(pr: number): Promise<string> {
    const r = await run(
      'gh',
      ['pr', 'view', String(pr), '--json', 'title,isDraft,comments,reviews,statusCheckRollup'],
      { cwd: this.cwd },
    );
    if (r.code !== 0) return '(could not load PR details)';
    const data = JSON.parse(r.stdout);
    const comments = (data.comments ?? []).map((c: any) => `- ${c.author?.login} (${c.createdAt}): ${c.body}`);
    const reviews = (data.reviews ?? [])
      .filter((r: any) => r.body)
      .map((r: any) => `- review by ${r.author?.login} [${r.state}]: ${r.body}`);
    const checks = (data.statusCheckRollup ?? []).map((c: any) => `- ${c.name ?? c.context}: ${c.conclusion ?? c.state ?? c.status}`);
    return [
      `Draft: ${data.isDraft}`,
      `Checks:\n${checks.join('\n') || '- none yet'}`,
      `Comments:\n${comments.join('\n') || '- none'}`,
      `Reviews:\n${reviews.join('\n') || '- none'}`,
    ].join('\n\n');
  }
}
