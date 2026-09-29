import { describe, expect, it } from 'vitest';
import { parseStreamLine } from '../src/runners/claude-stream.ts';

describe('parseStreamLine (claude stream-json)', () => {
  it('extracts the session id from init', () => {
    expect(parseStreamLine('{"type":"system","subtype":"init","session_id":"abc","model":"claude-haiku-4-5"}')).toEqual([
      { kind: 'session', id: 'abc', model: 'claude-haiku-4-5' },
    ]);
  });

  it('maps assistant text and tool_use, skipping thinking', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Reading files' },
          { type: 'tool_use', name: 'Bash', input: { command: 'git push' } },
        ],
      },
    });
    expect(parseStreamLine(line)).toEqual([
      { kind: 'text', text: 'Reading files' },
      { kind: 'tool', name: 'Bash', input: { command: 'git push' } },
    ]);
  });

  it('reports usage while allowed, and a limit when rejected', () => {
    const allowed = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', resetsAt: 100, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.43, resetsAt: 100 } } },
    };
    expect(parseStreamLine(JSON.stringify(allowed))).toEqual([{ kind: 'usage', window: 'five_hour', utilization: 0.43, resetsAt: 100 }]);

    const rejected = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 200, rateLimitType: 'five_hour' } };
    expect(parseStreamLine(JSON.stringify(rejected))).toEqual([{ kind: 'usage_limit', resetsAt: 200 }]);
  });

  it('flags usage-limited results', () => {
    const [ok] = parseStreamLine('{"type":"result","subtype":"success","is_error":false,"result":"DONE","total_cost_usd":0.02,"num_turns":2}');
    expect(ok).toMatchObject({ kind: 'result', ok: true, summary: 'DONE', usageLimited: false, turns: 2 });

    const [limited] = parseStreamLine('{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1790714400"}');
    expect(limited).toMatchObject({ kind: 'result', ok: false, usageLimited: true });

    const [err429] = parseStreamLine('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"","api_error_status":429}');
    expect(err429).toMatchObject({ usageLimited: true });
  });

  it('passes non-JSON through as raw and ignores blanks', () => {
    expect(parseStreamLine('warning: something')).toEqual([{ kind: 'raw', line: 'warning: something' }]);
    expect(parseStreamLine('   ')).toEqual([]);
  });
});
