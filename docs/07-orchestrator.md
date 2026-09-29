# 07 · Orchestrator (inside the agent container)

## Purpose
The Node/Express process that wraps the agent (the original's `ticket-agent.ts` + `server.ts`). It builds the prompt, supervises the run, enforces invariants the model can't be trusted with, and turns incoming events into new agent rounds.

## HTTP surface (`server.ts`)
| Route | Purpose |
|---|---|
| `GET /healthz` | 503 until the agent has spawned, then 200 |
| `POST /command` | Queue an event (comment, pipeline failure, pause/resume/stop) |
| `GET /state` | Current phase, session ID, queue depth (debugging and dashboard) |

About 2s after `listen()`, the server auto-fires the **initial workflow**.

## 1 · Prompt assembly
First, check Redis `codecrafter:state:<KEY>`. If it's `paused` or `stopped`, don't start work.

Gather these sources:
| Source | How |
|---|---|
| Jira issue: summary, description, labels, acceptance criteria | Jira REST `GET /rest/api/3/issue/{key}` (ADF converted to markdown) |
| Attachments | Download to `/workspace/attachments/`, listed in the prompt (images readable by the agent) |
| Branch context (only if `BRANCH_IS_NEW=false`) | `gh pr view`, latest workflow run status, unresolved review comments, `git log base..HEAD` |
| `codecrafter.yaml` | model, draft policy, test/lint commands |
| *(Phase 2)* Architecture context | `ContextClient` → Neo4j → markdown (see [10](10-context-graph.md)) |

Prompt template:
```
## Task Context        key, Jira URL, repo, base branch, branch name
## Task Requirements   Jira summary + description + AC
## Jira Attachments    local paths
## Architecture Context   (Phase 2)
## Fresh analysis | Existing work analysis   (by BRANCH_IS_NEW)
## Workflow Context    PR number, last CI result, pending comments, rules reminder
```

## 2 · Agent rules (`rules/code-crafter.md`, always applied)
1. **Commit and push incrementally** at named checkpoints (after analysis/plan, after first compile, after tests pass, after each review fix, before a PR, before finishing). WIP commits are fine; the container can die at any moment.
2. **Never sleep or poll** for CI status. Feedback arrives as events.
3. **Never change CI/CD or infra** to make a pipeline go green.
4. **Blocked by a vague ticket?** Push what you have, open a draft PR, and post a *specific* question as a PR comment. Never stall.
5. Review-bot comments (e.g. CodeRabbit) get a decision framework: check them against the real code, stay on the original task, ignore anything that conflicts with the requirements.
6. **TASK COMPLETED checklist:** tests run, lint run, PR opened/updated, (Phase 2) context manifest updated if a public surface changed.

## 3 · Supervision loop
```
start run (fresh or --resume)
every event: record lastOutputAt; on 'session' store sessionId in Redis
soft timeout = 12 min:
   send "commit and push your progress now" (interrupt + short resume round)
   progressing? (HEAD moved OR output within last N min)
      yes → reset timer, continuation++ (max 3)
      no  → STALLED
usage_limit → fallback chain (see 06)
STALLED or continuations exhausted:
   force-commit working tree ("WIP: code-crafter checkpoint"), push
   ensure a PR exists
   comment on the PR + Slack thread: "needs a human: <reason>"
```

## 4 · PR guardrails (don't trust the model)
The model opens the PR itself (`gh pr create …` per the rules). Afterwards, the orchestrator:
- **Pre-computes the PR body** and gives it to the model, including `<!-- SLACK_THREAD_TS: 1727… -->`. After the run it checks the marker is present and adds it back with `gh pr edit` if missing.
- **`ensurePRDraftStatus()`**: corrects draft or ready state against `codecrafter.yaml` (`gh pr ready` / `gh pr ready --undo`).
- Title format: `CC-12: <summary>`, base = `WORKSPACE_BASE_BRANCH`.
- If the model didn't create a PR at all, the orchestrator creates one.

## 5 · Event handling (`/command`)
Commands go into a single FIFO queue and are processed one at a time. **Failures never pre-empt** running work. Each command becomes a new agent round with `--resume <sessionId>` and a purpose-built prompt (see [09](09-feedback-and-merge.md)).

## Failure modes
Covered above. In addition, the orchestrator itself crashing means the container exits and the next event respawns and resumes it.

## Source layout (planned)
```
orchestrator/src/server.ts
orchestrator/src/ticket-agent.ts       workflow + supervision
orchestrator/src/prompt/*.ts           builders per section
orchestrator/src/runners/{claude,cursor}.ts
orchestrator/src/clients/{jira,github,slack,redis}.ts
orchestrator/src/guardrails/pr.ts
```
*Improvement over the original:* split the ~4k-line `ticket-agent.ts` into modules from the start.
