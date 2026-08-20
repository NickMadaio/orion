---
name: orion-git
description: Git and GitHub workflow for the Orion repo. Use before any commit, push, pull, branch, or history operation in this repository, and when a session starts and you need to know whether the working tree is yours. Covers the remote at github.com/NickMadaio/orion, the branch layout, why history must never be rewritten, and the secret-scanning rules.
---

# Orion git workflow

This repo got a remote on 2026-08-20: **`github.com/NickMadaio/orion`, private.**
Before then it was local-only. Most of the traps below exist because that
changed.

## Start of session: is this tree yours?

The working tree is usually dirty and the changes are usually **not yours**.
Two assistants and a scheduled job all write here. Before you touch anything:

```bash
git log --oneline -5                      # what actually landed, and when
git status --short                        # dirty is normal, not an error
git log -1 --format='%H %ci %s'           # last commit's real timestamp
git fetch && git status -sb               # ahead/behind the remote
```

If you are behind, `git pull` before you start. Diverging from `origin` and
discovering it at push time wastes a session.

## Pushing and pulling

**You may push and pull without asking.** This reverses the old rule, which
predates the remote existing.

`gh` is authenticated on this machine through the browser flow (set up
2026-08-20). No token, no prompt, no credential in any file:

```bash
git pull
git push
git push -u origin <new-branch>
```

If auth ever breaks, the fix is `gh auth login` → GitHub.com → HTTPS → Yes →
browser. Never a personal access token in a URL or a config file.

What did *not* change: commit your own work, not the ambient dirt. Stage
deliberately — `git add <paths>`, not `git add -A` — unless you have confirmed
the whole tree is yours.

## Never rewrite published history

`CFBundleVersion` is `git rev-list --count HEAD` (`git rev-list --count HEAD`
to see it now). Sparkle offers an update only when that number goes up.

Rewriting history makes it go *down*, and every installed copy of Orion
silently stops updating. There is no error message and no user-visible symptom
until someone notices they are months behind.

Banned on any branch that has been pushed:

```
git push --force            git push --force-with-lease
git rebase                  git commit --amend
git reset --hard <older>    git filter-branch / filter-repo
```

Locally this used to be recoverable. With a remote and shipped builds it is
not. If history genuinely has to change, that is a conversation with Nick, not
a command you run.

## Branches

| Branch | What it is |
|---|---|
| `main` | Default. The consolidated repo. Work here unless told otherwise. |
| `orion-v2/phase-0-inventory` | v2 work. Was the active branch pre-consolidation. |
| `orion-v2/source-checkpoint-20260818` | Frozen snapshot. Do not build on it. |
| `master` | Pre-v2 history. Kept for reference, not active. |
| `claude/affectionate-gauss-5c9cbc` | Old agent branch. Merge or delete when someone confirms it is dead. |

## Secrets

`.gitignore` covers `.env`, `.env.*` (except `.env.example`), `data/orion.db`,
`.claude/settings.local.json`, and the big vendored trees. Check it before
adding anything that holds a credential or machine-local state.

All 122 commits were scanned on 2026-08-20 and are clean. **One known false
positive** — do not "fix" it:

`openclaw-plugins/orion-control/src/index.test.ts` (and its `dist/` twin)
contains the literal string `-----BEGIN RSA PRIVATE KEY-----` inside a test
asserting that Orion *refuses* to transmit credentials. That is the test doing
its job.

The repo being private is not a substitute for the ignore rules. Private repos
get shared, forked, and made public by accident.

## The tree is bigger than it looks

Four folders were merged into this repo on 2026-08-20:

| Was | Is now |
|---|---|
| `~/orionBrain` (Obsidian vault) | `brain/` |
| `~/orion-privacy` | `web/privacy/` |
| `~/Orion Controlled Test Workspace` | `tests/workspace/` |

The originals still exist on disk — they were copied, not moved. **The repo is
authoritative.** Editing `~/orionBrain` does not reach GitHub, and a future
session reading that folder is reading a stale fork of `brain/`.
