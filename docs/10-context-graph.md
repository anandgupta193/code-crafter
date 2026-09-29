# 10 · Context graph (Phase 2)

## Purpose
Architecture memory: a graph of services and how they connect, so a ticket about service A arrives with the endpoints of the services A calls already in the prompt. The graph reaches the model **twice**: rendered into the prompt, and live through an MCP server for mid-task queries.

## Model (Neo4j)
Nodes: `Service`, `Endpoint`, `Event`, `Database`, `Library`, `Deployment`, `Team`, `Domain`, `DocChunk` (with embedding).
Relationships: `(Service)-[:EXPOSES]->(Endpoint)`, `-[:CALLS]->(Endpoint)`, `-[:PUBLISHES|SUBSCRIBES]->(Event)`, `-[:OWNS]->(Database)`, `-[:DEPENDS_ON]->(Library)`, `(Team)-[:OWNS]->(Service)`, `(DocChunk)-[:DESCRIBES]->(Service)`.

## Source of truth: `.codecrafter/context.yaml` in each target repo
```yaml
service: demo-app
repo: https://github.com/acme/demo-app.git
team: platform
exposes:   [{ method: GET, path: /items }]
calls:     [{ service: billing, method: POST, path: /charge }]
publishes: [item.created]
subscribes: []
databases: [{ name: demo_db, kind: postgres }]
```

## Ingestion
- A GitHub Action on **release tags** diffs `context.yaml` and `docs/**.md` against the previous tag and POSTs to the control plane `/api/context/webhook`.
- A Redis lock `codecrafter:lock:ingest` ensures one ingestion at a time; rejections are reported to Slack.
- Docs are chunked and embedded (Ollama `nomic-embed-text`, free, or OpenAI `text-embedding-3-small`).

## ContextClient (prompt side)
1. Find the `Service` whose `repo` matches the clone URL.
2. In one query: its endpoints, outbound `CALLS`, published and subscribed events, and owned DBs.
3. Walk upstream and downstream dependencies, including **event-mediated coupling** (A publishes X, B subscribes to X).
4. Scan the ticket text for other service names and pull their contexts too.
5. Render to markdown → `## Architecture Context`.

## Live access
`mcp-neo4j-cypher` wired into the agent (`.mcp.json`), read-only credentials.

## Drift is a defect
A rule makes updating `context.yaml` part of every task that changes a public surface (endpoint, outbound call, event, DB, deployment). It's item 4 of the TASK COMPLETED checklist. A drifted manifest is worse than none.

## Infra
Neo4j Community in Docker (free) or AuraDB Free. Also replaces `config/services.yaml` as the service registry.
