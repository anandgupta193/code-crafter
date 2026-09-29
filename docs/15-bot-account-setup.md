# 15 · GitHub bot account setup

## Purpose
Give code-crafter its own GitHub identity. Its commits and PRs are clearly "the bot", its access is limited to the repos it's allowed to touch, and it can never approve or merge its own work.

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
Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token:

| Field | Value |
|---|---|
| Name | `code-crafter-local` |
| Expiration | 90 days (put a calendar reminder to rotate it) |
| Resource owner | **anandgupta193** (the repo owner, not the bot). If it isn't listed, use a **classic** token with the `repo` scope instead, since fine-grained tokens for collaborator repos on personal accounts may not be offered |
| Repository access | Only select repositories → `expense-manager` |
| Permissions | Contents: **Read & write** · Pull requests: **Read & write** · Issues: **Read & write** · Actions: **Read** · Commit statuses: **Read** · Metadata: Read (auto) |
| **Not** granted | Workflows, Administration, Secrets |

Copy the token **once** into `~/Documents/code-crafter/.env` (gitignored) as `GITHUB_TOKEN=...`. Don't paste it into chat, Slack or any file that's committed.

### 4 · Protect `main` (from *your* account)
`expense-manager` → Settings → Branches (or Rules → Rulesets) → add a rule for `main`:
- Require a pull request before merging, with **1 approval**
- Require status checks: **CI / check**
- Don't allow bypassing (optional for you as the owner)

Because the bot has only Write access and needs an approval, it can open PRs but never merge them alone.

### 5 · Commit identity used inside the container
```
git config user.name  "code-crafter-bot"
git config user.email "<bot-id>+code-crafter-bot@users.noreply.github.com"
```
Find the no-reply email under the bot's Settings → Emails. This way commits are attributed to the bot's profile.

## Verification (once the token is in `.env`)
```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user | jq .login
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/anandgupta193/expense-manager | jq .permissions
```
The first should print the bot's username, and the second should show `"push": true` and `"admin": false`.
