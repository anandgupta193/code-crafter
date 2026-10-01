# 17 · Status page

## Context
Code-Crafter runs several moving parts (Slack bridge, n8n, smee, Redis, and one container per ticket). When something breaks, you shouldn't need to read `docker logs` in a terminal or ask someone. The status page has **one job: show what broke and why**, plus a small summary of what code-crafter has delivered.
The scope was trimmed in a grilling session on 2026-10-01 (decisions D27–D33 below).

## What's on the page (v1)
URL: **`http://localhost:3000/status`**, served by the control plane. Plain HTML and JS, read-only, no login (only reachable from the Mac). The page refreshes every **5 s**.

### 1 · 🟢 Health bar (4 pills)
| Pill | Green when | Checked by |
|---|---|---|
| **Slack bridge** | Socket Mode connected | the bridge's own flag (plus time since the last change) |
| **n8n** | `/healthz` answers | HTTP from the control plane |
| **smee** | container running **and** its last connection log line is "Connected" | Docker API (state + last log lines) |
| **Redis** | `PING` answers | Redis client |

Hovering shows the reason, e.g. *"smee: disconnected (last error 4 min ago)"*. The control plane and Docker aren't pills: if the page loads, the control plane is up, and if the table renders, Docker is reachable.

### 2 · 🎫 Tickets table
**Rows:** every ticket with a container (running or exited, kept about 2 h by the reaper) **or** queued commands in Redis. Volume-only tickets are not shown.
**Sort:** ❌ crashed → 💬 queued (no container running) → ⚡ working → 😴 idle → ✅ exited cleanly.

| Column | Source |
|---|---|
| Key + title | key from the container label; title saved to Redis **at spawn time** (intake already fetches it from Jira), so the table makes no Jira calls |
| State | Docker state + exit code + age; for running containers, the agent's own `/state` decides ⚡ working vs 😴 idle |
| Queue | length of `codecrafter:commands:<KEY>` in Redis |
| Links | 📜 logs (opens the panel) · 🧵 Slack thread (permalink built from the saved thread ts) · 🔗 PR (GitHub search link for the `CODE-CRAFTER-<KEY>` branch, no API call) |

### 3 · 📜 Logs panel
Opened from a ticket row or a health pill. It shows the **last 300 lines** and refreshes **every 3 s** while open, with a **filter box** and **colour-coded lines** (✓ green, ✗ red, ! amber, 💬 agent text, 🔧 tool use). Lines are **redacted** on the server, using the same redaction as the agent's logger. It works for crashed containers until the reaper removes them. Only `code-crafter-*` containers can be read.

### 4 · 📈 PR stats
One row per repo in `config/services.yaml`, plus a total: **merged · open · closed (not merged)** for PRs **authored by the bot account**. Each number links to the matching GitHub search. Source: GitHub search API, 3 calls per repo, **cached 10 min**.

## Explicitly out of v1
Events feed, Claude usage bars, expandable row details, Jira status, PR draft/CI status, true live log streaming (SSE), action buttons, login, charts. Slack alerts for breakages are a **separate** n8n workflow (not part of this page).

## Build
| Piece | Where |
|---|---|
| Save ticket title at spawn | `control-plane/src/intake.ts` → Redis `codecrafter:title:<KEY>` |
| Docker: compose service state, container logs (demultiplexed) | `control-plane/src/docker.ts` |
| Status gathering (health, tickets, sorting, links) | `control-plane/src/status.ts` |
| PR stats with a 10-min cache | `control-plane/src/pr-stats.ts` |
| Routes `GET /status`, `GET /api/status`, `GET /api/logs/:container` | `control-plane/src/main.ts` |
| The page | `control-plane/src/status.html` |

## Done when *(all verified 2026-10-01: smee pill red/green, a crashed test container sorted first with exit code and redacted logs, a queued command shown, PR stats 3/0/0, 9 unit tests)*
1. `docker compose stop smee` → the smee pill turns 🔴 within about 5 s; `start` → 🟢.
2. Trigger a real ticket → its row shows ⚡ with a title; logs show the agent's 🔧/💬 lines and no secrets.
3. Kill a ticket container with an error exit → the row turns ❌ with the exit code, sorts to the top, and its logs are still readable.
4. Queue a command while the ticket is stopped → the row shows 💬 1.
5. PR stats show expense-manager: merged 3 · open 0 · closed 0 (as of 2026-10-01).
6. Unit tests for ticket assembly and sorting, log demux and redaction, and PR stats aggregation.

## Decisions
| # | Decision |
|---|---|
| D27 | The status page's single job: see what broke and why. v1 = health bar + tickets table + logs, plus PR stats |
| D28 | Tickets table: key + title · state · queue · links. No Jira status or PR/CI status (no Jira/GitHub calls for the table) |
| D29 | Health bar: Slack bridge · n8n · smee · Redis |
| D30 | Logs: last 300 lines, refreshed every 3 s while the panel is open, filter + colours, redacted. No SSE |
| D31 | Rows: tickets with a container or queued commands; problems first |
| D32 | Read-only, localhost, no login, page refresh 5 s |
| D33 | PR stats: by bot author, per registered repo + total, GitHub search cached 10 min |
