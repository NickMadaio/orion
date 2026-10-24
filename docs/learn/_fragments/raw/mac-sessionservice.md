<!-- prompt: You are a research helper for a study guide about the ORION repo at /Users/nickmadaio/Desktop/ORION (snapshot HEAD 6c93032, 2026-10-14). STRICTLY READ-ONLY: do not edit, create, or delete any file; do not run builds, tests, installs, git commands that modify anything, or anything that calls a network API. Reading files, grep, wc, and `git log` are fine. Never copy secrets (API keys, tokens, phone  -->

# ORION SessionService study notes (HEAD 6c93032, 2026-10-14)

Scope: `native/Orion/Sources/SessionService/` (21 Swift files; the brief said 22 but listed 21, and the directory holds 21) and `native/Orion/Tests/SessionServiceTests/` (16 files). Everything was read in full, read-only. Both directories are clean in `git status`. SPM target: `SessionService` depends on `SessionDomain` and on `MobileCore` from the `OrionMobile` package (`native/Orion/Package.swift:74-75`). It is a library, not app code, "so the crash-safety and idempotency rules can be tested directly" (commit 8d72467).

---

## 1. File table

| File | Lines | Purpose |
|---|---|---|
| ActivationHistory.swift | 68 | In-memory map of bundle ID to last time it was frontmost. Watches `NSWorkspace.didActivateApplicationNotification`. Only knows activations since Orion launched. |
| AudioCoordinator.swift | 309 | Ducks the clip volume while Orion speaks (ref-counted fade). Ducks Apple Music's own volume for a whole conversation. Writes a crash marker file. Never touches system volume. |
| CameraPresence.swift | 303 | Opt-in camera sampler: one low-preset frame every 90 s, at most 1.5 s camera-on, turned into one variance number and then discarded. Has a 4 h runaway cap. Known defect: it has never produced a reading. |
| ClipLibrary.swift | 356 | A folder of audio clips found by convention, validated by opening each one with AVFoundation. Generates a built-in 180/190 Hz binaural loop. |
| ClipPlayer.swift | 226 | `AVAudioPlayer`, looping forever (`numberOfLoops = -1`), because the session clock decides phase boundaries. Recovers when the audio route changes. |
| DistractionReview.swift | 346 | "Close distractions by reasoning". A mechanical floor, then a model prompt, then a tolerant JSON parse, then a second screen at quit time. Also `SessionFreshness`. |
| DocumentStateSensor.swift | 127 | Detects unsaved work through `AXEdited` on a window's close button (Accessibility), with CoreGraphics as a second opinion. |
| Enforcer.swift | 248 | Drift-enforcement adapter: sensors feed the pure `Enforcement.decide`, which yields speech plus interventions (restore, hide, shield). Has arm, release and progressive modes. |
| ExternalActions.swift | 364 | `ExternalOutcome` type. `AppleMusicControl` drives Music through in-process `NSAppleScript`. |
| FileLock.swift | 132 | Cross-process advisory lock: `<path>.lock` created with O_CREAT\|O_EXCL, broken after 15 s, gives up after 6 s. Contract shared with the TS plugin and node scripts. |
| FocusModes.swift | 421 | Turns Focus modes on or off through one user-built Shortcut, called via `/usr/bin/shortcuts run <name> -i <tmpfile>`. Includes a spoken-mode parser. |
| MessageAccess.swift | 62 | `MessageReading` protocol and wire types so the socket can serve Messages (chat.db) reads. Orion.app has Full Disk Access; the gateway does not. |
| QuittableApps.swift | 260 | The only code that quits apps. Order of checks: never-quit set, authorisation (user list or reviewed), unsaved-work recheck, then `terminate()`. Never force-quits. |
| RunningApps.swift | 126 | Builds `AppFacts` per running app from NSRunningApplication, the AX document state, ActivationHistory and Info.plist document types. |
| Sensors.swift | 175 | Frontmost-app, idle (CGEventSource) and screen-lock sensors, `SensorHub`, and allowlist proposals. None of these needs a TCC permission. |
| SessionEffects.swift | 182 | Real `SessionEffectHandler`: speech closure, clip start/stop/pause, absence queue, and the announcement sentence text. |
| SessionHistory.swift | 145 | `focus-history.jsonl`, append-only and idempotent by session ID, under FileLock. |
| SessionIPC.swift | 569 | Unix-socket command server `~/.openclaw/orion-session.sock`. One newline-terminated JSON request per connection, one JSON line back. |
| SessionService.swift | 378 | The single writer. Hosts the SessionDomain reducer and reconciler, runs the heartbeat timer and the effect pump. |
| SessionStore.swift | 172 | `focus-state.json`: locked read-modify-write, unique scratch file then `rename(2)`, mode 0600. |
| TodayPlanStore.swift | 120 | `today-plan.json`: revisioned document with undo and replay receipts, `flock`-locked, fsync'd. |

Tests (16 files, 3,387 lines): AnnouncementTests 52, AudioCoordinatorMusicTests 170, AudioCoordinatorTests 111, CameraPresenceTests 139, ClipTests 308, ConsoleRuleTests 86, DistractionReviewTests 351, EnforcerInterventionTests 131, FocusModeTests 225, IPCTests 234, LayoutRuleTests 158, QuittableAppsTests 141, ServiceTests 360, SessionEffectsAudioTests 62, StoreTests 191, TodayPlanTests 268.

---

## 2. SessionService.swift: how the reducer is hosted

**Purpose (header, lines 1-25).** This is "The single writer." Voice, the dashboard, the Console and scripts are all clients. No script starts its own engine when the app is down. The header gives the loop in three steps:

1. On launch: load, record `processStarted`, reconcile.
2. On a timer: heartbeat, reconcile, dispatch effects, acknowledge them.
3. On a command: reduce, persist, reconcile, dispatch.

It also states the honest limit: "ENFORCEMENT DOES NOT RUN WHILE THE APP IS TERMINATED."

**Effect protocol.** `SessionEffectHandler` (`:39-53`) has `announce`, `startClip`, `stopClip`, `askAboutAbsence` and `reportClockAnomaly`. Each returns `Bool` meaning "it succeeded". `setAudioPaused(_:)` is declarative and idempotent. `NullEffectHandler` (`:58-66`) succeeds at everything; it is the default and the test handler. Effects are only acknowledged when they succeed, so a failed effect stays pending and is retried on the next pass.

**Threading.**
- `queue = DispatchQueue(label: "com.nickmadaio.orion.session")` (`:111`) serialises everything inside the process. FileLock handles other processes.
- The heartbeat runs on a separate `timerQueue` (`com.nickmadaio.orion.session.timer`, `:128`). It is a `DispatchSourceTimer`, not a `Timer` on `RunLoop.main`. The comment records the reason: a verified five-minute session ran "without a single heartbeat or phase announcement, because every main-run-loop timer in the process was dead while the socket on its own thread kept answering."
- `heartbeatInterval = 30` s, leeway 2 s (`:136`, `:200-202`). It is required, not optional: "a crash at minute 49 of a 50-minute block would void the block" without it.
- `onChange` is published on the main thread (`publish`, `:370-377`).

**Entry points.**
- `start()` (`:162-187`). Inside `queue.sync` it calls `store.mutate`, then `SessionReducer.noteProcessStart(session, requestID: "boot-<epoch>")`, so the gap since the last heartbeat counts as downtime, not focus. If the store throws, it returns a snapshot and does **not** overwrite the file. Then it runs `pumpUnlocked()`, `startTimer()` and `publish`.
- `tick()` (`:210-221`) calls `SessionReducer.noteHeartbeat`, then the pump.
- `send(_ command:)` (`:227-259`) is the only way to change anything. It runs `SessionReducer.reduce(document.session, command, clocks:, dayKeys:)`. A closure that returns nil means rejected, and nothing is written. Store errors become `CommandOutcome(accepted:false, rejection:.notApplicable(msg))`. `wasDuplicate` is `rejection?.isAlreadyApplied`.

**The pump** (`pumpUnlocked`, `:273-358`) is bounded at 4 iterations:
- `.readyToAbandon` leads to `SessionReducer.abandonIfStale(requestID: "abandon-stale-<id>")`, then `continue`. Added in 9c511d2: a session paused for more than 18 h expires. The threshold lives in the domain, per the commit body.
- `.readyToComplete` leads to `SessionReducer.completeIfServed(requestID: "complete-<id>")`, then `continue`.
- `handler.setAudioPaused(status == .paused || status.isOver)` runs on every pass.
- For each effect in `reconciliation.effects`, the matching handler is called. `.appendHistory` calls `history.append(record)`, which is itself idempotent by session ID.
- Acknowledged effect IDs are written back with `next.acknowledging(effect)` inside another `store.mutate`.

```swift
// native/Orion/Sources/SessionService/SessionService.swift:313
            let handler = effects ?? fallbackEffects

            // Audio follows the session's state on every pass, whether or not
            // there are effects to dispatch — a pause produces no effect, and
            // the clip still has to stop.
            handler.setAudioPaused(reconciliation.status == .paused
                                   || reconciliation.status.isOver)

            guard !reconciliation.effects.isEmpty else { return snapshot }
            var acknowledged: [EffectID] = []
```

**Snapshot.** `snapshotUnlocked()` (`:360-368`) calls `store.loadForDisplay()` and then `SessionReconciler.reconcile(session, now: ClockStamp(clocks:))`. `SessionSnapshot.failure` carries an unreadable-file error, so the UI can say "unreadable" rather than "nothing running" (`:74-76`).

**Reconcile on wake / restart.** There is no explicit sleep/wake observer in this file (inferred: none exists here). Wake is handled by construction:
- Reconciliation is derived purely from timestamps and is idempotent. The next tick after wake reconciles, and the gap is costed by the domain using wall plus monotonic clocks (`Clocks`, `ClockStamp`). The `.reportClockAnomaly` effect exists for clock jumps.
- On relaunch, `start()` records `processStarted`.
- ServiceTests models a restart as "a genuinely new SessionService pointed at the same files".

---

## 3. Persistence stores and FileLock

### SessionStore: `focus-state.json`
- Path: `~/.openclaw/orion-controlled/focus-state.json` (`SessionStore.swift:31-36`). Override with env `ORION_FOCUS_STATE` (`:44`). The directory is created 0700.
- Header (`:4-8`): there is a single writer, but the file is locked anyway, because "`open -na Orion`, which is what the dashboard LaunchAgent runs … starts a SECOND instance."
- **Reads.** A missing file returns `.empty`. An empty (0-byte) file also returns `.empty`: "what a machine that lost power mid-rename leaves behind" (`:69-73`). Unreadable bytes throw `SessionStoreError.corrupt`. A readable file that fails to decode is an error, never an empty session.
- **Writes.** `mutate` creates the directory, takes `FileLock.withLock(url)`, **re-reads inside the lock**, applies the change, and skips the write if the change returned nil (`:105-120`). `publish` encodes, writes `.focus-state.<UUID>.tmp` with `.atomic`, chmods it 0600, then calls `rename(2)`. The scratch file is removed if the rename fails (`:139-171`).
- Gotcha (`:144-153`): NOT `.completeFileProtection`. That option "can make the file unreadable to any process other than the one that wrote it … `cat` on the state file returned 'Operation not permitted'".
- **Schema.** `SessionDocument { schemaVersion: Int, session: SessionState? }` (`SessionDomain/SessionState.swift:109-124`). The encoding is pretty-printed with sorted keys. `{"session": null}` is a valid document. Decoding probes the version first, and a newer version is refused with `fromTheFuture` (`SessionState.swift:159-166`). Migration is a no-op today: version 1, `oldestReadable = 1`.
- **Other readers.** `scripts/orion-session` reads only the history file, not the state. `scripts/lib/focus/state.mjs:7` notes it used to use focus-state.json and now has its own file.

### FileLock
Header (`FileLock.swift:3-55`):
- Purpose: preventing a LOST UPDATE between the app and the `orion-control` plugin, which both read-modify-write files such as `health-log.json`. Atomic rename alone does not stop lost updates.
- Race test `Tests/run-race-test.sh`: unlocked, 1965 of 5725 updates were lost (34%, 27-38% across runs). Locked: 0 of 2187 and 0 of 4062.
- "THE PROTOCOL IS COPIED, DELIBERATELY AND EXACTLY, from `scripts/orion-notify` and `scripts/orion-remote`."

```swift
// native/Orion/Sources/SessionService/FileLock.swift:83
    public static func withLock<T>(_ target: URL, _ body: () throws -> T) throws -> T {
        let lockPath = target.path + ".lock"
        let deadline = Date().addingTimeInterval(giveUpAfter)

        while true {
            let descriptor = open(lockPath, O_CREAT | O_EXCL | O_WRONLY, 0o600)
            if descriptor >= 0 {
                close(descriptor)
                defer { unlink(lockPath) }
                return try body()
            }
            let failure = errno
            guard failure == EEXIST else { throw NSError(...) }  // real FS error: fail fast
            breakIfStale(lockPath)
            if Date() >= deadline { throw Busy(path: target.lastPathComponent) }
            usleep(pollInterval)
        }
    }
```

- Mechanism: **O_EXCL lockfile, not `flock` and not O_EXLOCK.**
- Constants: `staleAfter = 15` s, judged by the lockfile's mtime (`:61`, `:124-131`). `giveUpAfter = 6` s, matching node's 60 × 100 ms (`:64`). Polls every 20 ms; the poll interval is local tuning, not part of the contract (`:71`).
- Breaking a stale lock is "racy on purpose" (`:119-123`).
- Readers do not take the lock.
- Cross-language parties found in the repo:
  - `plugin/orion-control/src/health.ts:34-35,181,194` uses `` const lock = `${file}.lock` ``.
  - `scripts/orion-notify:115` and `scripts/orion-remote:260` use `${STATE}.lock`.
  - The header warns: "Change them here and you must change `plugin/orion-control/src/health.ts` in the same commit."
  - No Python participant was found.
- Users inside this target: SessionStore, SessionHistory, and the app's HealthLog (per the header and commit 8d72467).
- Gotcha: the comment at `:66-70` says `mutate` "runs on the main thread". That holds for HealthLog. SessionService calls it on its own queue (inferred inconsistency, harmless).

### SessionHistory: `focus-history.jsonl`
- Path: `~/.openclaw/orion-controlled/focus-history.jsonl`. Override with env `ORION_FOCUS_HISTORY` (`SessionHistory.swift:28-44`).
- Format: one compact JSON `HistoryRecord` per line, keys sorted, ISO-8601 dates (`:73-78`). Never pruned or rewritten. Rollback "has to be additive".
- `append` runs under FileLock: if `containsUnlocked(sessionID)` is true it returns false; otherwise it seeks to the end and writes. On first creation it writes `.atomic` and chmods 0600 (`:54-93`).
- Reads skip unparseable lines and count them as `skipped`, so a torn final line does not make the history unreadable (`:107-139`). `records(on: dayKey)` serves the calendar.
- Other readers: `scripts/orion-session` (`historyRecords()`, read-only, for `today` and `recover`), `scripts/orion-quick`, `scripts/orion-proactive`.

### TodayPlanStore: `today-plan.json`
- Path: `~/.openclaw/orion-controlled/today-plan.json` (`TodayPlanStore.swift:24-27`). No env override.
- Shape:

```swift
// native/Orion/Sources/SessionService/TodayPlanStore.swift:6
public struct TodayPlanDocument: Codable, Equatable {
    public var schemaVersion = 1
    public var revision = 0
    public var current: TodayPlan?
    public var undo: TodayPlan?
    public var hasUndo = false
    public var receipts: [Receipt] = []
    public struct Receipt: Codable, Equatable {
        let id: String
        let fingerprint: String
    }
```

- `TodayPlan` comes from MobileCore.
- **Lock: a different protocol from FileLock.** It opens `today-plan.json.lock` with `O_CREAT|O_RDWR|O_NOFOLLOW`, then `flock(LOCK_EX|LOCK_NB)`, polling 10 ms with a 2 s deadline; timing out raises `revisionConflict` (`:69-77`). Comment: "A kernel lock releases on process death; no timeout can steal it from an active writer."
- Mutate flow:
  1. Load.
  2. Fingerprint = SHA256(`"<action>:<expectedRevision>:"` + payload).
  3. If the operation UUID is already in the receipts: same fingerprint returns the document unchanged; a different fingerprint throws `replayMismatch`.
  4. Otherwise require `revision == expectedRevision`, apply the update, `revision += 1`, append a receipt, keep the last 256 receipts.
- Save: a temp file `.today-plan-<UUID>.tmp` created with O_EXCL|O_NOFOLLOW, mode 0600, a full write loop, `fsync(fd)`, `rename`, then `fsync` of the directory (`:93-113`).
- Load validates: regular file, 8 MiB or smaller, schema 1, at most 256 receipts with unique IDs, `validate()` on `current` and `undo`. Any failure is `corruptStore` (`:30-44`).
- Other users: `Sources/Orion/TodayPlanModel.swift:51` (writer). `native/OrionLink/Sources/LinkCore/SnapshotReader.swift:21` (reader).
- Gotcha (inferred): the `<path>.lock` name matches FileLock's convention but the semantics differ. A flock lockfile persists after use, so if FileLock were ever pointed at `today-plan.json` it would see EEXIST permanently and would break the lock every 15 s.

---

## 4. SessionIPC: the command socket

**Socket.** `~/.openclaw/orion-session.sock` (`SessionIPC.swift:176-180`). Override with env `ORION_SESSION_SOCKET` (`:207`). It shares a directory and convention with `orion-tts.sock`.

**Startup** (`start()`, `:220-289`):
- `signal(SIGPIPE, SIG_IGN)` process-wide, because a client that hangs up would otherwise kill Orion.
- Creates the directory 0700.
- If a socket file exists, it probes with `connect()`. If something is listening it logs "another instance already owns" and returns false. If the file is stale it unlinks it.
- `socket(AF_UNIX, SOCK_STREAM)`, `bind`, `chmod 0600`, `listen(backlog 8)`.
- A dedicated `Thread` named `com.nickmadaio.orion.session.ipc` runs `acceptLoop`.
- Each accepted connection gets `SO_NOSIGPIPE` and is **served serially**, one at a time, on that thread (`:340-360`).

**Framing.** One request line and one response line per connection. This is NDJSON-style, with no length prefix.

```swift
// native/Orion/Sources/SessionService/SessionIPC.swift:386
    private func readLine(from connection: Int32) -> Data? {
        var data = Data()
        var byte: UInt8 = 0
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout,
                   socklen_t(MemoryLayout<timeval>.size))

        while data.count < 64 * 1024 {
            let got = read(connection, &byte, 1)
            if got <= 0 { break }
            if byte == 0x0A { return data }
            data.append(byte)
        }
        return data.isEmpty ? nil : data
    }
```

- Reads are byte-at-a-time, capped at 64 KiB, with a 5 s receive timeout.
- The reply is `JSONEncoder` output of `SessionResponse` plus `\n`.
- Unparseable input returns `{"ok":false,"error":"could not parse that request: …"}`.
- Gotcha (inferred): because serving is serial, a silent client can stall every other client for up to 5 s.

**Request shape** (`SessionRequest`, `:30-70`):
- `op` and `requestId?`.
- Payload fields: `task`, `focusBlocks`, `focusMinutes`, `restMinutes`, `clips[]`, `minutes`, `allow[]` (bundle IDs), `level` (`gentle|guided|firm|shield`), `phases[{kind, seconds}]`.

**Response** (`:74-120`) is flat so `jq -r .status` works:
- `ok`, `duplicate`, `error`, `status`, `phase`, `phaseIndex`, `blockNumber`, `totalBlocks`, `task`.
- `servedSeconds`, `remainingSeconds`, `servedFocusSeconds`, `uncountedSeconds`, `approximate`, `dayKey`, `sessionId`.
- `unreadable`, `enforcement`, `proposedApps`, `proposedBundleIDs`, `sensorsUnavailable`, `messages`, `chats`, `messagesUnavailable`.
- Status strings (`:150-167`): `none`, `not-started`, `running` (plus `phase`), `paused`, `waiting-for-return`, `finishing`, `abandoning`, `finished` (`phase` = reason).

**Verbs and gates** (`handle`, `:407-545`), in dispatch order:

| op | needs requestId? | behaviour |
|---|---|---|
| `status` | no | snapshot plus annotation |
| `release` | no, and no session needed | `enforcer.release()`. Deliberately checked *before* the requestId check: "There is no condition under which Nick is told he cannot get out." |
| `messages` / `chats` | no | Answered by the app through `MessageReading`. The limit is `max(1, min(200, Int(request.minutes ?? 20)))`. `messages` with `task` set means messages from that person. Gotcha: the fields are overloaded. `minutes` is the limit and `task` is "who". |
| `preflight` | no | `enforcer.preflight(forTask:)`. Returns `proposedApps` and `proposedBundleIDs` from **one ordered list**, so index i is the same app in both ("Never sort these separately"). |
| `arm` | no | Requires a non-empty `allow` ("run preflight first"). `level` defaults to gentle. Calls `enforcer.arm(Allowlist(bundleIDs:), policy:)`. Via IPC it never sets progressive. |
| everything else | **yes**, otherwise "every command needs a requestId so retries are safe" | Builds `Command(requestID:, origin: .script, issuedAt: Date(), kind:)` and calls `service.send`. |

The requestId-gated kinds:
- `start`: needs a task. Session ID is `s-<requestId>`. `SessionPlanBuilder.alternating` with defaults of 3 blocks × 50 min focus and 10 min rest.
- `start-sequence` (added 87b49ed): 1-12 phases of kind focus or rest, each 1 s to 4 h, at least one focus.
- `pause`, `resume`, `skip` (`.skipRest`), `shorten` (needs `minutes`, becomes `.shortenRest(to: minutes*60)`), `finish` (`.finishEarly`), `abandon`, `idle` (`.noteIdle`), `back` (`.noteReturned`).
- Unknown ops return `unknown command: <op>`.
- Outcome mapping: accepted gives `ok`. A duplicate gives `ok:true, duplicate:true`. Otherwise `ok:false` and `error` = the rejection message.

**Annotation** (`:552-564`) is added to status, release, preflight and arm replies:
- `enforcement`: `released`, `off`, `disengaged`, or the level name.
- `sensorsUnavailable` = `enforcer.sensorDisclosure`. It goes on every annotated reply "because a UI that shows enforcement as on while a sensor is dark is claiming cover it does not have."

**Auth.** There is no token. Access control is the socket file mode 0600 inside a 0700 directory, plus the fact that a unix socket has "no port and no address" (`:20-21`). Idempotency comes from the requestId.

**Clients (grep for the socket path):**
- `scripts/orion-session` (node, 379 lines). It holds the socket constant (`:60-61`), an alias table (`end/stop/done` map to `finish`, `cancel/quit` to `abandon`, `end-break` to `skip`, …), and `ask()`, which uses one connection per request, `socket.write(JSON.stringify(request)+"\n")`, a 5 s timeout, and maps ENOENT or ECONNREFUSED to "Orion is not running…". It has no fallback engine.
- `scripts/lib/orion-automation-host.mjs:31` passes the env through. Tests: `tests/automation-host.test.mjs:40`, `tests/focus-cli.test.mjs:14`.
- The **OpenClaw plugin does not open the socket directly.** It runs `orion-session` through exec: it is on the exec allowlist at `plugin/orion-control/src/exec-routing.ts:40` and in `selfrepair.ts:363`. The model instruction in `plugin/orion-control/src/job-instructions.ts:7` reads: `orion-session start "<task>" [--minutes N | --until HH:MM] | status | pause | resume | skip | finish`.
- In the app, `AppState.swift:290` creates `SessionIPC(service: session, enforcer: enforcer, messages: messageBridge)`. Tests use their own C-socket client (`IPCTests.swift:51-87`, "What the node client does").

---

## 5. What the app does to other apps

### Enforcer (`Enforcer.swift`)
Two stated properties:
- "THE ESCAPE ALWAYS WORKS": `release()` sets a flag, logs, and speaks "Alright. I'll leave it." It consults no model, gateway or network (`:131-135`).
- "ENFORCEMENT IS OFF UNTIL HE CONFIRMS": `arm` calls `list.confirming()`, and the domain policy refuses an unconfirmed list.

Behaviour:
- `preflight` calls `SensorHub.proposeAllowlist`: the running apps with `.regular` activation policy, de-duplicated, sorted as name/ID pairs, with `confirmed:false` (`Sensors.swift:153-174`). The comment records the earlier pairing bug ("Claude (com.apple.MobileSMS)").
- `evaluate(sessionIsFocusing:)` (`:140-175`) is called from the app's heartbeat at `AppState.swift:922`. It observes, remembers `lastAllowedBundleID`, then `Enforcement.decide`, which returns `.none`, `.nudge(reason, escalation)` (speak plus `applyIntervention`), or `.disengage` (one final line).
- Interventions by effective level (`:177-203`):
  - gentle: speech only.
  - guided: at escalation 2 or more, `.restore(lastAllowed)`.
  - firm: at escalation 2 or more and a `.wrongApp` reason, `.hide(current, restore)`, never for apps in `Allowlist.alwaysAllowed`.
  - shield: `.shield(reason line, restore)`.
- Progressive mode maps escalation below 2 to gentle, 2 to guided, 3 to firm, and 4 or more to shield (`:205-214`).
- Nudge lines escalate from "You're in X." to "Last time — X. Come back or end the session." (`:218-239`). The disengage line is "I've said it enough. I'll stop now — the session's still running if you want it."
- `Allowlist.alwaysAllowed` (`SessionDomain/Enforcement.swift:96-103`): Orion, Finder, loginwindow, 1Password, System Settings, SecurityAgent.
- **What the interventions actually do** is implemented in the app target (`Sources/Orion/AppState.swift:966-985`). `.restore` calls `NSRunningApplication…activate(options:[.activateAllWindows])`. `.hide` calls `$0.hide()` and then activates the restore app. `.shield` calls `focusShield.show(...)`. Nothing is terminated.

### QuittableApps (`QuittableApps.swift`)
- List file: `~/.openclaw/orion-controlled/quittable-apps.json`. Override with env `ORION_QUITTABLE_APPS`. It is a pretty-printed JSON array of `{bundleID, name}`, written with `.atomic` and no FileLock (`:101-166`).
- Empty by default. A corrupt file reads as an empty list. Never-quit apps are filtered out on read.
- Only two authorisations exist: `.userList` and `.reviewed(reason:)` (`:44-49`).
- `quit()` order (`:188-224`): never-quit set, then authorisation, then running check, then `unsavedRefusal` (re-reads AX state for each PID: `.edited` gives `holdsUnsavedWork`, `.unknown` gives `unreadable`), then `app.terminate()`. If terminate returns false the outcome is `.declined`, which is never retried and never escalated to force.
- `neverQuittable = DistractionFloor.neverQuit` (`SessionDomain/DistractionPolicy.swift:142+`). It includes Orion, **com.apple.Music, com.spotify.client** (added after the reviewer quit Music mid-song on 2026-10-06), Finder, loginwindow, and more.
- `candidates()` offers running regular apps to add. Offering an app does not permit quitting it.

### RunningApps
Builds `AppFacts` (`RunningApps.swift:46-77`). It skips the AX query for background apps ("Sixty menu-bar helpers times a one-second timeout is a stalled session start"). `isSystemComponent` is true for paths under `/System/Library/`, `/usr/`, `/Library/CoreServices/` or `/System/iOSSupport/System/Library/`; it is explicitly *not* `/System/Applications`, which holds Messages and Music. `declaresEditableDocuments` reads `Contents/Info.plist` `CFBundleDocumentTypes` (role `Editor` or an `NSDocumentClass`) and caches the answer per bundle path.

### ExternalActions: AppleMusicControl
All calls are in-process `NSAppleScript(source:).executeAndReturnError` (`:334-357`). Error -1743 becomes `.denied("…System Settings ▸ Privacy & Security ▸ Automation ▸ Orion.")`. Scripts, verbatim in substance:
- `status()`: `tell application "Music"` returns a 10-item list: player state, name, artist, album, duration, player position, sound volume, shuffle enabled, song repeat, persistent ID (`:123-135`).
- `artworkData()`: `raw data of artwork 1 of currentItem`, fetched separately from the one-second status poll.
- `tell("playpause")`, `"play"`, `"previous track"`, `"next track"`, `"set player position to N"`, `"set sound volume to N"` (Music's own volume, 0-100), `"set shuffle enabled to not shuffle enabled"`, `"set shuffle enabled to true|false"`.
- `get name of every user playlist`; `play user playlist "<escaped>"`, with backslash and quote escaped (`:215`).
- `cycleRepeat`: off, then all, then one, then off.
- `pauseForSession`: `if player state is playing then pause; return true`. It sets `pausedByOrion`. `resumeAfterSession` plays only if Orion was the one that paused.
- `open()` uses `NSWorkspace.shared.openApplication(at:configuration:)` with `activates = true` (`:106-115`).

### FocusModes
- The contract: ONE Shortcut, default name `ORION Focus Toggle` (`FocusModes.swift:281`), takes one line of text input such as `on work`, `off work` or `on do not disturb` (`input()`, `:418-420`).
- Name override order: env `ORION_FOCUS_SHORTCUT` first, then UserDefaults `orion.focus.shortcutName`. Other keys: `orion.focus.mode` (default `do not disturb`) and `orion.focus.customModes` (comma-separated).
- Subprocesses (ShortcutsCLI, `:210-269`):
  - `/usr/bin/shortcuts list`. Output is split by line. A nonzero exit returns nil, meaning unknown.
  - `/usr/bin/shortcuts run <name> -i <tmp>`, where `<tmp>` = `$TMPDIR/orion-focus-<UUID>.txt`, mode 0600, removed with `defer`. "`-i` is `--input-path`: the CLI takes a FILE, not a literal string."
- Gates (`set`, `:346-391`):
  - An unknown mode returns `.notConfigured` before anything runs.
  - A Shortcut known to be missing returns `.notConfigured(setupInstructions)`.
  - An unreadable list means "try anyway".
  - A launch failure or nonzero exit returns `.failed`.
- The parser accepts the built-in modes (do not disturb, work, personal, sleep, driving, fitness, gaming, mindfulness, reading), synonyms (dnd, quiet, gym, …), decoration stripping and space-squashing.

---

## 6. Sensors and the other modules

**Sensors.swift.** No TCC prompts by design.
- `WorkspaceFrontmostSensor` uses `NSWorkspace.frontmostApplication`.
- `EventSourceIdleSensor` uses `CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: ~0)`; negative values or values of a week or more become nil.
- `SessionDictionaryScreenSensor` uses `CGSessionCopyCurrentDictionary`: `CGSSessionScreenIsLocked == 1` or `kCGSSessionOnConsoleKey == false` means locked. An empty dictionary reads as *not locked*.
- `SensorHub.observe()`: a nil idle reading becomes 0 ("actively working"), so a failed read never nags. Unavailable sensors are recorded, and `disclosure` = "Orion cannot read X or Y right now, so it is not watching for drift."

**DocumentStateSensor.swift.** Measured findings:
- `NSRunningApplication` has no document state.
- `AXEdited` on a window returns -25205 (unsupported) on every app.
- It does work on the window's `kAXCloseButtonAttribute` element.

Behaviour:
- Requires `AXIsProcessTrusted()`; otherwise every app reads `.unknown`, which blocks all quitting.
- `AXUIElementSetMessagingTimeout` is 1.0 s.
- Zero AX windows: if CoreGraphics (`CGWindowListCopyWindowInfo` on-screen, layer 0, matched by owner PID) shows windows, the result is `.unknown`; otherwise `.clean`.
- Any window without a readable close button makes the whole app `.unknown` if no window reported edited.
- Electron apps (VS Code, Slack, Discord) read `.unknown` and are never closed; measured, Code shows 5 CG windows and 0 AX windows.
- Window titles are never read, since they would need Screen Recording.

**CameraPresence.swift.**
- Constants: `sampleDuration = 1.5` s, `sampleInterval = 90` s (`:68-69`), giving a claimed duty cycle of 1.67%. `maximumRun = 4*3600` (`:89`). The runaway cap was added after it "sampled the camera every ninety seconds for six days".
- Timer: a `DispatchSourceTimer` on `com.nickmadaio.orion.presence`, first fire at +1 s, leeway 5 s.
- Off by default; `isEnabled` is not persisted here.
- `sampleOnce`:
  1. Checks the deadline.
  2. Creates `AVCaptureSession` with preset `.low`, `AVCaptureDevice.default(for:.video)` and `AVCaptureVideoDataOutput`.
  3. Calls `startRunning()`.
  4. A hard stop at +1.5 s calls `finish`, which calls `stopRunning`.
  5. The failure message names the device.
- `FrameCollector` samples the green channel every 16th pixel, assuming 4-byte pixels at offset +1 (inferred: assumes BGRA). It computes mean and variance; `present = variance > 220 && mean > 12`. Only the enum is stored (`lastReading`, `lastSampledAt`). No image is kept.
- Consent: `AVCaptureDevice.requestAccess`, called only from a user control. If not authorised, the reading is `.unavailable`, never `.absent`.
- Disclosure (`:124-132`) states the 90 s / 1.5 s figures, "under two percent", the hardware green light, and "Off unless you turn it on."
- **KNOWN DEFECT** (`:46-67`, commit d9cc23d): "504 samples, 504 'No frame arrived in time', zero successes". Raising the duration was deliberately not done, because it would break the tested under-2% invariant. The proposed fixes are a longer interval, or splitting the give-up timeout from the camera-on duration.
- The app instantiates it in `Sources/Orion/FocusExtras.swift:99`.

**ActivationHistory.** Covered in the table. The observer is on the `.main` queue and is guarded by NSLock. It is seeded with the current frontmost app. "Not seen" is nil, which is a weaker claim than "unused".

**MessageAccess.** Only the protocol and wire types. The rationale (`:4-16`): Full Disk Access is attributed to the *responsible* process, and the exec wrapper's responsible process is the gateway's node binary, which lacks FDA. Orion.app already has FDA and already reads chat.db, so the socket answers instead. The app's adapter is `MessageBridge(reader: MessagesReader())` (`AppState.swift:288-289`). chat.db is not opened in this target.

**DistractionReview.** It does call a model, through an injected `DistractionReasoning`. The concrete reasoner is in the app target, `Sources/Orion/DistractionReasoner.swift:21-45`: `LocalModelReasoner` calls `LocalModel.complete(prompt:, maxTokens: 2400, temperature: 0.1, timeout: 60, requireSentenceEnding: false)`. That is a local Ollama model (`gpt-oss:20b` is named in its comment), deliberately not the `openclaw agent` route ("measured forty times slower"). If the model call throws, nothing is closed.

The verbatim prompt (`DistractionPrompt.build`, `DistractionReview.swift:127-150`). Lines that end in `\` are continued in the Swift source.

```swift
// native/Orion/Sources/SessionService/DistractionReview.swift:127
        return """
        A focus session is starting on a Mac. Decide which of these apps to close.

        What the person said they are working on this session:
        \(stated.isEmpty ? "(they did not say)" : "\"\(stated)\"")

        Every app below has already been checked and has nothing unsaved, is not \
        the app they are using, and is safe to quit. The only question left is \
        whether it is plausibly part of that task.

        \(described)

        Rules:
        - Close an app only if it is clearly unrelated to the stated task.
        - If the task is vague, empty, or you are unsure about an app, keep it.
        - A communication app may be part of the task; do not assume it is not.
        - Keep anything that could plausibly be a tool for the work.

        Answer with JSON and nothing else: an array of objects, one per app you \
        were shown, each with "bundle" (the identifier exactly as given), "close" \
        (true or false) and "reason" (under 12 words, addressed to the person).

        Example: [{"bundle":"com.apple.Music","close":true,"reason":"a music player, not part of writing"}]
        """
```

- At most 25 apps go into the prompt. Each app line is `- Name [bundle]: N windows, hidden, last used N min ago | not switched to since this session's setup began, running N min, can/does not edit documents`.
- The parser takes the first `[` to the last `]` and accepts `bundle`, `bundleID` or `bundle_id`. Invented IDs are dropped, duplicates are dropped. `close` accepts true/yes/1/close; anything else means keep.
- Unmentioned apps are kept: "Silence is not permission."
- `closeDistractions` screens again at quit time through `QuittableApps.quit(authorizedBy: .reviewed)`.
- The log condenses floor refusals into counts, except work-related ones (unsaved or unreadable state).
- `SessionFreshness.startedJustNow(within: 120 s)` prevents re-closing apps after Orion restarts into a live session.
- Gotcha: the prompt's example says to close `com.apple.Music`, but Music is now in `neverQuit`, so the floor removes it before the model sees it. The example is stale but harmless.

**AudioCoordinator.**
- Clip ducking: ref-counted `speakers`, ducks to `duckedFraction 0.25`, an 8-step fade over 0.18 s on queue `…audio-coordinator`.
- Music ducking: `beginConversation`/`endConversation` are ref-counted `conversationHolders` on a separate `musicQueue`. Music goes to 0.3 × its prior volume, and is skipped if the volume is at or below the 0.12 floor or Music is not playing.
- Restore only happens if the current volume is within 0.03 of the ducked value; otherwise Nick's manual change wins.
- Crash marker `~/.openclaw/orion-music-duck-state.json` holds `{priorVolume}` and is checked once at init (`recoverMusicFromCrash`). `reset()` forces everything back.
- The header records why `AudioDucking.swift` in the app target, which changes global volume via osascript, is limited to opt-in and listening only.

**ClipLibrary / ClipPlayer.**
- Clips come only from the local directory `~/.openclaw/orion-controlled/focus-clips` (env `ORION_FOCUS_CLIPS`).
- Accepted extensions: m4a, mp3, wav, aiff, aif, caf, flac, aac, mp4. Hidden files are skipped.
- Each file is validated by opening it with `AVAudioFile` (exists, readable, size > 0, rate > 0, duration > 0). Rejected files are surfaced with a reason.
- The built-in track `Orion Binaural Focus.caf` is generated locally: 30 s, 44.1 kHz float32 stereo, 180 Hz left / 190 Hz right, envelope 0.075-0.1 (about -22 dBFS). It is tracked by the revision marker `.orion-binaural-revision` = "2". There is no download: "without downloading media or claiming a copyrighted recording."
- **No network** in either file.
- ClipPlayer: `AVAudioPlayer`, `numberOfLoops=-1`, volume 0.7 by default (env `ORION_CLIP_VOLUME`). It revalidates before every play. On `.AVAudioEngineConfigurationChange` it reopens from the current offset if the player stopped. If the delegate's did-finish ever fires, it is reported as a failure.
- SessionEffects: a missing clip still returns `true` (deliberate, to avoid retrying every 30 s) and sets `clipProblem`. A user's manual pause outranks a heartbeat resume. `setClipPlaybackEnabled(false)`, used when Apple Music is the selected source, stops phase transitions from starting a clip.

---

## 7. Every outbound network call or subprocess in this target

- **Network: none.** A grep for URLSession or URLRequest found nothing. The `testNoFrameIsEverWrittenBufferedOrSent` test asserts there is no `URLSession` in CameraPresence.
- **Subprocesses (`Process`):**
  - `native/Orion/Sources/SessionService/FocusModes.swift:217-219`: `/usr/bin/shortcuts list`.
  - `native/Orion/Sources/SessionService/FocusModes.swift:256-258`: `/usr/bin/shortcuts run <shortcutName> -i <$TMPDIR/orion-focus-UUID.txt>`.
- **In-process inter-app control (not subprocesses):**
  - `ExternalActions.swift:335`: `NSAppleScript` to Music (Apple Events).
  - `ExternalActions.swift:112`: `NSWorkspace.openApplication` for Music.
  - `QuittableApps.swift:215`: `NSRunningApplication.terminate()`.
  - Hide and activate live in the app target (`AppState.swift:970-978`).
  - AX queries (`DocumentStateSensor.swift:67-110`).
  - AVCaptureSession (`CameraPresence.swift:194-228`).
- `SessionEffects` mentions `/usr/bin/say` only in a comment. Speech is an injected closure.
- The model call for DistractionReview is in the app target (`Sources/Orion/LocalModel.swift`, local Ollama), out of scope.

## 8. Every file read or written

| Path | R/W | Contents | Owner |
|---|---|---|---|
| `~/.openclaw/orion-controlled/focus-state.json` (+ `.lock`, `.focus-state.<UUID>.tmp`) | RW | `SessionDocument` (schemaVersion, session events, plan, acks), 0600 | SessionStore |
| `~/.openclaw/orion-controlled/focus-history.jsonl` (+ `.lock`) | RW, append-only | one `HistoryRecord` per finished session | SessionHistory |
| `~/.openclaw/orion-controlled/today-plan.json` (+ `.lock` for flock, `.today-plan-<UUID>.tmp`) | RW | `TodayPlanDocument` | TodayPlanStore |
| `~/.openclaw/orion-controlled/quittable-apps.json` | RW | `[{bundleID,name}]` | QuittableApps |
| `~/.openclaw/orion-controlled/focus-clips/*` + `.orion-binaural-revision` + `.orion-binaural-<UUID>.caf` tmp | RW | audio clips; generated binaural track | ClipLibrary |
| `~/.openclaw/orion-music-duck-state.json` | RW, deleted on clear | `{priorVolume}` crash marker | AudioCoordinator |
| `~/.openclaw/orion-session.sock` | socket, 0600 | IPC | SessionIPC |
| `$TMPDIR/orion-focus-<UUID>.txt` | W then deleted | `on <mode>` Shortcut input | FocusModes |
| `<app>.app/Contents/Info.plist` | R | `CFBundleDocumentTypes` | RunningApps |
| UserDefaults `orion.focus.*` | R | Shortcut name, mode, custom modes | FocusModes |
| In memory only | | ActivationHistory map, CameraPresence `lastReading`, SessionEffects `pendingAbsences` | |

Env overrides in this target: `ORION_FOCUS_STATE`, `ORION_FOCUS_HISTORY`, `ORION_SESSION_SOCKET`, `ORION_QUITTABLE_APPS`, `ORION_FOCUS_CLIPS`, `ORION_CLIP_VOLUME`, `ORION_FOCUS_SHORTCUT`. No secrets, Keychain items or tokens are used anywhere in this target.

---

## 9. History (`git log --date=short`)

**SessionService.swift**
- 5d23d93 2026-08-11: SessionStore, SessionHistory and the single-writer SessionService.
- b4baaa0 2026-08-11: clip playback, and the heartbeat off the main run loop. Gate 4, 122 tests. The main-run-loop Timer produced zero heartbeats in a real five-minute run.
- 9c511d2 2026-09-01: expire stale focus sessions. `readyToAbandon` added; 18 h measured from the last event. A real session paused on 08-12 was still paused on 09-01 after 60 heartbeats and 48 process starts. Tests went from 318 to 322.

**SessionIPC.swift**
- 77f8484 2026-08-11: the command socket and the script client. Gate 3, 105 tests. Fixed SIGPIPE killing the process; stale socket reclaimed only after a probe.
- e23fcab 2026-08-11: sensing and Firm enforcement (+91 lines: preflight, arm, release).
- 93e9a42 2026-08-20: checkpoint before the first push.
- 9c511d2 2026-09-01: `abandoning` status.
- 87b49ed 2026-10-06: ending a break no longer lengthens it; `start-sequence` op. Before the fix, "End break sent the time served as the time to leave, so each press doubled the break."

**SessionStore.swift**: 5d23d93 2026-08-11 (creation), b4baaa0 2026-08-11 (13-line change, inferred to be the file-protection fix).

**Enforcer.swift**
- e23fcab 2026-08-11: Gate 5, 141 tests. The honest claim recorded there: Orion "cannot see drift inside an app you allowed". Six escalations, then silence. A locked screen is never drift.
- 93e9a42 2026-08-20: checkpoint (inferred to be where guided, shield and progressive landed).

**CameraPresence.swift**
- d623dab 2026-08-11: Gate 10 complete, camera presence.
- 93e9a42 2026-08-20: checkpoint.
- d9cc23d 2026-09-01: "honest failures for the camera" (+32 lines: the KNOWN DEFECT note and device-named failure messages).

**DistractionReview.swift**: 93e9a42 2026-08-20 only. It arrived in the checkpoint. The later Music never-quit change was made in SessionDomain.

**FileLock.swift**
- 8d72467 2026-08-11: "a SessionService target, and one FileLock shared by both writers". Race test: 1382 updates lost unlocked, 0 locked.
- ceb6b79 2026-09-15: openclaw-plugins/ folded into plugin/ (header path updated).

Other notable directory commits: e23fcab, d013d8c ("a deterministic way out, and session speech in Orion's real voice"), 694b762 (Gate 10 part one: quittable apps, Do Not Disturb, Music), 3e14200 2026-09-05 (Music conversation duck), f597f7f / 187fa15 2026-09-08 (TodayPlanStore, pins), e9cfc38 / 475b14a 2026-10-06 (playlists, shuffle fix), c2e1824 2026-10-07 (⌥Tab quick menu, which ConsoleRuleTests covers).

---

## 10. Gotchas from the comments, and what each test file proves

**Gotchas collected from the comments:**
- The main-run-loop timer starved the heartbeat (SessionService `:113-127`).
- `.completeFileProtection` made the state file unreadable to `cat` (SessionStore `:144-153`).
- A 0-byte state file is treated as absent, as left by a power cut mid-rename (SessionStore `:69-73`).
- SIGPIPE kills the process. It is ignored process-wide and `SO_NOSIGPIPE` is set per socket (SessionIPC `:223-233`, `:347-355`).
- Swift 6 rejects the overlapping access to `sun_path`, so the capacity is read first (SessionIPC `:317-321`).
- A unix socket path is limited to about 104 bytes, so tests use `/tmp/orion-ipc-N` (IPCTests `:26-28`).
- The lockfile name, O_EXCL and the 15 s rule are a cross-language contract (FileLock `:46-49`).
- Name and bundle-ID arrays sorted separately once produced a mislabelled confirmation dialog (Sensors `:163-171`).
- `AXEdited` on a window is unsupported; it only works on the close button (DocumentStateSensor `:12-24`).
- Electron apps are unknown and therefore never closed.
- `/System/Applications` is not "system" (RunningApps `:81-87`).
- `shortcuts -i` takes a file path, not text (FocusModes `:237-242`).
- The old two-Shortcut design caused a launch-time complaint about a missing "Orion Focus On" Shortcut (FocusModes `:24-28`).
- Music shuffle "toggle, then read back" read the stale value, hence `setShuffle(on)` (ExternalActions `:256-258`).
- The camera has never produced a frame, and the duty-cycle invariant blocks the obvious fix (CameraPresence `:46-67`). It also once ran for six days, hence the 4 h cap.
- A missing clip returns true so it is not retried every 30 s (SessionEffects `:74-81`).
- "1 minute" versus "1 minutes" (SessionEffects `:150-156`).
- AudioDucking's global volume can leave the Mac stuck quiet; this target never uses it (AudioCoordinator `:11-25`).
- DistractionReview's prompt example uses Music, which is now never-quit (inferred, stale).
- TodayPlanStore uses a flock lock while FileLock uses O_EXCL, with the same `.lock` suffix (inferred hazard).

**What each test file proves:**
- **ServiceTests**: Gate 3 exit criteria. start/status/pause/resume/finish. The session survives the service being replaced (a restart). Exactly one history record across restarts and repeated ticks. A fully served session archives itself as completed. An abandoned session is not congratulated. Effects are carried out once. A failed effect stays pending and is retried. Phase announcements do not repeat. A command with no session is refused rather than starting one. Retries report as duplicates. An unreadable state file neither blocks start nor gets overwritten. Heartbeats bound the cost of a crash. Heartbeats do not bloat the state file.
- **StoreTests**: real files. Missing file reads as empty. Round-trip is identical. Mode 0600. Empty file is absent. Corrupt bytes are an error. An unreadable file is never overwritten. Mutate returning nil leaves the file alone. No scratch files are left behind. History: one line per append, same session written once, a torn final line is tolerated, per-day fetch, one object per line.
- **IPCTests**: real socket. Status with no session returns `none`. A full cycle. A retry is a duplicate with `ok`. A missing requestId is refused. Start without a task is refused. An unknown op is named in the error. Garbage input does not kill the server. A stale socket is reclaimed. A second server will not steal a live socket. Socket permissions satisfy `& 0o077 == 0`. Stop removes the socket. With no server, a client cannot connect.
- **EnforcerInterventionTests**: guided restores the last work app after repeated drift; firm hides (and never quits); shield appears on the first real drift and `release` stops everything; progressive climbs from gentle to shield.
- **QuittableAppsTests**: the list starts empty and quits nothing; an unadded app is refused; Orion, 1Password and Finder cannot be added; a never-quit app smuggled into the file is ignored; add/remove persists; no duplicates; a corrupt list reads as empty; a source scan shows no `forceTerminate` and does show `terminate()`; candidates are not permitted.
- **DistractionReviewTests**: adversarial models. Floor-blocked apps are never put in front of the model. "Close everything" cannot reach blocked apps. Invented IDs are dropped. Unmentioned apps are kept. Unreachable, unreadable or absent reasoner means nothing is closed. The parser survives code fences, prose and string booleans. Ambiguous means keep. Unsaved or unreadable state refuses the quit, including through the real quit path. Reviewed quits cannot reach never-quit apps. Freshness rules hold. Log content and app descriptions are checked.
- **CameraPresenceTests**: off until enabled; starting while disabled does nothing; without authorisation the reading is unavailable, never absent; the disclosure states the real numbers, the green light and off-by-default; duty cycle below 0.02; a source scan forbids `write(to:`, `URLSession`, `CGImage`, `NSImage`, `jpegData`, `AVCaptureMovieFileOutput` and `AVCapturePhotoOutput`; `startRunning()` appears exactly once and `stopRunning` is present.
- **AudioCoordinatorTests**: ducks and restores; overlapping speech does not restore early; reset recovers a stuck duck; a source scan forbids `osascript`, `set volume output` and `AudioDucking`.
- **AudioCoordinatorMusicTests**: conversation duck and restore across listening, thinking and speaking; overlap safety; a manual volume change wins; the floor and not-playing cases are untouched; reset forces a restore; a nil music source is safe.
- **SessionEffectsAudioTests**: Apple Music selected means no clip starts under it; Binaural selected lets the clip start; a manual pause survives heartbeats.
- **ClipTests**: real generated audio. Discovery and timing; distinct messages for a missing versus an empty folder; non-audio files rejected with a reason; empty file; quiet skip of non-audio extensions; built-in loop created, upgraded from revision 1, and reused; revalidate catches vanished or unreadable files; shuffle is a permutation; a missing clip fails loudly; real clips loop; pause keeps its offset; a second clip replaces the first; seek; volume is the source's own.
- **FocusModeTests**: forgiving parser and intent words; `on <mode>` input format; name and mode configuration; strict control (missing Shortcut, unknown mode, nonzero exit and launch failure all fail before or without a silent success; an unreadable list still runs); session on and off; `isConfigured`.
- **AnnouncementTests**: singular and plural minutes; no empty sentences; the disengage line says it is stopping.
- **TodayPlanTests**: mostly the MobileCore planner (gaps, transitions, DST, sleep floor, deadlines, pins). For TodayPlanStore: atomic revisions survive reopen and undo; first plan can be undone to empty; a duplicate operation is idempotent; a replay ID cannot authorise different content; a stale writer is rejected; a corrupt file is preserved and cannot become an empty day; the file is owner-only; old snapshots without the pin field still load.
- **ConsoleRuleTests** and **LayoutRuleTests**: these grep **app-target** sources in `Sources/Orion/`. They sit in this test target so they run headless on every `swift test`. They check: the Carbon `RegisterEventHotKey` is used, not `addGlobalMonitorForEvents`; hotkey failure is disclosed; only auto- and notify-tier commands appear in the Console and ⌥Tab menu; Console commands carry `origin: .console`; no nested vertical ScrollView in dashboard tabs; the clock interpolates between 30 s heartbeats; audio status is confirmed by the player, not the plan; the dashboard proposes Progressive Guard.