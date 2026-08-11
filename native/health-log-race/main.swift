import Foundation

// Concurrency harness: hammers the REAL HealthLog through the REAL production
// path, so the test proves the app process and the plugin process actually
// exclude each other. A harness that injected its own temp path could not see a
// lockfile-name mismatch between the two sides, which is the whole hazard.
//
// argv: <prefix> <seconds> <startAtEpochMs> <issuedCountOutPath>
// Both sides spin to the same wall-clock start and run for the same window, so
// the write streams genuinely interleave instead of one finishing before the
// other has finished booting.
let args = CommandLine.arguments
let prefix = args[1]
let seconds = Double(args[2])!
let startAt = Double(args[3])! / 1000.0
let outPath = args[4]

while Date().timeIntervalSince1970 < startAt { usleep(200) }

let store = HealthLog()
let deadline = startAt + seconds
var issued = 0
var failures = 0
var firstError = ""
while Date().timeIntervalSince1970 < deadline {
    store.addSupplement(String(format: "%@-%05d", prefix, issued))
    if let error = store.lastError {
        failures += 1
        if firstError.isEmpty { firstError = error }
    }
    issued += 1
}
try? String(issued).write(toFile: outPath, atomically: true, encoding: .utf8)
let note = firstError.isEmpty ? "" : " (first: \(firstError))"
FileHandle.standardError.write(
    "swift: issued \(issued) writes in \(seconds)s, \(failures) errored\(note)\n".data(using: .utf8)!
)
