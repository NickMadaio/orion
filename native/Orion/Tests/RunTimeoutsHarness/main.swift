import Foundation

/*
 `RunTimeouts.violations()` — the ordering that used to be three numbers in
 three files, agreeing by accident. This just asserts the check is empty, but
 that assertion is the whole point: it is a NAMED test that fails the moment a
 future edit moves one layer without moving its neighbours, instead of quietly
 reintroducing the tie that produced two different error messages for one
 underlying failure (see `RunTimeouts.swift`'s header).

 Compiled directly against the REAL Sources/Orion/RunTimeouts.swift — not a
 copy — so this cannot drift from what ships. `Tests/run-runtimeouts-test.sh`
 does the compiling.
 */

var failures = 0
var checks = 0

func check(_ label: String, _ pass: Bool, _ detail: String = "") {
    checks += 1
    if pass {
        print("  ok    \(label)")
    } else {
        failures += 1
        print("  FAIL  \(label)\(detail.isEmpty ? "" : "\n        \(detail)")")
    }
}

print("== RunTimeouts: the ordering holds ==")
print("   \(RunTimeouts.summary)")

let violations = RunTimeouts.violations()
check("RunTimeouts.violations() is empty", violations.isEmpty, violations.joined(separator: "\n        "))

print("")
if failures == 0 {
    print("runtimeouts: \(checks) checks, all passed")
    exit(0)
} else {
    print("runtimeouts: \(checks) checks, \(failures) FAILED")
    exit(1)
}
