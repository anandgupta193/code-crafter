#!/usr/bin/env bash
# Build the n8n workflows from the tested parsers, import them into n8n, publish them, restart n8n
# so the webhooks register. Git stays the source of truth (D22).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node n8n/build.mjs
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
for id in $(jq -r '.id' n8n/workflows/*.json); do
  docker compose exec -T n8n n8n publish:workflow --id="$id" >/dev/null
done
docker compose restart n8n >/dev/null
echo "▶ waiting for n8n"
until curl -fs http://127.0.0.1:5678/healthz >/dev/null; do sleep 1; done
# /healthz turns green before published webhooks are registered — wait until one answers (404 = not yet).
until [ "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS http://127.0.0.1:5678/webhook/github)" != "404" ]; do sleep 1; done
sleep 2
echo "✓ workflows imported and published: $(jq -r '.name' n8n/workflows/*.json | paste -sd ', ' -)"
