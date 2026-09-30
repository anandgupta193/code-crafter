# 16 · Plan: finish Phase 1c and do Phase 1d

## Context
Phase 1c (feedback loop) is built. Verified live on SCRUM-6: ready → Jira In Review, approve noted, merge → Jira Done + ✅ + cleanup, and bot and non-code-crafter events ignored. **Not yet verified:** a human review comment or a CI failure going back to the agent, including when the container has already stopped.
Phase 1d makes the MVP dependable when you aren't watching: nothing lost when your Mac sleeps, paused tickets resume by themselves, and the public repo stays clean.

---

## Part A · Finish 1c (verification, ~no code)

**Test ticket:** create a small ticket via #ops, e.g. *"Add a `formatINR(amount)` helper in utils/ and use it in 2 places"*, then trigger it in #code-crafter-channel.

| # | Test | How | Pass when |
|---|---|---|---|
| A1 | Review comment → fix (container alive) | Inline comment on the draft PR with **Add single comment** (not "Start a review") | Agent pushes a fix, replies in your comment's thread, checks pass, ✅ posted |
| A2 | Review comment → fix (container stopped) | `docker stop code-crafter-scrum-N`, then comment | Router queues the comment and restarts the container; the agent resumes the same session; A1 outcome |
| A3 | CI failure → fix | You push a deliberate lint error to the bot's branch | `fix_pipeline` fires on the new HEAD; agent fixes it; CI is green again |
| A4 | Control verbs | `/codecrafter pause` mid-work → `resume` → `stop` | Pause checkpoints and stops the agent; resume continues; stop exits the container |
| A5 | Merge | Approve and merge | Jira Done, ✅, cleanup (already seen on SCRUM-6) |

Anything that breaks here gets fixed before Part B.

---

## Part B · Phase 1d (hardening)

### B1 · Catch-up loop: never lose an event *(highest value)*
**Problem:** smee.io only forwards while the local client is connected. Events arriving during sleep or network blips are lost; `EAI_AGAIN` was seen today.
**Design:** every **10 min** the control plane asks GitHub directly (bot token), for each **open `CODE-CRAFTER-*` PR** in registered repos:
- **new comments or reviews** by allow-listed users since the last check → the same router path (`handle_comment`)
- **merged or closed** → the same path (Done / cleanup)
- **latest workflow run failed on HEAD** → `fix_pipeline`
- also **recently closed PRs** (last 24h) whose ticket isn't Done yet, to catch a missed merge

A "last checked" timestamp per PR is stored in Redis. Events synthesised this way reuse the existing **deduplication**: we key by comment ID, run ID or merge SHA instead of delivery ID, so a webhook and the poll can't both act. Webhooks become the fast path; the poll is the safety net.
**Files:** `control-plane/src/reconciler.ts` (new), `router.ts` (dedupe keys by object ID), `github.ts` (list comments/reviews/runs), `main.ts` (interval).

### B2 · Auto-resume after a usage-limit pause
**Today:** the agent checkpoints, posts "⏸ resumes after 18:40" and exits, but nobody restarts it.
**Design:** the agent tells the control plane `POST /api/tickets/:key/paused {until}` → Redis sorted set `codecrafter:paused` (score = until). The control plane's timer (every minute) respawns due tickets with `resume:true`, subject to the normal 2-ticket cap; if the cap is full, it retries next minute. A manual `/codecrafter pause` is **not** auto-resumed.
**Files:** agent `ticket-agent.ts` (report the pause), control-plane `main.ts` + `spawner.ts`.

### B3 · Verify GitHub webhook signatures
**Today:** we don't check the HMAC; instead every actionable claim is re-checked with the GitHub API.
**Design:** the n8n webhook node receives the **raw body**; n8n forwards `{rawBody (base64), signature header}` along with the parsed summary; the control plane verifies `sha256=HMAC(GITHUB_WEBHOOK_SECRET, raw)` before routing. Unsigned or badly signed events are dropped and logged. The catch-up loop's events are trusted because they come from the GitHub API.

### B4 · Comment dedupe and priority (doc 09) — ✅ done 2026-10-01
Before a feedback round:
- **skip** comments already replied to by the bot, or in threads GitHub marks resolved (GraphQL `isResolved`)
- **order** the batch: CI failure first, then human change requests, then plain comments, newest first
- **merge** several comments into one round (already done)

### B5 · Keep secrets out of the public repo
- `gitleaks` as a **pre-commit hook** in code-crafter (Husky or a plain git hook) and as a **GitHub Action** on every push and PR.
- Add GitHub **secret scanning + push protection** (free for public repos; a repo setting, done by you).

### B6 · Housekeeping
- **README:** what it is, a diagram, how it works, quick start, status. It's the public landing page.
- **SCRUM-2:** move to Done (it was merged before 1c existed), delete `codecrafter-home-scrum-2`.
- **Toolchain:** Volta installs the Node version from `codecrafter.yaml` when it differs from the image's version (only matters for non-Node-24 repos).
- **Docs sync:** doc 03 still says "n8n routes to containers"; update it to "n8n parses, the control plane routes".

---

## Order & size
| Step | Items | Size |
|---|---|---|
| 1 | Part A tests (A1–A5) + fixes | 1 short session, needs you for comments/merge |
| 2 | B1 catch-up loop | medium |
| 3 | B2 auto-resume | small |
| 4 | B5 gitleaks + B6 housekeeping | small |
| 5 | B3 signatures | small–medium |
| 6 | B4 comment triage | medium |

## Done when
- A1–A5 pass on a real ticket.
- Stopping smee (`docker compose stop smee`), commenting, then starting it again still gets the comment handled within about 10 minutes (B1).
- A ticket that hits the usage limit resumes on its own after the reset time (B2).
- A forged unsigned POST to the n8n GitHub webhook is rejected (B3).
- `gitleaks` blocks a commit containing a fake token (B5).
- All unit tests pass; docs and the decisions log are updated.
