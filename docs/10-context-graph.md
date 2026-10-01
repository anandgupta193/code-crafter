# 10 · Context graph (Phase 2)

## Purpose
Architecture memory: a graph of each service, what it exposes, what it calls, where its data lives and what its docs say. A ticket arrives with that knowledge already attached, so the agent doesn't rediscover the system from scratch.

Like the original, the graph reaches the model **twice**:
1. **Briefing note:** a `## Architecture Context` section rendered into the first prompt.
2. **Live access:** an MCP server the agent can query mid-task ("does anything else call this endpoint?").

Planned in a sync session on 2026-10-01 (decisions D34–D40 below).

## How it fits
```
expense-manager main ──(PR merged webhook, already received)──► control plane
                                                                   │ read context.yaml + docs/** via GitHub API
                                                                   │ chunk docs → embed (Ollama on the Mac)
                                                                   ▼
                                                      Neo4j Community (compose service)
                                                                   ▲            ▲
             agent container, at startup: ContextClient ───────────┘            │ read-only Cypher, mid-task
             (graph facts + top doc chunks for the ticket → prompt)    mcp-neo4j-cypher (--mcp-config)
```

## Decisions
| # | Decision |
|---|---|
| D34 | **Neo4j Community Edition** (free, GPLv3) in Docker, part of the compose stack on the `codecrafter` network. Browser UI on `localhost:7474`, data in a named volume. AuraDB Free is for the cloud phase |
| D35 | Embeddings: **Ollama + `nomic-embed-text`** (768 dims), running natively on the Mac (Docker can't use the Apple GPU). Containers reach it at `host.docker.internal:11434` |
| D36 | `.codecrafter/context.yaml` per target repo, **drafted from the code and reviewed by a human** (expense-manager: PR #12). Afterwards the agent keeps it true ("drift is a defect") |
| D37 | Ingestion runs **on every merge to `main`** (the `pull_request` closed + merged webhook we already receive), not on release tags. Plus an internal "reindex now" endpoint for the first load and recovery |
| D38 | The agent gets **both** the prompt briefing **and** live read-only graph queries over MCP, as in the original |
| D39 | The **agent container** builds the briefing at startup (`ContextClient` in the orchestrator), rebuilt on every resume. If Neo4j or Ollama is down, it logs a warning and **starts without it**. The graph helps, never blocks |
| D40 | **`config/services.yaml` stays the repo registry** (spawn, routing, PR stats, which repos to ingest). The graph holds knowledge only. Revisit in Phase 3 (planner) |

## Graph model (v1)
Only what expense-manager actually has. Event, Deployment and Team nodes wait until a repo needs them; `team` and `domain` are Service properties for now.

| Node | Key | Properties |
|---|---|---|
| `Service` | `name` | repo, description, team, domain, stack[], checks[] |
| `Endpoint` | `service + method + path` | method, path, handler, auth, response, description, calledBy[] |
| `ExternalService` | `name` | (e.g. openrouter, google-gemini, firebase-auth) |
| `Database` | `service + name` | kind, layout, collections[], accessedFrom, rules, code |
| `Library` | `name` | |
| `DocChunk` | `service + path + heading` | text, path, heading, `embedding` (768-d vector index), hash |

Relationships:
- `(Service)-[:EXPOSES]->(Endpoint)`
- `(Service)-[:CALLS {purpose, via[], env[]}]->(ExternalService | Service)`
- `(Service)-[:OWNS]->(Database)`
- `(Service)-[:DEPENDS_ON {why}]->(Library)`
- `(DocChunk)-[:DESCRIBES]->(Service)`

A `calls` entry naming another registered service links to that `Service` node. That's what later lets a ticket on service A see service B's endpoints.

## Source of truth: `.codecrafter/context.yaml`
See expense-manager's file for the full shape: `service`, `repo`, `description`, `team`, `domain`, `stack`, `exposes[]`, `calls[]`, `publishes[]`, `subscribes[]`, `databases[]`, `libraries[]`, `docs[]`, `checks[]`.

The manifest is validated on ingest. An unknown top-level key, a missing `service` or `repo`, or a `repo` that doesn't match `services.yaml` means a **rejection**: the graph is left untouched and a message goes to the ops channel.

## Ingestion (control plane)
1. **Trigger:** the router sees a merged PR on a registered repo, or `POST /api/context/reindex/:service` is called (token-protected).
2. **Lock:** Redis `codecrafter:lock:ingest:<service>`, so one ingestion per service at a time.
3. **Read:** `context.yaml` and every file in its `docs[]` list from `main` via the GitHub contents API. No clone.
4. **Validate** the manifest (see above).
5. **Upsert:** one transaction replaces the service's subgraph. Nodes the manifest no longer mentions are removed.
6. **Docs:**
   - Split at `##` headings into chunks of at most ~1,500 characters.
   - Hash each chunk and **embed only new or changed ones**, using the `search_document:` prefix that nomic expects.
   - Delete chunks that disappeared.
7. **Report:** one log line (e.g. `ingested expense-manager: 1 endpoint, 5 calls, 2 DBs, 23 chunks (4 re-embedded)`). Failures are posted to the ops channel.

## Briefing note (agent: `ContextClient`)
At startup, before building the first prompt:
1. Find the `Service` whose `repo` matches the clone URL.
2. In **one read-only query**, get its endpoints, outbound calls, databases and libraries.
3. Walk one hop to any **registered** services it calls or that call it, and get their endpoints. There are none yet; this pays off with a second repo.
4. Scan the ticket text for other registered service names and pull their contexts too.
5. **RAG:**
   - Embed the ticket summary and description, using the `search_query:` prefix.
   - Take the **top 5 doc chunks** for this service by vector similarity, with a score cutoff.
6. Render the markdown and insert it into `buildInitialPrompt` as `## Architecture Context`, after the task requirements and attachments. Cap it at about 6k characters, cutting doc chunks first.

On failure (no service node, Neo4j or Ollama unreachable, timeout above 10 s), log `! no architecture context: <reason>` and continue.

## Live access (MCP)
- **Server:** `mcp-neo4j-cypher`, run with `uvx` (the agent image gains `uv`), connected to `bolt://neo4j:7687`.
- **Wiring:** an `mcp.json` in `/workspace/harness/` (outside the repo), passed with `claude --mcp-config`. Nothing lands in the target repo.
- **Read-only:** Community Edition has **no per-user roles**, so read-only is enforced by:
  1. running the MCP server in its read-only mode, which exposes no write tool;
  2. running the briefing queries in `READ` access-mode sessions, which Neo4j rejects writes in.
- **Rule:** the agent rules gain one paragraph: "the architecture graph is available via the neo4j MCP tools; query it before changing an endpoint, an outbound call or a data model."

## Drift is a defect
`rules/code-crafter.md` adds a TASK COMPLETED checklist item: if the change touches an endpoint, an outbound call, a database, an env var or a key library, update `.codecrafter/context.yaml` in the same PR. A stale manifest is worse than none. The next merge re-ingests it automatically (D37).

## Infra
| Piece | Where | Notes |
|---|---|---|
| Neo4j `5.26-community` (LTS) | compose service `neo4j` | `127.0.0.1:7474` (browser), `7687` (bolt) on the `codecrafter` network; volume `neo4j_data`; `NEO4J_AUTH` from `.env` |
| Ollama + `nomic-embed-text` | Mac host (`brew services start ollama`) | `host.docker.internal:11434` from containers |
| Env (`.env`) | `NEO4J_PASSWORD`, `OLLAMA_URL` | passed to the control plane and agent containers |
| Status page | adds a 5th health pill: **Graph** (Neo4j answers, plus last ingest time) | |

## Build order (tests first)
1. **Infra:** Neo4j in compose; `.env` names; check Ollama is reachable from a container.
2. **Pure functions with unit tests:**
   - manifest validation;
   - manifest → graph upsert plan;
   - markdown chunker;
   - briefing renderer, including the size cap;
   - prompt-section placement.
3. **Control plane:**
   - Neo4j + Ollama clients;
   - ingestion with lock, diffing and rejection reporting;
   - router hook on merge;
   - the reindex endpoint;
   - the Graph health pill.
4. **Agent:**
   - `ContextClient` with a read-only session and a graceful skip;
   - `## Architecture Context` in the prompt;
   - the MCP server in the image and `--mcp-config`;
   - the rules update.
5. **Live:**
   - seed the graph with reindex;
   - run one real ticket and check the briefing in the logs;
   - one ticket where the agent should query the graph mid-task;
   - merge a PR that edits `context.yaml` and watch the graph update.

## Done when
1. `POST /api/context/reindex/expense-manager` fills Neo4j. In the Neo4j browser, `MATCH (s:Service)-[r]->(n) RETURN s,r,n` shows `/api/chat`, five external calls, two DBs and the libraries.
2. A broken manifest is rejected with a message in the ops channel, and the graph is unchanged.
3. Merging a PR that edits `context.yaml` or a doc updates the graph within a minute; only changed chunks are re-embedded.
4. A new ticket's log shows `✓ architecture context: N facts, K doc chunks`, and the prompt contains the section.
5. With Neo4j stopped, a ticket still starts (with a warning), and the status page shows the Graph pill red.
6. The agent can run a read-only Cypher query mid-task; a write attempt is refused.
7. A ticket that changes an endpoint also updates `context.yaml`.

## Later (not v1)
- Event, Deployment and Team nodes (when a repo has them).
- The graph as the registry (Phase 3 planner).
- Cross-repo planner context.
- AuraDB in the cloud phase.
- Re-embedding on a model change.
