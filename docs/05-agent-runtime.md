# 05 · Agent runtime (container image + boot)

## Purpose
The per-ticket sandbox. It **builds itself out of the target repo's own configuration** rather than being a generic dev box.

## Image: `code-crafter-agent`
Base: `debian:bookworm-slim` (or `node:22-bookworm`), plus:
- `git`, `gh`, `curl`, `jq`, `yq`, `ca-certificates`
- Node 22 (for the orchestrator) and `volta` (per-repo Node versions)
- Agent CLIs: `claude` (`@anthropic-ai/claude-code`); `cursor-agent` added later
- MCP servers are installed lazily (Phase 2: `mcp-neo4j-cypher`)
- The orchestrator build (`/opt/codecrafter/orchestrator`), agent rules (`/opt/codecrafter/rules`), `entrypoint.sh`, `codecrafter-utils.sh`
- Runs as a non-root user `agent`

## Boot sequence (`entrypoint.sh`)
1. **Git identity and credentials.** `git config user.name/email` for the bot; `gh auth setup-git` using `GITHUB_TOKEN`.
2. **Clone** `WORKSPACE_REPO` into `/workspace/repo`.
3. **Branch detection. This is the flag everything depends on.**
   ```
   if origin has CODE-CRAFTER-<KEY>: checkout + pull  → BRANCH_IS_NEW=false
   else: checkout -b CODE-CRAFTER-<KEY> from origin/<BASE> → BRANCH_IS_NEW=true
   ```
4. **Drop the harness.** Copy the agent rules into `.codecrafter/harness/` (never into the repo's own `CLAUDE.md` / `.claude/`, which target repos may already have; see [14](14-target-repo-expense-manager.md)), and add those paths to **`.git/info/exclude`** so the agent can't commit its own harness. *Improvement over the original:* it appended to the tracked `.gitignore`, which shows up in diffs; `.git/info/exclude` is local-only.
5. **MCP wiring** *(Phase 2)*: write `.mcp.json` with the Neo4j MCP server.
6. **Toolchain.** Parse `codecrafter.yaml` and install what it asks for (`codecrafter-utils.sh`), then run its setup command.
7. `exec node /opt/codecrafter/orchestrator/server.js`. The server auto-starts the workflow ~2s after it starts listening (see [07](07-orchestrator.md)).

## Per-repo contract: `codecrafter.yaml` (in the target repo root)
```yaml
system:
  setup:
    volta:  { enabled: true, node: "22.12.0", npm: "10.9.0" }
    python: { enabled: false, version: "3.12" }
    go:     { enabled: false, version: "1.23" }
    command: "bash"
    args: ["scripts/setup.sh"]
codecrafter:
  agent:
    provider: claude          # claude | cursor   (overrides AGENT_PROVIDER)
    model: sonnet             # provider-specific alias
    fallback: [sonnet, haiku] # tried in order on usage limit
  pull_request: { draft: true }
  commands:                   # optional hints the agent can use to self-verify
    test: "npm test"
    lint: "npm run lint"
```
If the file is missing, use defaults: Node LTS, no setup, draft PRs, the default provider. Templates per stack will live in `examples/`.

*Differences from the original:* `merge_request` → `pull_request`; `cursor.model` → `agent.provider/model` (tool-agnostic); `commands` added.

## Health
`GET /healthz` returns **503 until the agent process has actually spawned** and 200 afterwards (the original's defence against wedged pods). The spawner and router use it.

## Failure modes
| Case | Behaviour |
|---|---|
| Clone fails (auth/URL) | Exit non-zero; control plane posts the error to the Slack thread |
| Toolchain install fails | Continue with a warning in the prompt ("setup failed: …"); the agent may fix it |
| Container killed | Pushed commits survive; the next spawn sees `BRANCH_IS_NEW=false` and resumes |

## Open questions
- Build one fat image with all toolchains (slower build, faster boot) or install per repo at boot (the original's approach)? Proposal: install at boot and cache downloads in a named Docker volume.
