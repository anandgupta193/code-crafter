import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

/** Run a command without a shell. Never throws on non-zero exit; check `code`. */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const hasInput = opts.input !== undefined;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      // Only open stdin when we have something to send: writing to a child that already exited
      // raises EPIPE, which crashed the whole orchestrator on SCRUM-7.
      stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d) => (stdout += d));
    child.stderr!.on('data', (d) => (stderr += d));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : undefined;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (child.stdin) {
      child.stdin.on('error', () => {}); // child exited before reading its input — its exit code tells the story
      child.stdin.end(opts.input);
    }
  });
}

/** Run a shell command line (used for repo-declared commands like `npm run lint`). */
export function sh(commandLine: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return run('bash', ['-lc', commandLine], opts);
}

/** Like `run`, but throws with stderr when the command fails. */
export async function runOk(cmd: string, args: string[], opts: ExecOptions = {}): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

export function tail(text: string, lines = 60): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}
