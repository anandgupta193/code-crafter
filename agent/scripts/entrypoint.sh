#!/usr/bin/env bash
# Container boot (docs/05-agent-runtime.md): git identity → clone → branch detection → harness → orchestrator.
set -euo pipefail

log() { printf '[%s] ▶ %s\n' "$(date +%H:%M:%S)" "$*"; }

: "${WORKSPACE_REPO:?WORKSPACE_REPO is required}"
: "${JIRA_TASK_KEY:?JIRA_TASK_KEY is required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

BASE="${WORKSPACE_BASE_BRANCH:-main}"
BRANCH="CODE-CRAFTER-${JIRA_TASK_KEY}"
REPO_DIR="${REPO_DIR:-/workspace/repo}"

# 1. Git identity + credentials. The helper reads the token from env at use time, so it is never written to disk.
export GH_TOKEN="$GITHUB_TOKEN"
git config --global user.name "${GIT_USER_NAME:-codecrafterbot}"
git config --global user.email "${GIT_USER_EMAIL:-335623999+codecrafterbot@users.noreply.github.com}"
git config --global credential.helper '!f() { echo username=x-access-token; echo "password=${GITHUB_TOKEN}"; }; f'

# 2. Fresh clone every boot — the branch on GitHub is the state, not this disk.
log "cloning ${WORKSPACE_REPO}"
rm -rf "$REPO_DIR"
git clone --quiet "$WORKSPACE_REPO" "$REPO_DIR"
cd "$REPO_DIR"

# 3. The flag everything hangs on.
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
  BRANCH_IS_NEW=false
  log "resuming existing branch $BRANCH"
else
  git checkout --quiet -b "$BRANCH" "origin/$BASE"
  BRANCH_IS_NEW=true
  log "created branch $BRANCH from $BASE"
fi

# 4. Harness: our rules live beside the repo's own CLAUDE.md/.claude (never overwrite those),
#    excluded locally so the agent cannot commit them.
mkdir -p .codecrafter/harness
cp /opt/codecrafter/rules/*.md .codecrafter/harness/
echo ".codecrafter/" >> .git/info/exclude

export BRANCH_NAME="$BRANCH" BRANCH_IS_NEW REPO_DIR
exec node /opt/codecrafter/orchestrator/src/main.ts
