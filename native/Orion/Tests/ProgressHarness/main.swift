import Foundation

/*
 `RunProgressModel` — the feed Nick reads instead of a blank "Thinking…" — put
 through the same discipline as `Tests/WatchdogHarness`: pure, clock-injected,
 driven against a fixed instant so a failure reads the same on every run.

 Compiled against the REAL `Sources/Orion/RunProgressModel.swift` and
 `Sources/Orion/RunTimeouts.swift` — not copies — so this cannot drift from
 what ships. `Tests/run-progress-test.sh` does the compiling.

 WHAT THIS PROVES: the state machine reaches the right feed text, the right
 fold, and the right wedge verdict, at the right second, entirely off pure
 inputs (a fixed clock and hand-built audit pages).

 WHAT IT DOES NOT PROVE: that `AppState` actually spawns `openclaw audit` on
 the right cadence and wires the result here — that is IO, and it is verified
 live, the same limitation `WatchdogHarness` states about `AppState`'s wiring.
 */

var failures = 0
var checks = 0

func check(_ label: String, _ pass: Bool, _ detail: @autoclosure () -> String = "") {
    checks += 1
    if pass {
        print("  ok    \(label)")
    } else {
        failures += 1
        let d = detail()
        print("  FAIL  \(label)\(d.isEmpty ? "" : "\n        \(d)")")
    }
}

func checkEqual<T: Equatable>(_ label: String, _ actual: T, _ expected: T) {
    check(label, actual == expected, "expected \(expected)\n        actual   \(actual)")
}

func section(_ title: String) {
    print("")
    print("== \(title) ==")
}

let t0 = Date(timeIntervalSince1970: 1_770_000_000)
func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

func record(_ id: String, _ signal: RunSignal) -> RunProgressModel.AuditRecord {
    RunProgressModel.AuditRecord(eventId: id, signal: signal)
}

// MARK: - The first line

section("the first line is local, synthetic, and immediate")

do {
    let model = RunProgressModel(now: t0)
    checkEqual("nothing has happened yet, and Nick still sees a line",
               model.visibleLines(at: t0), ["Thinking…"])
    checkEqual("it is exactly the synthetic first line, not something built ad hoc",
               model.visibleLines(at: t0), [RunProgressModel.syntheticFirstLine])
}

// MARK: - Translation, and the privacy floor

section("known tools translate; unknown tools never leak a name")

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("e1", .toolStarted(tool: "exec", callId: "c1"))], at: at(1))
    checkEqual("a started exec call reads as a public phrase",
               model.visibleLines(at: at(1)), ["Thinking…", "Running a command…"])

    model.ingest([record("e2", .toolFinished(tool: "exec", callId: "c1"))], at: at(2))
    checkEqual("finishing it replaces the line in place",
               model.visibleLines(at: at(2)), ["Thinking…", "Ran a command."])
}

do {
    // `orion_task_run` is the real, documented shape of the gap: every
    // Orion-domain action (calendar, reminders, mail, health) dispatches
    // through this ONE tool name, with the actual action buried in
    // `arguments`, which audit never records. This must read exactly like any
    // other unknown tool — generic, and never showing the raw name.
    var model = RunProgressModel(now: t0)
    model.ingest([record("e1", .toolStarted(tool: "orion_task_run", callId: "c1"))], at: at(1))
    model.ingest([record("e2", .toolFinished(tool: "orion_task_run", callId: "c1"))], at: at(2))
    let lines = model.visibleLines(at: at(2))
    checkEqual("an Orion-domain action reads as the generic fallback", lines, ["Thinking…", "Ran a step."])
    check("the raw tool name never appears in the feed",
          !lines.joined().contains("orion_task_run"))
}

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("e1", .toolStarted(tool: "some_future_tool_nobody_mapped", callId: "c1"))], at: at(1))
    let lines = model.visibleLines(at: at(1))
    check("a completely unrecognised tool still falls through to the generic line",
          lines.last == "Working on a step…")
    check("and never surfaces its own name",
          !lines.joined().contains("some_future_tool_nobody_mapped"))
}

// MARK: - Folding repeats, without hiding an interleaved different action

section("repeats fold into a count; an interleaved action breaks the fold")

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("s1", .toolStarted(tool: "exec", callId: "c1"))], at: at(1))
    model.ingest([record("f1", .toolFinished(tool: "exec", callId: "c1"))], at: at(2))
    model.ingest([record("s2", .toolStarted(tool: "exec", callId: "c2"))], at: at(3))
    model.ingest([record("f2", .toolFinished(tool: "exec", callId: "c2"))], at: at(4))
    checkEqual("two commands fold into one line, spelled out",
               model.visibleLines(at: at(4)), ["Thinking…", "Ran two commands."])

    model.ingest([record("s3", .toolStarted(tool: "exec", callId: "c3"))], at: at(5))
    model.ingest([record("f3", .toolFinished(tool: "exec", callId: "c3"))], at: at(6))
    checkEqual("a third folds into the same line rather than adding a new one",
               model.visibleLines(at: at(6)), ["Thinking…", "Ran three commands."])
}

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("s1", .toolStarted(tool: "exec", callId: "c1"))], at: at(1))
    model.ingest([record("f1", .toolFinished(tool: "exec", callId: "c1"))], at: at(2))
    model.ingest([record("s2", .toolStarted(tool: "web_search", callId: "c2"))], at: at(3))
    model.ingest([record("f2", .toolFinished(tool: "web_search", callId: "c2"))], at: at(4))
    model.ingest([record("s3", .toolStarted(tool: "exec", callId: "c3"))], at: at(5))
    model.ingest([record("f3", .toolFinished(tool: "exec", callId: "c3"))], at: at(6))
    checkEqual("a different action in between keeps every line visible, not folded away",
               model.visibleLines(at: at(6)),
               ["Thinking…", "Ran a command.", "Searched the web.", "Ran a command."])
}

// MARK: - De-duplication

section("the same audit page ingested twice changes nothing the second time")

do {
    var model = RunProgressModel(now: t0)
    let page = [record("e1", .toolStarted(tool: "exec", callId: "c1")),
                record("e2", .toolFinished(tool: "exec", callId: "c1"))]
    model.ingest(page, at: at(1))
    model.ingest(page, at: at(4)) // the poller re-queries "--after turn start" every cycle
    checkEqual("re-ingesting the identical page is a no-op",
               model.visibleLines(at: at(4)), ["Thinking…", "Ran a command."])
}

// MARK: - Silence, honestly

section("silence budget: the feed says so, at the exact second")

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("e1", .toolFinished(tool: "exec", callId: "c1"))], at: at(10))
    checkEqual("7.999s of quiet after the last signal is still just the feed",
               model.visibleLines(at: at(10 + RunTimeouts.silenceBudget - 0.001)), ["Thinking…", "Ran a command."])
    checkEqual("RunTimeouts.silenceBudget of quiet adds the honest line",
               model.visibleLines(at: at(10 + RunTimeouts.silenceBudget)),
               ["Thinking…", "Ran a command.", "Still working — nothing new for \(Int(RunTimeouts.silenceBudget))s."])
}

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("e1", .runSucceeded)], at: at(5))
    checkEqual("once finished, the feed is frozen — no silence line ever, however late it is read",
               model.visibleLines(at: at(5 + 10_000)), ["Thinking…", "Done."])
}

// MARK: - The wedge — the one liveness signal `.thinking` has ever had

section("wedge: audit says done, the call has not returned")

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("e1", .runSucceeded)], at: at(5))
    check("just under RunTimeouts.wedgeGraceAfterRunEnd since the audit fact is not yet a wedge",
          !model.isWedged(at: at(5 + RunTimeouts.wedgeGraceAfterRunEnd - 0.001)))
    check("RunTimeouts.wedgeGraceAfterRunEnd since the audit fact IS the wedge",
          model.isWedged(at: at(5 + RunTimeouts.wedgeGraceAfterRunEnd)))
}

do {
    var model = RunProgressModel(now: t0)
    model.ingest([record("e1", .runSucceeded)], at: at(5))
    model.markCallReturned(at: at(6))
    check("the call actually returning rules out a wedge for good, however late this is checked",
          !model.isWedged(at: at(5 + 10_000)))
}

do {
    // A user's OWN cancel must never look like a wedge a few seconds later —
    // we already know why the call is not coming back.
    var model = RunProgressModel(now: t0)
    model.recordUserCancelled(at: at(5))
    check("a local cancel never arms the wedge check",
          !model.isWedged(at: at(5 + RunTimeouts.wedgeGraceAfterRunEnd + 100)))
}

// MARK: - Verdict

print("")
if failures == 0 {
    print("progress: \(checks) checks, all passed")
    exit(0)
} else {
    print("progress: \(checks) checks, \(failures) FAILED")
    exit(1)
}
