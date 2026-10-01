<div align="center">

# 🛠️ Code-Crafter

### _Post a ticket in Slack. Get a review-ready pull request back._ 🚀

**Your team's backlog of "small but someone has to do it" tickets, handled by an AI teammate<br/>that works in its own sandbox 📦, knows your architecture 🕸️, takes review comments 💬, and never merges without you 👀**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node 24](https://img.shields.io/badge/Node_24-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white)
![Neo4j](https://img.shields.io/badge/Neo4j-4581C3?style=for-the-badge&logo=neo4j&logoColor=white)
![n8n](https://img.shields.io/badge/n8n-EA4B71?style=for-the-badge&logo=n8n&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Slack](https://img.shields.io/badge/Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white)
![Jira](https://img.shields.io/badge/Jira-0052CC?style=for-the-badge&logo=jira&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)
![MIT License](https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge)

`✅ v1 complete` · `💸 free tiers + one Claude subscription` · `🏠 fully self-hosted` · `🔓 open source (MIT)`

[Why](#-why-this-exists) · [How it works](#%EF%B8%8F-how-it-works) · [**Set it up yourself**](#-set-it-up-yourself-step-by-step) · [**Going to production**](#-going-to-production) · [Roadmap](#-roadmap)

</div>

---

## 💥 Why this exists

Every engineering team pays the same hidden tax 💸:

- 🐌 the **"quick" tickets** (a search box, a health endpoint, a config flag, removing a dead feature) that each eat half a day of context-switching
- 🔁 the **review ping-pong**: comment, wait, fix, push, wait again
- 🧭 the **"how does this service even work?"** hour before anyone writes a line
- 📋 the **busywork around the code**: branch, PR, Jira status, Slack update, cleanup

**Code-Crafter takes all of that off your engineers' plates.** You write the ticket and review the PR. Everything in between, the typing, the checks, the fixes, the Jira moves and the Slack updates, happens on its own. 🤖

> 🧑‍💻 Engineers stop being typists and become reviewers. The backlog shrinks while they work on the hard problems.

### 📈 Real numbers from its first customer

| | |
|---|---|
| 🏆 **PRs merged** into [expense-manager](https://github.com/anandgupta193/expense-manager), all written by code-crafter | **6** |
| ⏱️ Slack message → green draft PR (a new API endpoint, [PR #14](https://github.com/anandgupta193/expense-manager/pull/14)) | **~4 minutes** |
| 💰 Model cost of that ticket (subscription equivalent) | **~$0.20** |
| 🧑‍⚖️ Human time on it | **write the ticket + review a 2-file diff** |
| 🛠️ Infra bill | **$0**: everything runs on a laptop and free tiers |

---

## 🎬 What it looks like

```text
#ops            you:  Add a GET /api/health endpoint for uptime checks …
                bot:  🎫 Created SCRUM-11 → https://…/browse/SCRUM-11

#code-crafter   you:  SCRUM-11
                bot:  👀 Picked up SCRUM-11
                      🕸️ architecture context: 15 facts, 3 doc chunks
                      📋 draft PR #14 · 💾 add GET /api/health · 💾 update context.yaml
                bot:  ✅ Done: lint ✓ format ✓ types ✓ build ✓

GitHub PR #14   you:  🟢 Approve & merge
                bot:  🎉 merged · Jira → Done · 🕸️ architecture graph updated · container cleaned up
```

That's a real run ([PR #14](https://github.com/anandgupta193/expense-manager/pull/14)). The agent even **updated the architecture manifest on its own**, because its rules say an out-of-date map is a bug. 🗺️

---

## 🤔 What exactly does it do?

Think of it as **a new developer who joins for one ticket, does it, and leaves** 👋:

1. 📦 **Gets a fresh desk:** a disposable Docker container just for that ticket
2. 🕸️ **Gets briefed:** what this service exposes, what it calls, where its data lives, and the docs most relevant to the ticket, pulled from an **architecture knowledge graph**
3. 🧠 **Does the work** with **Claude Code**, on its own branch, **committing as it goes**
4. 🔍 **Checks itself:** runs your repo's lint, format, typecheck and build, and fixes what fails
5. 📬 **Opens a draft PR** and pings you in Slack
6. 💬 **Takes feedback:** reads your review comments and CI failures, fixes them, replies in the thread. Vague comment? It **asks** instead of guessing 🙋
7. ✅ **Wraps up:** when you merge, Jira goes to **Done**, the graph re-learns the new architecture, and the container disappears

You never leave Slack and GitHub. The robot does the typing; you do the thinking. 🧑‍⚖️

---

## 🕸️ It knows your architecture (Graph RAG)

Most AI coding tools start every task **blind**: they grep around and guess. Code-Crafter starts with a **map** 🗺️.

```text
  your repo                              the graph (Neo4j)                       the agent
  ─────────                              ─────────────────                       ─────────
  .codecrafter/context.yaml ──┐  every   ┌ Service ─ EXPOSES ─▶ Endpoint         📋 briefing in its first prompt:
    endpoints, calls,         ├▶ merge ─▶├ Service ─ CALLS ───▶ ExternalService     "you're in expense-manager; it exposes
    databases, libraries      │  to main ├ Service ─ OWNS ────▶ Database            POST /api/chat, calls OpenRouter …
  docs/*.md ──────────────────┘          └ DocChunk (embedded) ─▶ Service           here are the most relevant docs"
                                                                                  🔎 live, read-only graph queries mid-task
```

- 📄 **One small YAML file per repo** (`.codecrafter/context.yaml`) describes its endpoints, outbound calls, data stores and key libraries.
- 🔁 **Self-updating:** every merge to `main` re-ingests it within seconds. Only changed doc sections are re-embedded.
- 🎯 **RAG on your docs:** the ticket text is embedded and matched against your docs with local **Ollama** (`nomic-embed-text`). Free, and this step never leaves your machine.
- 🔎 **Live lookups:** the agent can query the graph mid-task through a **read-only** Neo4j MCP server ("who calls this endpoint?").
- 🧹 **Drift is a defect:** if a change adds an endpoint, an outbound call or a data store, the agent **updates the manifest in the same PR**. A broken manifest is rejected, and #ops is told exactly what to fix.
- 🧯 **Never blocks:** if the graph is down, tickets still run, just without the briefing.

---

## 🗺️ How it works

```mermaid
flowchart LR
    U([🧑 You in Slack]) -->|#ops message| B
    U -->|SCRUM-11 in #code-crafter| B
    B[🔌 Slack bridge<br/>Socket Mode] --> N[🧩 n8n<br/>parse & route]
    N -->|create Story| J[(🎫 Jira)]
    N -->|spawn request| C[🧭 Control plane<br/>lock · dedupe · cap]
    C -->|docker run| A[📦 Agent container<br/>Claude Code + orchestrator]
    K[(🕸️ Neo4j graph)] -->|briefing + read-only MCP| A
    A -->|branch · commits · draft PR| G[(🐙 GitHub)]
    A -->|🚀 📋 💾 ✅| U
    G -->|webhooks via smee| N
    N -->|comment · CI fail · merge| C
    C -->|/command or respawn| A
    C -->|merge → Done ✅| J
    C -->|merge → re-ingest| K
```

### 🧩 The pieces

| | Piece | Lifetime | What it does |
|---|---|---|---|
| 📦 | **Agent container** | one per ticket, disposable | Clones the repo, gets briefed from the graph, runs Claude Code under a supervisor, opens the draft PR |
| 🧭 | **Control plane** | always on | Listens to Slack, starts and stops containers, routes GitHub feedback, keeps the graph up to date, cleans up |
| 🕸️ | **Neo4j** | always on | The architecture graph: services, endpoints, calls, data stores, libraries, embedded doc chunks |
| 🦙 | **Ollama** | on the host | Turns text into embeddings for doc search (free, local) |
| 🧩 | **n8n** | always on | Turns raw Slack and GitHub events into clean data; creates Jira tickets from `#ops` |
| 🗄️ | **Redis** | always on | Locks, Slack thread IDs, queued feedback for sleeping containers |
| 📡 | **smee** | always on | Carries GitHub webhooks from the internet to your machine (no open ports) |

### 🧠 Where the memory lives (why a container can die at any time)

| What | Stored in | Survives a crash? |
|---|---|---|
| 💻 The code | the `CODE-CRAFTER-<KEY>` branch on GitHub | ✅ |
| 🗣️ Claude's conversation | a per-ticket Docker volume | ✅ |
| 🎛️ Locks, threads, queued comments | Redis | ✅ |
| 🧵 Link to the Slack thread | a hidden marker in the PR description | ✅ |
| 🕸️ What the system looks like | Neo4j, rebuilt from `context.yaml` on every merge | ✅ |

---

## ✨ Features

- 🎫 **Slack → Jira:** any message in `#ops` becomes a Jira Story, and the link comes straight back in the thread.
- 🚀 **Slack → PR:** post a ticket key like `SCRUM-11`, or the Jira link, in the code-crafter channel and a draft PR shows up minutes later.
- 🕸️ **Architecture-aware:** every ticket starts with a briefing from the knowledge graph, and the agent can query the graph live (read-only).
- 🧪 **Trust, but verify:** the orchestrator re-runs your repo's own checks and gives the agent up to 2 fix rounds.
- 💬 **Review loop:** inline comments go to the agent, which fixes them, replies in the thread, and pushes.
- 🧹 **Comment triage:** never redoes feedback it already handled, and works on CI failures and change requests first.
- 🔴 **CI loop:** a failed CI run on the latest commit becomes a "fix the pipeline" task; failures on older commits are skipped.
- 😴 **Sleeps when idle:** containers exit after 40 idle minutes; the next comment wakes them up and they resume the same session.
- 🛑 **Guardrails:** PRs stay **draft** until *you* say so, Jira only moves **forward**, the agent never touches CI files, and nothing merges without a human.
- 🕹️ **Remote control:** comment `/codecrafter pause | resume | stop | approve` on the PR.
- 🔌 **Tool-agnostic:** Claude Code sits behind an `AgentRunner` interface, so a Cursor adapter can be dropped in.
- 🧯 **Never silent:** a crash posts ❌ with the reason to the Slack thread.
- 📊 **Status page** at `localhost:3000/status`: health lights (Slack · n8n · smee · Redis · **Graph**), every ticket's state (crashed first), live logs with secrets redacted, and PRs merged so far.

---

## 🧰 Set it up yourself (step by step)

Budget about **1–2 hours** the first time. Everything except Claude is free. It's tested on **macOS (Apple Silicon) with Docker Desktop**; Linux works too (see the Ollama note in step 6).

### What you need

| | Thing | Cost | Used for |
|---|---|---|---|
| 💻 | **Docker Desktop**, **Node 24**, **git**, `jq` | free | running everything |
| 🐙 | Your **GitHub** account + a **second GitHub account for the bot** + a **target repo** | free | where the PRs happen |
| 🎫 | **Jira Cloud** (Free plan) | free | tickets |
| 💬 | A **Slack** workspace (Free plan) | free | where you talk to it |
| 🧠 | **Claude Pro/Max** subscription (or an Anthropic API key) | $ | the coding agent |
| 🦙 | **Ollama** | free | embeddings for the graph |
| 📡 | A **smee.io** channel | free | GitHub webhooks to your machine |

You'll fill one file, `.env`, as you go. Start it now:

```bash
git clone https://github.com/anandgupta193/code-crafter.git && cd code-crafter
cp .env.example .env && chmod 600 .env
```

> 🔐 Never commit `.env` or paste tokens into chats or tickets. It's gitignored already.

<details>
<summary><b>1️⃣ GitHub: bot account, token, branch protection, webhook</b></summary>

**a. Create the bot account** (in a private browser window): sign up at [github.com/signup](https://github.com/signup) with a separate email, e.g. `yourname-codecrafter-bot`. Verify the email and turn on 2FA.

**b. Give the bot access to your target repo** (from *your* account): repo → **Settings → Collaborators → Add people** → the bot → role **Write**. Accept the invite as the bot.

**c. Create the bot's token** (logged in as the *bot*): [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**.
- Scope **`public_repo`** if the target repo is public, or **`repo`** if it's private. Nothing else.
- Set an expiry (e.g. 90 days).
- Put it in `.env` as `GITHUB_TOKEN=`.

> A classic token is needed because fine-grained tokens can't reach repos owned by *another* user where the bot is only a collaborator.

**d. Commit identity:** as the bot, open **Settings → Emails** and copy its `…@users.noreply.github.com` address. Set `GIT_USER_NAME=<bot username>` and `GIT_USER_EMAIL=<that address>`.

**e. Protect `main`** (from *your* account): repo → **Settings → Rules → Rulesets → New branch ruleset**, targeting the default branch, with:
- require a pull request with **1 approval**
- require status checks (your CI)
- block force pushes and deletion

The bot then can't merge anything by itself.

**f. Webhook:**
1. Open [smee.io/new](https://smee.io/new) and copy the URL into `.env` as `SMEE_URL=`.
2. Run `openssl rand -hex 24` and put the result in `.env` as `GITHUB_WEBHOOK_SECRET=`.
3. On the target repo: **Settings → Webhooks → Add webhook**:
   - **Payload URL:** your smee URL
   - **Content type:** `application/json`
   - **Secret:** the value from step 2
   - **Events:** *Let me select individual events*, then tick **Pull requests**, **Pull request reviews**, **Pull request review comments**, **Issue comments** and **Workflow runs**

**g. Who may steer the agent:** set `GITHUB_ALLOWED_USERS=<your GitHub username>`, comma-separated if several. Comments from anyone else are ignored.

</details>

<details>
<summary><b>2️⃣ Jira: site, project, API token</b></summary>

**a. Create a site:** [atlassian.com/software/jira/free](https://www.atlassian.com/software/jira/free) → your site becomes `https://<name>.atlassian.net`. Put that in `.env` as `JIRA_BASE_URL=`.

**b. Create a project:** **Projects → Create project → Scrum** (team-managed is fine). Note its **key**, e.g. `SCRUM`, and set `JIRA_PROJECT_KEY=` to it.

**c. Statuses:** code-crafter moves tickets **To Do → In Progress → In Review → Done**, forward only.
- *To Do*, *In Progress* and *Done* exist by default.
- Add **In Review**: board **⋯ → Board settings → Columns → add a column/status "In Review"**. If you skip it, that step is simply left out.

**d. API token:** log in as the account code-crafter should act as (your own, or a dedicated bot account) and go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) → **Create API token**. Set:
- `JIRA_EMAIL=` that account's email
- `JIRA_API_TOKEN=` the token

**e. Check it** (prints only your display name):

```bash
set -a; . ./.env; set +a; curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" "$JIRA_BASE_URL/rest/api/3/myself" | jq -r .displayName
```

</details>

<details>
<summary><b>3️⃣ Slack: workspace, app, two channels, tokens</b></summary>

**a. Workspace:** use an existing one where you can install apps, or create one at [slack.com/get-started](https://slack.com/get-started).

**b. Create the app from the manifest:**
1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest** → pick the workspace.
2. Paste the contents of [`slack/manifest.yaml`](slack/manifest.yaml) → **Create**.
3. Click **Install to Workspace** → **Allow**.

**c. Tokens:**
- **OAuth & Permissions → Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN=`
- **Basic Information → App-Level Tokens → Generate Token and Scopes**: add scope **`connections:write`** → **Generate**. The token (`xapp-…`) → `SLACK_APP_TOKEN=`

This is **Socket Mode**: Slack talks to your machine over an outgoing connection, so you don't need a public URL.

**d. Channels:**
1. Create **`#code-crafter`**, where you post ticket keys, and **`#ops`**, where any message becomes a Jira ticket.
2. In each, type `/invite @code-crafter`.
3. Get each channel's ID: open the channel name → **About** → the ID at the bottom (`C…`). Set `SLACK_TRIGGER_CHANNEL_ID=` (#code-crafter) and `SLACK_OPS_CHANNEL_ID=` (#ops).

**e. Who may start tickets:** your profile → **⋮ → Copy member ID** (`U…`) → `SLACK_ALLOWED_USER_IDS=`, comma-separated if several.

</details>

<details>
<summary><b>4️⃣ Claude: the agent's brain</b></summary>

- **With a Claude Pro/Max subscription:** install Claude Code (`npm i -g @anthropic-ai/claude-code`), run `claude setup-token`, sign in, and put the long-lived token in `.env` as `CLAUDE_CODE_OAUTH_TOKEN=`.
- **Or with an API key** (pay per use; the right choice for teams and production): [console.anthropic.com](https://console.anthropic.com) → API keys → `ANTHROPIC_API_KEY=`.

The default model is **Haiku**, which is cheap and fast. Use a Jira label `model:sonnet` or `model:opus` for harder tickets.

</details>

<details>
<summary><b>5️⃣ Internal secrets, Ollama and Neo4j</b></summary>

```bash
# shared secret between n8n, the control plane and agents
echo "INTERNAL_API_TOKEN=$(openssl rand -hex 24)" >> .env
# Neo4j password (leave NEO4J_PASSWORD empty to run without the architecture graph)
echo "NEO4J_PASSWORD=$(openssl rand -hex 16)" >> .env

# embeddings model for the graph
brew install ollama && brew services start ollama
ollama pull nomic-embed-text
```

> 🐧 **Linux:** containers can't reach `host.docker.internal` by default. Set `OLLAMA_URL=http://<your host IP>:11434` in `.env`, and make Ollama listen on that interface with `OLLAMA_HOST=0.0.0.0`.

</details>

<details>
<summary><b>6️⃣ Teach it your target repo</b></summary>

**a. Register the repo** in [`config/services.yaml`](config/services.yaml):

```yaml
services:
  my-app:
    repo: https://github.com/<you>/<repo>.git
    default_base_branch: main
```

**b. Add `codecrafter.yaml`** at the root of the **target repo**, describing how to build and check it:

```yaml
system:
  setup:
    volta: { enabled: true, node: '24' }
    command: 'npm'
    args: ['ci']
codecrafter:
  agent:
    provider: claude
    model: haiku            # per ticket: Jira label model:sonnet / model:opus
    fallback: []
    on_usage_limit: pause   # checkpoint, post the reset time, never downgrade mid-ticket
  pull_request:
    draft: true
  commands:                 # what "done" means for this repo
    lint: 'npm run lint'
    format: 'npm run format:check'
    typecheck: 'npx tsc --noEmit'
    build: 'npm run build'
```

**c. Optional but recommended: add `.codecrafter/context.yaml`** to the target repo for the architecture graph:

```yaml
service: my-app                     # must match the name in config/services.yaml
repo: https://github.com/<you>/<repo>.git
description: What this service does, in one or two sentences.
exposes:
  - { method: POST, path: /api/chat, handler: app/api/chat/route.ts, auth: firebase-id-token }
calls:
  - { service: openrouter, external: true, purpose: 'Chat LLM', env: [OPENROUTER_API_KEY] }
databases:
  - { name: firestore, kind: firestore, collections: [expenses, categories] }
libraries:
  - { name: '@google/adk', why: 'chat agent runtime (tools, sessions, streaming)' }
docs: [docs/architecture.md, docs/data-model.md]
```

💡 Quote any value that contains a comma. The ingester rejects unquoted ones and tells you where. Full example: [expense-manager's manifest](https://github.com/anandgupta193/expense-manager/blob/main/.codecrafter/context.yaml).

</details>

<details>
<summary><b>7️⃣ Start everything</b></summary>

```bash
docker volume create n8n_data   # first time only
docker compose build agent      # the per-ticket agent image (a few minutes)
docker compose up -d            # n8n · redis · smee · neo4j · control-plane
scripts/n8n-import.sh           # load + publish the n8n workflows from git

# seed the graph once (later merges to main keep it fresh automatically)
set -a; . ./.env; set +a
curl -X POST localhost:3000/api/context/reindex/my-app -H "x-codecrafter-token: $INTERNAL_API_TOKEN"
```

Open **http://localhost:3000/status**. All five lights should be 🟢 (Slack bridge · n8n · smee · Redis · Graph).

</details>

<details>
<summary><b>8️⃣ Your first ticket 🎉</b></summary>

1. In **#ops**, post: *"Add a GET /api/health endpoint that returns {ok: true}"*. The bot replies with a Jira link.
2. In **#code-crafter**, post the ticket key, e.g. `SCRUM-1`.
3. Watch the Slack thread and the status page. A draft PR appears in a few minutes.
4. Leave a review comment and watch it get fixed. Then mark the PR ready, approve and merge. Jira moves to **Done** ✅.

**Tinkering without Slack:** `scripts/run-ticket.sh SCRUM-1` starts a ticket container by hand and follows its logs.

</details>

<details>
<summary><b>🩺 Troubleshooting</b></summary>

| Symptom | Likely cause |
|---|---|
| Nothing happens after posting a key | Your Slack user ID isn't in `SLACK_ALLOWED_USER_IDS`, the bot isn't invited to the channel, or the Slack bridge light is 🔴 |
| Jira says "project doesn't exist" | Wrong `JIRA_PROJECT_KEY`, or the token's account can't see that project |
| PR comments are ignored | Your GitHub username isn't in `GITHUB_ALLOWED_USERS`, the webhook events are missing, or the smee light is 🔴. Note that *pending* review comments send nothing until you click **Submit review** |
| Graph light 🔴 / "no architecture context" | `NEO4J_PASSWORD` is unset, Neo4j is still starting, or Ollama isn't running (`ollama list`) |
| Ticket paused "usage limit" | Your Claude plan hit its limit; it resumes after the reset time posted in the thread |
| Anything else | Status page → **📜 Logs** on the ticket row, or `docker logs code-crafter-<key>` |

</details>

---

## 🏭 Going to production

v1 is built for **one team on one machine**. Here's what changes for real, multi-user, always-on use, roughly in order.

### 🖥️ Compute
- [ ] **Kubernetes** (GKE, EKS or AKS), or a single cloud VM as a first step.
- [ ] Per-ticket **Kubernetes Jobs** instead of `docker run`. Today the control plane drives Docker through `docker.sock`, which is root-equivalent on the host. A Kubernetes backend for the spawner gets a service account that may only create pods in one namespace.
- [ ] Per-ticket state on a **PersistentVolume** or object storage (S3/GCS).
- [ ] Images built in CI and pushed to a **registry** (GHCR, Artifact Registry or ECR), version-tagged and scanned (Trivy).
- [ ] A **spawn queue** with per-team concurrency, and autoscaling worker nodes (Spot nodes work well for disposable agents).

### 🌐 Getting events in
- [ ] Replace smee with a real **HTTPS ingress** (load balancer + TLS) that GitHub calls directly.
- [ ] Verify **GitHub HMAC signatures** (`X-Hub-Signature-256`) on every delivery.
- [ ] A **catch-up poller** that replays missed PR comments and CI results.
- [ ] Slack can stay on Socket Mode, or move to the Events API behind the same ingress.

### 🔐 Identity and secrets (most important)
- [ ] An **Anthropic API key** on an org account, or Claude via **AWS Bedrock / Google Vertex AI**, with spend limits. Personal subscription tokens aren't meant for shared services.
- [ ] A **GitHub App** instead of a bot PAT: per-repo access, and 1-hour installation tokens minted per ticket.
- [ ] A **secret manager** (GCP Secret Manager, AWS Secrets Manager or Vault), synced with External Secrets.
- [ ] **Least privilege in the agent:** only a repo-scoped GitHub token and the model key. Slack, Jira and Neo4j calls go through the control plane.
- [ ] Dedicated **service accounts** for Jira and Slack.

### 🧱 Sandboxing the agent
- [ ] **Egress allow-list** (NetworkPolicy): GitHub, the model API and package registries only.
- [ ] **gVisor or Kata** runtime, non-root, read-only root filesystem, CPU/memory/disk limits, no host mounts.
- [ ] **Prompt-injection hygiene:** treat ticket and PR text as untrusted, and only allow-listed people can trigger runs.
- [ ] Branch protection and **CODEOWNERS** on every target repo. The bot can never merge.

### 🗄️ Data services
- [ ] **Managed Redis** (Memorystore, ElastiCache or Upstash).
- [ ] n8n on **Postgres** in queue mode, or fold its 3 small workflows into the control plane.
- [ ] Neo4j **AuraDB Professional**, or Neo4j on a persistent volume with backups. The graph can always be rebuilt from `context.yaml`.
- [ ] Embeddings from an in-cluster Ollama or a hosted embeddings API. Switching models means one reindex.

### 👀 Operations
- [ ] Structured logs to **Cloud Logging, Loki or Datadog** (secrets are already redacted).
- [ ] **Metrics:** tickets per day, time to PR, success rate, cost per ticket, queue depth.
- [ ] **Alerts** to Slack or PagerDuty: crashes, stuck tickets, failed ingests, usage limits.
- [ ] Status page behind **SSO**.
- [ ] **Auto-resume** after usage-limit pauses, retries, and a dead-letter queue.
- [ ] **CI/CD for code-crafter itself:** tests, gitleaks, image builds, **Helm** chart, and a **staging** environment (a test Slack channel, Jira project and repo) before prod.

### 👥 Scale and governance
- [ ] **Multiple teams:** many repos, Jira projects and Slack channels, with allow-lists from Slack user groups or GitHub teams.
- [ ] **Budgets:** tokens and time per ticket and per team, with model routing (Haiku → Sonnet/Opus by label).
- [ ] An **audit trail** of who triggered what, which PR came out, and what it cost.

### 🪜 Suggested path

| Step | What | Rough monthly cost |
|---|---|---|
| **A. One cloud VM** | Same `docker compose` on a VM, HTTPS webhooks, an API key, a GitHub App, a secret manager, HMAC checks, the catch-up poller | ~$20–50 + model usage |
| **B. Harden** | Least-privilege agent, egress rules, alerts, metrics, auto-resume, status page behind SSO, managed Redis | +~$10–30 |
| **C. GKE** | Kubernetes spawner (Jobs), Helm, staging environment, gVisor, autoscaling Spot nodes, multiple teams | cluster ~$75–150+ |
| **D. Scale** | Budgets, audit trail, the multi-repo planner | grows with usage |

💡 GKE's free tier covers the management fee of one zonal or Autopilot cluster; you pay for nodes. Model usage is usually the biggest line: about **$0.20 per small Haiku ticket**.

---

## 🗂️ What's in the box

```text
code-crafter/
├── 📦 agent/                  the per-ticket worker
│   ├── Dockerfile             Node 24 · git · gh · Claude Code · Neo4j MCP server
│   ├── scripts/entrypoint.sh  clone → branch → harness → MCP config → orchestrator
│   ├── rules/code-crafter.md  the agent's house rules
│   └── orchestrator/          prompt · 🕸️ context briefing · supervision · guardrails · checks · command queue
├── 🧭 control-plane/          Slack bridge · spawner · GitHub event router · 🕸️ graph ingestion · reaper · status page
├── 🧩 n8n/                    tested parsers → generated workflows
├── ⚙️ config/services.yaml    which repos it may touch
├── 💬 slack/manifest.yaml     one-paste Slack app
├── 🐳 docker-compose.yml      the always-on stack (incl. Neo4j)
└── 📚 docs/                   the full architecture, piece by piece
```

🧪 **Tests:** 44 agent · 53 control plane · 15 parser. Run `npm test` in `agent/orchestrator` and `control-plane`, and `node --test n8n/parsers/*.test.js`.

---

## 🛡️ Safety notes

- 🤖 The agent pushes as a **separate GitHub bot** with minimal scopes: it can open PRs but **can't merge**, can't change CI, and isn't an admin.
- 🔒 Branch protection on `main`: PR + 1 human approval + green CI.
- 🕸️ The agent's graph access is **read-only** twice over: the MCP server has no write tool, and Neo4j itself refuses writes in read-only sessions.
- 🔐 Secrets live only in `.env` (gitignored), and the logs and status page redact them.
- ⚠️ **Single-team design:** inside its container the agent gets the full set of tokens. Follow [Going to production](#-going-to-production) before letting untrusted people post tickets or comments.

---

## 🧭 Roadmap

**v1 is complete ✅.** The whole loop works end to end and has been verified live. Everything below "v1" is open for contributions. 🙌

| | Phase | Status |
|---|---|---|
| 📦 | **1a** Agent in a container → draft PR | ✅ |
| 🔌 | **0/1b** Slack → n8n → control plane → spawn | ✅ |
| 💬 | **1c** Review comments, CI failures, merge → Done | ✅ |
| 🧹 | **Comment triage**: skip handled feedback, most important first | ✅ |
| 📊 | **Status page**: health, tickets, logs, PR stats | ✅ |
| 🎫 | **#ops → Jira** ticket creation | ✅ |
| 🕸️ | **2** Architecture knowledge graph: Neo4j + Graph RAG briefing + live MCP + self-updating manifest | ✅ |
| 🧯 | **1d** Catch-up poll, auto-resume, webhook signatures, gitleaks, Slack alerts | 💡 open |
| 🔀 | **2b** Cursor adapter | 💡 open |
| ☸️ | **GKE / Kubernetes spawner** (see [Going to production](#-going-to-production)) | 💡 open |
| 🗺️ | **3** Multi-repo planner: one request → N PRs, planned from the graph | 💡 open |

---

## 📚 Docs

| | Doc | |
|---|---|---|
| 🧭 | [00 · Overview](docs/00-overview.md) | the big picture |
| 💳 | [01 · Accounts & infra](docs/01-accounts-and-infra.md) | what to sign up for, install, pay for |
| 💬 | [02 · Trigger intake](docs/02-trigger-intake.md) | Slack → ticket → spawn |
| 🧩 | [03 · Event bus](docs/03-event-bus-n8n.md) | n8n workflows and parsers |
| 🚢 | [04 · Spawner](docs/04-spawner.md) | one container per ticket |
| 📦 | [05 · Agent runtime](docs/05-agent-runtime.md) | image, boot, `codecrafter.yaml` |
| 🔌 | [06 · AgentRunner](docs/06-agent-runner-abstraction.md) | Claude / Cursor adapters |
| 🧠 | [07 · Orchestrator](docs/07-orchestrator.md) | prompt, supervision, guardrails |
| 🗄️ | [08 · State & memory](docs/08-state-and-memory.md) | why containers can die |
| 🔁 | [09 · Feedback & merge](docs/09-feedback-and-merge.md) | comments, CI, merge → Done |
| 🕸️ | [10 · Context graph](docs/10-context-graph.md) | architecture memory: Neo4j, Graph RAG, MCP |
| 🗺️ | [11 · Planner](docs/11-planner.md) | *(future)* multi-repo plans |
| 🛡️ | [12 · Security](docs/12-security.md) | secrets, tokens, sandboxing |
| 🧭 | [13 · Roadmap](docs/13-roadmap.md) | phases and the decisions log |
| 🎯 | [14 · Target repo](docs/14-target-repo-expense-manager.md) | the first repo it works on |
| 🤖 | [15 · Bot account](docs/15-bot-account-setup.md) | GitHub bot, token, branch protection |
| 📋 | [16 · Plan 1c + 1d](docs/16-plan-1c-1d.md) | finishing the loop, hardening |
| 📊 | [17 · Status page](docs/17-status-page.md) | what broke and why |

---

## 💡 Inspiration

Based on the published architecture of QuillBot's internal **Code-Crafter** (disposable pod per ticket, n8n event bus, PR-event feedback loop, Neo4j context graph), rebuilt from scratch with GitHub, Slack Socket Mode, local Docker, Ollama and free tiers.

<div align="center">

### 🧑‍💻 Built by [@anandgupta193](https://github.com/anandgupta193)

_First customer: [expense-manager](https://github.com/anandgupta193/expense-manager), where 6 merged PRs and counting were written by this robot_ 🤖💸

### ⭐ If this saved you an afternoon, or just made you think "wait, we could do this", **star the repo** ⭐

_Stars tell me what to build next. Issues, ideas and PRs are very welcome._ 🙌

📄 [MIT licensed](LICENSE)

</div>
