import Foundation
import MobileCore

// PHASE 35 — the journal store, against a REAL file in a temp directory.
//
// The extraction rules are proven in MobileCoreCheck. This proves the part that
// only fails on disk: that an entry survives a round trip with all five
// manifest fields intact, that a correction replaces rather than duplicates,
// and that an unreadable file does NOT report as "no entries" — because Phase
// 36 will read this, and "nothing to correlate" and "I could not look" are
// different answers that must not collapse into one.

var failures: [String] = []
var checked = 0
func expect(_ condition: @autoclosure () -> Bool, _ what: String) {
    checked += 1
    if !condition() { failures.append(what) }
}
func section(_ name: String) { print("\n\(name)") }

let temporary = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("orion-journal-test-\(UUID().uuidString)")
try? FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
let journalPath = temporary.appendingPathComponent("health-journal.json")
setenv("ORION_HEALTH_JOURNAL", journalPath.path, 1)
defer { try? FileManager.default.removeItem(at: temporary) }

var calendar = Calendar(identifier: .gregorian)
calendar.timeZone = TimeZone(identifier: "America/New_York")!
let evening = calendar.date(from: DateComponents(
    year: 2026, month: 9, day: 1, hour: 21, minute: 0))!

section("a round trip through a real file")

let store = JournalStore()
expect(store.entries.isEmpty, "a store with no file starts empty")
expect(JournalStore.fileURL.path == journalPath.path, "the override is honoured")

let added = store.add("Had caffeine around 5.", now: evening)
expect(added != nil, "an entry is extracted and stored")
expect(store.entries.count == 1, "and appears in the store")
expect(FileManager.default.fileExists(atPath: journalPath.path), "and reaches the disk")

// Re-open from disk. This is the assertion that matters: a store that keeps
// everything in memory would pass every check above.
let reopened = JournalStore()
expect(reopened.entries.count == 1, "a fresh store reads the file back")
if let entry = reopened.entries.first {
    expect(entry.eventType == .caffeine, "event_type survives")
    expect(entry.source == .extracted, "source survives")
    expect(entry.confidence == .medium, "confidence survives")
    expect(entry.notes == "Had caffeine around 5.", "notes survive verbatim")
    expect(calendar.component(.hour, from: entry.time) == 17, "and the resolved time survives")
} else {
    expect(false, "the reopened store has the entry")
}

section("corrections replace rather than accumulate")

guard let target = reopened.entries.first else { exit(1) }
let corrected = reopened.correct(id: target.id, eventType: .meal, now: evening)
expect(corrected != nil, "an entry can be corrected")
expect(reopened.entries.count == 1, "a correction REPLACES -- it does not add a second row")
let afterCorrection = JournalStore()
if let stored = afterCorrection.entries.first {
    expect(stored.eventType == .meal, "the correction reached the disk")
    expect(stored.source == .correction, "and records that a person said so")
    expect(stored.confidence == .high, "at high confidence")
    expect(stored.originalText == "Had caffeine around 5.",
           "and the original text survives, so the guess stays reviewable")
    expect(stored.id == target.id, "keeping the same id")
}
expect(reopened.correct(id: "nope-does-not-exist") == nil,
       "correcting an unknown id changes nothing rather than creating a row")

section("an unreadable journal is not an empty one")

try? "{ this is not json".write(to: journalPath, atomically: true, encoding: .utf8)
let broken = JournalStore()
expect(broken.lastError != nil, "an unreadable file reports an error")
expect(!broken.entries.isEmpty || broken.lastError != nil,
       "and does NOT quietly report zero entries, which Phase 36 would read as 'nothing happened'")

section("counting a day")

try? FileManager.default.removeItem(at: journalPath)
let counter = JournalStore()
counter.add("Coffee at 09:00", now: evening)
counter.add("Gym at 6pm", now: evening)
let yesterday = calendar.date(byAdding: .day, value: -1, to: evening)!
expect(counter.entryCount(on: evening, calendar: calendar) == 2, "two entries today")
expect(counter.entryCount(on: yesterday, calendar: calendar) == 0, "none yesterday")

section("ids")

let a = JournalStore.newID(), b = JournalStore.newID()
expect(a != b, "ids do not collide")
expect(a.hasPrefix("j-"), "and are recognisable")
expect(!a.contains(where: \.isUppercase), "and are lowercase, so a case-folding store cannot merge two")

print("\n\(checked) checks, \(failures.count) failed")
for failure in failures { print("  FAIL \(failure)") }
exit(failures.isEmpty ? 0 : 1)
