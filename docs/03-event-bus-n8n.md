# 03 · Event bus (n8n)

## Purpose
n8n is the **switchboard**. It receives every external event (Slack, GitHub), turns it into a small typed message, and routes it to the right place: the control plane or a specific ticket container.

## Responsibilities
- Host the webhook endpoints (`/webhook/slack-trigger`, `/webhook/github`).
- Verify GitHub webhook signatures (`X-Hub-Signature-256`).
- Run the parsers (below).
- Route **by convention**: take the Jira key from the branch name and build the container hostname from it.
- If no container is alive for a ticket, ask the control plane to re-spawn it (resume path).

## Workflows
| Workflow | Trigger | Output |
|---|---|---|
| `slack-parser` | bridge POST | `/spawn` or a thread error (see [02](02-trigger-intake.md)) |
| `github-router` | smee → GitHub webhook | fans out to the parsers below |

### Parsers (GitHub events → commands)
| Parser | Fires on (GitHub event) | Result |
|---|---|---|
| `comment-parser` | `issue_comment`, `pull_request_review`, `pull_request_review_comment` on a `CODE-CRAFTER-*` PR (ignoring the bot's own comments) | `POST /command {type:"handle_comment", …file, line, diff_hunk, thread}` |
| `pipeline-parser` | `workflow_run` completed with `conclusion=failure` | `POST /command {type:"fix_pipeline", run_url, failed_jobs, head_sha}` |
| `job-parser` | `check_run` completed/failure | job-level detail (can be merged into pipeline-parser for the MVP) |
| `merge-parser` | `pull_request` closed with `merged=true` | `POST control-plane /api/tickets/:key/merged` |
| `security-parser` | *(later)* Dependabot / code-scanning alert | `POST control-plane /api/tickets` → new ticket |

## Routing rule
```
branch = "CODE-CRAFTER-CC-12"
  └─ prefix check: must start with "CODE-CRAFTER-"   else → drop
  key  = "CC-12"
  host = "code-crafter-" + lower(key)  = "code-crafter-cc-12"
  POST http://code-crafter-cc-12:8080/command
     ├─ 2xx          → done (the container queues it; failures never preempt current work)
     └─ conn refused → POST control-plane /spawn {…, resume:true}   (re-clone → BRANCH_IS_NEW=false)
                       and re-deliver the command once /healthz is OK
```
n8n and the ticket containers share the Docker network `codecrafter`, so the container name resolves as a hostname. No registry is needed.

## Interfaces / contracts
`/command` body (to the agent container):
```json
{ "type": "handle_comment | fix_pipeline | pause | resume | stop",
  "jiraKey": "CC-12",
  "prNumber": 7,
  "payload": { } ,
  "receivedAt": "2026-09-29T12:00:00Z" }
```

## Local ingress (smee)
```bash
smee --url $SMEE_URL --target http://localhost:5678/webhook/github
```
This runs as a small container in compose, so there's nothing to remember to start.

## Hosting
Community edition in Docker; see [01](01-accounts-and-infra.md). Workflow JSON is exported into `n8n/workflows/*.json` in this repo and imported on boot, so it's version-controlled.
**Rule:** no literal secrets in workflow JSON. Use n8n Credentials or `{{$env.X}}` (lesson from the original's committed trigger token).

## Failure modes
| Case | Behaviour |
|---|---|
| Bot's own comment | Ignored (author = bot login) to avoid loops |
| Duplicate delivery | Container dedupes by GitHub delivery ID |
| Container is mid-task | Command is queued in the container |
| n8n down | smee buffers nothing, so events are lost. MVP mitigation: the agent re-reads PR comments and checks on resume (see [09](09-feedback-and-merge.md)) |

## MVP vs later
- **MVP:** slack-parser, comment-parser, pipeline-parser, merge-parser.
- **Later:** security-parser; a replay queue (Redis stream) for durability; a public URL instead of smee.

## Open questions
- Should the parsers live as JS Code nodes in n8n (like the original's `n8n/*.js`) or as small functions in the control plane with n8n just calling them? (Proposal: keep the logic in `n8n/parsers/*.js`, unit-testable, and paste or load it into Code nodes.)
