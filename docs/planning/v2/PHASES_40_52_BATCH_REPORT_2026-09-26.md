# Phases 40–52: batch report

Written 2026-09-26. The session ran from 2026-09-25 into the early hours of the 26th.

Nick asked for "the next 10 phases". This is the review, repair and checkpoint
record the AGENTS.md batch protocol requires. Phase state lives in
`PHASE_GATES.json`; this file explains it.

## Where each phase stands

| Phase | State | In one line |
|---|---|---|
| 40 | closed | ORION re-homed to London (live, `orion-timezone set Europe/London`). |
| 43 | closed | Owner re-authentication (Touch ID or password), needed to release a lock or relax a mode. |
| 44 | closed | All requirements already passed; its entry opened once 43 closed. |
| 46 | closed | Cancel from the phone, optional arguments visible to the model, timeout retry. |
| 47 | closed | Deletion recoverable from the Trash, proven against the real `~/.Trash` through the installed plugin, with `orion-undo`. |
| 48 | open | Per-turn binding: passed. Tamper protection: done for the bridge; for the plugin it is not a prevention (see below). The broker split and signing are blocked on Nick. |
| 49 | open, not started | iPhone approval with Face ID, device-key signatures, and Mac-side verification. The transport isn't live. |
| 50 | requirements pass | Delegations carry resources (`orion-mode --within`). Can't close until 49 does. |
| 51 | requirements pass | The bare `git` allowlist entry is retired (live, with Nick's yes). Can't close until 49 and 50 do. |
| 52 | built, flag off | `terminal_run` with in-app Allow once / Allow for this chat / Deny. Needs Nick to accept the gate amendment (in-app confirmation instead of Face ID). |

## What was built, and why that way

- **Cancellation (46).**
  - A running action is listed in `actions/running/`.
  - A cancel mark is checked before every step. The step in flight finishes, because a half-killed step is the one state the repair engine can't reason about. `terminal_run` is the exception and is killed.
  - Reached from Discord with `actions` / `action cancel <id>`, and from the Mac panel's Stop.
  - Rejected alternative: killing any step mid-flight.
- **Optional arguments (46).** `optionalArguments` in the catalog is the one source. It feeds both the tool description and TOOLS.md.
  - Hash arguments are deliberately not advertised; the host fills them.
- **Timeout retry (46).** At least one retry, but only for reads and set-to-a-state actions.
  - A toggle retried after a timeout undoes itself, so toggles are excluded.
- **Trash recovery (47).** `scripts/orion-undo` reverses what the ledger records. It never overwrites, is audited, and is a person's tool: it is not on ORION's allowlist.
- **Owner re-authentication (43).**
  - LocalAuthentication in the bridge binary (`authenticate --reason`).
  - Used by `orion-lock release` and every `orion-mode` relaxation.
  - The test seam is honoured only when HOME is not the real home.
- **Integrity (48).**
  - SHA-256 manifests in `~/.openclaw/orion-gate/integrity`, written only by the installers.
  - launchd starts the bridge through a verifier kept outside the copy it guards.
  - The plugin checks itself at load.
- **Per-turn binding (48).** For an irreversible or critical action, a target that must come from a person's words has to be in the requesting turn, or in the confirmation just before it.
- **Resources (50).** A delegation can be scoped to folders. A target outside them is raised back to asking.
- **Raw terminal (52).**
  - One zsh command per approval: 2-minute limit, 20 KB output cap.
  - Stop kills the process group.
  - Nick's decision replaced Face ID with the chat-app choice (Allow once / Allow for this chat / Deny), in the Mac panel and `orion-approve --chat`.
  - Flag `enableRawTerminalActions` is off by default and is still off.

**The broker (48) was not built as code, deliberately.** A broker running as the same macOS user adds no boundary. It needs a second macOS user, or a `sandbox-exec` profile around the gateway. Both are admin changes, so they are Nick's call.

## Independent review, and what it changed

A reviewer that saw only the code and the source requirements found:

- 3 CRITICAL
- 6 HIGH
- 7 MEDIUM
- 5 LOW

The most serious was **live before this batch**.

### CRITICAL

- **C1: ORION could rewrite his own safety scripts without approval.**
  - The Desktop root contains the repo, and `desktop_file_write_explicit` needs no approval. So ORION could rewrite `scripts/orion-remote` (on his exec allowlist) or `scripts/orion-approve` (what the app's Allow button runs).
  - **Repaired:** `protected-paths.ts`. No file action may write, move, rename or delete anything under `~/Desktop/ORION`, `~/.openclaw` or `~/Library/LaunchAgents`. Moving a folder that contains one of them is refused too.
- **C2: the approval card never showed the command or the file.**
  - **Repaired:** the command and folder are shown whole, never cut. File targets are named. The panel scrolls long commands, and labels the model's goal line "ORION says".
- **C3: one approved command could grant itself standing shell access.**
  - **Repaired:**
    - `terminal_run` runs under `sandbox-exec`, which denies writes to every protected path. This was verified live, including for backgrounded children.
    - It gets a minimal environment, and its output is redacted before it is recorded.
    - A chat grant is capped at 8 hours from when it was given, and must trace to a real grant record.

### HIGH

- **H1: Stop re-ran the command** (3 runs with a retry budget of 2).
  - **Repaired:** no retry once a stop is asked for. Critical actions, and irreversible actions that needed approval, are never retried. A stop mid-step is recorded as a cancellation.
- **H2: a command copied from a web page ran under a chat grant.**
  - **Repaired:** `command` and `cwd` are taint-checked like file paths and recipients.
- **H3: "this chat" is ORION's one conversation, shared by the app, voice and Discord.**
  - **Partly repaired:** `orion-approve revoke-chat` withdraws all chat grants, and `orion-lock` withdraws them too. The shared scope is now said plainly when the approval is given.
  - **Still open:** binding a chat grant to one surface.
- **H4: one approval could run twice** (a race, or identical steps).
  - **Repaired:** the rename that spends the grant is the gate. Identical approval-gated steps can't share one grant.
- **H5: the integrity check could be bypassed.**
  - **Partly repaired:**
    - The whole extension is hashed (package.json, manifest, node_modules: 1,464 files).
    - The installed copy fails closed when no manifest exists.
    - Deploy empties dist before copying.
    - A backup that did not verify is marked UNVERIFIED and never re-recorded as trusted. orion-repair does the same.
  - **Not repairable here:** a check inside the plugin can't catch the plugin being replaced. That is why the requirement is marked **blocked**.
- **H6: bare `env` and `find` are still on the main agent's exec allowlist.**
  - Either could launch other programs (`env CMD`, `find -exec`). **Not changed.** It is a live config change and needs Nick's yes, as `git` did.

### MEDIUM

- **M1:** briefings could count as "the requesting turn". **Repaired:** they are stripped first. The rule's reach is now described accurately in the gate record.
- **M2:** resources only scope file actions that carry a path; fixed-root actions fail closed. **Recorded as a limit.**
- **M3:** `orion-mode` could widen scope without Touch ID. **Repaired:** dropping or widening `--within`, or `--clear-never`, needs the owner. A same-mode scope change is written instead of answered "Already". `contained` never asks.
- **M4:** `orion-lock` didn't stop running actions. **Repaired.**
- **M5:** the terminal inherited the gateway's environment. **Repaired** (see C3).
- **M6:** `orion-undo` trusted any path in the ledger. **Repaired:** it only moves things within the home folder, never into protected places, refuses symlinks, and verifies a copy's hash before trashing it.
- **M7:** the Phase 47 proof ran the repo build. **Repaired:** `--live` runs the installed plugin. The stale limitations were corrected.

### LOW

- **L1:** `kill(0)` when there is no pid. **Repaired.**
- **L3:** `dist/v2` was never redeployed. **Repaired**, which the new empty-dist-first deploy needed anyway.
- **L4:** a grant-file collision was reported as success. **Repaired.**
- **L2:** a command can detach and outlive its limit. **Recorded;** the sandbox still contains what it can write.
- **L5:** the cancel path depends on matching config. **Recorded.**

## Proofs, as run

- **Plugin:** 374/374 tests. This includes `review-repairs.test.ts` (9), one test per repaired finding.
- **`orion-deploy`:** all seven suites OK. The gateway loads the plugin with 115 actions and 5 profiles. Integrity reads "unchanged" 20 seconds after load.
- **Checks:** lock, reauth (12), strictness (34), remote, integrity, and trash recovery in both modes (11/11, `--live` through the installed plugin).
- **Mac app:** rebuilt (binary checked newer than the edit), 4/4 approvals tests, signature verified, running.
- **Secret scan:** clean with the reviewed allowlist.

## Rollback

- **Plugin:** `orion-deploy --rollback`. The newest backup (`20260926-004141`) is marked UNVERIFIED, only because the old manifest covered `dist/` alone. Rolling back to it restores it, but deliberately does not re-record it; run a deploy afterwards.
- **App:** `/Applications/.Orion-previous-275-pre-approvals-20260926.app`.
- **Phase 51:** `~/.openclaw/exec-approvals.json.pre-phase51-20260925-211108`.
- **Gates:** the pre-batch copy of `PHASE_GATES.json` is identical to HEAD.

## What was left out of the checkpoint commit

`scripts/orion-remote`, `scripts/orion-remote-bridge`, `scripts/orion_v2_remote_check.sh` and `scripts/orion_v2_ci_check.sh` are not in the commit. They are deployed and working, but uncommitted.

The reason is that this batch's `action` verb is woven through the same hunks as earlier uncommitted work: the Discord channel and the development-agent `agent` verb. The lock exception is one line serving both. Splitting them would have committed a state that never ran.

`orion-remote-install` and `DashboardView.swift` were committed partially: this batch's hunks only.

## Decisions waiting on Nick

1. Turn on `enableRawTerminalActions`? It is off. The repairs above are what make that reasonable.
2. Accept the Phase 52 gate amendment: in-app confirmation instead of Face ID.
3. Remove bare `env` and `find` from the main agent's allowlist (H6)?
4. Phase 48's broker: a second macOS user, or a `sandbox-exec` profile around the gateway. Both need admin. Signing was deferred at $99/yr.
