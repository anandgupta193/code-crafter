#!/usr/bin/env bash
# Phase 1a: start the agent container for one Jira ticket by hand.
#   scripts/run-ticket.sh SCRUM-2 [service] [base-branch]
# Re-running for the same ticket replaces the container and resumes from the branch + volume.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${1:?usage: scripts/run-ticket.sh <JIRA-KEY> [service] [base-branch]}"
SERVICE="${2:-expense-manager}"
MAX_CONCURRENT="${CC_MAX_CONCURRENT:-2}"

[[ -f "$ROOT/.env" ]] || { echo "✗ $ROOT/.env not found"; exit 1; }

# Look up the service in config/services.yaml (allow-list).
read -r REPO DEFAULT_BASE < <(awk -v svc="$SERVICE" '
  /^  [A-Za-z0-9_.-]+:[[:space:]]*$/ { cur = $1; sub(":", "", cur); next }
  cur == svc && $1 == "repo:" { repo = $2 }
  cur == svc && $1 == "default_base_branch:" { base = $2 }
  END { if (repo) print repo, (base ? base : "main") }
' "$ROOT/config/services.yaml")
[[ -n "${REPO:-}" ]] || { echo "✗ service '$SERVICE' is not in config/services.yaml"; exit 1; }
BASE="${3:-$DEFAULT_BASE}"

LOWER="$(printf '%s' "$KEY" | tr '[:upper:]' '[:lower:]')"
NAME="code-crafter-$LOWER"
VOLUME="codecrafter-home-$LOWER"

# Concurrency cap (D3), not counting this ticket's own container.
RUNNING="$(docker ps --filter label=codecrafter.key --format '{{.Names}}' | { grep -vx "$NAME" || true; } | wc -l | tr -d ' ')"
if (( RUNNING >= MAX_CONCURRENT )); then
  echo "✗ $RUNNING tickets already running (max $MAX_CONCURRENT): $(docker ps --filter label=codecrafter.key --format '{{.Names}}' | tr '\n' ' ')"
  exit 1
fi

echo "▶ building image code-crafter-agent"
docker build --quiet -t code-crafter-agent "$ROOT/agent" >/dev/null

docker rm -f "$NAME" >/dev/null 2>&1 || true
echo "▶ starting $NAME  ($SERVICE @ $BASE, volume $VOLUME)"
docker run -d \
  --name "$NAME" \
  --label codecrafter.key="$KEY" \
  --label codecrafter.started="$(date +%s)" \
  --memory 6g --cpus 4 \
  --env-file "$ROOT/.env" \
  -e WORKSPACE_REPO="$REPO" \
  -e WORKSPACE_BASE_BRANCH="$BASE" \
  -e JIRA_TASK_KEY="$KEY" \
  -e TZ="${TZ:-Asia/Kolkata}" \
  -v "$VOLUME:/home/node" \
  code-crafter-agent >/dev/null

echo "▶ following logs (Ctrl-C stops following; the container keeps running)"
exec docker logs -f "$NAME"
