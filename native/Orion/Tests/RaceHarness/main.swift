import Foundation

/*
 The Swift half of the health-log race harness. See Tests/run-race-test.sh.

 This deliberately compiles the REAL HealthLog.swift and FileLock.swift rather
 than a copy of their logic. A harness that reimplements `mutate()` proves that
 the harness is correct and says nothing about the code that ships, which is the
 only code that can lose Nick's supplements. `ORION_HEALTH_LOG` points the real
 store at a scratch file so the harness never touches his actual log.

 Two modes:

   locked    calls HealthLog.addSupplement — the shipping path, lock and all.
   unlocked  replays the PRE-FIX code: read, modify, write by atomic rename,
             no lock. It exists so the fix has a before number to be measured
             against. A race fix with no failing baseline is a claim.

 Each run appends `<prefix>-0001 … <prefix>-NNNN` as supplement names. Every one
 is distinct, so the count that survives in the file is exactly the count of
 updates that were not clobbered.
*/

// MARK: - Arguments

func argument(_ name: String, default fallback: String) -> String {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--\(name)"),
          index + 1 < arguments.count
    else { return fallback }
    return arguments[index + 1]
}

/// Bounded by TIME, not by a fixed count.
///
/// A fixed count was the first shape and it flattered the fix: node finished its
/// 400 updates in 0.13s while Swift needed 0.62s, so four fifths of the Swift run
/// had no one to race and the baseline only lost 4%. Running both flat out for
/// the same wall-clock window is the honest test — every update on both sides
/// has a contender.
let seconds = Double(argument("seconds", default: "4")) ?? 4
let cap = Int(argument("cap", default: "100000")) ?? 100_000
let prefix = argument("prefix", default: "swift")
let mode = argument("mode", default: "locked")

guard let target = ProcessInfo.processInfo.environment["ORION_HEALTH_LOG"], !target.isEmpty else {
    FileHandle.standardError.write(Data("ORION_HEALTH_LOG must be set\n".utf8))
    exit(2)
}
let fileURL = URL(fileURLWithPath: target)

// MARK: - The pre-fix path, kept only as a baseline

/// What HealthLog.mutate looked like before FileLock existed: read, change,
/// publish by atomic rename, with nothing serialising the three steps. The
/// rename means no reader ever sees half a file — and the update still vanishes,
/// which is the whole point of the baseline.
func unlockedAdd(_ name: String) {
    var file = HealthLogFile()
    if let data = try? Data(contentsOf: fileURL),
       let decoded = try? JSONDecoder().decode(HealthLogFile.self, from: data) {
        file = decoded
    }
    guard !file.supplements.contains(where: { $0.name == name }) else { return }
    file.supplements.append(Supplement(name: name))
    file.updatedAt = ISO8601DateFormatter().string(from: Date())

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(file) else { return }
    let scratch = fileURL.deletingLastPathComponent()
        .appendingPathComponent(".health-log.\(UUID().uuidString).tmp")
    guard (try? data.write(to: scratch, options: [.atomic])) != nil else { return }
    if rename(scratch.path, fileURL.path) != 0 {
        try? FileManager.default.removeItem(at: scratch)
    }
}

// MARK: - Run

let store = HealthLog()
let started = Date()
let deadline = started.addingTimeInterval(seconds)
var attempted = 0

var failures = 0
var firstError = ""

while Date() < deadline && attempted < cap {
    attempted += 1
    let name = "\(prefix)-\(String(format: "%05d", attempted))"
    if mode == "unlocked" {
        unlockedAdd(name)
    } else {
        store.addSupplement(name)
        // A mutate that could not take the lock inside six seconds sets
        // lastError and writes nothing. That is a refusal, not a lost update,
        // and it is counted separately so it can never be quietly folded into
        // the "kept" number — a fix that survives by refusing writes is not a fix.
        if let error = store.lastError {
            failures += 1
            if firstError.isEmpty { firstError = error }
        }
    }
}

let elapsed = Date().timeIntervalSince(started)
let report: [String: Any] = [
    "side": "swift",
    "mode": mode,
    "prefix": prefix,
    "attempted": attempted,
    "failures": failures,
    "seconds": (elapsed * 1000).rounded() / 1000,
    "firstError": firstError,
]
if let data = try? JSONSerialization.data(withJSONObject: report) {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}
