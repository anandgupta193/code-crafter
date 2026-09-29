// Supervision loop (docs/07-orchestrator.md §3, timers per D16).
//
// Every `softTimeoutMs` we check for progress: HEAD moved or the agent produced output recently.
//   progressing → keep going (up to `maxContinuations` extensions)
//   not progressing → interrupt: STALLED
//   extensions used up → interrupt: EXHAUSTED
// A usage-limit signal ends the round as USAGE_LIMIT (D13: pause, never downgrade).

import type { AgentEvent, AgentRunner, RunOptions } from './runners/types.ts';

export type Outcome =
  | { kind: 'done'; summary: string; sessionId?: string }
  | { kind: 'usage_limit'; summary: string; sessionId?: string; resetsAt?: number }
  | { kind: 'stalled' | 'exhausted' | 'error' | 'killed'; summary: string; sessionId?: string };

export interface SuperviseOptions {
  softTimeoutMs: number;
  maxContinuations: number;
  /** Output within this window counts as "still working". */
  recentOutputMs?: number;
  head: () => Promise<string>;
  onEvent?: (e: AgentEvent) => void | Promise<void>;
  onTick?: (info: { continuation: number; progressing: boolean }) => void;
  /** Lets the caller abort (shutdown) — the current run is killed. */
  signal?: AbortSignal;
}

export async function supervise(runner: AgentRunner, run: RunOptions, opts: SuperviseOptions): Promise<Outcome> {
  const handle = runner.start(run);
  const recentMs = opts.recentOutputMs ?? 3 * 60_000;
  let lastOutputAt = Date.now();
  let lastHead = await opts.head().catch(() => '');
  let continuation = 0;
  let verdict: 'stalled' | 'exhausted' | undefined;

  const onAbort = () => handle.kill();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const timer = setInterval(async () => {
    const head = await opts.head().catch(() => lastHead);
    const progressing = head !== lastHead || Date.now() - lastOutputAt < recentMs;
    lastHead = head;
    opts.onTick?.({ continuation, progressing });
    if (!progressing) {
      verdict = 'stalled';
      handle.interrupt();
    } else if (continuation >= opts.maxContinuations) {
      verdict = 'exhausted';
      handle.interrupt();
    } else {
      continuation++;
    }
  }, opts.softTimeoutMs);

  try {
    for await (const e of handle.events) {
      lastOutputAt = Date.now();
      await opts.onEvent?.(e);
    }
    const exit = await handle.exit;
    const sessionId = handle.sessionId();
    if (opts.signal?.aborted) return { kind: 'killed', summary: exit.summary, sessionId };
    if (exit.reason === 'usage_limit') return { kind: 'usage_limit', summary: exit.summary, sessionId, resetsAt: exit.resetsAt };
    if (verdict) return { kind: verdict, summary: exit.summary, sessionId };
    if (exit.reason === 'done') return { kind: 'done', summary: exit.summary, sessionId };
    return { kind: exit.reason === 'killed' ? 'killed' : 'error', summary: exit.summary, sessionId };
  } finally {
    clearInterval(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
