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

> **Status:** architecture docs only. No code yet.

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
| 13 | [Roadmap](docs/13-roadmap.md) | Phases and open questions |
