# Observable runs — 2026-09-05

Nick's complaint, verbatim, from `HANDOFF.md` item 3:

> "sometimes he times out... i cant tell if hes actually working and thinking
> and its just taking a while or if hes timing out. Claude and Chat both show
> they are thinking like orion does, but they show processes they are doing at
> that moment. 'ran two commands', 'fixed pipeline', etc. and thats defenitly
> needed."

This continues the wave-two work on that item. `RunTimeouts.swift` (wiring the
three-way timeout tie) and its diagnosis were already done and left inert by
the previous session; this pass wires it in, and builds the progress feed on
top of it.

## What shipped

### 1. `RunTimeouts` is now live, not just written down

`GatewayClient.swift` carried its own `timeoutSeconds = 180` and derived
`+15`/`+30` deadlines inline — exactly the duplication `RunTimeouts.swift`
documented and existed to replace, but had not yet replaced. Fixed:

- `--timeout` now passes `RunTimeouts.agentTimeout` (300s).
- The internal SIGTERM/SIGKILL backstop now fires at `RunTimeouts.terminateAt`
  / `RunTimeouts.killGrace` instead of `timeoutSeconds + 15` / a bare `5`.
- The client's hard read deadline is now `RunTimeouts.clientReadDeadline`
  instead of `timeoutSeconds + 30`.
- `VoiceTuning.absoluteThinkingCeiling` — the OTHER half of the original
  210/210 tie — now reads `RunTimeouts.watchdogCeiling` instead of its own
  hardcoded `210`. This was the actual bug: the client's old hard read
  deadline and the app's `.thinking` watchdog ceiling were both exactly 210,
  a tie rather than an ordering, so whichever runloop got there first decided
  which of two different messages Nick saw for the same failure.
- `Tests/WatchdogHarness/main.swift`'s mirrored `thinkingCeiling` literal was
  updated by hand from `210` to `420` to match, per that file's own stated
  policy ("kept as literals... so changing a tunable in the app makes this
  file's intent visible in the diff"), with the affected assertions and
  comments updated to match (320s/420s instead of 195s/210s).
- Added a `RunTimeouts.violations()` test, `Tests/RunTimeoutsHarness` +
  `Tests/run-runtimeouts-test.sh`, in the same discipline as
  `Tests/run-watchdog-test.sh`.
- Also added to `RunTimeouts`: `measuredAuditInvocationCost` (2.8s, the
  measured cost recorded in the previous session) and `auditPollInterval`
  (3s), with a new `violations()` check that the poll interval exceeds the
  measured cost — otherwise polling would just queue audit calls up behind
  each other.

**Mutation proof** (hard rule: prove every repair by mutation). Test:
`RunTimeouts.violations() is empty` in `Tests/RunTimeoutsHarness/main.swift`,
run via `Tests/run-runtimeouts-test.sh`.

- Mutated `clientReadDeadline` alone: `360` → `300`.
- Ran the harness. It failed, by name, with:
  `client read deadline (300s) must be at least 30s past the kill (325s)`
- Restored `clientReadDeadline` to `360`. Reran — `1 checks, all passed`.

### 2. `RunProgressModel` — the feed itself

New file: `native/Orion/Sources/Orion/RunProgressModel.swift`. Pure,
clock-injected, same shape as `StallWatchdog` — no subprocess, no audio
device, no timer inside the type itself. Two signal sources it reconciles:

1. **Local, immediate.** `init(now:)` seeds the feed with `"Thinking…"`
   because one `openclaw audit` call measures 2.4-2.8s — slower than
   `RunTimeouts.firstStatusWithin` (2s) can wait. The first line Nick sees
   cannot come from audit; it has to already be there.
2. **Audit**, fed in as already-parsed `RunSignal` values via `ingest(_:at:)`,
   de-duplicated by `eventId` so the poller can safely re-query
   `--after <turn start>` every cycle rather than track a cursor.

`ToolPhrasebook` translates the small set of tool names into short public
phrases, with a safe generic fallback ("Ran a step.") for anything else.

**A finding that changed the design, checked against the real schema**
(`packages/gateway-protocol/src/schema/audit.d.ts` inside
`plugin/orion-control/node_modules/openclaw/dist/`) and against
`docs/planning/v2/evals/README.md`'s own note ("`toolName` is `exec`, and the
command that `exec` ran is not in it"):

Every OpenClaw BUILTIN tool — `bash`, `shell`, `exec`, `web_search`, `browser`,
`grep`, `glob` — is a distinct, stable top-level name that audit can and does
report. But every Orion-DOMAIN action (calendar, reminders, mail, health)
dispatches through **one** tool, `orion_task_run`
(`plugin/orion-control/src/index.ts:990`), with the actual action
name inside `arguments` — which the audit ledger deliberately never records
(`redaction: "metadata_only"`; the schema has no argument field at all).

So **"Checking your calendar…" is not a real, obtainable line today.** A step
through `orion_task_run` — which is most of what Orion actually does for
Nick — reads as the generic fallback, "Ran a step." / "Working on a step…",
indistinguishable from any other domain action. This is disappointing against
the target vocabulary in the brief, but it is also exactly the privacy
property the hard rules ask for (never surface a payload for an unknown
action), so `ToolPhrasebook` was built honest rather than aspirational: only
names audit can actually tell apart get their own phrase.

What DOES work as specified: `"Ran two commands."` The fold logic
(`RunProgressModel.recordFinished`) merges consecutive finishes of the SAME
tool into one spelled-out count, and breaks the fold the moment a different
action lands in between — proven in `Tests/ProgressHarness` with an
interleaved-action test.

**"The provider is slow — retrying."** — in the brief's target vocabulary —
is NOT wired to a real signal. Audit's `agent_run`/`tool_action` statuses are
`started, succeeded, failed, cancelled, timed_out, blocked, unknown`; there is
no `retrying` status, and OpenClaw's own model-fallback/retry logic
(`dist/model-fallback-*.js`) is internal to the runtime and not projected into
the audit ledger. Fabricating this line from a guessed heuristic would violate
the "report honestly" rule, so it was left out rather than faked. If Nick
wants it, the honest path is a `scopeNotInManifest` entry asking OpenClaw's
audit projection to surface a retry/fallback event — not something this app
can infer from the outside.

**Wedge detection** (priority 3) is `RunProgressModel.isWedged(at:)`: true only
once `RunTimeouts.wedgeGraceAfterRunEnd` (20s) has passed since audit reported
the run's terminal status AND `markCallReturned` has never been called. A
user's own cancel goes through a separate `recordUserCancelled` path that
deliberately never arms this check — cancelling already explains why the call
is not returning.

**Silence honesty** (the priority item): `visibleLines(at:)` appends
`"Still working — nothing new for Ns."` once `RunTimeouts.silenceBudget` (8s)
has passed with no new signal, computed live against the query time rather
than stored, so the count keeps advancing without a separate tick touching
state.

19 checks in `Tests/ProgressHarness/main.swift`, run via
`Tests/run-progress-test.sh`, covering: the first line, known-tool
translation, the `orion_task_run` privacy case, an unrecognised tool, folding,
fold-breaking on an interleaved action, page de-duplication, the silence
boundary at the exact second, the frozen-after-finish case, and the wedge
boundary (just under / at `wedgeGraceAfterRunEnd`, ruled out by
`markCallReturned`, never armed by a local cancel).

### 3. Wired into the running app

`GatewayClient.swift` gained:
- `cancelInFlight(reason:)` — SIGTERM then SIGKILL (after
  `RunTimeouts.killGrace`) on the `Process` currently blocked inside `ask`,
  tracked via a lock-protected static. Nothing could reach the subprocess
  from outside before this; the watchdog's existing recovery only orphans the
  call (bumps a generation), it does not touch the process.
- `auditSince(_:session:)` — one bounded `openclaw audit --json` page, IO
  only, feeding `RunProgressModel.parseAuditPage` (pure). Deliberately does
  NOT pass `GOG_KEYRING_PASSWORD` — it is metadata-only and needs no agent
  credential, and widening what this process gets is exactly what the hard
  rule about that variable exists to prevent.

`AppState.swift` gained:
- `thinkingFeed: [String]` and `thinkingElapsedSeconds: Int`, published, reset
  at the start of every `send(_:)` call and driven at 1Hz by
  `tickProgress(generation:)` — independent of the audit poll's own cadence,
  so the visible elapsed timer never stalls waiting on a slow `openclaw
  audit` call. `statusLine` is also updated to the feed's latest line, so the
  existing UI surface (panel status, menu bar) shows real content today even
  before any view is built specifically for `thinkingFeed`.
- A separate `auditQueue`, because the existing `agentQueue` is where the
  BLOCKING `GatewayClient.ask` call sits for the whole turn — polling audit
  on that same queue would simply never run until the turn it is describing
  had already ended.
- `pollAuditOnce` re-schedules itself `RunTimeouts.auditPollInterval` after
  the PREVIOUS call returns, not on a fixed timer, so a slow poll cannot queue
  up behind itself.
- `failThinking(_:)` replaces the bare gateway error message with the stage,
  the elapsed time, and the last thing the feed actually saw — e.g.
  `"Thinking stalled after 43s. The agent did not answer within 300s. Last
  seen: Ran a command."` — instead of just `"The agent did not answer within
  300s."` This is priority item 4: name the stage, not just "it failed."
- The wedge check (`tickProgress`) calls the EXISTING
  `recoverFromStuckThinking`, so wedge detection reuses the same recovery
  path the outer ceiling watchdog already uses, rather than a second one.

### 4. Cancellation

**Checked directly, not assumed: there was no way to cancel a `.thinking` turn
before this pass.** Three things confirmed:

- `bargeIn()` only acted on `phase == .speaking`; a `.thinking` phase fell
  through and nothing happened.
- `AppDelegate.refreshEscapeWatch()` only arms the global Escape hotkey watch
  when `phase == .speaking` or the panel is visible — so Escape during
  `.thinking` reaches `handleEscape()` only if the panel happens to be open,
  and even then `handleEscape()` only calls `bargeIn()` for `.speaking`;
  otherwise it just hides the panel.
- No SwiftUI view (`HomeTab.swift`, `PanelView.swift`,
  `HomeLauncherSurface.swift`) has a Stop/Cancel control bound to any phase.
- The ONLY existing path off `.thinking` early was the watchdog's
  `recoverFromStuckThinking`, which fires after `RunTimeouts.watchdogCeiling`
  (420s) and does not touch the subprocess — it only orphans the call.

Built: `bargeIn()` now has a `.thinking` branch calling a new
`cancelThinking(reason:)` in `AppState.swift`, which disarms the watchdog,
stops progress polling, bumps `askGeneration` (orphaning `send(_:)`'s
completion handler), sets phase back to `.idle`, and appends an honest
transcript line — all synchronous, so the app is responsive again within
about a second of the call. It then also calls
`GatewayClient.cancelInFlight(reason:)` on `agentQueue` to actually SIGTERM /
SIGKILL the subprocess, which previously never happened at all (the subprocess
was simply abandoned, leaking until it happened to exit on its own).

**Known gap, left alone deliberately:** `AppDelegate.swift` is not in this
session's owned-files list (`GatewayClient.swift`, `StallWatchdog.swift`,
`RunTimeouts.swift`, `AppState.swift`, `VoiceTuning.swift`, plus new files and
`Tests/` harnesses), so the Escape-hotkey routing gap above was NOT fixed —
`cancelThinking` exists and is tested in principle, but nothing outside a
future `submitTyped`-style call or a UI button can reach it yet except by
calling `state.bargeIn()` directly. The one-line fix, for whoever owns
`AppDelegate.swift` next: widen both
`refreshEscapeWatch()`'s and `handleEscape()`'s `phase == .speaking` checks to
also include `phase == .thinking`.

## Definition of done

- `swift build` in `native/Orion`: **succeeds.** (One unrelated pre-existing
  warning about an unused `minutes` binding at `AppState.swift:639`, not
  touched by this pass.) A concurrent audio-fix agent renamed
  `AudioDucking.duck()`/`.restore()` to `beginListeningFallback()` /
  `endListeningFallback()` / `restoreSystemVolumeNow()` mid-session, which
  broke the build on three call sites inside `AppState.swift` (a file this
  session owns) that had not been updated yet. `AudioDucking.swift` itself was
  NOT touched (it is on this session's do-not-edit list) — the three call
  sites in `AppState.swift` were updated to the new, already-documented API
  1:1 per that file's own doc comments (`beginListeningFallback()` is
  documented as "call when phase enters `.listening`", matching the old
  `duck()` call site exactly; likewise `endListeningFallback()` for the exit
  path and `restoreSystemVolumeNow()` for the unconditional quit-time restore,
  which the new file's own comment says to pair with `audioCoordinator.reset()`
  — already present at the same call site).
- `Tests/run-watchdog-test.sh`: 15 checks, all passed.
- `Tests/run-runtimeouts-test.sh` (new): 1 check, passed; mutation-proof run
  above.
- `Tests/run-progress-test.sh` (new): 19 checks, all passed.

## What Nick will actually see during a slow turn

1. Immediately: `"Thinking…"`
2. As tool actions complete, for tools audit can tell apart:
   `"Ran a command."`, `"Ran two commands."`, `"Searched the web."`,
   `"Used the browser."`, `"Searched the files."`
3. For everything else — which today means most Orion-domain actions,
   calendar/reminders/mail/health included — the generic, still-honest:
   `"Ran a step."` / `"Ran two steps."`
4. After 8s with nothing new: `"Still working — nothing new for 14s."` (the
   count keeps climbing live)
5. A visible elapsed-seconds counter the whole time (`thinkingElapsedSeconds`)
6. On failure: the stage and duration named, e.g. `"Thinking stalled after
   43s. The agent did not answer within 300s. Last seen: Ran a command."`
7. Pressing cancel (once wired to an input path — see the Escape gap above):
   `"Cancelled — stopped waiting for that one. (Anything it already started
   may still finish in the background.)"`, and the app is idle and accepting
   new input again within about a second.

## Next steps for whoever picks this up

1. Wire an actual input path to `cancelThinking` — the `AppDelegate.swift`
   Escape-hotkey fix above, and/or a Stop button in whichever view owns the
   `.thinking` presentation.
2. Build a real UI surface for `thinkingFeed` — right now only `statusLine`
   (already rendered somewhere in the existing UI) shows it live; nothing
   presents the full scrolling feed or `thinkingElapsedSeconds` as its own
   element yet.
3. If richer per-domain lines ("Checking your calendar…") are wanted, that is
   a `scopeNotInManifest`-worthy ask of OpenClaw itself: `orion_task_run`
   would need to thread its `action` argument into the audit projection as
   metadata, which is an upstream change, not something fixable from this
   app.
4. If "the provider is slow — retrying" still matters to Nick, same category:
   needs OpenClaw's model-fallback/retry logic to emit an audit-visible
   signal. Left unbuilt rather than faked.
