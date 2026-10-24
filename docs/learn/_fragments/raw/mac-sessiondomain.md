<!-- prompt: You are a research helper for a study guide about the ORION repo at /Users/nickmadaio/Desktop/ORION (snapshot HEAD 6c93032, 2026-10-14). STRICTLY READ-ONLY: do not edit, create, or delete any file; do not run builds, tests, installs, git commands that modify anything, or anything that calls a network API. Reading files, grep, wc, and `git log` are fine. Never copy secrets (API keys, tokens, phone  -->

# SessionDomain study notes (ORION @ 6c93032, 2026-10-14)

All paths below are relative to `native/Orion/`. The domain sources are in `Sources/SessionDomain/` and the tests are in `Tests/SessionDomainTests/`. Neither directory has uncommitted changes in the working tree.

---

## 1. File table

| File | Lines | Purpose |
|---|---|---|
| AgendaPlacement.swift | 94 | Decides which civil day a calendar event appears on. All-day events compare civil days; timed events use instant overlap. |
| BreakLock.swift | 133 | The undismissable break: a 10 or 3 minute length, and one release that needs a reason. |
| CalendarRange.swift | 171 | Month, week and day grid arithmetic, plus the fetch interval (the visible page plus the real neighbouring pages). |
| Clocks.swift | 144 | `WallClock` and `MonotonicClock` protocols, their system implementations, and stub test doubles. |
| Commands.swift | 153 | `Command`, `CommandOrigin`, `CommandKind` and `CommandRejection`: the only vocabulary for changing a session. |
| DayScore.swift | 425 | Day score policy v2. Rated out of 10, group weights, a coverage floor, and "missing is not zero". |
| DistractionPolicy.swift | 238 | `DistractionFloor`: a deterministic screen of which apps may even be considered for quitting. |
| Effects.swift | 157 | `Effect`, `Announcement`, `HistoryRecord`, and the stable `EffectKindName` strings. |
| Enforcement.swift | 359 | Drift detection, four levels, keep-on-task vs. keep-away, a 6-step cap, and an unconditional escape. |
| Events.swift | 218 | `ClockStamp` (both clocks), `Elapsed`, `LifecycleEvent`, `EventKind`, `FinishReason`, and helpers for reading the log. |
| ExitPolicy.swift | 130 | The fail-closed hatch: 3 exit requests the model never answered, inside 5 minutes, release the session. |
| Identifiers.swift | 158 | `SessionID`, `PhaseID`, `RequestID`, `EffectID` (derived), `DayKeyProvider`, and `CutoffDayKeys` (4 am cutoff). |
| Reconcile.swift | 571 | `SessionReconciler.reconcile(_:now:)`: a pure walk that pours segments into phases and builds effects. |
| Reducer.swift | 293 | `SessionReducer.reduce`: pure command → state, idempotent, returns typed rejections. Also process-start, heartbeat, anomaly, complete and abandon helpers. |
| SessionPlan.swift | 279 | The immutable plan: `PhaseKind`, `ClipAssignment`/`ClipFit`, `PhaseDefinition`, and the builders (`alternating`, `sequence`, `assigning`). |
| SessionState.swift | 247 | The persisted state value, the `SessionDocument` envelope, coding, store errors, and `Migration`. |
| TimeZonePolicy.swift | 254 | Home zone vs. device zone, the recorded `ExpectedMove`, and `ZoneVerdict` (trip vs. move). |
| TravelMode.swift | 177 | A display-only layer: two clocks, `Journey` (two `ZonedInstant`s), and an "unsociable hour" check. |
| ZonedTime.swift | 551 | The `IANAZone` whitelist, `CivilDay`, `ZonedInstant`, `AllDaySpan`, and the `ZonedTime` sum type. |

The test target has 16 files. Line counts: Adversarial 390, AgendaPlacement 191, BreakLock 115, CalendarRange 163, Clocks 85, DayScore 327, DistractionFloor 139, Enforcement 337, ExitPolicy 139, Harness 238, Heartbeat 129, Persistence 182, SequencePlan 43, SessionCycle 328, TimeZonePolicy 261, TravelMode 168, ZonedTime 456.

---

## 2. The state machine

### 2.1 Design rule: store facts, derive everything else

`SessionState` has **no derived fields**: no `currentPhase`, no `phaseEndsAt`, no `servedMinutes` (`SessionState.swift:5-10`). Phase, served time and status are all computed fresh by `reconcile(now:)` from the plan plus an append-only event log (`Events.swift:4-16`). The stated reason: pause, resume, shortening, idle, sleep and clock drags all move a stored boundary, and "the first one that forgets produces a session that is silently wrong."

### 2.2 SessionState

```swift
// Sources/SessionDomain/SessionState.swift:23
public struct SessionState: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1
    public let schemaVersion: Int
    public let id: SessionID
    /// Local, 4 am cutoff. Fixed at start and never recomputed
    public let dayKey: String
    public let plan: SessionPlan
    /// Append-only.
    public let events: [LifecycleEvent]
    /// Effects that have been carried out.
    public let acknowledgedEffects: Set<String>
```

Every update returns a new value:

- `appending(_:)` at `:67`.
- `heartbeating(eventID:stamp:)` at `:79`. This is the one exception to append-only: a trailing `.processAlive` is replaced rather than appended.
- `acknowledging(_:)` at `:89`, and `hasAcknowledged` at `:94`.
- `isFinished` at `:98`.

The on-disk envelope is `SessionDocument { schemaVersion, session: SessionState? }` (`SessionState.swift:109`). `{"session": null}` is a valid document that means "no session" (`:105-108`).

### 2.3 Status (derived, not stored)

```swift
// Sources/SessionDomain/Reconcile.swift:32
public enum SessionStatus: Equatable, Sendable {
    case notStarted
    case running(PhaseKind)
    case paused
    case waitingForReturn(afterRestIndex: Int)
    case readyToComplete
    case readyToAbandon
    case finished(FinishReason)
```

- `label` (`Reconcile.swift:69-79`) exists because the default enum description leaked into the app log as `"running(SessionDomain.PhaseKind.focus)"`.
- `PhaseKind` has two cases, `.focus` and `.rest` (`SessionPlan.swift:20`). It is named `rest` because `break` is a Swift keyword.
- `FinishReason` has three cases: `.completed`, `.early` and `.abandoned`. `isSuccess` is true for completed and early (`Events.swift:183-191`). Finishing early counts as a success "by decision."

### 2.4 EventKind: only facts that cannot be derived

```swift
// Sources/SessionDomain/Events.swift:138
public enum EventKind: Codable, Equatable, Sendable {
    case started
    case paused
    case resumed
    case restShortened(index: Int, to: TimeInterval)   // new TOTAL, not remaining
    case idleBegan
    case idleEnded
    case processStarted     // gap BEFORE this = downtime
    case processAlive       // heartbeat watermark; coalesces
    case finished(FinishReason)
    case clockAnomaly(seconds: TimeInterval)
}
```

- **Event shape.** `LifecycleEvent { id, stamp: ClockStamp, kind }` (`Events.swift:114`). For an event driven by a command, `id` equals the command's `RequestID`. That makes duplicate detection a lookup: `contains(request:)` at `:199`.
- **Clock stamp.** `ClockStamp { wall: Date, uptime: TimeInterval?, bootEpoch: Date? }`, where `bootEpoch = wall − uptime` (`Events.swift:30-50`).
- **Same boot.** `sameBootTolerance = 60` seconds (`:60`).
- **Measuring elapsed time.** `elapsed(since:)` (`:85-91`) uses monotonic time whenever both stamps have an uptime and it did not go backwards. It deliberately does **not** gate on `sharesBoot`, because dragging the wall clock changes `bootEpoch` even though uptime is still valid. Otherwise it falls back to wall time, clamped at ≥ 0, with source `.wall` or `.wallWentBackwards`.

### 2.5 Command and CommandKind

```swift
// Sources/SessionDomain/Commands.swift:62
public enum CommandKind: Codable, Equatable, Sendable {
    case start(plan: SessionPlan)
    case pause
    case resume
    case skipRest
    case shortenRest(to: TimeInterval)   // remaining duration
    case finishEarly                     // archived as SUCCESS
    case abandon
    case noteIdle
    case noteReturned
    case acknowledgeEffect(EffectID)
}
```

- `Command { requestID, origin, issuedAt, kind }` (`Commands.swift:42`).
- `CommandOrigin` has five cases: `voice`, `dashboard`, `console`, `script`, `scheduler` (`:27-38`). The origin is carried through so that Console text is never mistaken for verified speech (`:16-19`).
- `CommandRejection` (`:110`) has six cases: `alreadyApplied(RequestID)`, `noSession`, `sessionAlreadyRunning(SessionID)`, `sessionFinished(SessionID)`, `notApplicable(String)`, `invalidPlan(String)`. Each has a plain `message` meant to be spoken (`:137-151`). `alreadyApplied` means success.

### 2.6 Effects

```swift
// Sources/SessionDomain/Effects.swift:26
public enum Effect: Equatable, Sendable, Identifiable {
    case announce(id: EffectID, Announcement)
    case startClip(id: EffectID, clip: ClipAssignment, phaseIndex: Int)
    case stopClip(id: EffectID)
    case appendHistory(id: EffectID, HistoryRecord)
    case askAboutAbsence(id: EffectID, seconds: TimeInterval, phaseIndex: Int)
    case reportClockAnomaly(id: EffectID, seconds: TimeInterval)
```

- **Announcements** (`Effects.swift:69-79`) are typed values, not prose. The cases are: `sessionStarted(task:totalMinutes:)`, `focusBeginning(blockNumber:ofBlocks:minutes:)`, `restBeginning(minutes:)`, `restEnding`, `sessionComplete(focusMinutes:)`, `sessionEndedEarly(focusMinutes:)`, `waitingForReturn`, `paused`, `resumed`. (inferred) `sessionStarted`, `restEnding`, `paused` and `resumed` are never emitted by `buildEffects` in Reconcile.swift.
- **Effect IDs are derived** (`Identifiers.swift:71-86`):
  - per phase: `"<session>/<phaseIndex>/<kind>"`
  - per session: `"<session>/-/<kind>"`
- **Kind names** (`Effects.swift:147-157`): `session-started`, `phase-announce`, `phase-clip`, `clip-stop`, `history`, `absence`, `clock-anomaly`, `waiting-for-return`, `finish-announce`. The comment says: "renaming one silently un-acknowledges every effect of that kind on disk and Orion says everything again. Change these only with a migration."

---

## 3. Walkthroughs

### 3.1 Reducer.swift: `SessionReducer.reduce(_:_:clocks:dayKeys:)` (`Reducer.swift:50`)

The reducer is pure, total and never throws. It returns `ReduceResult { state, rejection }`, where `applied` means `rejection == nil` and `wasDuplicate` means the rejection is `.alreadyApplied` (`:20-37`).

**Step 0: stamp and idempotency, always first** (`:55-64`).

```swift
// Sources/SessionDomain/Reducer.swift:55
let stamp = ClockStamp(clocks: clocks)
// Idempotency first, always. See the header.
if let state, state.events.contains(request: command.requestID) {
    return .no(.alreadyApplied(command.requestID), keeping: state)
}
if let state, case .acknowledgeEffect(let effect) = command.kind,
   state.hasAcknowledged(effect) {
    return .no(.alreadyApplied(command.requestID), keeping: state)
}
```

The header (`:10-13`) explains the order: a retried `finishEarly` on a finished session must come back as `alreadyApplied`, not `sessionFinished`.

**Then a switch on `command.kind`:**

| Command | Precondition (otherwise rejected) | New state |
|---|---|---|
| `.start(plan)` (`:68-85`) | No unfinished session, else `sessionAlreadyRunning`. `validate(plan)` passes, else `invalidPlan`. | A fresh `SessionState` with `dayKey = dayKeys.key(at: stamp.wall)` (fixed forever) and a single event `.started` whose id is the requestID. Starting after a finished session is allowed and replaces it. |
| `.acknowledgeEffect(e)` (`:87-89`) | A session exists, else `noSession`. | `state.acknowledging(e)`. No event is appended. |
| `.pause` (`:91-98`) | The reconciled status is `.running(_)`, else "Nothing is running to pause." | Append `.paused`. |
| `.resume` (`:100-105`) | Status is `.paused`, else "The session is not paused." | Append `.resumed`. |
| `.noteIdle` / `.noteReturned` (`:107-113`) | None beyond "exists and is not finished". | Append `.idleBegan` / `.idleEnded`. |
| `.skipRest` (`:115`) | Same as `shortenRest(remaining: 0)`. | — |
| `.shortenRest(to:)` (`:118`) | See `shortenRest` below. | — |
| `.finishEarly` / `.abandon` (`:121-125`) | Exists and is not finished. | Append `.finished(.early)` / `.finished(.abandoned)`. |

**Shared helper `append`** (`:179-195`):

- Rejects `noSession` and `sessionFinished`.
- Runs `SessionReconciler.reconcile(state, now: stamp)` and passes the derived status to the precondition closure.
- On success, appends `LifecycleEvent(id: requestID.raw, stamp, kind)`.

**Shortening a break** (`:202-226`):

```swift
// Sources/SessionDomain/Reducer.swift:209
let now = SessionReconciler.reconcile(state, now: stamp)
guard case .running(let kind) = now.status, kind == .rest else {
    return .no(.notApplicable("There is no break running to shorten."), keeping: state)
}
// Never longer than what is left: "shorten" that lengthens is how ending
// a break turned two minutes into six (6 Oct 2026).
let leave = max(0, remaining)
guard leave < now.remainingInPhase else {
    return .no(.notApplicable("The break already has less than that left."), keeping: state)
}
let newTotal = now.servedInPhase + leave
return .ok(state.appending(LifecycleEvent(
    id: command.requestID.raw, stamp: stamp,
    kind: .restShortened(index: now.phaseIndex, to: newTotal))))
```

**Plan validation** (`validate`, `:282-292`). A plan is rejected when:

- it has no phases;
- it has no focus phase;
- any `plannedDuration <= 0`;
- any `phase.index` differs from its array position.

**Entry points the service calls (not commands).** None of these is a `Command`, but they write through the same single writer.

- `noteProcessStart(_:requestID:clocks:)` (`:131-143`): runs on launch. It is a no-op when there is no session or the session is finished, and idempotent on requestID. It appends `.processStarted`.
- `noteHeartbeat(_:clocks:)` (`:149-157`): the event id is derived from the stamp, `"alive-<epochSeconds>"`, and the event goes through `heartbeating`, which coalesces. Finished sessions are ignored.
- `noteClockAnomaly(_:seconds:requestID:clocks:)` (`:162-175`): only records when `abs(seconds) >= clockAnomalyThreshold`. The threshold is `120` seconds (`:48`): "far more than NTP ever corrects in one step… far less than a time-zone change or a user dragging the date."
- `completeIfServed(_:requestID:clocks:)` (`:242-256`): appends `.finished(.completed)` only when reconcile reports `.readyToComplete`.
- `abandonIfStale(_:requestID:clocks:)` (`:266-280`): appends `.finished(.abandoned)` only when the status is `.readyToAbandon`. Because the reason is abandoned, `isSuccess` is false, so a stale session never counts as completed in DayScore (`:263-265`).

### 3.2 Reconcile.swift: `SessionReconciler.reconcile(_:now:)` (`Reconcile.swift:153`)

`reconcile` is a pure function of (plan, events, now). It caches nothing and can be called any number of times.

**Constants:**

- `longAbsenceThreshold = 10 * 60` seconds (`:141`).
- `staleAfter = 18 * 60 * 60` seconds (`:151`). Eighteen hours rather than 24, because it "has to be long enough to survive a night's sleep… and short enough that yesterday's session is never today's." It is measured from the last event, deliberately without a timezone.

**Four policies stated in the header** (`:16-25`):

1. Closing the window is a no-op. No event exists for it.
2. Time while the app was terminated is not focus. The gap before `processStarted` is downtime.
3. A long gap prompts the user rather than being counted.
4. A break that ends while Nick is away enters `waitingForReturn` and **stays** there.

**Algorithm:**

1. **Not started.** With no `.started` event, return `.notStarted` with phase 0 (`:157-165`).
2. **Build segments** (`:230-285`). Walk the events after `started`. For each event, the segment from the previous stamp to this event gets these fields:
   - `duration` and `source`, from `elapsed(since:)` (so monotonic when possible);
   - `paused` and `idle`, as the flags stood **before** this event;
   - `downtime = (event.kind == .processStarted)`;
   - `endWall`.

   After recording the segment, the event updates the flags: paused, resumed, idleBegan, idleEnded. A `.finished` event returns immediately, so nothing after it counts. A tail segment runs from the last event to `now`.
3. **Rest overrides** (`:289-297`). The **latest** `restShortened` total per phase index wins, which allows shortening twice.
4. **The walk** (`Walk.consume`, `:492-566`) pours each segment into phases:
   - If `waitingForReturn` is set and the segment is not idle, clear the hold. This is "the only thing that does" (`:494`).
   - If everything is already served, the time goes to `uncounted`.
   - `paused = segment.paused`.
   - If the segment does not count (`paused || downtime`), it goes to `uncounted`. **Only downtime records an `Absence`**, because "a pause is a decision Nick made on purpose, and asking him to account for time he deliberately stopped the clock on would be nagging" (`:505-507`).
   - While waiting for return, time goes to `uncounted`.
   - If `segment.source != .monotonic`, set `usedWallClock = true`.
   - Otherwise fill the phase up to `effectiveDuration` (override or `plannedDuration`), then spill the remainder into the next phase. Completing a focus phase increments `completedFocusBlocks`. **If a rest phase completes during an idle segment**, set `waitingForReturn = true` and `heldAfterRest = phase.index`, advance the index, put the rest of the segment into `uncounted`, and stop (`:547-555`). Passing the last index sets `everythingServed`.
   - **Idle during focus still counts** (`counts` ignores idle). Idle only matters at a rest→focus boundary.
5. **Status precedence** (`:183-197`):

```swift
// Sources/SessionDomain/Reconcile.swift:183
let status: SessionStatus = {
    if let recordedFinish { return .finished(recordedFinish.reason) }
    if walk.everythingServed { return .readyToComplete }
    if (walk.paused || walk.waitingForReturn),
       now.wall.timeIntervalSince(lastEventWall) >= staleAfter {
        return .readyToAbandon
    }
    if walk.waitingForReturn { return .waitingForReturn(afterRestIndex: walk.heldAfterRest) }
    if walk.paused { return .paused }
    return .running(plan.phase(at: walk.phaseIndex)?.kind ?? .focus)
}()
```

`lastEventWall` counts events of any kind, heartbeats included. That makes the rule conservative: it can only fire later, never sooner (`:177-181`).

6. **Outputs.** `phaseIndex` is clamped to `lastIndex`. `remainingInPhase = max(0, effectiveTotal − servedInPhase)`. `approximate` is true when `usedWallClock` or when any `clockAnomaly` event exists (`:203-204`). Effects are filtered against `acknowledgedEffects` (`:224`).

**Effects built by `buildEffects`** (`:301-451`):

- **Always:**
  - `askAboutAbsence` for each downtime absence of at least 10 minutes. Id: `<s>/<phase>/absence@<endWallEpoch>`.
  - `reportClockAnomaly` for each anomaly event. Id: `<s>/-/clock-anomaly@<eventID>`.
- **`.running(kind)`:** effects for the **current phase only**. A phase that was overtaken while the app was shut is never narrated (`:338-341`). The effects are:
  - `announce(focusBeginning | restBeginning)`, id `<s>/<i>/phase-announce`;
  - then `startClip` (`<s>/<i>/phase-clip`) if the phase has a clip, otherwise `stopClip` (`<s>/<i>/clip-stop`).
- **`.paused`, `.readyToAbandon`:** nothing. For readyToAbandon, the `.finished(.abandoned)` pass that follows owns the reaction, so emitting here would fire twice (`:373-377`).
- **`.waitingForReturn(i)`:** `announce(.waitingForReturn)`, id `<s>/<i>/waiting-for-return`.
- **`.readyToComplete`:** `announce(sessionComplete)` (`<s>/-/finish-announce`) and `stopClip` (`<s>/-/clip-stop`).
- **`.finished(reason)`:**
  - `stopClip`;
  - an announcement: `sessionComplete` for completed, `sessionEndedEarly` for early, nothing for abandoned;
  - `appendHistory`, id `<s>/-/history`. There is exactly one history record per session, ever, because the id has no phase component (`:426-427`).

  The completed announcement shares an id with the readyToComplete one. The incident note at `:400-407` explains why: the service turns readyToComplete into the terminal event in the same pass, so the original `.early`-only announce meant "a finished session ended in silence."

**How reconcile handles wake, clock jumps and DST:**

- Duration always comes from `ClockStamp.elapsed`.
- A dragged wall clock or a DST change on the same boot: the uptime difference is still valid, so served time is unaffected. Tests cover ±3600 s and spring-forward then back.
- Sleep with the app still running: monotonic uptime keeps counting while asleep on macOS (`Clocks.swift:49-52`), so a short lid-close counts. A reboot appears as uptime going backwards, which falls back to wall time. The following `processStarted` marks that gap as downtime, and a gap of 10 minutes or more prompts.
- The *size* of a clock jump is recorded separately, through `noteClockAnomaly`, which the service detects by comparing the two clocks between ticks.

### 3.3 Clocks.swift

- `WallClock.now: Date` is used for persistence and for anything that crosses a process boundary.
- `MonotonicClock.uptime` is `ProcessInfo.systemUptime`, which is `mach_absolute_time` scaled. It is used for in-memory durations (`Clocks.swift:35-62`).
- `Clocks` bundles both "so no call site can accidentally take only the convenient one" (`:66-80`).
- There is no `Date()` or `mach_absolute_time` anywhere in the domain except inside `SystemWallClock` and `SystemMonotonicClock` (`:23-26`).
- Test doubles:
  - `StubWallClock` has `advance` and `set`. `set` is named so that "a test that moves time backwards has to say so out loud" (`:105-110`).
  - `StubMonotonicClock.advance` has a `precondition(interval >= 0)`. `reset(to:)` exists only to model a reboot (`:127-143`).

### 3.4 ZonedTime.swift

- **`IANAZone`** (`:81-113`). The accepted set is exactly `TimeZone.knownTimeZoneIdentifiers` (443 names on this system). Fixed-offset zones such as `GMT+0500`, `EST` and `Zulu` are refused. `UTC` is refused because Foundation reads it back as `"GMT"`, so `IANAZone.utc = GMT`. `Asia/Calcutta` is accepted and `Asia/Kolkata` is not. `calendar(in:)` returns a Gregorian calendar with the locale pinned to `en_US_POSIX`.
- **`CivilDay`** (`:123-266`). A year, month and day with no instant.
  - The `init` reads the result back from the calendar, because `Calendar.date(from:)` silently rolls 29 Feb 2026 forward to 1 Mar (`:134-139`).
  - The `key` initialiser accepts strict `yyyy-MM-dd` only.
  - `init(of:in:)` requires a zone.
  - `key` is built with `String(format:)`, not `DateFormatter`.
  - `start(in:)` builds midday, then calls `startOfDay`, which handles zones where midnight does not exist.
  - `interval(in:)` ends at the next day's start, not at +86 400 s, so DST days come out as 23 or 25 hours.
  - It is encoded as a bare string.
- **`ZonedInstant`** (`:277-404`).
  - Fields: `instant` (rounded to the millisecond so it round-trips), `zone` (the anchor) and `originalZone` (provenance only).
  - `init?(wall:in:)` returns nil for nonexistent wall times such as 02:30 on a spring-forward morning.
  - `rezoned(to:)` keeps the instant. `reanchored(to:)` keeps the wall clock and is optional.
  - Wire format: `{utc: ISO-8601 with ms and Z, zone, originalZone}`. Zones are validated on decode.
- **`AllDaySpan`** (`:415-480`). `from` plus an **inclusive** `through`, clamped so it is never inverted. The only way to get time from it is `interval(in:)`, which requires a zone.
- **`ZonedTime`** (`:487-551`). A sum type, `.moment(ZonedInstant) | .day(AllDaySpan)`, with **no `instant` property**. It encodes as `{kind: "moment"|"day", ...}` and rejects unknown kinds.

---

## 4. Policies

### BreakLock (`BreakLock.swift`)

- **Rule.** A rest surface you cannot dismiss: no Escape, no shortcut. The only early exit is giving a vital reason out loud and being believed.
- **What it deliberately leaves alone.** Cmd-Tab, Force Quit and the power button still work (`:16-21`): "The lock is meant to beat reflex, not to beat its owner."
- **Lengths.** `BreakLength` has two values, `.full = 600` s and `.short = BreakLock.floor = 180` s (`:35-56`). There are only two choices, because "a slider invites negotiating the number down every time."
- **The floor** (`:78`) is the shortest break that can be *chosen*. It is not a window during which escape is disabled: "A real emergency at minute one has to be able to get out at minute one" (`:23-27`).
- **States.** `state(at:)` (`:101`) returns `.held(remaining, pleadable: true)`, `.served` or `.released(BreakRelease)`. `progress` is clamped to 0…1 and freezes at release.
- **Release.** `grantRelease(reason:at:)` (`:126`) refuses empty or whitespace-only reasons, because an empty one "means the judging step failed open." It also refuses a second release.
- **Release record.** `BreakRelease { reason, at, served }` is Codable, so that "a week of vital reasons" can be reviewed (`:58-72`).
- **Mutation note.** `grantRelease` is a `mutating func` on a value type. This is the one in-place-style API in the domain, which otherwise always returns new values (`SessionState`, `Enforcement`).

### ExitPolicy (`ExitPolicy.swift`)

- **Rule.** The deterministic check comes first and the model second. A model that is down, slow or adversarial must never trap him (`:4-24`).
- **Two exits.**
  1. `Enforcement.release`, which is unconditional.
  2. The fail-closed hatch.
- **Constants.** `attemptsBeforeRelease = 3` (`:79`) and `window = 5 * 60` (`:82`).
- **`decide(requests:modelVerdict:now:)`** (`:90-110`):
  - It counts requests inside the window with `modelUnreachable == true`. Three or more returns `.releasedByFallback(after:within:)` **before** the model's verdict is even read.
  - A nil verdict returns `.undecided` with the message "Ask twice more and I'll let you out anyway."
  - Otherwise it returns `.granted` or `.refused`.
  - `isFallback` flags the archive.
- **`remainingAttempts`** (`:113`) is there so the UI can tell him how many more tries are needed.

### DistractionPolicy / DistractionFloor (`DistractionPolicy.swift`)

- **Rule.** This file decides what *may be considered* for quitting. The model then picks from that set, and it can only narrow it. Screening runs again at the moment of quitting (`:14-21`). Every ambiguous case resolves to "leave it open" (`:23-25`).
- **`DocumentState`** has three values: `clean`, `edited` and `unknown`. Unknown is never treated as clean (`:32-43`).
- **`neverQuit`** (`:142-184`) covers:
  - Orion and the machine: Finder, loginwindow, SecurityAgent, System Settings, Installer, Disk Utility.
  - **Music and Spotify**, added after the incident on 2026-10-06 where the reviewer quit Music mid-song.
  - Password managers: 1Password, Bitwarden, LastPass, KeePassXC, Passwords.
  - Terminals and editors: Terminal, iTerm2, Warp, Ghostty, kitty, WezTerm, Alacritty, Xcode, VS Code, Cursor, IntelliJ.
  - Recorders and calls: QuickTime, OBS, Zoom, Teams.

  The list is framed as engineering judgement about what may never be closed, not as a list of what may be.
- **`recentUseGrace = 120`** seconds (`:190`).
- **`screen(_:)`** (`:193-221`) checks in order:
  1. empty bundle id;
  2. on the `neverQuit` list;
  3. system component (`/System/Applications` does *not* count, so Messages is fair game);
  4. background-only;
  5. edited documents;
  6. unknown document state;
  7. frontmost;
  8. used within 120 s. A nil "since" means never switched to, which is eligible.
- **`partition`** (`:226`) keeps a reason for every app it blocks, for the audit trail.

### Enforcement (`Enforcement.swift`)

- **Honest claim.** It detects a disallowed frontmost app and extended inactivity. It **cannot** see drift inside an allowed app, and the UI must not imply that it can (`:9-14`).
- **Directions** (`:33-41`): `keepOnTask`, and `keepAway` (reverse lockdown).
- **Levels** (`:43-54`):
  - `gentle` speaks once, then stops.
  - `guided` speaks, then brings the work context forward.
  - `firm` hides the app.
  - `shield` shows a reversible surface.

  Only `gentle` does not escalate.
- **`Allowlist`** (`:87-130`). It must be `confirmed` before it enforces anything ("the model proposes; Nick authorizes"). `alwaysAllowed` contains Orion, Finder, loginwindow, 1Password, System Preferences and SecurityAgent, and it holds in both directions. A nil frontmost app counts as allowed, i.e. it fails open on nagging.
- **Policy defaults** (`:176-188`): `idleThreshold` 300 s, `wrongAppGrace` 60 s, `nudgeInterval` 60 s, `disengageAfter` 6.
- **`decide(...)` order** (`:224-301`):
  1. `released` → `.none`.
  2. Not focusing → `.none`, and clear `driftingSince`.
  3. Allowlist not confirmed → `.none`.
  4. Screen locked → `.none`.
  5. Classify drift as on-task, within grace or drifting. On-task resets `escalations` and `driftingSince`, but **not** `disengaged`.
  6. Already disengaged → `.none`.
  7. Gentle level with escalations ≥ 1 → `.none`.
  8. Last nudge less than `nudgeInterval` ago → `.none`.
  9. Escalations ≥ 6 → `.disengage`, said once.
  10. Otherwise `.nudge(escalation: n)`.
- **Drift classification** (`drift`, `:315-345`). Idle is only drift in keep-on-task mode, and the threshold is its own grace period. A wrong app gets the grace period on top, tracked through `driftingSince`.
- **`release`** (`:353`) is unconditional and "depends on nothing that can be unavailable."

### TimeZonePolicy (`TimeZonePolicy.swift`)

- **Problem** (`:8-15`). The cron jobs are pinned to `America/New_York` and macOS auto-timezone is on. After landing in London, the 02:10 NY rollup runs at 07:10 London time and nothing notices. So detection compares two values (home vs. device) rather than watching for a zone-change event.
- **Trip vs. move.** These cannot be told apart from what the machine can observe, so the user records an `ExpectedMove { destination, on: CivilDay, place? }` in advance. `on` is the arrival day (`:58-60`). The origin story: Nick said on 2026-07-31 that he was moving, and "A date in a sentence is not a mechanism" (`:38-41`).
- **`ZoneVerdict`** (`:96-130`) has five cases: `settled`, `travelling`, `moveArrived(from,to,place)`, `moveDue(to,on,daysLate)`, `moveScheduled(to,on,daysAway)`. `warrantsAttention` is false only for `settled` and `moveScheduled`.
- **`verdict(device:at:)`** (`:166-206`):
  1. `today` is computed in the device's zone.
  2. With no move recorded, the answer is settled or travelling.
  3. If home already equals the destination, the move is treated as spent: settled or travelling.
  4. **If the device is at the destination, the answer is `moveArrived` regardless of date**, so early arrival counts.
  5. If the date has arrived and he is still at home, `moveDue(daysLate)`. If away somewhere else, travelling.
  6. Before the date: at home gives `moveScheduled(daysAway)`, away gives travelling.
- **`dayGap`** (`:213`) walks `CivilDay`s instead of dividing by 86 400 (DST) and never goes negative.
- **`accepting(_:)`** (`:230`) moves home to the destination, carries `place` over, and clears the expectation so the "arrived" notice does not repeat forever.
- **Non-goal.** It does not re-home anything. `scripts/orion-timezone` does that, as a reviewable action you can dry-run (`:43-49`).

### TravelMode (`TravelMode.swift`)

- **Rule.** It is a reading layer only and never changes stored data, which makes it safe to switch on automatically (`:10-17`).
- **Activation.** `isActive` is true when `home.identifier != device.identifier` (`:131`), during a trip and after a move alike.
- **Clocks.** `clocks(at:)` returns one reading when at home (a duplicated clock "reads as a bug") and two otherwise, device first (`:137-140`).
- **Unsociable hours.** `isUnsociable` uses `sociableFrom = 8` and `sociableUntil = 23`, matching `orion-standing`'s quiet hours (`:162-171`).
- **Journey** (`:64-105`). Two `ZonedInstant`s. Construction fails for an empty title or an arrival before departure. `duration` comes from the instants, because subtracting wall clocks turns a 7-hour flight into 12 (`:36-37, 83-87`). `clockShiftHours` is positive going east.
- **`displacementHours(at:)`** reads both zones at the given instant, so DST dates that do not line up between zones are handled.

### DayScore (`DayScore.swift`)

- **Policy v2** (`:4-21`):
  1. Whoop data alone can carry a day.
  2. Tasks count.
  3. The score is out of 10 with one decimal.
- **Invariants.** Missing is not zero: a missing component is excluded and its weight redistributed. Components are visible. The policy version is persisted (`:25-37`).
- **Groups and components:**
  - work: `focusServed`, `focusCompletion`, `tasks`
  - body: `recovery`, `sleep`, `exertion`
  - care: `selfCare`, `nutrition`
- **`ScorePolicy`** (`:123-184`): `currentVersion = 2`; shares work 0.45, body 0.40, care 0.15; `minimumCoverage = 0.15`; `confidentCoverage = 0.5`.
- **Component weights** (as a share of the day): focusServed 0.40·w, focusCompletion 0.20·w, tasks 0.40·w, recovery 0.425·b, sleep 0.375·b, exertion 0.20·b, selfCare 0.60·c, nutrition 0.40·c. The comment on minimum coverage says a bottle of water alone, at 9% of the day's weight, is refused.
- **`score(dayKey:inputs:policy:)`** (`:245-297`):
  - A component supplied more than once keeps the last value.
  - Omitted components become unavailable.
  - Coverage = present weight / total weight.
  - Effective weight = weight / present weight.
  - Below minimum coverage, `value` is nil with an `insufficient` explanation.
  - `isProvisional` when coverage is below 0.5.
  - `displayValue` is `"—"` when there is no value, and never `"0"`.
- **Input builders** (`:317-424`):
  - `focusInputs`: no records means unavailable ("A day Nick spent in meetings is not a day he failed at focus").
  - `tasksInput`: `cleared*0.7 + min(1, completed/4)*0.3`. Only overdue tasks count against the day.
  - `recoveryInput` and `sleepInput`: Whoop percent / 100.
  - `exertionInput`: inside the band scores 1. Under the band: `0.35 + 0.65·(strain/low)`. Over the band: `max(0.55, 1 − (strain−high)/8)`. The band comes from `StrainTarget` in the app.
  - `selfCareInput`: averages only the parts that were actually logged.
  - `nutritionInput`: `max(0, 1 − |cal−goal|/goal)`, symmetric.

### AgendaPlacement (`AgendaPlacement.swift`)

- **The bug it replaces** (`:4-18`). `AppleCalendarSync.events(on:)` used `calendar.isDate($0.start, inSameDayAs:)`. An all-day event on 8 Sept written in London is stored as `2026-09-07T23:00Z`. Read in New York, that lands on the 7th.
- **Rule.** All-day membership compares civil days. Timed membership uses instant overlap with the day's interval, so a meeting from 23:30 to 00:30 appears on both days (`:40-55`).
- **`span(from:to:in:)`** (`:70-79`) treats the end as exclusive only when it falls exactly on a day boundary in `zone` **and** after the start day. An inclusive 23:59:59 end therefore still comes out right.

### CalendarRange (`CalendarRange.swift`)

- **Rule.** Fetch the visible interval plus padding, never a fixed number of days (`:4-15`). For a month view the visible interval is the **grid**, not the month.
- **The padding bug** (`:59-66`). The padding is the union of the previous, current and next pages' visible intervals. The naive "+1 month" was wrong: April's grid runs 29 Mar to 2 May and May's runs 26 Apr to 6 Jun, so adding a month to April's end lands on 2 June. That is 4 days short, and the last row stayed blank until a refetch.
- **`monthGrid`** (`:119-137`) returns whole weeks: `ceil((lead + days)/7)`, which is 4, 5 or 6 weeks.
- The calendar is injected and defaults to `.current`.

### SessionPlan (`SessionPlan.swift`)

- **Rule.** A plan is immutable. Durations are what the user *requested*, and shortening appends an event instead of rewriting the plan (`:4-13`).
- **`ClipAssignment { name, fit: ClipFit, mediaDuration? }`** (`:36-57`). Clip N is not tied to block N, and shuffle is supported. The media duration is stored separately from the phase duration ("plan correction #10").
- **`ClipFit`** (`:61-69`) defaults to `.trimOrLoop`: a 43-minute clip loops and a 62-minute clip is trimmed. `.useClipLength` is the only way media length changes the duration, and it happens at plan time, in `duration(for:requested:)` at `:245`. A nil or non-positive media duration keeps the requested value.
- **`plannedDuration`** is computed rather than stored. That way a clip swapped in by shuffle cannot leave a stale duration behind (`:85-93`). The persistence test asserts that `plannedDuration` never appears in the JSON.
- **Builders:**
  - `alternating` (`:161`) defaults to 3 × 50-minute focus with 10-minute rests **between** blocks only. Ending on a rest "is a way to make someone resent it." Clips cycle.
  - `sequence` (`:212-232`, added 6 Oct 2026) takes any order. It returns nil if the list is empty, longer than 12, has no focus phase, or has any phase outside 1 s to 4 h. Clips cycle over focus phases.
  - `assigning(_:to:order:)` (`:259`) shuffles with an injected permutation, so the result is reproducible.

---

## 5. History (`git log` per file)

**Reducer.swift**
- `87b49ed` 2026-10-06 fix(focus): ending a break no longer lengthens it; any work/break sequence can start
- `9c511d2` 2026-09-01 fix: expire stale focus sessions, and stop the calendar promise being false
- `d58ee40` 2026-08-11 feat: the pure session domain — models, reducer, and reconcile(now:)

**Reconcile.swift**
- `9c511d2` 2026-09-01 fix: expire stale focus sessions… (added `readyToAbandon` and `staleAfter`)
- `b4baaa0` 2026-08-11 feat: clip playback, and the heartbeat off the main run loop
- `77f8484` 2026-08-11 feat: the command socket, the script client, and the session wired into the app
- `d58ee40` 2026-08-11 feat: the pure session domain…

**SessionState.swift** (also Effects, Events and Commands)
- `d58ee40` 2026-08-11 is the only commit.

**BreakLock.swift**
- `93e9a42` 2026-08-20 checkpoint: capture outstanding local work before first push (only commit)

**ExitPolicy.swift**
- `d013d8c` 2026-08-11 feat: a deterministic way out, and session speech in Orion's real voice

**DistractionPolicy.swift**
- `e9cfc38` 2026-10-06 fix(focus): Music keeps playing; playlists, minimize, today and the hologram in sessions
- `93e9a42` 2026-08-20 checkpoint…

**TimeZonePolicy.swift**
- `168351c` 2026-09-01 feat(phase-40): time that survives a flight, and a day key that was already wrong

**TravelMode.swift** (also AgendaPlacement)
- `36ae8a0` 2026-09-01 feat(phase-40): calendar day placement by civil day, and Travel Mode as a reading layer

**DayScore.swift**
- `93e9a42` 2026-08-20 checkpoint… (inferred: the v2 policy rewrite landed here)
- `694b762` 2026-08-11 feat: Gate 10, part one — day score, quittable apps, Do Not Disturb, Music

**Other files:**
- Enforcement: `e23fcab` 08-11 (sensing and Firm enforcement, with an escape that cannot fail), `d623dab` 08-11 (Gate 10 complete: reverse lockdown, full-bleed, camera presence), `93e9a42` 08-20.
- SessionPlan: `d58ee40`, `87b49ed`.
- ZonedTime and Identifiers: `168351c` 09-01 (this is where the `CutoffDayKeys` DateFormatter fix landed).
- CalendarRange: `1412945` 08-11 (a factual calendar).
- Clocks: `8baac06` 08-11 (a pure-domain target and its test suite), then `d58ee40`.

**Timeline in one line:** the domain was built on 2026-08-11 (Gates 0–10), checkpointed on 08-20, fixed for Phase 40 (zones) and staleness on 09-01, and patched on 10-06 for break shortening, `sequence`, and Music.

---

## 6. Gotchas and incidents recorded in comments

1. **"Shorten" that lengthened a break (6 Oct 2026).** Ending a break turned 2 minutes into 6. The reducer now refuses any `leave >= remainingInPhase` (`Reducer.swift:214-219`). Test: `testShorteningNeverLengthensABreak`.
2. **A paused session that never expired.** A session paused on 2026-08-12 was still paused on 2026-09-01, accumulating heartbeats for 20 days. Its log had 60 `processAlive` and 48 `processStarted` events. The update path had been "taught to gate on `.running`" as a workaround. The fix is `readyToAbandon` with an 18-hour `staleAfter` (`Reconcile.swift:45-55, 143-151`; `AdversarialTests.swift:288-330`).
   - (inferred, open question) Staleness is measured from the last event **including heartbeats**. `SessionService.tick()` (`Sources/SessionService/SessionService.swift:210-218`) writes a heartbeat on every tick while a session is unfinished, paused included. So if the app stays up continuously, a paused session's last event stays fresh and may never reach 18 hours. The test only shows expiry after a long *down* period.
3. **A finished session that ended in silence.** The announce used to fire only for `.early`. The `readyToComplete` announce never got dispatched because the terminal event was written in the same pass. The fix is a shared `finish-announce` id (`Reconcile.swift:399-410`).
4. **Off-by-one day key from `CutoffDayKeys` (measured 2026-09-01).** A static `DateFormatter` had no time zone, so it formatted in the machine's zone while `dayStart` used the injected calendar's zone. With a London calendar on a New York machine, `2026-09-08T04:30Z` gave the key `"2026-09-07"`. The tests did not catch it because they injected NY on a NY machine, the self-verifying pattern AGENTS.md warns about. The fix replaced the formatter with `CivilDay` (`Identifiers.swift:138-157`). The ZonedTime test header notes the defect survived a suite of 322 tests.
5. **A UTC day-key bug shipped once before in `orion-daily`.** `toISOString()` filed every evening's memory under the next day (`Identifiers.swift:111-114`).
6. **Music quit mid-song (2026-10-06).** The reviewer judged Music "not part of certification work." Music and Spotify are now on `neverQuit` (`DistractionPolicy.swift:145-148`).
7. **Enforcement grace that never elapsed.** Clearing `driftingSince` inside the grace window restarted the clock on every observation, so a wrong app was never reported. "That bug made every escalation test fail at once" (`Enforcement.swift:270-275`).
8. **A mutation test caught an overclaiming comment in TimeZonePolicy.** Every branch that reads `today` is one where the device is at home, so device vs. home zone currently makes no difference. The old comment claiming otherwise was wrong. Separately, two identical `deviceIsDestination` branches had made `arrivedOnTime` look like a gate when it never was (`TimeZonePolicy.swift:158-189`).
9. **`Calendar.date(from:)` is lenient.** 29 Feb 2026 rolls to 1 Mar, which defeats the obvious day-range check. Hence the read-back comparison (`ZonedTime.swift:134-139`).
10. **`UTC` is not an accepted identifier; `Asia/Kolkata` is not canonical** on this system (`ZonedTime.swift:72-80`).
11. **Month-grid padding was short by 4 days** (April → May). Fixed with a union of the real neighbouring pages (`CalendarRange.swift:59-66`).
12. **Debug log leaked enum descriptions** like `running(SessionDomain.PhaseKind.focus)`. Fixed with `SessionStatus.label` (`Reconcile.swift:66-68`).
13. **Renaming an `EffectKindName` un-acknowledges every persisted effect of that kind**, and Orion repeats everything. Change them only with a migration (`Effects.swift:142-146`).
14. **Before heartbeats, a crash voided the whole block.** A crash at minute 49 of a 50-minute block lost everything. The loss is now bounded to one heartbeat interval (`Events.swift:160-166`; HeartbeatTests).
15. **Idle during focus still counts** (deliberately). Idle only matters when a rest ends, which produces `waitingForReturn` (`SessionCycleTests.testGoingIdleDuringFocusStillCountsTheTime`).

---

## 7. Tests: what each file proves

- **Harness.swift.** Not tests itself; it is the driver they all use.
  - `advance` moves both stub clocks in 30-second heartbeat steps (`heartbeatInterval = 30`).
  - `advanceWhileDown` moves time without heartbeats.
  - `dragWallClock` moves the wall clock only. `reboot(after:)` resets uptime.
  - `send` calls the reducer with automatic `req-N` IDs. `drainEffects` acknowledges effects.
  - Plans: `shortPlan` (2/1/2 min) and `fullPlan` (50/10/50/10/50).
  - Day keys use a New York calendar. `defaultStart` is epoch 1 772 452 800, i.e. 2026-03-02.
- **SessionCycleTests.** The normal lifecycle: a full cycle completes; pause stops the clock; pausing with nothing running is rejected; a paused stretch never prompts. Skip and shorten work, a break can be shortened twice, shortening never lengthens, and shortening is rejected during focus. A rest that ends while idle waits indefinitely (`testARestEndingWhileIdleWaitsAndKeepsWaiting`) and coming back releases it. Finishing early counts as success and abandoning is a distinct outcome. Nothing applies after the end. A second start is refused while running and allowed after finishing. A plan with no focus block is refused. The 50/10 plan has the expected shape.
- **AdversarialTests.**
  - Idempotency: the same request applied once; a retried finish reads as `alreadyApplied`; two different finish requests do not both archive.
  - Effect replay: an acknowledged effect is never re-emitted; history is emitted once across many reconciles; an unacknowledged effect survives for retry; a stale announcement for an overtaken phase is not replayed.
  - Downtime: it does not count; a long gap prompts; a short one does not.
  - Reboot and sleep: the session survives a reboot; short sleep counts; a long absence across a restart does not.
  - Clocks: dragging the wall clock ±1 h and DST do not change served time; an anomaly makes the record approximate; a 5-second correction is ignored.
  - Window close is a no-op.
  - Staleness: a paused session survives one night but not two; restarts alone do not keep a stale session alive; a fully served session is completed, not abandoned; `abandonIfStale` writes the terminal event.
  - Pause and idle hold both survive a restart.
- **HeartbeatTests.** A crash at minute 49 keeps at least 49 minutes minus 30 seconds. Loss is bounded by the interval. Heartbeats coalesce, and a real event breaks the coalescing. A heartbeat moves forward, never changes derived answers, is ignored on a finished session, and does not disturb a pause.
- **PersistenceTests.** State round-trips, and reconciliation is identical after a round trip. The empty document is valid. Corrupt or truncated bytes throw instead of reading as "no session". A future version is refused. Every store error has a user-facing message. Migration of the current version is a pass-through, and versions below the oldest are refused. `testTheOnDiskShapeIsWhatWeThinkItIs` checks `"schemaVersion" : 1`, `dayKey` `"2026-03-02"`, and that `plannedDuration` is absent. The day key uses the 4 am cutoff rather than UTC (22:30 and 02:00 belong to the same day). The day is fixed at start.
- **SequencePlanTests.** A sequence keeps its order and lengths. A session can open on a break. Two consecutive focus phases stay separate. Impossible sequences return nil.
- **ClocksTests.** Wall clock forward and back; the monotonic clock accumulates; moving the wall clock backwards does not move elapsed time; the system monotonic clock never goes backwards.
- **BreakLockTests.** 10 and 3 minute lengths, and short equals the floor. The break is held for its whole length. The plead route is offered from second one. A release ends it immediately. An empty reason is refused, and a second release is refused. The reason is kept. Progress is clamped and freezes at release, and is never negative before the start.
- **ExitPolicyTests.** Model agree lets him out, refuse keeps him in, unreachable is undecided. Remaining-attempts count. Three unanswered requests in 5 minutes open the hatch. Requests outside the window do not count. The hatch opens even when the model says no. Requests the model did answer do not count. With nothing working at all, he still gets out.
- **DistractionFloorTests.** All refusals: edited, unknown, unsaved changes outranking every allow-signal, Orion, machine and credential apps, terminals, editors and recorders, frontmost, used in the last 2 minutes, background or system, no bundle ID. Never-switched-to is eligible, and so is a non-machinery Apple app. Partition keeps a reason for every refusal.
- **EnforcementTests.** An allowed app is silent and an unreadable one is not drift. A glance does not count but staying past the grace period does. Coming back resets the ladder. Always-allowed apps never count. Idle past the threshold is drift; brief idle and a locked screen are not. Gentle speaks once; firm escalates; every level above gentle uses the bounded ladder. Nudges are spaced. After 6 it disengages once and stays quiet even after he drifts again. The escape is unconditional and has no dependencies. An unconfirmed allowlist does nothing. Reverse lockdown: nudges for listed apps, silent otherwise, never about idling, honours always-allowed, the escape works, and it caps at 6. A break is not drift, and drift does not carry into the next block.
- **DayScoreTests.** A perfect day is 10.0 with one decimal and the work/body/care split. A Whoop-only day scores, on its own merits, and is provisional. A tasks-only day scores. A scrap of self-care is refused and an empty day refuses. Missing is excluded, not zero, and missing differs from a real 0. No session is not a focus failure. Omitted components become unavailable. Every component reports itself. Coverage and policy version are carried. Focus inputs come from history and sum across sessions. Task, strain, self-care and nutrition mappings are covered (strain inside, under and over the band; nutrition penalised in both directions).
- **TimeZonePolicyTests.** The scenario: New York on 2026-09-01, landing in London on the 8th. At home before the move gives scheduled. A trip elsewhere leaves home alone. Landing on the day, or early, is a move. Passing the move day while still home gives due. The day boundary decides scheduled vs. due, and the destination decides the move regardless of date. Accepting re-homes and clears the expectation; afterwards the verdict goes quiet. A spent expectation is treated as spent, and returning to NY afterwards is travelling. No recorded move means a mismatch is just travel. A clock jump only changes what it should. `dayGap` is non-negative and correct across DST. The policy round-trips through Codable and refuses non-IANA zones.
- **TravelModeTests.** Off at home, on away. One clock at home, two away with device first, possibly on different days. Displacement is read at the instant. Unsociable hours. Journey duration comes from the instants. Each end reads in its own zone. Westbound gives positive duration and a negative shift. Arriving before leaving is refused, and a title is required. A same-zone journey is still a journey. Travel Mode agrees with the policy about home.
- **ZonedTimeTests.** Fixed-offset and junk zones are refused, and accepted names round-trip byte for byte. Invalid civil dates and loose key formats are refused. DST days are 23 or 25 hours. Start of day works where midnight does not exist. Nonexistent wall times are refused. Offset is read at the instant. rezone vs. reanchor, including reanchor refusing. All-day has no moment and maps to a different interval in each zone. Spans are inclusive and clamped. Millisecond normalisation. The sum type round-trips. `testTheDayKeyIsRenderedInTheCalendarsOwnZoneOnEveryZoneThisSystemKnows` and `testTheLondonDayKeyOnANewYorkMachineIsTheLondonDay` are the regression guards for gotcha 4.
- **AgendaPlacementTests.** Every all-day assertion is written to **fail under the old instant rule**. All-day events do not move across zones. An exclusive midnight end adds no day, and an inclusive end is not shortened. Multi-day trips cover every day. A timed event overlapping midnight shows on both days, and one ending exactly at midnight does not spill over. DST day lengths are respected.
- **CalendarRangeTests.** Pinned to a New York calendar. Grids are whole weeks and 6 weeks when needed. The visible interval is the grid. Fetch pads a whole page each way, so paging one step needs no refetch and paging two does. Week and day intervals. Stepping from 31 Jan does not skip a month. Neighbouring-month days are marked.

---

## 8. Persisted data, Codable types, and configuration

**Persisted session state**
- **`focus-state.json`** holds a `SessionDocument`, written as pretty-printed JSON with sorted keys and ISO-8601 dates (`SessionState.swift:133-144`).
  - Default path: `~/.openclaw/orion-controlled/focus-state.json` (`Sources/SessionService/SessionStore.swift:31-36`).
  - Override: the env var `ORION_FOCUS_STATE` (`SessionStore.swift:38`). This is in the service target, not the domain.
- **Decoding** (`SessionState.swift:156-183`):
  1. A `VersionProbe` reads `schemaVersion` first.
  2. A version above `currentSchemaVersion` (1) throws `.fromTheFuture`.
  3. Unparseable bytes throw `.corrupt`, never an empty session.
  4. `Migration.migrate` runs (`:222-246`). `oldestReadable = 1`; anything lower throws `.unmigratable`. Today it is a no-op scaffold. The rule for future steps: "migrations only ever ADD or DERIVE."

**Persisted history**
- **`focus-history.jsonl`** has one compact line per `HistoryRecord`, append-only and never pruned (`Effects.swift:83-138`). The fields are: sessionID, dayKey, task, startedAt, endedAt, reason, planned and served focus and rest seconds, completed and total focus blocks, uncountedSeconds, approximate.
- Default path: `~/.openclaw/orion-controlled/focus-history.jsonl` (`Sources/SessionService/SessionHistory.swift:28-33`).

**Codable domain types:**
- Session: `SessionState`, `SessionDocument`, `LifecycleEvent`, `ClockStamp`, `EventKind`, `FinishReason`, `Command`, `CommandKind`, `CommandOrigin`, `SessionPlan`, `PhaseDefinition`, `ClipAssignment`, `ClipFit`, `PhaseKind`.
- IDs: `SessionID`, `PhaseID`, `RequestID`, `EffectID`.
- Policies: `BreakLength`, `BreakRelease`, `ExitRequest`, `DocumentState`, `EnforcementDirection`, `EnforcementLevel`, `Allowlist`, `ScoreComponent`, `ScoreGroup`, `ScorePolicy` (versioned), `CalendarGranularity`.
- Time: `CivilDay` (bare `"yyyy-MM-dd"`), `ZonedInstant` (`{utc, zone, originalZone}`), `AllDaySpan` (`{from, through, originalZone?}`), `ZonedTime` (`{kind, moment|day}`), `ExpectedMove` (`{destination, on, place?}`), `TimeZonePolicy` (`{home, place?, expectedMove?}`).
- Every zone field is validated through `IANAZone.resolve` when decoded.
- (inferred) The file that stores `TimeZonePolicy` is written by `scripts/orion-timezone` and the app. No path is named in the domain.
- `Effect`, `Announcement` and `Reconciliation` are **not** Codable. They are recomputed every time and never stored.

**Configuration**
- The domain reads **no environment variables and no UserDefaults**. The only mention is a comment saying the app's `OrionDay` reads UserDefaults (`Identifiers.swift:92-96`). That provider is injected through `DayKeyProvider`, and `CutoffDayKeys(cutoffHour: 4)` is the pure fallback.
- All thresholds are compile-time constants:

| Constant | Value | Where |
|---|---|---|
| Reducer clock-anomaly threshold | 120 s | `Reducer.swift:48` |
| Same-boot tolerance | 60 s | `Events.swift:60` |
| Long absence | 600 s | `Reconcile.swift:141` |
| Stale after | 64 800 s (18 h) | `Reconcile.swift:151` |
| Break floor | 180 s; full break 600 s | `BreakLock.swift` |
| Exit hatch | 3 requests / 300 s | `ExitPolicy.swift:79, 82` |
| Recent-use grace | 120 s | `DistractionPolicy.swift:190` |
| Enforcement | idle 300, grace 60, nudge 60, cap 6 | `Enforcement.swift:176-188` |
| Score shares | 0.45 / 0.40 / 0.15 | `DayScore.swift:148` |
| Score coverage | 0.15 minimum, 0.5 confident | `DayScore.swift:149` |
| Sociable hours | 8–23 | `TravelMode.swift:170-171` |
| Sequence limits | ≤12 phases, 1 s–4 h each | `SessionPlan.swift:218-220` |
| Default plan | 3×50 min focus with 10 min rests | `SessionPlan.swift:161-166` |