# code-crafter agent image: one container per Jira ticket (docs/05-agent-runtime.md).
FROM node:24-bookworm

# GitHub CLI + jq
RUN mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh jq \
 && rm -rf /var/lib/apt/lists/*

# Coding agent CLI(s). Pinned so every ticket runs the same agent.
ARG CLAUDE_CODE_VERSION=2.1.284
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
ENV DISABLE_AUTOUPDATER=1

# Neo4j MCP server: live, read-only graph queries mid-task (docs/10-context-graph.md). Installed at build time
# with uv into /opt so tickets never download it; Python comes from the base image (bookworm, 3.11).
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /uvx /usr/local/bin/
ENV UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin UV_PYTHON_PREFERENCE=only-system
RUN uv tool install mcp-neo4j-cypher==0.6.0 && rm -rf /root/.cache/uv

# Orchestrator (TypeScript run directly by Node 24's type stripping — no build step).
WORKDIR /opt/codecrafter/orchestrator
COPY orchestrator/package.json orchestrator/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY orchestrator/src ./src
COPY rules /opt/codecrafter/rules
COPY scripts/entrypoint.sh /opt/codecrafter/entrypoint.sh

RUN mkdir -p /workspace && chown node:node /workspace
# The per-ticket volume is mounted at /home/node (Claude session + orchestrator state survive restarts).
USER node
WORKDIR /workspace
EXPOSE 8080
ENTRYPOINT ["/opt/codecrafter/entrypoint.sh"]
