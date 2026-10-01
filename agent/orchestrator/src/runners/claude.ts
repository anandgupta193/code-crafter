import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseStreamLine } from './claude-stream.ts';
import type { AgentEvent, AgentExit, AgentRun, AgentRunner, RunOptions } from './types.ts';

/** Claude Code headless adapter: `claude -p --output-format stream-json`. */
export class ClaudeCodeRunner implements AgentRunner {
  readonly provider = 'claude' as const;

  private binary: string;

  constructor(binary = process.env.CLAUDE_BIN ?? 'claude') {
    this.binary = binary;
  }

  buildArgs(opts: RunOptions): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', opts.model,
      // Safe only because the container is disposable (docs/12-security.md).
      '--permission-mode', 'bypassPermissions',
    ];
    if (opts.systemPromptAppend) args.push('--append-system-prompt', opts.systemPromptAppend);
    if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig);
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    return args;
  }

  start(opts: RunOptions): AgentRun {
    const child = spawn(this.binary, this.buildArgs(opts), {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {}); // EPIPE if claude exits before reading the prompt; the exit code reports it
    child.stdin.end(opts.prompt);

    let sessionId = opts.resumeSessionId;
    let lastResult: Extract<AgentEvent, { kind: 'result' }> | undefined;
    let limitResetsAt: number | undefined;
    let limited = false;
    let killed = false;
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));

    const queue: AgentEvent[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    const push = (e: AgentEvent) => {
      queue.push(e);
      wake?.();
    };

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (opts.transcriptFile) void appendFile(opts.transcriptFile, line + '\n').catch(() => {});
      for (const e of parseStreamLine(line)) {
        if (e.kind === 'session') sessionId = e.id;
        if (e.kind === 'usage_limit') {
          limited = true;
          limitResetsAt = e.resetsAt;
        }
        if (e.kind === 'result') {
          lastResult = e;
          if (e.usageLimited) limited = true;
        }
        push(e);
      }
    });

    const exit = new Promise<AgentExit>((resolve) => {
      child.on('close', (code) => {
        closed = true;
        wake?.();
        const summary = lastResult?.summary || stderr.trim().split('\n').slice(-5).join('\n');
        const reason = killed ? 'killed' : limited ? 'usage_limit' : lastResult?.ok ? 'done' : 'error';
        resolve({ code: code ?? 1, reason, summary, resetsAt: limitResetsAt });
      });
      child.on('error', (err) => {
        closed = true;
        wake?.();
        resolve({ code: 127, reason: 'error', summary: `failed to start ${this.binary}: ${String(err)}` });
      });
    });

    async function* events(): AsyncGenerator<AgentEvent> {
      while (true) {
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
        wake = undefined;
      }
    }

    return {
      events: events(),
      sessionId: () => sessionId,
      interrupt: () => child.kill('SIGINT'),
      kill: () => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 10_000).unref();
      },
      exit,
    };
  }
}
