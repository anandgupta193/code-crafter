import { describe, expect, it } from 'vitest';
import { run } from '../src/exec.ts';

describe('run', () => {
  it('does not crash when the child exits before reading its input (SCRUM-7 EPIPE)', async () => {
    const big = 'x'.repeat(5 * 1024 * 1024); // larger than the pipe buffer
    const r = await run('true', [], { input: big });
    expect(r.code).toBe(0);
  });

  it('does not open stdin without input', async () => {
    const r = await run('cat', []); // would hang forever if stdin were an open pipe
    expect(r.code).toBe(0);
  });

  it('passes input through when given', async () => {
    expect((await run('cat', [], { input: 'hello' })).stdout).toBe('hello');
  });
});
