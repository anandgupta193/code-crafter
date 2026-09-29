# 08 · State & memory

## Purpose
The sandbox is disposable, so **no important state may live only inside it**. The original's note says these layers are "routinely conflated". This doc keeps them separate.

## The layers
| Layer | Stored in | Holds | Survives container death? |
|---|---|---|---|
| **Work** | git: branch `CODE-CRAFTER-<KEY>` on GitHub | The code. Checkpoint commits make a restart a *resume* | ✅ |
| **Conversation** | Agent session (`sessionId`) → kept in Redis `codecrafter:session:<KEY>` | Replayed with `--resume` for feedback rounds. Deliberately dropped on model fallback | ⚠️ Partially. The session files live in the container's home dir, so they're lost on respawn → see below |
| **Control** | Redis | `codecrafter:state:<KEY>` (running/paused/stopped), `codecrafter:thread:<KEY>`, spawn locks, processed-delivery IDs | ✅ (Redis volume) |
| **Durable thread link** | PR body `<!-- SLACK_THREAD_TS: … -->` | A restarted sandbox recovers Slack threading even if Redis was flushed | ✅ |
| **Architecture** *(Phase 2)* | Neo4j | Services, endpoints, events, DBs, doc embeddings | ✅ |

## Session persistence across respawns
Claude Code stores sessions under `~/.claude/` in the container, so a fresh container can't `--resume` an old ID. Options:
1. **Mount a per-ticket named volume** (`codecrafter-home-<key>`) at the agent's home dir. The session survives respawns, and the reaper deletes the volume after merge. *(Proposed for the MVP.)*
2. Accept a fresh session on respawn and rely on the "existing work analysis" prompt (git log, PR, comments). This is always the fallback.

## Redis key schema
```
codecrafter:state:<KEY>          running|paused|stopped
codecrafter:thread:<KEY>         slack thread ts
codecrafter:session:<KEY>        agent session id
codecrafter:lock:spawn:<KEY>     spawn lock (TTL 60s)
codecrafter:delivery:<id>        processed GitHub delivery ids (TTL 1d)
codecrafter:lock:ingest          (Phase 2) graph ingestion lock
```

## Pause / resume / stop
A human comments `/codecrafter pause|resume|stop` on the PR (or in the Slack thread). The router sets the Redis state, and the orchestrator checks it before every round.

## Open questions
- Is Redis durability (AOF) needed for the MVP, given the PR body plus git already cover the critical recovery? Proposal: default RDB snapshots are enough.
