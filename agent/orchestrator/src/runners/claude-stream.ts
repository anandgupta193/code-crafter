import type { AgentEvent } from './types.ts';

// Parser for `claude -p --output-format stream-json --verbose`.
// Shapes observed on Claude Code 2.1.x:
//   {"type":"system","subtype":"init","session_id":..,"model":..}
//   {"type":"assistant","message":{"content":[{"type":"text"|"tool_use"|"thinking",..}]}}
//   {"type":"user","message":{"content":[{"type":"tool_result","is_error":..}]}}
//   {"type":"rate_limit_event","rate_limit_info":{"status":"allowed",..,"resetsAt":<epoch s>,"unifiedWindows":{..}}}
//   {"type":"result","subtype":"success"|"error_*","is_error":..,"result":"..","total_cost_usd":..,"api_error_status":..}

const USAGE_LIMIT_TEXT = /usage limit|hit your limit|rate.?limit(ed)?|limit reached|resets? at/i;

export function isUsageLimitText(text: string): boolean {
  return USAGE_LIMIT_TEXT.test(text);
}

export function parseStreamLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return [{ kind: 'raw', line: trimmed }];
  }

  switch (msg.type) {
    case 'system':
      return msg.subtype === 'init' && msg.session_id ? [{ kind: 'session', id: msg.session_id, model: msg.model }] : [];

    case 'assistant': {
      const events: AgentEvent[] = [];
      for (const part of msg.message?.content ?? []) {
        if (part.type === 'text' && part.text?.trim()) events.push({ kind: 'text', text: part.text });
        else if (part.type === 'tool_use') events.push({ kind: 'tool', name: part.name, input: part.input ?? {} });
      }
      return events;
    }

    case 'user':
      return (msg.message?.content ?? [])
        .filter((p: any) => p.type === 'tool_result')
        .map((p: any) => ({ kind: 'tool_result', isError: Boolean(p.is_error) }) as AgentEvent);

    case 'rate_limit_event': {
      const info = msg.rate_limit_info ?? {};
      if (info.status && info.status !== 'allowed' && info.status !== 'allowed_warning') {
        return [{ kind: 'usage_limit', resetsAt: info.resetsAt }];
      }
      const windows = info.unifiedWindows ?? {};
      const current = windows[info.rateLimitType] ?? {};
      return [
        {
          kind: 'usage',
          window: info.rateLimitType ?? 'unknown',
          utilization: current.utilization,
          resetsAt: current.resetsAt ?? info.resetsAt,
        },
      ];
    }

    case 'result': {
      const summary = typeof msg.result === 'string' ? msg.result : '';
      const usageLimited = Boolean(msg.is_error) && (msg.api_error_status === 429 || isUsageLimitText(summary));
      return [
        {
          kind: 'result',
          ok: !msg.is_error && msg.subtype === 'success',
          summary,
          usageLimited,
          costUsd: msg.total_cost_usd,
          turns: msg.num_turns,
        },
      ];
    }

    default:
      return [];
  }
}
