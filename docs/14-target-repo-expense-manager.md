# 14 · First target repo: `expense-manager`

## Purpose
Records what code-crafter has to handle for its first real target, and what the repo needs before the loop can work end to end.

**Repo:** https://github.com/anandgupta193/expense-manager (public, default branch `main`)

## What the repo looks like (read on 2026-09-29)
| Aspect | Finding | Impact on code-crafter |
|---|---|---|
| Stack | Next.js 16 (App Router), React 19, TypeScript, Ant Design 6, Tailwind 4, Firebase | Node toolchain only |
| Node | `.nvmrc` = 24, `engines.node >=24` | `codecrafter.yaml` → volta node 24 |
| Scripts | `dev`, `build` (also type-checks), `lint`, `format:check` | The agent verifies with `npm run lint && npm run build` |
| Tests | **None** ("There are no tests yet") | Verification = lint + build + format check |
| Git hooks | husky `pre-commit` → `npx lint-staged` | Needs `npm ci` at boot, or the agent's commits fail. Never use `--no-verify` |
| CI | Only `label.yml` (actions/labeler on `pull_request_target`), and **no `.github/labeler.yml`** in the repo | ⚠️ Likely **fails on every PR**. The agent would get `fix_pipeline` events it isn't allowed to fix (rule: never touch CI). No CI runs build or lint, so the CI-feedback loop has nothing useful to react to |
| Agent config | Has its own `CLAUDE.md` and `.claude/commands`, `.claude/skills` | Our harness **must not overwrite** these (see below) |
| Env | Firebase `NEXT_PUBLIC_*` + AI keys (`.env.local.example`) | `next build` may need placeholder values. The agent gets **dummy** values only, never real keys |
| Branch protection | Can't be read without auth; to confirm | Needed: PR + 1 human approval on `main` |

## Harness coexistence with the repo's own Claude config
The repo already guides Claude Code through `CLAUDE.md` and `.claude/`. That's good: the agent gets the repo's architecture rules for free. So:
- **Don't** write or overwrite `CLAUDE.md` or `.claude/**`.
- Put the code-crafter rules in `.codecrafter/harness/` (listed in `.git/info/exclude`) and pass them with `--append-system-prompt`. The repo's `CLAUDE.md` is then loaded normally, and our workflow rules are added on top.
- This updates [05](05-agent-runtime.md) step 4 and [06](06-agent-runner-abstraction.md): the rules location is per-adapter *and* must never collide with the repo's own files.

## Proposed `codecrafter.yaml` for this repo
```yaml
system:
  setup:
    volta: { enabled: true, node: "24" }
    command: "npm"
    args: ["ci"]
codecrafter:
  agent: { provider: claude, model: sonnet, fallback: [sonnet, haiku] }
  pull_request: { draft: true }
  commands:
    lint: "npm run lint"
    build: "npm run build"
    format: "npm run format:check"
```

## Proposed CI workflow (`.github/workflows/ci.yml`), added by a human
```yaml
name: CI
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run build
        env:            # placeholders so the build doesn't need real Firebase config
          NEXT_PUBLIC_FIREBASE_API_KEY: dummy
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: dummy
```
It's public, so Actions minutes are free.

## Pre-flight changes to the repo (human, before Phase 1c)
1. Add `.github/labeler.yml`, or delete `label.yml`, so PRs aren't born red.
2. Add `ci.yml` above (and confirm `npm run build` works with dummy env).
3. Add `codecrafter.yaml`.
4. Branch protection on `main`: require a PR, the CI check, and 1 approval.
5. Add the bot account as a collaborator (write access).
6. Add the webhook → smee URL (see [01](01-accounts-and-infra.md)).

## Jira
Site: `https://code-crafter.atlassian.net` → `JIRA_BASE_URL`. Project key: **TBD**.
