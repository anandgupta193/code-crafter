# 15 · GitHub bot account setup

## Purpose
Give code-crafter its own GitHub identity. Its commits and PRs are clearly "the bot", its access is limited to the repos it's allowed to touch, and it can never approve or merge its own work.

## Actual bot
- Username: **`codecrafterbot`** (user id `335623999`)
- Commit identity: `codecrafterbot <335623999+codecrafterbot@users.noreply.github.com>`
- There is no "mark as bot" setting for user accounts. The `[bot]` badge only exists for GitHub Apps. A machine user is a normal account; label it through its profile name and bio.

## Steps (you do these; they involve signing up and handling credentials)

### 1 · Create the account
1. Sign out of GitHub, or use a private browser window.
2. Sign up at github.com/signup with:
   - **Username:** e.g. `code-crafter-bot` (or `anandgupta193-bot`, whichever is free)
   - **Email:** a Gmail plus-address works and lands in your inbox: `aanand.gupta03+codecrafter@gmail.com`
3. Verify the email and **turn on 2FA** (Settings → Password and authentication).
4. Optional: set a profile name like "Code Crafter Bot" and an avatar so it's recognisable in PRs.

> GitHub's terms allow one free "machine user" account per person for automation, as long as you're responsible for it.

### 2 · Give it access to the repo (from *your* account)
`expense-manager` → Settings → Collaborators → **Add people** → the bot username → role **Write**.
Accept the invite from the bot account (check the bot's email or github.com/notifications).

### 3 · Create the bot's token (from the *bot* account)
Use a **classic** token. Fine-grained tokens can only reach repos owned by the bot or by its organizations, not repos on another user's account where it's a collaborator.

github.com/settings/tokens → Generate new token (classic):

| Field | Value |
|---|---|
| Note | `code-crafter-local` |
| Expiration | 90 days (rotate with a reminder) |
| Scopes | **`public_repo` only**. expense-manager is public; use `repo` only if a private target is added |
| **Not** granted | `workflow` (GitHub then rejects pushes touching `.github/workflows/**`, which enforces "never touch CI"), `admin:*`, `delete_repo` |

Effective reach = repos where the bot is a collaborator (only expense-manager).

Store it only in `~/Documents/code-crafter/.env` (gitignored, `chmod 600`) as `GITHUB_TOKEN=...`. Never paste it into chat, Slack or a committed file.

### 4 · Protect `main` (from *your* account)
`expense-manager` → Settings → Rules → Rulesets → New branch ruleset:
- Name `protect-main`, Enforcement **Active**
- Bypass list: **Repository admin**. You're the only maintainer, and GitHub won't let you approve your own PRs, so you need this to merge your own work.
- Target branches: **Include default branch**
- Rules: Restrict deletions · Block force pushes · Require a pull request (1 approval, dismiss stale approvals) · Require status checks → `check` (from GitHub Actions)

The bot has only Write access, isn't on the bypass list, and can't approve its own PRs, so it can open PRs but never merge them. You approve and merge them.

### 5 · Commit identity used inside the container
```
git config user.name  "codecrafterbot"
git config user.email "335623999+codecrafterbot@users.noreply.github.com"
```
Find the no-reply email under the bot's Settings → Emails. This way commits are attributed to the bot's profile.

## Verification (once the token is in `.env`)
```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user | jq .login
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/anandgupta193/expense-manager | jq .permissions
```
The first should print the bot's username, and the second should show `"push": true` and `"admin": false`.
