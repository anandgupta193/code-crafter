# 04 · Spawner (control plane)

## Purpose
Replaces the original's GitLab CI `deploy_on_demand` job: **create exactly one disposable sandbox per ticket**, with secrets injected, and destroy it on a timer.

## Responsibilities
- `POST /spawn`: start the container `code-crafter-<key>` from the image `code-crafter-agent`.
- **Serialise per ticket** (the original used `resource_group: code-crafter-$KEY`). We use a Redis lock `codecrafter:lock:spawn:<KEY>`.
- **Dedupe:** if a healthy container already exists, exit cleanly (the original's `check-agent-healthy.sh`).
- **TTL:** stop and remove containers older than 40 min (the original's `auto_stop_in: 40 minutes`).
- Inject env vars and secrets; attach to the `codecrafter` network; apply resource limits.

## Flow
```
POST /spawn {WORKSPACE_REPO, WORKSPACE_BASE_BRANCH, JIRA_TASK_KEY, SLACK_THREAD_TS, resume?}
  acquire lock(KEY) ── busy → 409 "spawn in progress"
  container exists?
     ├─ running & /healthz 200 → release, 200 {status:"already-running"}
     └─ exited / unhealthy     → remove it
  docker run -d --name code-crafter-cc-12 --network codecrafter \
     --label codecrafter.key=CC-12 --label codecrafter.started=<epoch> \
     --memory 4g --cpus 2 --env-file <ticket-env> code-crafter-agent
  release lock → 201
Reaper (every 60s): containers with label codecrafter.started < now-40m → stop + rm
```

## Interfaces / contracts
- HTTP: `POST /spawn`, `GET /tickets/:key/status`, `DELETE /tickets/:key` (manual kill).
- Docker access: the control plane talks to the Docker Engine API (via `dockerode`) over `/var/run/docker.sock`.
- Env passed to the container: the four spawn vars plus `GITHUB_TOKEN`, `JIRA_*`, `SLACK_BOT_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`, `REDIS_URL`, `AGENT_PROVIDER`.

## Data & state
Stateless apart from the Redis lock and Docker labels. The container itself is disposable (see [08](08-state-and-memory.md)).

## Failure modes
| Case | Behaviour |
|---|---|
| Double trigger | Lock + dedupe; second request returns `already-running` |
| Container crashes | `/healthz` fails; the next event triggers a respawn with `resume` |
| TTL expires mid-task | Work already pushed via checkpoint commits; the next event resumes it |
| Docker out of resources | 503 to n8n; thread reply |

## MVP vs later
- **MVP:** `dockerode` + labels + reaper loop.
- **Later (K8s):** the same API, but it creates a Namespace, Secret and Deployment from `kubernetes/template.yaml` (kind locally, then a managed cluster). The TTL becomes a CronJob or controller, and `/healthz` becomes a liveness probe. Keep a `Spawner` interface (`DockerSpawner`, `K8sSpawner`) so the switch is a config change.

## Security note
Mounting `docker.sock` gives the control plane root-equivalent access on the host. That's acceptable on a laptop prototype; it goes away with K8s (see [12](12-security.md)). Agent containers **never** get the socket.

## Decided
- **Max 2 concurrent tickets.** `/spawn` counts running `codecrafter.key` containers; a third gets `429` and a Slack reply "queue full, retry later" (a real queue comes later).
- **TTL 40 min.**
