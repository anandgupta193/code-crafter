# 09 · Feedback & merge

## Purpose
Close the loop: review comments and CI failures become new agent rounds, and a merge becomes Jira "Done" plus a Slack ✅.

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
