# 11 · Orchestration planner (Phase 3)

## Purpose
Turn a cross-service request into **N independent single-repo tickets**. Each one then runs through the normal MVP loop.

## Flow
```
engineer chats at /orchestrate (control-plane web UI)
  → planner worker: read all Service/Library repo URLs from Neo4j, dedupe monorepos
  → init step: shallow-clone all into /workspace/repos/
  → run AgentRunner READ-ONLY across the whole estate (+ graph MCP as escape hatch)
  → agent emits a `PLAN:` JSON block {story, subtasks:[{service, summary, description}]}
  → engineer confirms in the chat
  → create Jira Story + one Sub-task per service
  → post one Slack trigger message per Sub-task  → normal spawn path
```

## Contracts
`PLAN:` JSON schema, validated before anything is created. The planner session snapshots go to Redis so the dialogue survives restarts.

## Notes
- The read-only mode is enforced with the agent's permission settings (no write or bash tools), not just the prompt.
- Runs as a longer-lived container (not per ticket).

## Open questions
- UI: a minimal web chat in the control plane, or a Slack thread dialogue? (A Slack thread is cheaper to build.)
