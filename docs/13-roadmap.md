# 13 · Roadmap & open questions

## Phases
| Phase | Goal | Deliverables | Done when |
|---|---|---|---|
| **0 · Setup** | Accounts and local infra | Checklist in [01](01-accounts-and-infra.md); `docker-compose.yml` (n8n, redis, smee, control plane); sandbox repo with `codecrafter.yaml` + CI | `docker compose up` works; a GitHub webhook shows up in n8n |
| **1a · Agent runs locally** | Prove the agent core without the bus | Agent image, `entrypoint.sh`, orchestrator with `ClaudeCodeRunner`, prompt from Jira; start it manually with `docker run` | Given `CC-1`, a PR is opened on the sandbox repo |
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

## Consolidated open questions
1. **Sandbox repo:** public (free CI minutes, free CodeRabbit) or private?
2. **Jira:** a new free site or an existing company one?
3. **Concurrency:** max parallel tickets (proposal: 2)?
4. **TTL:** keep 40 min?
5. **Session volume:** persist the agent home dir per ticket (proposal: yes)?
6. **Parser location:** JS in n8n Code nodes, loaded from `n8n/parsers/` (proposal: yes)?
7. **Language:** TypeScript for the control plane and orchestrator (proposal: yes, to match the original)?
8. **Who can trigger:** a Slack user allow-list?
9. **Environment field:** ignore for the MVP?
