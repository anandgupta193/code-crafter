# code-crafter

A prototype that turns a Jira ticket into a merged GitHub pull request. For each ticket it starts a disposable sandbox with a coding agent inside. The sandbox writes the code, opens the PR, reacts to review comments and CI failures as they come in, and closes the loop in Jira and Slack when the PR merges.

The design is based on QuillBot's internal **Code-Crafter** (see [docs/00-overview.md](docs/00-overview.md)). It is adapted to use free or cheap tools:

| Concern | Choice |
|---|---|
| Code host / CI | GitHub + GitHub Actions |
| Tickets / chat | Jira Cloud Free + Slack Free |
| Coding agent | Claude Code (headless), behind a tool-agnostic `AgentRunner` so Cursor can be swapped in |
| Sandbox | One local Docker container per ticket (Kubernetes later) |
| Event bus | Self-hosted n8n |
| Webhook ingress | smee.io (GitHub) and Slack Socket Mode (Slack) |

> **Status:** Phase 1a (agent) and Phase 0/1b (Slack → n8n → control plane → agent) built. Next: Phase 1c feedback loop. See [docs/13-roadmap.md](docs/13-roadmap.md).

## Start the stack (Phase 0/1b)
```bash
cp .env.example .env                 # fill in, see docs/01 (INTERNAL_API_TOKEN: openssl rand -hex 24)
docker volume create n8n_data        # first time only
docker compose build agent           # per-ticket agent image
docker compose up -d                 # n8n, redis, smee, control-plane
scripts/n8n-import.sh                # load + publish workflows from git
```
Then post `SCRUM-2` (or the full trigger format) in the Slack trigger channel.

## Run a ticket by hand (Phase 1a)
```bash
cp .env.example .env              # fill in, see docs/01
scripts/run-ticket.sh SCRUM-2     # builds the image, starts code-crafter-scrum-2, follows logs
docker kill code-crafter-scrum-2  # kill test: re-run the script and it resumes
```

## Layout
| Path | What |
|---|---|
| `agent/Dockerfile` | Agent image: Node 24, git, gh, Claude Code |
| `agent/scripts/entrypoint.sh` | Boot: git identity → clone → branch detect → harness → orchestrator |
| `agent/rules/code-crafter.md` | Agent rules, appended to the system prompt |
| `agent/orchestrator/` | TypeScript orchestrator (run directly by Node 24): prompt, supervision, guardrails, Jira/Slack/GitHub clients, `AgentRunner` adapters |
| `control-plane/` | Long-lived manager: Slack bridge (Socket Mode), `/spawn` with lock + dedupe + 2-ticket cap, Slack intake replies, reaper |
| `n8n/parsers/` | Trigger/event parsers (plain JS, `node --test`) |
| `n8n/build.mjs` → `n8n/workflows/` | Generates the n8n workflows with the parsers inlined |
| `docker-compose.yml` | n8n, Redis, smee, control plane; `agent` image build |
| `scripts/n8n-import.sh` | Import + publish workflows into n8n |
| `config/services.yaml` | Allow-list of target repos |
| `scripts/run-ticket.sh` | Manual launcher (Phase 1a) |
| `slack/manifest.yaml` | Slack app definition |

## Docs
| # | Doc | Covers |
|---|---|---|
| 00 | [Overview](docs/00-overview.md) | How the original works and how we map it |
| 01 | [Accounts & infra](docs/01-accounts-and-infra.md) | What to sign up for, install, and pay for |
| 02 | [Trigger intake](docs/02-trigger-intake.md) | Slack trigger message → spawn request |
| 03 | [Event bus (n8n)](docs/03-event-bus-n8n.md) | Webhook parsing and routing to the right container |
| 04 | [Spawner](docs/04-spawner.md) | Creating and reaping per-ticket containers |
| 05 | [Agent runtime](docs/05-agent-runtime.md) | Container image, entrypoint, `codecrafter.yaml` |
| 06 | [AgentRunner abstraction](docs/06-agent-runner-abstraction.md) | Claude Code / Cursor adapters |
| 07 | [Orchestrator](docs/07-orchestrator.md) | Prompt assembly, supervision loop, PR guardrails |
| 08 | [State & memory](docs/08-state-and-memory.md) | Where each kind of state lives |
| 09 | [Feedback & merge](docs/09-feedback-and-merge.md) | Review comments, CI failures, merge → Done |
| 10 | [Context graph](docs/10-context-graph.md) | *(Phase 2)* Neo4j architecture memory |
| 11 | [Planner](docs/11-planner.md) | *(Phase 3)* Multi-repo planning |
| 12 | [Security](docs/12-security.md) | Secrets, sandboxing, token scopes |
| 13 | [Roadmap](docs/13-roadmap.md) | Phases, decisions, open questions |
| 14 | [Target: expense-manager](docs/14-target-repo-expense-manager.md) | First target repo and its pre-flight changes |
| 15 | [Bot account setup](docs/15-bot-account-setup.md) | Creating the GitHub bot, its token, branch protection |
