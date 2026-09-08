import Foundation

/*
 SelfDevelopmentStatus — the three-state derivation, checked.

 The interesting state is the third one. A run whose pid is gone and which never
 wrote a finish time did NOT finish: it was killed, it crashed, or the machine
 slept through its deadline. Nick's machine has already done the last of those
 once. Reporting the last number such a run happened to write, as though it had
 ended tidily, is the lie this type exists to avoid.
*/

var checks = 0
var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    checks += 1
    if condition {
        print("  ok    \(name)")
    } else {
        failures += 1
        print("  FAIL  \(name)")
        if !detail.isEmpty { print("        \(detail)") }
    }
}

func write(_ object: [String: Any]) -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("selfdev-\(UUID().uuidString).json")
    let data = try! JSONSerialization.data(withJSONObject: object)
    try! data.write(to: url)
    return url
}

print("== SelfDevelopmentStatus: is it running, did it finish, or did it just stop ==")

// Running: a pid we say is alive, and no finish time.
let running = SelfDevelopmentStatus.read(
    stateURL: write(["pid": 4242, "started": "2026-09-07T20:59:08", "passed": 3,
                     "failed": 1, "last": "a task", "finished": NSNull()]),
    isAlive: { _ in true })
check("a live pid with no finish time is RUNNING", running.activity == .running)
check("running says what it is on now", running.detail == "a task")
check("running counts both outcomes", running.landed == 3 && running.didNotLand == 1)

// Finished: a finish time wins even if the pid somehow still answers.
let finished = SelfDevelopmentStatus.read(
    stateURL: write(["pid": 4242, "started": "s", "finished": "2026-09-07T21:14:00",
                     "passed": 4, "failed": 1, "stopped_because": "nothing left to do"]),
    isAlive: { _ in true })
check("a finish time means FINISHED, whatever the pid says", finished.activity == .finished)
check("finished says why it stopped",
      finished.detail == "Stopped because nothing left to do.")

// Stopped without finishing: the one that must not be reported as finished.
let stopped = SelfDevelopmentStatus.read(
    stateURL: write(["pid": 4242, "started": "s", "passed": 2, "failed": 0,
                     "finished": NSNull()]),
    isAlive: { _ in false })
check("a dead pid with no finish time is STOPPED WITHOUT FINISHING",
      stopped.activity == .stoppedWithoutFinishing,
      "got \(stopped.activity)")
check("it does NOT claim to have finished", stopped.activity != .finished)
check("it says the committed work survived",
      stopped.detail?.contains("already committed") == true)
check("it still reports what landed before it died", stopped.landed == 2)

// Never run.
let missing = SelfDevelopmentStatus.read(
    stateURL: URL(fileURLWithPath: "/nonexistent/selfdev-state.json"),
    isAlive: { _ in false })
check("a missing state file is NEVER RUN, not an error", missing.activity == .neverRun)
check("never-run tells you how to start it",
      missing.detail?.contains("orion-code loop") == true)

// A corrupt file is the same as no file: this must never throw into the UI.
let corrupt = FileManager.default.temporaryDirectory
    .appendingPathComponent("selfdev-corrupt.json")
try! "{ not json".write(to: corrupt, atomically: true, encoding: .utf8)
let broken = SelfDevelopmentStatus.read(stateURL: corrupt, isAlive: { _ in false })
check("a corrupt state file reads as never-run rather than crashing the tab",
      broken.activity == .neverRun)

print("")
if failures == 0 {
    print("selfdev-status: \(checks) checks, all passed")
} else {
    print("selfdev-status: \(checks) checks, \(failures) FAILED")
}
exit(failures == 0 ? 0 : 1)
