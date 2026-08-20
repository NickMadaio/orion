# AGENTS.md — shared ground truth for coding assistants

For any AI working on this repository: Claude Code, ChatGPT/Codex, or anything
else. One file, so two assistants do not hold two different beliefs about how
this thing is built.

Not to be confused with `openclaw-workspace/AGENTS.md`, which is Orion's OWN
runtime instructions — how the assistant behaves when it is running. This file
is about the codebase.

Companion docs: `HANDOFF.md` (running log of completed work), `OVERNIGHT-LOG.md`,
`planning/` (design docs), `native/Orion/README.md` (the app itself).

Current ORION v2 state and exact continuation steps live in
`planning/v2/HANDOFF.md`. Read it before changing v2 contracts or the OpenClaw
integration, and preserve the shared dirty worktree.

Last updated 2026-08-20.

---

## Relay protocol

Two assistants work on this repo and neither sees the other's chat. These files
are the entire channel, so treat them as the job rather than the paperwork.

**Read before you touch anything:** this file, `HANDOFF.md`, `NICK-TODO.md`, and
`planning/v2/HANDOFF.md` if the work is v2.

**A handoff's date is when it was written, not when the work stopped.** This has
already cost a session. On 2026-08-19 Codex wrote its handoff at 18:32, kept
working until 18:47, and then hit zero credits — so the file listed as "next" a
slice that was already built, tested, installed, and proven live. Never take the
last write as the end of the work. Verify against the machine:

```bash
git log -1 --format='%H %ci %s'          # what is actually committed
git status --short                        # this tree is always dirty; that is normal
find . -newermt "<handoff date>" -not -path './.git/*' -not -path './.build/*'
tail -5 ~/.openclaw/logs/config-audit.jsonl        # live config changes, with argv
gzcat ~/.openclaw/orion-controlled/archive/ledger-*.jsonl.gz   # what actually ran
ls -lat ~/.codex/sessions/*/*/*/rollout-*.jsonl | head          # Codex's own tool log
```

That last file is the good one. The auto-review thread inside it carries the main
agent's full numbered transcript — every command, every result — so you can
recover exactly where a dead session stopped instead of guessing.

**Write before you finish.** Append a dated section to `HANDOFF.md` (newest
first, and `planning/v2/HANDOFF.md` too for v2 work) covering:

- what state you found, and where the previous session's record was wrong;
- what changed and why, including alternatives you rejected;
- verification — actual numbers and command output, not "tests pass";
- live/installed state: what is running, what flags are set, what was deployed;
- the rollback path, in the repo (`.builds/`), never in `/private/tmp` — that
  path does not survive a reboot;
- the exact next step, and which shared files it needs.

An entry that only says what you did is half an entry. The next assistant needs
the state of the world, because it cannot ask you.

---

## The one invariant

**The app's code-signing identity must never change.** Everything else here is
detail; this is the thing that breaks users.

macOS binds TCC permissions (microphone, accessibility, speech) to the app's
*designated requirement*:

```
identifier "com.nickmadaio.orion.app" and certificate leaf = H"171a72ab4922a629de353811e065ce2c5820ac09"
```

Ship a build whose requirement differs by one byte and macOS treats it as a
different application. Every permission resets, every stored token becomes
unreadable, and a second "Orion" appears in Privacy & Security. The user did
nothing wrong and gets no explanation.

Consequences you must respect:

- **Never ad-hoc sign.** `make_app_bundle.sh` now hard-fails rather than falling
  back. `--allow-adhoc` exists for throwaway builds and must never be used for
  anything a user will run.
- **Never casually regenerate the signing certificate.** A new certificate is a
  new identity and resets everything. It is sometimes necessary (see expiry
  below) but it is a decision, not a step.
- **Check before shipping:** `scripts/orion-identity-check` compares a built
  bundle's requirement against the installed app. Exit 0 = safe. Anything else
  means do not publish.

### The Keychain does NOT work this way — measured 2026-08-18

TCC survives rebuilds. **Keychain ACLs do not.** Legacy (file-based) Keychain
items bind their ACL to the specific BINARY, not to the signing identity. Proven
with two binaries compiled from near-identical source, signed with the same
certificate and identifier, differing only in cdhash: the second one was
prompted for an item the first one created.

So every new build prompts once per stored secret — roughly fifteen dialogs —
and "Always Allow" only whitelists that one build. This is the "million Keychain
permissions" problem and the signing certificate does not fix it.

The prompt-free path is the data-protection Keychain
(`kSecUseDataProtectionKeychain`), which is entitlement-gated rather than
ACL-gated. It is **unavailable to a self-signed app**, also measured: claiming
`keychain-access-groups` gets the process SIGKILLed by the kernel, and without
that entitlement every data-protection call returns `-34018`. It needs a real
Apple team identity (Developer ID).

Do not repeat these experiments casually — each one costs the user a dialog.

**The certificate expires 2027-07-31.** The build warns from 90 days out and
refuses to build after. Renewal costs one permission reset, so plan it.

---

## Layout and commands

| Thing | Where |
|---|---|
| The Mac app (Swift, SwiftPM) | `native/Orion/` |
| Pure domain logic, no I/O | `native/Orion/Sources/SessionDomain/` |
| State files, history, locks | `native/Orion/Sources/SessionService/` |
| The OpenClaw plugin | `openclaw-plugins/orion-control` |
| Runtime data the app reads/writes | `~/.openclaw/orion-controlled/` |
| App log | `~/.openclaw/logs/orion-app.log` |

```bash
# Build a signed .app bundle (also stamps version + verifies the signature)
native/Orion/make_app_bundle.sh

# Install it
cp -R native/Orion/.build/Orion.app /Applications/

# Unit tests — 318 of them. Use THIS, not `swift test`.
native/Orion/Tests/run-domain-test.sh

# End-to-end update test (builds, signs, serves, installs, asserts)
native/Orion/Tests/run-update-test.sh
native/Orion/Tests/run-update-test.sh --tamper   # must REFUSE
```

`swift test` fails with "no such module 'XCTest'" because `xcode-select` points
at CommandLineTools. The wrapper sets `DEVELOPER_DIR` for one invocation. Do not
"fix" this by changing the machine's active developer directory.

---

## Versioning

- `native/Orion/VERSION` holds the semantic version (currently **1.2.0**), read
  at bundle time.
- `CFBundleVersion` is `git rev-list --count HEAD` (currently **118**). It only
  ever goes up. **Do not rewrite published history** — the build number would go
  backwards and updates would stop being offered.
- `ORION_VERSION`, `ORION_BUILD_NUMBER`, `ORION_BUNDLE_OUT` override all of this,
  for the release script and the update test only.

---

## Auto-updates (Sparkle)

Added 2026-08-18. Sparkle **2.9.6** via SwiftPM — the only third-party
dependency in a package that is otherwise Apple-frameworks-only. That was a
deliberate exception; do not treat it as precedent.

- `Sources/Orion/UpdateController.swift` — the updater and its policies.
- The framework is embedded and signed **inside-out** by `make_app_bundle.sh`
  (XPC services → Updater.app → Autoupdate → framework → app). Signing the app
  first seals a hash of its contents, so anything signed afterwards invalidates
  it. The build verifies with `codesign --verify --deep --strict` and fails if
  the order was wrong.
- EdDSA public key lives in `Resources/Info.plist` as `SUPublicEDKey`
  (`XpJLRMEJj6NI7CBHBI1JNhIWr8UG94GDXywVw6YMgHI=`). **The private key is in
  Nick's login Keychain and is not backed up yet.** Losing it means never
  shipping an accepted update again.

Two policies that are not Sparkle defaults, both load-bearing:

1. **Nothing on the launch path.** The updater starts 30s after launch. This app
   has already lost an afternoon to a launch path that waited on securityd; an
   update check reaches the network, which can hang without erroring.
2. **Never interrupt an active focus session.** Checked before a check runs and
   again before the relaunch. Gated on `.running` specifically — *not*
   `snapshot().isRunning`, which stays true for `waitingForReturn` indefinitely.
   Postponement has a six-hour ceiling, because "wait for a good moment" is one
   stuck state away from "never".

### Not done yet

- **No rollback if an update crashes on launch.** Sparkle will not catch this.
  `scripts/orion-forge` already solves the shape locally — keep
  `Orion-previous.app`, verify the launch, restore if it dies — and that pattern
  should be carried into the update path before anyone else installs Orion.
- **No feed.** `UpdateController.defaultFeedURL` is a placeholder
  (`ORION_OWNER/ORION_REPO`) and 404s, so a real "Check for Updates" fails today.
  Needs a GitHub repo, an appcast, and one published release.
- **No release script** yet. It must gate on: clean tree, tests green, identity
  check, deep signature verify.
- Not notarized, so the app is Gatekeeper-blocked for anyone but Nick. Public
  distribution needs a Developer ID (Apple Developer Program, $99/yr). The design
  keeps that a configuration change rather than a rewrite.

---

## Traps that have already bitten, do not reintroduce

- **`set -euo pipefail` + `grep`.** A `grep` that matches nothing exits 1 and
  kills the script mid-assignment. This silently made the ad-hoc warning path in
  `make_app_bundle.sh` unreachable. Use `|| true` on pipelines whose emptiness is
  a legitimate outcome.
- **Ad-hoc bundles print their requirement commented**: `# designated => cdhash
  H"..."`. Parsers must accept both spellings or they misreport the one case that
  matters.
- **Sparkle delegate callbacks arrive on the main thread.** `DispatchQueue.main.sync`
  inside one is an instant deadlock.
- **Sparkle installs on quit by default.** A menu-bar app that starts at login may
  never be quit, so the update downloads and silently never lands.
- **Whoop pagination returns 401 on page 2**, reproducibly, on a token that just
  served page 1. `WhoopClient` therefore fetches two fixed windows (7d and 35d)
  rather than following `next_token`. A data-fetch 401 must never clear the
  grant — renew and retry once first, because clearing it disconnects the user.
- **`log` is a shell builtin in this environment.** `log show ...` silently fails
  with "too many arguments" — any assertion built on it passes vacuously. Use
  `/usr/bin/log` explicitly. This invalidated a "no permission prompts appeared"
  test result and led to a wrong conclusion that the Keychain problem was solved.
- **A default-off bridge that can throw is not default-off.** The v2
  `system_status` adapter validated its contract *before* calling the legacy
  route and threw on a mismatch, so turning the flag on could refuse a call that
  works with it off — `system_status` declares `requiredArguments: []` and the
  validator rejects no unknown key, so an extra argument is a normal call. An
  observer that is allowed to fail the action is not an observer. Anything that
  should *deny* belongs in the validator and the permission profile, which
  already own that authority.
- **Missing health data is not zero.** `SessionDomain/DayScore.swift` excludes
  absent inputs and redistributes their weight. Scoring a missing input as zero
  tells the user they had a bad day because a watch did not sync.

---

## Version control

**This repo has a remote as of 2026-08-20: `github.com/NickMadaio/orion`,
private.** Before that date nothing left the machine — no remote, no backup, and
the project lived in four folders that did not know about each other. They are
one tree now:

| Was | Is now |
|---|---|
| `~/Desktop/ORION` | repo root |
| `~/orionBrain` (Obsidian vault) | `brain/` |
| `~/orion-privacy` | `web/privacy/` |
| `~/Orion Controlled Test Workspace` | `tests/workspace/` |

The originals still exist on disk; they were copied, not moved. **The repo is
authoritative.** Editing `~/orionBrain` does not reach GitHub, and a session
that reads that folder is reading a stale fork of `brain/`.

Full workflow, including branch layout and the secret-scanning rules, is in
`.claude/skills/orion-git/SKILL.md`. Claude Code loads it as a skill; anything
else should just read the file.

### You may push and pull without asking

This reverses the rule that was in House rules below, which predates the remote
existing. `gh` is authenticated on this machine through the browser flow (set up
2026-08-20), so `git pull`, `git push`, and `git fetch` work with no token and no
prompt. Use them.

If auth breaks: `gh auth login` → GitHub.com → HTTPS → Yes → browser. Never a
personal access token in a URL or a config file.

What did not change: **the dirty tree is usually not yours.** Stage deliberately
with `git add <paths>` rather than `git add -A`, unless you have checked
`git log` and confirmed the whole tree is your work.

### Never rewrite published history

This was already a rule (see Versioning) and the remote makes it binding.
`CFBundleVersion` is `git rev-list --count HEAD` — **122** as of writing.
Sparkle offers an update only when that number goes up. Rewriting history makes
it go down, and every installed copy of Orion silently stops updating, with no
error and no symptom until someone notices they are months behind.

Banned on any pushed branch: `push --force`, `push --force-with-lease`,
`rebase`, `commit --amend`, `reset --hard` to an older commit, `filter-branch`.
If history genuinely has to change, that is a conversation with Nick.

---

## House rules

- **Committing and pushing is allowed** as of 2026-08-20 — see Version control
  above. The caution that came with the old rule still stands: something else in
  this repo commits on its own schedule (a commit landed 2026-08-18 22:11 that no
  session here authored), so check `git log` before assuming the tree is yours.
- The working tree usually has uncommitted changes that are not yours. Builds
  include them. A release must require a clean tree.
- Hooks are active (see `~/.claude/settings.json`): git-push review, doc
  blocking, auto-format, console.log audit.
- Prefer many small files over few large ones; 200–400 lines typical.
- Comments here explain *why*, especially why an obvious alternative was
  rejected. Match that; do not strip it.
