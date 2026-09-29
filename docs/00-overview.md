# 00 · Overview

## Purpose
This doc records what we learned from the *Inside Code-Crafter* architecture note and how our prototype maps each piece onto free or cheap tools.

## The core idea
Code-Crafter is **not a long-running bot**. It is a factory: each ticket gets a **disposable sandbox** that
1. clones the target repo and builds *that repo's* toolchain,
2. runs a coding agent with a prompt built from the ticket plus architecture context,
3. commits often, opens a PR, and then
4. is **fed events** (review comments, CI failures, merge) until the PR lands.

The sandbox can be killed at any time without losing work, because all the important state lives outside it (see [08](08-state-and-memory.md)).

## The five parts (original → ours)
| Part | Lifetime | Original | Ours (MVP) |
|---|---|---|---|
| Agent sandbox | per ticket, ~40 min | K8s pod: Express wrapper + `cursor-agent` | Docker container: Express wrapper + `AgentRunner` (Claude Code first) — [05](05-agent-runtime.md), [06](06-agent-runner-abstraction.md), [07](07-orchestrator.md) |
| Webapp / control plane | long-lived | Neo4j graph, planner, Jira/Slack entry points, dashboards | Slim Node/TS service: `/spawn`, `/api/tickets/:key/merged`, slack-bridge. Graph and planner come later — [04](04-spawner.md), [10](10-context-graph.md), [11](11-planner.md) |
| Architecture memory | long-lived | Neo4j | *(Phase 2)* Neo4j Community — [10](10-context-graph.md) |
| Event bus | long-lived | n8n | n8n self-hosted in Docker — [03](03-event-bus-n8n.md) |
| Spawner | per trigger | GitLab CI `deploy_on_demand` → namespace + Deployment | Control plane `docker run` — [04](04-spawner.md) |

## The request cycle (8 stages)
```
1 Trigger   Slack message: Jira URL · repo/service · base branch · env
2 Spawn     n8n slack-parser → control-plane /spawn → docker run code-crafter-<key>
3 Boot      entrypoint: git creds → clone → checkout/create CODE-CRAFTER-<KEY> → BRANCH_IS_NEW
            → drop agent rules (gitignored) → read codecrafter.yaml → install toolchain
4 Prompt    Jira issue + attachments + branch/PR state (+ graph context later) → prompt
5 Coding    AgentRunner streams; checkpoint commits; supervision loop (soft timeout, stall detect)
6 PR        agent runs `gh pr create`; orchestrator enforces draft flag + embeds Slack thread ts
7 Feedback  GitHub webhook → smee → n8n router → http://code-crafter-<key>:8080/command
8 Merge     merge event → control plane → Jira "Done" + ✅ reaction on the Slack trigger
```

```
Slack ──Socket Mode──► slack-bridge ──► n8n slack-parser ──► control-plane /spawn
                                                                 │ docker run
GitHub ──webhook──► smee.io ──► n8n event-router ──► code-crafter-<key>:8080/command
                                                                 │
                                           ┌─────────────────────┴───────────────────┐
                                           │ agent container                         │
                                           │ entrypoint.sh → orchestrator (Express)  │
                                           │   → AgentRunner → claude -p (stream)    │
                                           └─────────────────────────────────────────┘
merge ──► n8n merge-parser ──► control-plane /api/tickets/:key/merged ──► Jira Done + Slack ✅
```

## Design principles we keep from the original
1. **The sandbox is designed to die.** It has a TTL, and resuming works by re-cloning the branch.
2. **Routing by convention, not by registry.** Branch `CODE-CRAFTER-<KEY>` maps to container name `code-crafter-<key>`, which is also its DNS name.
3. **Events, never polling.** The agent never sleeps waiting for CI; feedback arrives as a `/command`.
4. **Don't trust the model for invariants.** The orchestrator re-checks things like the draft status and the PR body after the agent finishes.
5. **One flag drives resume vs fresh:** `BRANCH_IS_NEW`.
6. **Per-repo contract:** `codecrafter.yaml` in the target repo declares its toolchain, agent model and PR policy.
7. **Tool-agnostic agent** *(our addition)*: every call to the coding CLI goes through `AgentRunner`.

## Things the original got wrong (lessons)
- A literal pipeline-trigger token was committed in an n8n workflow JSON. → Our n8n workflows use credentials or env placeholders only. See [12](12-security.md).
- The README had drifted from reality. → These docs are the source of truth and are updated in the same PR as the code they describe.

## Open questions
- Should the MVP trigger only from Slack, or also from a Jira label or automation? (Proposal: Slack only.)
- One target repo for the MVP, or several from day one?
