# Astra → Claude: actual ORION state

Recorded 2026-09-21, Europe/London. Technical transfer only; the user supplies the new mission separately. User explicitly directed Astra to reach this stopping point and stop. **No unattended agent has been enabled.**

## Checkout and evidence authority

- Repository: `/Users/nickmadaio/Desktop/ORION`. Branch: `orion-v2/backlog-checkpoint`.
- Latest implementation: **`18de992`**, disabled project-agent foundation. This handoff is a following documentation checkpoint. Changes are local; no push/merge/deploy performed. `git fetch` succeeded before checkpointing.
- Only unrelated pre-existing dirt: **untracked `capabilities.md`**. Preserve it; provenance unknown. Do not sweep into a commit. Tracked implementation changes were committed.
- Start with root `AGENTS.md`, `HANDOFF.md`, `NICK-TODO.md`; root HANDOFF is current. `docs/planning/v2/HANDOFF.md` is closed historical evidence. This document is a scoped transfer, not another live handoff.
- Live stack: Swift `native/Orion`, TS plugin `plugin/orion-control`, Node/Python CLI wrappers. Historical Python-runtime phase wording does not license a replacement backend or reordered phases.
- Verified gate counts: **46 complete / 25 in progress / 14 not started = 54% of85**. `docs/planning/v2/PHASE_GATES.json` is authoritative. Added only `scopeNotInManifest.entries[id=supervised_local_project_agent]`; no numbered gate closed.
- Existing worktrees: primary checkout; `~/.openclaw/orion-controlled/selfdev-worktree` on `orion-selfdev` (observed HEAD `af62de9`); `.builds/deploy-file-copy-d7d80e8` detached at `d7d80e8`. Preserve all; do not reset/rebase/recreate with `-B`.

## What just landed: `18de992`

| File | Actual responsibility |
|---|---|
| `scripts/lib/orion-project-agent.mjs` | Durable JSON controller foundation; dependency validation, transaction locks, atomic replacement/fsync, task claims, timeout, review gates, progress and controls. Host-supplied fixture adapters only. |
| `scripts/orion-project-agent` | Operator CLI: `status`, `pause --revision N`, `resume --revision N`, `steer --revision N --text TEXT`. No run/init/review/approval CLI. |
| `tests/project-agent.test.mjs` |12 Node tests; independent review verified them. |
| `native/Orion/Sources/Orion/ProjectAgentStatus.swift` | Snapshot decoding, weighted accepted progress, fixed-argv operator control bridge. |
| `native/Orion/Sources/Orion/ProjectTab.swift` | New source-only panel: accepted-work ring, current task spinner/stage, blockers/events/steering, pause/resume. Legacy coder remains separately labeled. |
| `native/Orion/Tests/TodayPlanAppTests/ProjectAgentStatusTests.swift` | Three XCTest methods, not executed under full app target because Xcode license blocks build. |
| `scripts/orion_v2_ci_check.sh` | Now includes project-agent Node suite alongside seven automation suites. |

### Controller contract / constraints

- Production path reserved by CLI/UI: `~/.openclaw/orion-controlled/project-agent/state.json`. **Verified absent at handoff**; no production run initialized. Tests create disposable temporary roots.
- Version1 snapshot: revision, runId, status, activeTask, pauseRequested, maxAttempts, finalReview, tasks, steering, reviews, events. Task contract currently validates id/title/objective/weight/dependencies/acceptance. It is NOT yet a full allowed-file/tool/test execution contract.
- Task states: queued/running/awaiting_review/accepted/blocked. Run states: ready/running/paused/waiting_for_review/interrupted/budget_exhausted/completed.
- `initializeProjectAgent` exclusively creates state; never overwrites. `state.lock` serializes transactions; expected revisions prevent stale control/review writes. Subsequent snapshot publication uses temporary file + rename + file/directory sync.
- `runProjectAgent(root,{worker,verify,durationMs,taskTimeoutMs})` requires trusted adapters. **It performs at most one task per invocation, then stops at review. It is not yet the requested continuously orchestrated worker/reviewer loop.** Dependencies require accepted tasks. Host verify must return strictly true and candidate commit must be40 lowercase hex characters.
- The module does not actually inspect Git or run acceptance commands; fixture `verify` stands in for that future host implementation. A valid-looking SHA alone is not a verified real checkpoint.
- `worker.lock` excludes another controller. Timeout aborts the signal, blocks task with unknown outcome, marks interrupted and deliberately retains lease. No automatic lease deletion, process-owner proof, reconciliation API or process-tree cancellation exists. Do not manually clear it while an unknown worker may survive.
- Pause during task is acknowledged at boundary. Steering queued before a task is handed to its worker and marked applied. Stage currently moves inspect→review, not a complete per-tool execution trace.
- Review APIs are trusted-host functions, not authenticated transport: revision + task ID + exact commit + decision. Local worker receives no review function. Repair requests permit at most2 attempts by default (validated range1–3). Failures block rather than guessing repairs.
- Completion requires all tasks accepted, explicit final review, and no pending steering. Weighted percentage is capped99 until final review. Final pending steering now **blocks closure**, but no disposition/reconciliation API exists yet; leave that explicit for subsequent work.
- `events` is only the latest200 entries inside snapshot, NOT an append-only audit journal. Review receipts remain in snapshot. Duration budget is per invocation, not a persisted overnight-run budget. Resume is not start; nothing supervises/restarts execution yet.
- State validation rejects corrupt lifecycle, invalid attempt limits/commits, inconsistent active task and false completion. This is not tamper-proof storage against a process that can write the host filesystem.

### Review defects repaired before stopping

1. Valid JSON could set finalReview=true with zero accepted tasks and show100%; added lifecycle/invariant validation.
2. Worker resolving after timeout could start host verify; cancellation now checked before verify. Regression asserts verify never starts late.
3. Final review could discard late pending steering; closure now refuses until reconciled.

Independent review confirmed all three fixes,12 tests passed, no remaining blocking finding **within disabled fixture-only scope**. Do not generalize this to a production-sandbox or crash-recovery proof.

## Verification at handoff

- `node --test tests/project-agent.test.mjs`: **12 passed**, also independently rerun.
- `scripts/orion_v2_ci_check.sh --quick`: **OK**,197 security-invariant checks,348 plugin tests,82 automation tests,12 controller tests; type/schema/architectural checks pass. `--quick` skips network dependency audit and does not run installed Mac integration suites.
- `python3 scripts/orion_v2_secret_scan.py --allowlist docs/planning/v2/secret-scan-allowlist.json`: clean,30 reviewed fixtures allowlisted.
- Native `ProjectAgentStatus.swift` typechecked with CommandLineTools/macOS14 target. Three touched Swift files parse. A compiled Foundation-only harness passed6 status/argv checks. **Full SwiftUI typecheck, app XCTest and rendered UI are NOT proven.**
- Full app build exits69 before compilation: **Xcode license not accepted**. User was told to open Xcode and accept its terms. Do not accept legal terms on their behalf or describe this as a source compilation failure.
- Logs: `.builds/project-agent-handoff-2026-09-21/{controller-tests.log,ci.log,secret-scan.log}`; native `.builds/project-agent-ui-2026-09-21/{xcode-build-blocked.log,swift-parse.log,status-check.log,status-check.swift,status-check}`. `.builds` is local evidence, not necessarily remotely backed up.
- Native recheck command: `DEVELOPER_DIR=/Library/Developer/CommandLineTools swiftc -typecheck -target arm64-apple-macosx14.0 -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk native/Orion/Sources/Orion/ProjectAgentStatus.swift`.

## Existing coder: important hazards, not fixed in this checkpoint

Inspect `scripts/orion-code`, `scripts/lib/orion-selfdev-policy.mjs`, `plugin/orion-control/src/self-development-authority.ts`, and `SelfDevelopmentStatus.swift` before reuse.

- Source `GOVERNED_SELF_DEVELOPMENT_ENABLED=false` remains unchanged. The legacy policy wrapper falls back to repository-built policy and checks paths without calling the enablement assertion. **Do not launch the legacy loop as a substitute for the new controller.**
- Legacy coder reuses one worktree, creates it with `git worktree add -B`, does not lock/validate clean ownership, follows target symlinks, and symlinks dependencies to primary checkout.
- Checks can be shell strings. Model-edited code/tests execute with host privileges. A worktree is not a sandbox. Credentials/network/host-file containment is unimplemented.
- `do_task` ignores git add/commit exit codes and still logs checkpoint success. Existing Projects legacy status inherits those claims. No independent acceptance/review gate; local loop chooses backlog itself.
- Queue/status are non-atomic JSON; queue replays retained tasks; budgets checked between potentially long calls; no bounded descendant cancellation or proper recovery. PID existence can misidentify reused PID. Corrupt legacy state can appear never-run.
- Available models observed with `ollama list`: gpt-oss:20b, qwen3.6:27b, qwen3:30b, gemma4:31b, llama3.2:3b, nomic-embed-text. Mac reports48GiB. Legacy default gpt-oss:20b. Historical benchmarks conflict; no fresh inference benchmark performed. Nothing downloaded or started for this work.
- No authorized Astra/cloud reviewer transport has been selected/proven. Do not assume Codex subscription/OAuth is an API credential or worker-accessible review service.

## Previous active work: Phase57 automation, kept intact

- `8ef85c8`: scheduler entrypoint/preview; `04cbc1a`: candidate installed-policy executor; `7354e07`: live read-only host checks; `3c657b8`: message budgets.
- Read `docs/planning/v2/PHASE_57_{SCHEDULE_2026-09-21,RUNTIME_2026-09-20,HOST_2026-09-20,DELIVERY_2026-09-19}.md` and `scripts/lib/orion-automation-{admission,dispatch,host,runtime,schedule,tick}.mjs`.
- `orion-automation schedule-plan NAME --timezone IANA` is read-only. `install` explicitly refuses: obsolete cron flags and bypass path were removed. `orion-automation-run NAME` evaluates current minute through guarded runtime, emits sanitized status only. No disabled-job registration/activation has been built; no new jobs created.
- Current installed cron CLI supports --cron/--tz/--command-argv/--disabled/--exact/--no-deliver, not old --schedule/--timezone. Actual help captured under `.builds/phase-57-schedule-2026-09-20/`.
- Runtime supports only agenda_today, existing installed identity/ledgers, no production sender. Read-only host proof: guarded mode, inactive focus, agenda eligible, standing refused. Check/spawn is non-atomic; kill of direct subprocess does not prove descendants stopped.
- Phase57 next gate remains human-only transactional policy+ledger registration, disabled-job exact verification, activation and disposable full-route proof.82 automation tests pass; no phase completion claimed.

## Installed state / things to preserve

- Last recorded installed Mac app1.2.0 build232; plugin deployment `d7d80e8`, fingerprint `e0fbbeb7ab40`,114 actions/5 profiles. These values were NOT freshly audited for this handoff; verify before deployment claims.
- Previous deployment rollback: `~/.openclaw/backups/orion-control/20260918-035928`, also `.builds/phase-47-76-2026-09-17/rollback/20260918-035928`.
- Phase47 installed copy/collision proof exists; Trash recovery remains open. Human-only ticket A-QZV3 expired ungranted; “continue” did not grant it. Do not delete retained copy-proof fixtures or approve on user's behalf.
- Preserve `~/.openclaw/orion-controlled/today-plan.json`; last verified revision8, SHA256 `a4111fae45135cfc2bd14b48b07f761df286bb63b2de5cdd11c707779ff0a5b1`. No personal-state/config/permission writes in this checkpoint.
- Never change app signing identity, ad-hoc sign the user's build, rewrite published history, force-reset existing worktrees, sweep unrelated files, or count fixture tests as installed behavior. Root AGENTS has exact identity and checkpoint requirements.

## Immediate resumption checks

1. Read this file and `git status`, verify `18de992` plus the handoff commit. Preserve capabilities.md.
2. Confirm Xcode license gate, then compile/test the native changes normally before deployment. UI controls use fixed absolute path `/Users/nickmadaio/Desktop/ORION/scripts/orion-project-agent`, poll every5s, surface errors; no start/init control. The running label reflects a snapshot, not a verified heartbeat.
3. Review controller/Swift schema together. UI decoding validates only its display subset; controller performs fuller lifecycle validation. No real state exists to demonstrate controls yet.
4. Follow the separately supplied mission. Treat real execution boundary, trusted worker/verification, persistent supervision/recovery, complete task contracts/audit, and actual reviewer connection as missing implementation—not completed capabilities.

No running local-model development session, background automation, new recurring service, cloud-review session, app installation or outbound notification was created. Astra stopped here as requested.
