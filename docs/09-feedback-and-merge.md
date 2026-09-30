# 09 · Feedback & merge

## Purpose
Close the loop: review comments and CI failures become new agent rounds, and a merge becomes Jira "Done" plus a Slack ✅.

## As built (Phase 1c)
- **n8n parses, the control plane routes** (`control-plane/src/router.ts`). The control plane knows which containers are alive and can respawn them, so routing lives there instead of in n8n.
- **Verify, don't trust:** there's no webhook signature check yet. Instead, every actionable event is re-checked against the GitHub API with the bot token: is the PR really merged, does the comment exist and was it written by the sender, is the failed run on the current HEAD. Deliveries are deduped in Redis.
- **Only allow-listed humans** (`GITHUB_ALLOWED_USERS`) can drive the agent; bots and strangers are ignored (D17).
- **Delivery:** `POST code-crafter-<key>:8080/command` (with the internal token). If the container isn't running, the command goes to Redis `codecrafter:commands:<key>` and the ticket is respawned. On boot the container drains the queue and skips the full ticket prompt (the session already knows the ticket).
- **In the container:** commands queue up and are batched into one feedback round (same session) that runs the same checks, guardrails and "done" flow as the first run. `pause` interrupts immediately (checkpoint) and survives restarts; `resume` and `approve` continue; `stop` shuts the container down.
- **Not yet:** comment scoring/dedupe against later commits (below), CodeRabbit handling, auto-resume after a usage-limit pause.

## Review comments → `handle_comment`
Prompt carries: comment body, author, file, line, `diff_hunk`, the full review thread, and whether it comes from a human or a review bot.

**Dedupe instead of replay** (on resume the agent re-reads *all* PR comments, so it must avoid redoing work):
1. Drop comments older than a later commit that plausibly addresses them. Evidence: the commit touches the same file or lines, or the commit message references the comment ("fixed comment", "address review", keywords from the comment).
2. Drop resolved threads (GitHub `isResolved` via GraphQL).
3. Score what's left by **criticality** (human > bot; "bug/security/broken" > "nit") and **recency**. Anything under 10 minutes old jumps to the top.
4. Process in score order; reply to each thread with what was done (or why it was declined, e.g. conflicts with the requirements).

## CI failure → `fix_pipeline`
Prompt carries: workflow and run URL, failed job names, the tail of the failed step logs (`gh run view --log-failed`, truncated), head SHA, and commits since the last green run.
Rules reminder: fix the code, never the CI config. If the failure is unrelated or flaky, say so in a PR comment rather than hacking around it.

## Merge → Done
```
pull_request closed merged=true, head = CODE-CRAFTER-CC-12
  → n8n merge-parser → POST control-plane /api/tickets/CC-12/merged
      → Jira: transition CC-12 to "Done" (transition ID looked up by name)
      → Slack: reactions.add ✅ on the trigger message (channel + thread ts)
      → control plane: stop + remove the container and the per-ticket volume; clear Redis keys
```
PR closed **without** merge: Slack note in the thread, container stopped, Jira left as-is.

## Failure modes
| Case | Behaviour |
|---|---|
| Comment loop (bot replies to itself) | Parser ignores the bot's own login |
| Flood of comments during a run | Queued; merged into a single round if several are waiting |
| Jira transition name differs | Configurable `JIRA_DONE_TRANSITION` (default "Done") |

## MVP vs later
- **MVP:** human comments, workflow failures, merge.
- **Later:** CodeRabbit-specific handling, the security-scan intake parser, "approve" → auto mark ready.
