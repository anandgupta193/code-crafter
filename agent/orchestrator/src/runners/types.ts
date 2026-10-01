// Tool-agnostic coding-agent interface (docs/06-agent-runner-abstraction.md).
// The orchestrator only ever talks to these types; Claude Code / Cursor live behind adapters.

export type Provider = 'claude' | 'cursor';

export interface RunOptions {
  cwd: string;
  prompt: string;
  model: string;
  resumeSessionId?: string;
  systemPromptAppend?: string;
  /** MCP server config file outside the repo (context graph, docs/10). */
  mcpConfig?: string;
  env?: NodeJS.ProcessEnv;
  /** Append every raw output line here (debug transcript on the ticket volume). */
  transcriptFile?: string;
}

export type AgentEvent =
  | { kind: 'session'; id: string; model?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; isError: boolean }
  | { kind: 'usage'; window: string; utilization?: number; resetsAt?: number }
  | { kind: 'usage_limit'; resetsAt?: number }
  | { kind: 'result'; ok: boolean; summary: string; usageLimited: boolean; costUsd?: number; turns?: number }
  | { kind: 'raw'; line: string };

export type ExitReason = 'done' | 'usage_limit' | 'error' | 'killed';

export interface AgentExit {
  code: number;
  reason: ExitReason;
  summary: string;
  resetsAt?: number;
}

export interface AgentRun {
  events: AsyncIterable<AgentEvent>;
  sessionId(): string | undefined;
  /** Ask the agent to stop gracefully (SIGINT). */
  interrupt(): void;
  /** Stop now (SIGTERM, then SIGKILL). */
  kill(): void;
  exit: Promise<AgentExit>;
}

export interface AgentRunner {
  readonly provider: Provider;
  start(opts: RunOptions): AgentRun;
}
