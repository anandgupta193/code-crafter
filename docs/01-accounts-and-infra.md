# 01 · Accounts, subscriptions & infrastructure

## Purpose
A single checklist of everything to sign up for, install, and (where needed) pay for, plus the secret each item produces. Prices are approximate. Check the vendor's page before you pay.

## Accounts — MVP
| # | Account | Plan | Cost | Used for | Secret produced → env var |
|---|---|---|---|---|---|
| 1 | **GitHub** | Free | $0 | Target repo(s), PRs, Actions CI (2,000 free min/mo on private repos; unlimited on public) | Fine-grained PAT → `GITHUB_TOKEN` |
| 2 | GitHub bot user *(recommended)* | Free | $0 | A separate identity so agent commits and PRs are clearly "the bot" | Its PAT becomes `GITHUB_TOKEN` |
| 3 | **Jira Cloud** | Free (≤10 users) | $0 | Tickets; read issue and attachments; move to Done | API token → `JIRA_API_TOKEN`, plus `JIRA_EMAIL`, `JIRA_BASE_URL` |
| 4 | **Slack** workspace + app | Free | $0 | Trigger channel, thread updates, ✅ reaction | Bot token `xoxb-…` → `SLACK_BOT_TOKEN`; app token `xapp-…` → `SLACK_APP_TOKEN` (Socket Mode) |
| 5 | **Claude** | Pro (have) / Max | ~$20/mo Pro; Max ~$100–200/mo | The coding agent | `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` |
| 6 | **smee.io** | Free, no signup | $0 | Forwards GitHub webhooks to your Mac | Channel URL → `SMEE_URL` (not secret, but keep it private) |

### How Claude Pro is used
- The `claude` CLI inside each ticket container needs to be signed in. `claude setup-token`, run once on your Mac, produces a long-lived token tied to your subscription. We inject it as `CLAUDE_CODE_OAUTH_TOKEN`.
- **Limits:** Pro has rolling usage caps. Every container shares the same token, so parallel tickets share the same cap. When the cap is hit the orchestrator detects it (see [06](06-agent-runner-abstraction.md)) and pauses or falls back.
- **When to switch:** if the agent runs for a team, or often hits limits, move to Max or to an Anthropic **API key** (pay per token, `ANTHROPIC_API_KEY`). The adapter supports both; it's a config change.

## Local software to install
| # | Tool | Why | Install |
|---|---|---|---|
| 1 | Docker Desktop *(or OrbStack/Colima)* | Runs n8n, Redis, control plane and ticket containers. Free for personal and small-business use | docker.com |
| 2 | Homebrew | Package manager | brew.sh |
| 3 | Node.js 22+ | Control plane and orchestrator (Node 24 already installed) | ✅ |
| 4 | Claude Code CLI | `setup-token`; local testing of the agent | `npm install -g @anthropic-ai/claude-code` |
| 5 | GitHub CLI `gh` | Local testing; also installed inside the agent image | `brew install gh` |
| 6 | smee client | Webhook forwarder | `npm install -g smee-client` |
| 7 | git | ✅ already installed | — |

The agent image itself installs `git`, `gh`, `claude`, and the per-repo toolchain (volta/python/go…), so nothing extra is needed on your Mac for that.

## Long-running services (all in Docker, all free)
| Service | Image | Port | Notes |
|---|---|---|---|
| n8n | `docker.n8n.io/n8nio/n8n` | 5678 | Event bus UI and webhooks. Data in volume `n8n_data` |
| Redis | `redis:7-alpine` | 6379 | Pause/stop flags, Slack thread ts, spawn locks |
| control-plane | built from this repo | 3000 | `/spawn`, `/api/tickets/*`, slack-bridge |
| ticket containers | `code-crafter-agent` (built from this repo) | 8080 (internal) | One per ticket; on Docker network `codecrafter` |

All of these will be defined in one `docker-compose.yml` (except the ticket containers, which the control plane starts on demand).

### Hosting n8n (quick start before compose exists)
```bash
docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
```
Open http://localhost:5678 and create the local owner login. To move it to the cloud later, run the same container on any small VM behind a real URL.

## One-time setup checklist
- [ ] Create a GitHub bot account; create a **sandbox repo** (e.g. a tiny Node app with a GitHub Actions test workflow).
- [ ] Create a fine-grained PAT for the bot, scoped to the sandbox repo only: Contents RW, Pull requests RW, Issues RW, Actions R, Metadata R.
- [ ] Add the bot as a collaborator on the sandbox repo.
- [ ] Create a Jira Cloud Free site and a project (e.g. key `CC`), then an API token.
- [ ] Create a Slack workspace and a channel `#code-crafter`; create a Slack app with Socket Mode **on**. Bot scopes: `channels:history`, `chat:write`, `reactions:write`, `app_mentions:read`. Event subscription: `message.channels`. Install it and invite the bot to the channel.
- [ ] Create a smee channel at smee.io/new. In the repo, add a webhook pointing at it (events: *Issue comments, Pull request reviews, Pull request review comments, Check runs / Workflow runs, Pull requests*), with a webhook secret → `GITHUB_WEBHOOK_SECRET`.
- [ ] Run `claude setup-token` and store the result.
- [ ] Put everything in `.env` (gitignored), copying the template `.env.example` we'll add with the code.

## Later phases — additional accounts and costs
| Item | Phase | Cost | Notes |
|---|---|---|---|
| Cursor Pro | when adding the Cursor adapter | ~$20/mo | Needs a CLI/API key for `cursor-agent` |
| Neo4j Community (Docker) / AuraDB Free | 2 | $0 | Architecture graph |
| Embeddings | 2 | $0 (Ollama local) or cents (OpenAI `text-embedding-3-small`) | Doc chunk search |
| CodeRabbit | optional | Free for public repos | AI reviewer the agent learns to triage |
| kind (local K8s) | 4 | $0 | Replace `docker run` with namespace/Deployment |
| Managed K8s + VM for n8n/control plane | 5 | ~$30–150/mo | Only when moving off your laptop |
| Secrets manager (Vault / Doppler / SOPS) | 5 | $0 on the free tiers | Replaces `.env` |

## Open questions
- Should the bot's PRs target a **public** sandbox repo (unlimited Actions minutes, CodeRabbit free) or a private one?
- Is your Jira site new, or an existing company site? A company site may need an admin to approve the API token.
