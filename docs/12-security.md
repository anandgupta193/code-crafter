# 12 · Security

## Purpose
An autonomous agent with push rights and a model token is a juicy target. This doc sets the rules for keeping the blast radius small.

## Secrets
- Local secrets live **only** in `.env` (gitignored). `.env.example` lists the names with no values.
- **No literal secrets in n8n workflow JSON.** Use n8n Credentials or env references. (The original committed a pipeline trigger token this way; it stayed in git history and had to be rotated.)
- Add a pre-commit secret scan (`gitleaks`, free) before the first code lands.
- The control plane passes each container only the secrets it needs; there's no shared mounted secrets dir.
- Later: Vault, Doppler or SOPS, and on K8s, ExternalSecrets (like the original).

## Token scopes (least privilege)
| Token | Scope |
|---|---|
| GitHub PAT (bot) | Fine-grained, **only the allow-listed repos**: Contents RW, PRs RW, Issues RW, Actions R, Metadata R. No admin, no workflow write |
| Jira | Bot user with access to the code-crafter project only |
| Slack | Bot scopes listed in [01](01-accounts-and-infra.md), no admin scopes |
| Claude | Subscription token. Treat it like a password; rotate by running `setup-token` again |

## Guarding the repo
- **Branch protection on `main`:** PRs required, CI required, at least one human approval. The bot can never merge its own work.
- The bot can't edit `.github/workflows/**`. This is enforced by the PAT (no `workflows` permission) *and* CODEOWNERS, not just the agent rule.
- The harness files are excluded via `.git/info/exclude`.

## Sandbox
- Agent containers run as non-root, with CPU and memory limits and **no docker.sock**.
- `bypassPermissions` mode is acceptable **only** because the container is disposable and holds scoped tokens.
- Later: egress allow-list (GitHub, Jira, Slack, Anthropic, package registries) through a proxy.
- Prompt injection: ticket text, comments and attachments are untrusted. The rules tell the agent never to exfiltrate env vars or change CI, and token scopes enforce what the rules can't.

## Webhooks
- Verify GitHub's `X-Hub-Signature-256` in n8n.
- Slack Socket Mode means there's no inbound endpoint to attack.
- Dedupe by delivery ID.

## Control plane
Mounting `docker.sock` is root-equivalent on the host. Acceptable on a single-user laptop; it goes away with the K8s spawner.

## Accepted risk for Phase 1 (D17)
The hardening above is **deferred**. In Phase 1 the AI process gets the full container env (GitHub, Jira, Claude, Slack tokens), runs as the same user as the orchestrator, and has open network access. This is acceptable only while **the owner is the only person who can create tickets, comment on the PR, or trigger runs**. Revisit (allow-listed env, separate Linux user, secret scan of outgoing text) before that changes.
