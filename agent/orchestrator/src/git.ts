import { run, runOk } from './exec.ts';

export const EMERGENCY_COMMIT_MESSAGE = 'WIP(code-crafter): emergency checkpoint [skip-hooks]';

export class Git {
  private cwd: string;
  private branch: string;
  private baseBranch: string;

  constructor(cwd: string, branch: string, baseBranch: string) {
    this.cwd = cwd;
    this.branch = branch;
    this.baseBranch = baseBranch;
  }

  private git(...args: string[]) {
    return runOk('git', args, { cwd: this.cwd });
  }

  head(): Promise<string> {
    return this.git('rev-parse', 'HEAD');
  }

  async isDirty(): Promise<boolean> {
    return (await this.git('status', '--porcelain')).length > 0;
  }

  /** Commits on the branch that are not on origin/<base>. */
  async commitsAheadOfBase(): Promise<number> {
    return Number(await this.git('rev-list', '--count', `origin/${this.baseBranch}..HEAD`));
  }

  /** Commits not yet pushed to origin/<branch> (all of them if the branch was never pushed). */
  async unpushedCount(): Promise<number> {
    const remote = await run('git', ['rev-parse', '--verify', '--quiet', `origin/${this.branch}`], { cwd: this.cwd });
    const range = remote.code === 0 ? `origin/${this.branch}..HEAD` : `origin/${this.baseBranch}..HEAD`;
    return Number(await this.git('rev-list', '--count', range));
  }

  logSinceBase(max = 30): Promise<string> {
    return this.git('log', '--oneline', `-${max}`, `origin/${this.baseBranch}..HEAD`);
  }

  lastCommitSubject(): Promise<string> {
    return this.git('log', '-1', '--format=%s');
  }

  /** Normal commit: hooks run. Returns false if the hook (or anything) rejected it. */
  async commitAll(message: string): Promise<boolean> {
    await this.git('add', '-A');
    const r = await run('git', ['commit', '-m', message], { cwd: this.cwd });
    return r.code === 0;
  }

  /** Emergency save (D14): the only place hooks may be skipped. */
  async emergencyCommit(): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '--no-verify', '-m', EMERGENCY_COMMIT_MESSAGE);
  }

  async push(): Promise<void> {
    await this.git('push', '-u', 'origin', this.branch);
  }
}
