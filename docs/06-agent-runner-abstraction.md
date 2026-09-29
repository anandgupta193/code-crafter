# 06 · AgentRunner abstraction (tool-agnostic coding agent)

## Purpose
Let the orchestrator drive **any** coding CLI (Claude Code today, Cursor tomorrow) through one interface. Switching tools should be a config change (`agent.provider`), not a rewrite.

## What the orchestrator needs from any agent
From the original's use of `cursor-agent`, the orchestrator needs:
1. Run with a one-shot prompt from stdin/arg, non-interactive.
2. **Stream structured events** (text, tool use, result) to detect progress and stalls.
3. **Session ID**, so feedback rounds continue the same conversation (`--resume`).
4. Choose a **model**, and fall back on usage limits.
5. Project **rules** that always apply.
6. **MCP** servers (Phase 2).
7. Clean interrupt (SIGINT/SIGTERM).

## Interface (TypeScript sketch)
```ts
interface AgentRunner {
  readonly provider: 'claude' | 'cursor';
  start(opts: RunOptions): AgentRun;          // fresh or resumed session
}

interface RunOptions {
  cwd: string;
  prompt: string;
  model: string;
  resumeSessionId?: string;
  permissionMode: 'autonomous';              // no interactive approvals in the sandbox
  env: Record<string, string>;
}

interface AgentRun {
  events: AsyncIterable<AgentEvent>;        // normalised stream
  sessionId(): Promise<string | undefined>;
  interrupt(): Promise<void>;               // ask the agent to stop gracefully
  kill(): Promise<void>;
  exit: Promise<{ code: number; reason: 'done' | 'usage_limit' | 'error' | 'killed' }>;
}

type AgentEvent =
  | { kind: 'session'; id: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'usage_limit'; resetAt?: string }
  | { kind: 'result'; ok: boolean; summary?: string }
  | { kind: 'raw'; line: string };          // anything unrecognised
```

## Adapters
| Capability | `ClaudeCodeRunner` | `CursorRunner` *(later)* |
|---|---|---|
| Command | `claude -p --output-format stream-json --verbose` | `cursor-agent -p --output-format stream-json` |
| Resume | `--resume <sessionId>` | `--resume <sessionId>` |
| Model | `--model <alias>` | `--model <name>` |
| Autonomy | `--permission-mode bypassPermissions` (safe only because it runs inside a disposable container) | `--force` / equivalent |
| Rules | `CLAUDE.md` / `.claude/` + `--append-system-prompt` | `.cursor/rules/*.mdc` (`alwaysApply: true`) |
| MCP | `.mcp.json` / `--mcp-config` | `.cursor/mcp.json` |
| Auth | `CLAUDE_CODE_OAUTH_TOKEN` (subscription) or `ANTHROPIC_API_KEY` | `CURSOR_API_KEY` |
| Usage-limit signal | Parsed from the stream / exit message | Parsed from the stream |

Exact flags get checked against each CLI's current `--help` when the adapter is implemented; this table records intent.

**Rules are authored once**, in a neutral `rules/*.md`, and each adapter renders them into its native location (`CLAUDE.md` vs `.mdc` with front-matter).

## Model fallback chain
On `usage_limit`: move to the next model in `codecrafter.agent.fallback` and **start a fresh session** (don't resume into a context that just hit the limit; the original does the same). Prompt it with "resume from the branch state" context. If the chain is exhausted, force-commit, make sure a PR exists, post "paused: usage limit, resets at …" to the PR and Slack, and set a Redis pause flag.

## Failure modes
| Case | Behaviour |
|---|---|
| Stream line isn't JSON | Emit `raw`, keep going |
| Session ID missing | Treat the next round as fresh (with branch context) |
| CLI not installed / auth invalid | Fail fast at boot; post to Slack |

## Open questions
- Do we also want an **Agent SDK** adapter (in-process, no CLI)? It would give richer hooks, but CLI parity with Cursor is simpler. Proposal: CLI first.
