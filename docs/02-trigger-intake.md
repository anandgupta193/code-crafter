# 02 · Trigger intake

## Purpose
Turn a human intent ("work on CC-12") into a validated **spawn request**, and fix the **Slack thread** that will follow the ticket for its whole life.

## Responsibilities
- Receive Slack messages from the trigger channel without a public URL (Socket Mode).
- Parse and validate the trigger message format.
- Resolve `service` to a repo URL using an allow-list (the original only accepted services that exist in its graph).
- Call the control plane's `/spawn` with the four-variable contract.
- Reply in the thread with success or a validation error.

## #ops → Jira (D25)
Anyone can post in **#ops**. The bridge forwards the message to the n8n workflow **`#ops → Jira`**, which:
1. looks up the poster's name and the message permalink,
2. builds the issue (`n8n/parsers/ops-ticket.js`): title = first line, description = the whole message (bullets kept) plus "Created from Slack #ops by … · original message", label `from-slack`,
3. creates a **Story** in `SCRUM`,
4. **immediately replies in the Slack thread** with the ticket link and adds 🎫 (or ❌ with the reason).

Then a human refines the ticket in Jira and posts its key in #code-crafter-channel, which is the normal trigger below. n8n reads the Jira and Slack credentials from its environment (`$env`), never from workflow JSON.

## Trigger message format
```
*Jira ticket url* https://<site>.atlassian.net/browse/CC-12
*Service* demo-app
*Base branch* main
*Environment* qa
```
Parsing is tolerant of Slack formatting: bold markers, `<url|text>` link wrapping, and extra whitespace.

## Flow
```
Slack #code-crafter
   │ message event (Socket Mode websocket)
   ▼
slack-bridge (inside control plane, @slack/bolt)
   │ POST http://n8n:5678/webhook/slack-trigger   {text, channel, ts, user}
   ▼
n8n "slack-parser" workflow
   │ parse → validate → lookup service in services.yaml
   ├─ invalid → reply in thread with error
   ▼
POST http://control-plane:3000/spawn
   { WORKSPACE_REPO, WORKSPACE_BASE_BRANCH, JIRA_TASK_KEY, SLACK_THREAD_TS }
```

**Why a bridge?** n8n's Slack Trigger node needs a public Events API URL, and smee can't answer Slack's URL-verification challenge. Socket Mode opens an outbound websocket from our side instead, so nothing has to be exposed. The bridge is about 30 lines of code; it only forwards, it doesn't decide anything.

## Interfaces / contracts
**Spawn contract.** These four variables are the entire contract between intake and the sandbox, the same as in the original:

| Var | Example | Source |
|---|---|---|
| `WORKSPACE_REPO` | `https://github.com/acme/demo-app.git` | `services.yaml` lookup |
| `WORKSPACE_BASE_BRANCH` | `main` | message |
| `JIRA_TASK_KEY` | `CC-12` | parsed from the URL |
| `SLACK_THREAD_TS` | `1727…` | ts of the trigger message |

**Service registry (MVP).** A `config/services.yaml` in this repo. In Phase 2 it's replaced by the Neo4j graph.
```yaml
services:
  expense-manager:
    repo: https://github.com/anandgupta193/expense-manager.git
    default_base_branch: main
```

## Data & state
- The trigger message `ts` becomes the **thread ID**. It's stored in Redis (`codecrafter:thread:<KEY>`) and later embedded in the PR body (see [08](08-state-and-memory.md)).

## Failure modes
| Case | Behaviour |
|---|---|
| Unknown service | Thread reply: "service X not registered", no spawn |
| Malformed Jira URL | Thread reply with the expected format |
| Same ticket triggered twice | The spawner dedupes (see [04](04-spawner.md)); thread reply "already running" |
| Bridge disconnected | Bolt auto-reconnects; messages sent during the outage are lost (acceptable for the MVP) |

## MVP vs later
- **MVP:** Slack message only.
- **Later:** `/api/tickets` (programmatic and security-scan intake), the planner ([11](11-planner.md)), a Slack slash command or modal form, and a Jira automation webhook.

## Open questions
- Restrict who is allowed to trigger (a Slack user allow-list)?
- Is `Environment` needed for the MVP? (The original uses it for deploy targets; we could ignore it at first.)
