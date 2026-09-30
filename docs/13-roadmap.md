# 13 · Roadmap & open questions

## Phases
| Phase | Goal | Deliverables | Done when |
|---|---|---|---|
| **0 · Plumbing** *(after 1a)* | Accounts and local infra | Checklist in [01](01-accounts-and-infra.md); `docker-compose.yml` (n8n, redis, smee, control plane); sandbox repo with `codecrafter.yaml` + CI | `docker compose up` works; a GitHub webhook shows up in n8n |
| **1a · Agent runs locally** *(first)* | Prove the agent core without the bus | Agent image, `entrypoint.sh`, orchestrator with `ClaudeCodeRunner`, prompt from Jira; `scripts/run-ticket.sh` | The Phase 1a checklist below passes on `SCRUM-2` |
| **1b · Spawn from Slack** | Intake | slack-bridge, n8n `slack-parser`, control plane `/spawn` + dedupe + reaper | A Slack message produces a PR, and the thread gets updates |
| **1c · Feedback loop** | Events | n8n `github-router` + comment/pipeline/merge parsers, `/command` queue, resume path | A review comment is fixed; a CI failure is fixed; a merge moves Jira to Done and adds ✅ |
| **1d · Hardening** | Robustness | Supervision loop, fallback chain, PR guardrails, pause/stop, gitleaks | A killed container resumes cleanly |
| **2 · Context graph** | Architecture memory | Neo4j, `context.yaml`, ingestion, ContextClient, MCP | The prompt includes dependency context |
| **2b · Cursor adapter** | Tool-agnostic proof | `CursorRunner` | Switching `provider: cursor` works end to end |
| **3 · Planner** | Multi-repo | `/orchestrate`, `PLAN:` → Story + Sub-tasks | One request fans out into N PRs |
| **4 · Kubernetes** | Parity with the original | `K8sSpawner`, kind, manifests template | Same flow on kind |
| **5 · Cloud** | Off the laptop | VM/cluster, real ingress, secrets manager | Runs without your Mac |

## Proposed repo layout (for the next planning round)
```
code-crafter/
  docs/
  docker-compose.yml
  .env.example
  config/services.yaml
  control-plane/        Node/TS: spawn API, reaper, slack-bridge, tickets API
  agent/
    Dockerfile
    scripts/entrypoint.sh, codecrafter-utils.sh
    rules/              neutral agent rules (rendered per provider)
    orchestrator/       Node/TS: server, ticket-agent, runners, prompt, clients
  n8n/
    workflows/*.json
    parsers/*.js        unit-tested parser logic
  examples/             codecrafter.yaml templates per stack
```

## Decisions log
| # | Decision | Date |
|---|---|---|
| D1 | Target repo: `anandgupta193/expense-manager` (public), see [14](14-target-repo-expense-manager.md) | 2026-09-29 |
| D2 | Jira site: `https://code-crafter.atlassian.net` | 2026-09-29 |
| D3 | Max 2 concurrent tickets | 2026-09-29 |
| D4 | ~~Container TTL 40 min~~ → superseded by D16 | 2026-09-29 |
| D5 | TypeScript for the control plane and orchestrator | 2026-09-29 |
| D6 | GitHub + Jira + Slack; Claude Code behind `AgentRunner`; local Docker; self-hosted n8n; smee.io | 2026-09-29 |
| D7 | Jira project key `SCRUM`; ~~first test ticket SCRUM-5~~ → D10 | 2026-09-29 |
| D8 | Separate GitHub bot account (see [15](15-bot-account-setup.md)) | 2026-09-29 |
| D9 | Build order: **Phase 1a (agent) before Phase 0 (plumbing)** | 2026-09-30 |
| D10 | First ticket **SCRUM-2** "Make agent code modular" (pure refactor, AC in ticket). SCRUM-5 is already implemented (`set_budget` exists) | 2026-09-30 |
| D11 | Jira status is **forward-only**: To Do→In Progress on start; In Review when a human marks the PR ready; Done on merge; plus one Jira comment with the PR link | 2026-09-30 |
| D12 | PRs **stay draft**; the orchestrator forces draft. The agent posts a "✅ done" PR comment (and Slack) once local checks pass; the human flips it to ready | 2026-09-30 |
| D13 | On a usage limit: **pause** (WIP checkpoint, post the reset time, exit). No model downgrade; `fallback: []` | 2026-09-30 |
| D14 | Agent commits always run hooks; **only the orchestrator's emergency WIP commit may use `--no-verify`**, labelled `WIP(code-crafter): emergency checkpoint [skip-hooks]`; the final HEAD must pass local checks | 2026-09-30 |
| D15 | Load the target repo's own `CLAUDE.md` / `.claude/` as-is; the harness lives in `/workspace/harness/` (outside the repo) + `--append-system-prompt` | 2026-09-30 |
| D16 | Timers: soft timeout **10 min**, **3** continuations, **idle TTL 40 min** (reset by events/activity), **hard cap 90 min**, **2 min** SIGTERM grace for checkpointing | 2026-09-30 |
| D17 | Security hardening deferred: the AI gets the **full env, single user, open network** in Phase 1. Revisit before anyone else can create tickets or comments that reach the agent (see [12](12-security.md)) | 2026-09-30 |
| D18 | Per-ticket volume `codecrafter-home-<key>` keeps the Claude session; the resume prompt always includes branch/PR/comment context as a fallback; volume deleted on merge/close, reaped after 7 days idle | 2026-09-30 |
| D19 | **Plan and continue**: the draft PR opens early with a Plan section. Jira label `plan-first` → wait for `/codecrafter approve` | 2026-09-30 |
| D20 | Visibility: Slack thread = milestones only; PR comments = plan/questions/done/review replies; `docker logs` = readable progress; raw transcript on the volume; Jira = status + PR link only | 2026-09-30 |
| D21 | "No behaviour change" is verified by **human review** for now (no tests in the repo — the biggest trust gap; revisit with a Vitest ticket) | 2026-09-30 |
| D22 | n8n: **git is the source of truth** (`n8n/workflows/*.json`, tested `n8n/parsers/*.js`); reuse the existing `n8n_data` volume in compose | 2026-09-30 |
| D24 | Slack trigger: full format or shorthand `SCRUM-2`; service defaults when only one is registered; `Environment` ignored | 2026-09-30 |
| D25 | Tickets come from Slack **#ops**: any message there becomes a Jira Story (title = first line) via an n8n workflow that replies in the thread with the link; humans refine the ticket, then trigger code-crafter | 2026-09-30 |
| D26 | Phase 1c/1d plan ([16](16-plan-1c-1d.md)): Part A live tests first; catch-up poll every 10 min; add HMAC webhook verification | 2026-09-30 |
| D23 | Default model **haiku** (pipeline testing). Jira label `model:sonnet` / `model:opus` overrides it. Pro token verified for sonnet-5-5 and opus-5-5 | 2026-09-30 |

## Phase 1a acceptance checklist (agreed 2026-09-30)
1. `./scripts/run-ticket.sh SCRUM-2` builds the agent image (arm64) and starts `code-crafter-scrum-2`.
2. Jira SCRUM-2 is only moved forward (already In Progress → no change); a comment with the PR link is added.
3. Slack thread: 🚀 started → 📋 plan → 💾 checkpoints → ✅ done (or ⏸ / ❓).
4. Branch `CODE-CRAFTER-SCRUM-2` is pushed by **codecrafterbot**; commits pass the husky hook.
5. A draft PR `SCRUM-2: …` with a Plan section and the `SLACK_THREAD_TS` marker.
6. Lint, format, typecheck and build pass locally before ✅ done; GitHub CI is green.
7. Kill test: `docker kill` mid-work → re-run → resumes (`BRANCH_IS_NEW=false`, same session).
8. The idle timer shuts the container down by itself after it finishes.
9. No secrets in commits, PR text, Slack or logs.

**Result (2026-09-30):** items 1–6, 8 and 9 pass on SCRUM-2 ([expense-manager#6](https://github.com/anandgupta193/expense-manager/pull/6)). Resume on an existing branch and the same session is verified. Item 7 (kill while working) was **skipped** by the owner. Lessons: Haiku under-delivers on acceptance criteria (the `useChat.ts` extraction); the draft guardrail must never override a human (fixed).

Out of scope for 1a: Slack trigger, webhooks, review-comment handling, auto-resume scheduler, Cursor.

## Phase 0/1b result (2026-09-30)
- The compose stack is up (n8n 2.41.3 reusing `n8n_data`, Redis, smee, control plane). The Slack bridge is connected over Socket Mode.
- GitHub → smee → n8n `github-events` → control plane works (logged and routed by branch → container; routing to `/command` comes in 1c).
- Slack → bridge → n8n `slack-trigger` → control-plane intake → `/spawn` works; the allow-list is enforced at the bridge and again at intake.
- The trigger accepts the full 4-line format or the shorthand `SCRUM-2`; `Environment` is parsed and ignored (D24).
- n8n 2.x can't activate on import in regular mode: import, then `publish:workflow`, then restart.
- Known gap for 1c: `issue_comment` events carry no branch, so the router must look the PR up.

## Phase 1c (2026-09-30)
Built: the router (merge → Done + ✅ + cleanup; ready → In Review; comments, reviews and CI failures → agent; `/codecrafter pause|resume|stop|approve`), queue-and-respawn, and the agent command queue with batched feedback rounds. Smoke-tested through the real n8n path (the ignore cases). **Pending a live test** on a real ticket: a review comment round-trip and a merge.

## Open questions
- None right now. The Environment field is resolved by D24.
