import { describe, expect, it } from 'vitest';
import { supervise } from '../src/supervisor.ts';
import type { AgentEvent, AgentExit, AgentRun, AgentRunner, RunOptions } from '../src/runners/types.ts';

/** A scripted fake agent: emits events on a schedule, can be interrupted. */
function fakeRunner(script: { at: number; event: AgentEvent }[], endAt: number, exit: Omit<AgentExit, 'code'>): AgentRunner {
  return {
    provider: 'claude',
    start(_opts: RunOptions): AgentRun {
      let stop: (reason: AgentExit['reason']) => void = () => {};
      const exitP = new Promise<AgentExit>((resolve) => {
        stop = (reason) => resolve({ code: reason === 'done' ? 0 : 130, ...exit, reason: reason === 'done' ? exit.reason : reason });
      });
      async function* events(): AsyncGenerator<AgentEvent> {
        const t0 = Date.now();
        let interrupted = false;
        exitP.then(() => (interrupted = true));
        for (const { at, event } of script) {
          while (Date.now() - t0 < at && !interrupted) await new Promise((r) => setTimeout(r, 5));
          if (interrupted) return;
          yield event;
        }
        while (Date.now() - t0 < endAt && !interrupted) await new Promise((r) => setTimeout(r, 5));
        stop('done');
      }
      return {
        events: events(),
        sessionId: () => 'sess-1',
        interrupt: () => stop('error'),
        kill: () => stop('killed'),
        exit: exitP,
      };
    },
  };
}

const run: RunOptions = { cwd: '/tmp', prompt: 'x', model: 'haiku' };

describe('supervise', () => {
  it('returns done when the agent finishes', async () => {
    const r = fakeRunner([{ at: 0, event: { kind: 'text', text: 'hi' } }], 20, { reason: 'done', summary: 'DONE' });
    const o = await supervise(r, run, { softTimeoutMs: 1000, maxContinuations: 3, head: async () => 'a' });
    expect(o).toEqual({ kind: 'done', summary: 'DONE', sessionId: 'sess-1' });
  });

  it('interrupts a silent agent as stalled', async () => {
    const r = fakeRunner([], 5_000, { reason: 'done', summary: '' });
    const o = await supervise(r, run, { softTimeoutMs: 40, maxContinuations: 3, recentOutputMs: 20, head: async () => 'same' });
    expect(o.kind).toBe('stalled');
  });

  it('extends while progressing, then stops as exhausted', async () => {
    let n = 0;
    const r = fakeRunner([], 5_000, { reason: 'done', summary: '' });
    const ticks: boolean[] = [];
    const o = await supervise(r, run, {
      softTimeoutMs: 30,
      maxContinuations: 2,
      recentOutputMs: 1,
      head: async () => `sha-${n++}`, // HEAD moves every check → progressing
      onTick: ({ progressing }) => ticks.push(progressing),
    });
    expect(o.kind).toBe('exhausted');
    expect(ticks.length).toBe(3);
  });

  it('reports usage limits with the reset time', async () => {
    const r = fakeRunner([{ at: 0, event: { kind: 'usage_limit', resetsAt: 123 } }], 10, { reason: 'usage_limit', summary: 'limit', resetsAt: 123 });
    const o = await supervise(r, run, { softTimeoutMs: 1000, maxContinuations: 3, head: async () => 'a' });
    expect(o).toMatchObject({ kind: 'usage_limit', resetsAt: 123 });
  });

  it('abort signal kills the run', async () => {
    const r = fakeRunner([], 5_000, { reason: 'done', summary: '' });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const o = await supervise(r, run, { softTimeoutMs: 1000, maxContinuations: 3, head: async () => 'a', signal: ac.signal });
    expect(o.kind).toBe('killed');
  });
});
