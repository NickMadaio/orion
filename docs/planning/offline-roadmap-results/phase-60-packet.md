# Phase 60: Focus Sessions — Evidence Packet

## Baseline

| Item | Value |
|------|-------|
| Commit | 9855d99 (2026-09-26) |
| Inspected paths | `scripts/orion-focus`, `native/Orion/Sources/Orion/FocusSessionHome.swift` |
| Limits | No installed Mac access; native Swift checks not registered. Evidence drawn from source inspection only. |

## Requirement matrix

| Req ID | Status | Source symbol / evidence | Notes |
|--------|--------|--------------------------|-------|
| `creates_focus_sessions_connecting_task_and_mac_workspace` | Built | `scripts/orion-focus`: `start` command writes session to `~/.openclaw/orion-controlled/focus.json`; `check` command (cron-driven) reads frontmost app via `lsappinfo`, compares against `allowedApps`, re-focuses via `open -a`. Enforcement loop in `check` case, strike escalation at lines ~260-310. | Cron-based enforcement; refocus-not-quit strategy confirmed in source header and `raise()` function. |
| `connects_a_calendar_block_and_notification_preferences` | Built | `scripts/orion-focus`: `next` command calls `orion-agenda upcoming --json`, parses events, binds session `until` to block's end time (line ~200). Notifications via `setFocusMode()` calling `/usr/bin/shortcuts run "Orion Focus On/Off"` (lines ~100-115). Missing shortcut produces warning, not failure. | Calendar BLOCK binding confirmed; Shortcut-based notifications with graceful degradation. |
| `orion_prepares_required_applications_files_and_project_context` | Built | `scripts/orion-focus`: `prepare()` function (lines ~130-175) opens apps via `open -a`, runs `git status --short --branch` and `git log --oneline -5` against repo from Phase 51 table, reads agenda via `orion-agenda today`. Three operations only: APPLICATIONS, PROJECT, CONTEXT. | App launch idempotent; git ops read-only; calendar blind spot reported not absorbed. |
| `does_not_begin_work_on_the_mac_without_proper_permissions` | Built | `scripts/orion-focus`: header comment (lines 1-30) states no new permissions needed. `frontmostApp()` uses `lsappinfo` (no TCC), `raise()` uses `open -a` (no TCC), `speak()` uses `/usr/bin/say` (no TCC). No Automation permission required for enforcement. | Confirmed in source: all three system calls need no additional TCC grant. |

## Architecture and interfaces

**Producer**: `scripts/orion-focus` (Node.js/ESM) — orchestrates session lifecycle via subcommands (`start`, `next`, `check`, `plead`, `end`, `prepare`, `status`). State persisted to `~/.openclaw/orion-controlled/focus.json`.

**Consumer (native UI)**: `native/Orion/Sources/Orion/FocusSessionHome.swift` — SwiftUI view overlaid on `DashboardView` when `state.sessionTabModel.isActiveFocus` is true. Driven by `SessionTabModel` (`native/Orion/Sources/Orion/SessionTabModel.swift`, line 78), which owns session state, guard configuration, and media controls.

**Consumer (macOS environment)**: Cron job calls `orion-focus check` every minute. System tools: `lsappinfo` (frontmost app), `open -a` (raise window), `/usr/bin/say` (speech), `/usr/bin/shortcuts` (Focus mode toggle).

**Seam**: The enforcement seam is the cron-triggered `check` command in `scripts/orion-focus`. It reads frontmost app via `lsappinfo`, compares against `session.allowedApps`, increments strikes on drift, and re-focuses via `raise(session.anchor)` using `open -a`. Strike escalation: strike 1 speaks once; strike 2 speaks with shorter cooldown; strike 3+ raises the anchor app. Cooldowns prevent car-alarm behavior (lines ~260-310).

**State ownership**: Durable state in `~/.openclaw/orion-controlled/focus.json` (immutable writes — new object each update, no partial mutations). Native UI state in `SessionTabModel` (ObservableObject), which the Swift views observe. The two are separate: the script owns enforcement; the native app owns presentation and guard configuration via `armGuard()` (line 443 of SessionTabModel.swift).

**Serialized fields**: `session.task`, `session.startedAt`, `session.until`, `session.allowedApps`, `session.anchor`, `session.strikes`, `session.grants[]`, `session.lastSpokeAt`. Optional: `session.repo`, `session.repoPath`, `session.fromCalendar`.

**Errors**: Missing Shortcut → warning logged, session proceeds. Unreadable calendar → "blind spot" reported, not treated as empty day. Corrupt state file → reset to `{}` (never locked forever). Model unreachable during `plead` → denial (broken model is not an escape hatch).

## Smallest next slice

**Blocker**: Phase 60 requires installed-Mac proof that the cron enforcement loop actually runs and re-focuses, and that the native Swift guard (`SessionTabModel.armGuard`) integrates with the script's durable state. Neither can be proven from source inspection alone — both require a running Mac with Orion installed, calendar access granted, and a focus session started.

**Exact reconnaissance needed**:
1. Verify cron job registration: check `crontab -l` on the host for an entry invoking `orion-focus check` every minute. Source shows the enforcement logic exists but not that it is scheduled.
2. Verify `SessionTabModel` ↔ `focus.json` integration: does the native UI read from the same durable state, or does it maintain a separate in-memory session? The Swift code references `SessionService` (imported at top of FocusSessionHome.swift) which may own the bridge.
3. Verify `plead` model gate: the script calls `curl http://127.0.0.1:11434/api/generate` — confirm this endpoint is live and returns in the expected format.

**No proposed contracts** until reconnaissance above is complete. A contract that assumes cron is registered or that the Swift bridge works would be inventing an API.

If prerequisites prevent truthful contracts, the blocker stands: **installed Mac access with Orion running, calendar TCC granted, and a live Ollama endpoint**.

## Test scenarios

**Nearest existing suite**: `native/Orion/Tests/FocusSessionHarness/main.swift` (references `SessionTabModel` at line 25) and `native/Orion/Tests/SessionServiceTests/LayoutRuleTests.swift` (references `SessionTabModel.swift` source parsing). These are native Swift tests, not yet registered in the local worker's check registry.

| Scenario | Type | Injectable seam | Expected outcome |
|----------|------|-----------------|------------------|
| Session starts with valid task and apps | Positive | Run `orion-focus start "test" 10 Zed` on installed Mac | `focus.json` written with session; cron entry present; spoken confirmation via `say` |
| Frontmost app not in allowed set, strike 1 | Positive | Switch to Safari during active session; run `orion-focus check` | Strike incremented to 1; spoken warning via `say`; no app raise yet |
| Frontmost app not in allowed set, strike 3+ | Positive | Trigger 3+ strikes; run `orion-focus check` | Anchor app raised via `open -a`; spoken escalation |
| Shortcut absent | Failure | Delete "Orion Focus On" Shortcut from Shortcuts app | Warning logged: `notifications: unchanged — no "Orion Focus On" shortcut`; session starts anyway |
| Calendar unreadable during `next` | Failure | Revoke EventKit permission for Orion; run `orion-focus next` | Script fails with message about not guessing a block; no session created |
| Corrupt state file | Failure | Write invalid JSON to `focus.json`; run `orion-focus check` | State reset to `{}`; no active session; no crash |
| Model unreachable during `plead` | Failure | Stop Ollama; run `orion-focus plead "test"` | Denial: `could not reach the local model, so the answer is no`; exit code 1 |
| Grant expires then enforcement resumes | Positive | Grant a 5-min exception; wait for expiry; run `check` while off-task | Strike incremented; grace period over; enforcement active again |

**Fixture vs. installed proof**: All scenarios above require an installed Mac with Orion running. Source-only inspection can verify the code paths exist but cannot prove they execute correctly on the target system.

## Gates and handoff

**Entry gate**: Phase 59 must be satisfied. Per manifest, `entryRequiresPhase: "59"` and `entrySatisfied: false` — recorded as a deviation per AGENTS.md rather than asserted true. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half; neither blocks this phase's code.

**Remaining hands-on proof**:
1. Installed Mac test: start a focus session, verify cron enforcement runs every minute, verify re-focus behavior on drift, verify `plead` model gate responds correctly.
2. Native Swift integration: verify `SessionTabModel` reads/writes the same durable state as the script, or confirm the bridge through `SessionService`.
3. Calendar TCC grant: verify `orion-agenda upcoming --json` returns events when calendar permission is granted.

**Rollback**: Remove cron job entry (`crontab -e`); delete `~/.openclaw/orion-controlled/focus.json`; restore previous Focus mode configuration via Shortcuts app.

**Reviewer handoff**:
- Verify all cited symbols exist at baseline commit 9855d99: `scripts/orion-focus` (315 lines), `native/Orion/Sources/Orion/FocusSessionHome.swift` (1192 lines), `SessionTabModel` in `native/Orion/Sources/Orion/SessionTabModel.swift` (line 78).
- Confirm no proposed scope expands authority: this packet contains zero implementation contracts, only a blocker requiring installed-Mac reconnaissance.
- No automatic gate edits: Phase 60 remains open until hands-on proof is recorded.

**User decisions needed**: None beyond what Nick has already authorized (cron scheduling, Shortcuts names, Ollama endpoint).
