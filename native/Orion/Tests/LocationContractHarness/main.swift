//
//  Does the Mac app read what `scripts/orion-timezone` actually writes?
//
//  Compiled against the REAL SessionDomain sources and run over bytes the real
//  script produced a moment ago. Both halves matter:
//
//    · Building a stand-in policy JSON here would test my idea of the format,
//      not the format. AGENTS.md already records what that costs — Phase 32's
//      hand-built fixtures left 23 of 42 guards unenforced and hid a defect in
//      the producer.
//    · The zone NAMES are the fragile part. Foundation and ICU canonicalise 47
//      of them differently, in both directions, so "it parsed on my machine"
//      is not the same as "the two runtimes agree".
//

import Foundation

var failures = 0
var checks = 0

func check(_ what: String, _ passed: Bool, _ detail: String = "") {
    checks += 1
    if passed {
        print("  ok    \(what)")
    } else {
        failures += 1
        print("  FAIL  \(what)\(detail.isEmpty ? "" : " — \(detail)")")
    }
}

// MARK: The file the script wrote

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
guard !path.isEmpty, let data = FileManager.default.contents(atPath: path) else {
    print("usage: location-contract <path-to-location.json-the-script-wrote>")
    exit(2)
}
print("== reading \(path) ==")
print(String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        .split(separator: "\n").map { "  | \($0)" }.joined(separator: "\n"))
print("")

// MARK: It decodes at all

let policy: TimeZonePolicy
do {
    policy = try JSONDecoder().decode(TimeZonePolicy.self, from: data)
    check("the Mac app decodes the script's file", true)
} catch {
    check("the Mac app decodes the script's file", false, "\(error)")
    print("\n\(failures) of \(checks) checks failed")
    exit(1)
}

// MARK: It decodes to the right thing

check("home is the zone the script recorded", policy.home.identifier == "Europe/London",
      "got \(policy.home.identifier)")
check("place survives", policy.place == "London, United Kingdom",
      "got \(policy.place ?? "nil")")
check("the expected move survives", policy.expectedMove?.destination.identifier == "Europe/London"
        && policy.expectedMove?.on.key == "2026-09-08",
      "got \(policy.expectedMove.map { "\($0.destination.identifier) on \($0.on.key)" } ?? "nil")")

// MARK: Re-encoding is stable

do {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let round = try encoder.encode(policy)
    let back = try JSONDecoder().decode(TimeZonePolicy.self, from: round)
    check("re-encoding and re-decoding is a fixed point", back == policy)
} catch {
    check("re-encoding and re-decoding is a fixed point", false, "\(error)")
}

// MARK: The zone names both runtimes have to agree on

// The script refuses to write anything Foundation's accepted set lacks. This
// asserts the CONTENTS of that agreement for the names actually in play, rather
// than a count, which cannot tell you the members are the ones you meant.
for identifier in ["Europe/London", "America/New_York"] {
    check("\(identifier) is storable on the Swift side", IANAZone.isAccepted(identifier))
}

// And the fixed-offset spellings that Foundation resolves but must never store.
for identifier in ["UTC", "EST", "Zulu", "GMT+0500", "Etc/GMT+5"] {
    check("\(identifier) is refused on the Swift side", !IANAZone.isAccepted(identifier))
}

// The eleven ICU-canonical names the script translates. If Foundation ever
// starts listing them, the translation table in orion-timezone is dead code and
// should go; if it still does not, the table is load-bearing. Either way this
// says which world we are in rather than assuming.
let icuOnly = ["Africa/Asmera", "America/Buenos_Aires", "America/Catamarca",
               "America/Coral_Harbour", "America/Cordoba", "America/Indianapolis",
               "America/Jujuy", "America/Louisville", "America/Mendoza",
               "Asia/Saigon", "Atlantic/Faeroe"]
let stillDiverging = icuOnly.filter { !IANAZone.isAccepted($0) }
check("the ICU-only spellings are still outside Foundation's set (table is load-bearing)",
      stillDiverging.count == icuOnly.count,
      "\(icuOnly.count - stillDiverging.count) are now accepted: "
        + icuOnly.filter(IANAZone.isAccepted).joined(separator: ", "))

// And their Foundation spellings, which is what the table writes instead.
for identifier in ["America/Argentina/Buenos_Aires", "America/Indiana/Indianapolis",
                   "Asia/Ho_Chi_Minh", "Atlantic/Faroe", "Africa/Asmara",
                   "America/Kentucky/Louisville", "America/Atikokan"] {
    check("the table's target \(identifier) is storable", IANAZone.isAccepted(identifier))
}

print("")
if failures == 0 {
    print("\(checks) checks passed")
    exit(0)
}
print("\(failures) of \(checks) checks failed")
exit(1)
