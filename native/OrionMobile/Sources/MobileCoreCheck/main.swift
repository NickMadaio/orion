import Foundation
import MobileCore

// MobileCoreCheck — assertions for MobileCore, as an executable.
//
// XCTest and swift-testing both ship with Xcode, and this machine has only the
// Command Line Tools. So the checks are a program: it prints what it checked and
// exits non-zero when something fails. That was verified by making an assertion
// fail on purpose before any of these were written.

var failures: [String] = []
var checked = 0

func expect(_ condition: @autoclosure () -> Bool, _ what: String) {
    checked += 1
    if !condition() { failures.append(what) }
}

func section(_ name: String) {
    print("\n\(name)")
}

// -- navigation ------------------------------------------------------------

section("navigation")
expect(Navigation.tabs.map(\.rawValue) == ["Today", "Plan", "ORION", "Health", "Control"],
       "the five manifest tabs, in order")
expect(Navigation.centreTab == .orion, "ORION is the centre tab")
expect(Navigation.defaultTab == .orion, "ORION is where the app opens")
var navigation = Navigation()
navigation.select(.health)
expect(navigation.selected == .health, "a tab can be selected")
navigation.returnToConversation()
expect(navigation.selected == .orion, "returning to the conversation goes to ORION")
// Sign-out must not report success while removing nothing. `clear()` is throws
// and swallowed every error with `try?`, so against the refusing store this
// package ships it was a silent no-op -- and `clear` appeared in no assertion.
do {
    try SecureStorage(store: RefusingSecureStore()).clear()
    expect(false, "clearing a refusing store reports the failure")
} catch {
    expect(true, "clearing a refusing store reports the failure")
}

expect(DesktopOnlySurface.allCases.count == 6, "the desktop-only surfaces are enumerated")
expect(Set(DesktopOnlySurface.allCases.map(\.rawValue)) == [
    "menu bar", "orb", "workshop", "focus clips", "voice tuning", "plugin console",
], "and they are the six named surfaces, by name")
// A count let orb and workshop be renamed to "banana" and "zzz" with every check
// green. The comment on this enum says the list "is written down and checked
// rather than remembered" -- a count is remembering, not checking.
expect(!Navigation.tabs.map(\.rawValue).contains(where: { name in
    DesktopOnlySurface.allCases.contains { $0.rawValue.lowercased() == name.lowercased() }
}), "no desktop-only surface is a mobile tab")

// -- deferred features -----------------------------------------------------

section("deferred features")
expect(Deferred.features.map(\.name) == ["Gmail", "remote Mac control"],
       "the two still deferred are named")
expect(Deferred.released.map(\.name) == ["HealthKit"],
       "HealthKit is recorded as released by the phase that owns it, not simply deleted")
expect(Deferred.features.allSatisfy { $0.owningPhase > 16 && !$0.reason.isEmpty },
       "each names a later phase and a reason")
expect(Deferred.features.allSatisfy { !$0.tokens.isEmpty },
       "a deferred feature that names no tokens is unenforceable")
expect(Deferred.forbiddenTokens == Deferred.features.flatMap(\.tokens),
       "the forbidden tokens are derived from the features, not hand-maintained")
expect(Deferred.released.allSatisfy { !$0.tokens.isEmpty },
       "a released feature still records the tokens it was identified by")
expect(Deferred.released.allSatisfy { released in
    !Deferred.forbiddenTokens.contains(where: released.tokens.contains)
}, "a released feature's tokens are no longer forbidden")
// Pinned CONTENTS, not a self-referential property. The previous assertion was
// `features.allSatisfy { $0.tokens.allSatisfy(forbiddenTokens.contains) }`
// while `forbiddenTokens` IS `features.flatMap(\.tokens)` -- true by
// construction, so dropping "GmailAPI" from Gmail's three tokens passed. An
// independent review proved it with a mutation that survived at 140/0.
let expectedTokens: [String: [String]] = [
    "Gmail": ["GmailAPI", "gmail.readonly", "MailMessage"],
    "remote Mac control": ["RemoteMacControl", "remoteExecute", "MacRemote"],
]
expect(Deferred.features.allSatisfy { expectedTokens[$0.name] == $0.tokens },
       "each still-deferred feature carries exactly the tokens that identify it")
expect(Set(Deferred.forbiddenTokens) == Set(expectedTokens.values.flatMap { $0 }),
       "and the forbidden list is exactly those")

let sourceDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()   // MobileCoreCheck
    .deletingLastPathComponent()   // Sources
    .appendingPathComponent("MobileCore")
var offendingFiles: [String] = []
// RECURSIVE. `contentsOfDirectory` does not descend, but SwiftPM compiles
// subdirectories of a target -- so a file at MobileCore/Remote/MacBridge.swift
// was public, callable, compiled, and completely unscanned. A deferred feature
// could be shipped in ORION's own public API by putting it one folder down.
func mobileCoreSwiftFiles() -> [(name: String, url: URL)] {
    guard let walker = FileManager.default.enumerator(
        at: sourceDirectory, includingPropertiesForKeys: nil
    ) else { return [] }
    return walker.compactMap { entry in
        guard let url = entry as? URL, url.pathExtension == "swift" else { return nil }
        let relative = url.path.replacingOccurrences(of: sourceDirectory.path + "/", with: "")
        return (relative, url)
    }
}
let coreFiles = mobileCoreSwiftFiles()
expect(!coreFiles.isEmpty, "the recursive scan finds sources at all")
expect(coreFiles.contains { $0.name.contains("/") } == false,
       "every MobileCore source is scanned, including any in a subdirectory (\(coreFiles.map(\.name).filter { $0.contains("/") }))")

// The import boundary, enforced by a scan rather than only by the iOS compiler.
// The compiler catches AppKit and UIKit because they are platform-EXCLUSIVE.
// SwiftUI, Security, UserNotifications, CryptoKit and CoreLocation exist on both
// platforms, so `import SwiftUI` plus a live SecItemCopyMatching call built
// cleanly for the simulator and the check said "no platform framework crept in".
// Those are exactly the three frameworks this phase's closing work names next.
var foreignImports: [String] = []
for file in coreFiles {
    guard let contents = try? String(contentsOf: file.url, encoding: .utf8) else { continue }
    for line in contents.split(separator: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("import ") else { continue }
        let module = trimmed.dropFirst("import ".count).trimmingCharacters(in: .whitespaces)
        if module != "Foundation" { foreignImports.append("\(file.name): \(module)") }
    }
}
expect(foreignImports.isEmpty, "MobileCore imports Foundation and nothing else (\(foreignImports))")

if let files = try? FileManager.default.contentsOfDirectory(atPath: sourceDirectory.path) {
    for file in coreFiles.map(\.name) where file != "Deferred.swift" {
        // NOT `(try? ...) ?? ""`. A file the check cannot open was read as
        // empty and passed -- an independent review chmod-ed a source to 000
        // with a forbidden token in it and the check went green. A grep that
        // cannot read its input has not checked it.
        guard let contents = try? String(contentsOf: sourceDirectory.appendingPathComponent(file), encoding: .utf8) else {
            offendingFiles.append("\(file): UNREADABLE, so unchecked")
            continue
        }
        for token in Deferred.forbiddenTokens where contents.contains(token) {
            offendingFiles.append("\(file): \(token)")
        }
    }
    expect(files.filter { $0.hasSuffix(".swift") }.count >= 8, "the core has its files")
} else {
    failures.append("could not read the MobileCore sources")
}
expect(offendingFiles.isEmpty, "no source mentions Gmail or remote Mac control (\(offendingFiles))")

// -- conversation ----------------------------------------------------------

section("conversation")
let epoch = Date(timeIntervalSince1970: 1_756_000_000)
func message(_ id: String, _ sequence: Int, device: String = "phone", text: String = "hello",
             role: Message.Role = .user, pending: Bool = false) -> Message {
    Message(id: id, role: role, text: text, sequence: sequence, createdAt: epoch,
            deviceID: device, pending: pending)
}

var conversation = Conversation(id: "conversation-1")
conversation.upsert(message("m2", 2))
conversation.upsert(message("m1", 1))
expect(conversation.messages.map(\.id) == ["m1", "m2"], "messages sort by sequence, not arrival")

let duplicated = conversation.upsert(message("m1", 1))
expect(duplicated == false, "an identical redelivery changes nothing")
expect(conversation.messages.count == 2, "a duplicate does not append")

conversation.upsert(message("m1", 1, text: "hello again"))
expect(conversation.messages.count == 2, "an edit replaces in place")
expect(conversation.message(id: "m1")?.text == "hello again", "the edit is what is stored")

// Anti-correlated ON PURPOSE: id "a" on device "zzz", id "b" on device "aaa".
// The previous fixture paired "b"/"bbb" and "a"/"aaa", so sorting by device id
// and falling through to message id produced the same answer -- and deleting the
// device-id tiebreak entirely left all 293 checks green. None of the six shared
// vectors could tell them apart either, including the one named for this rule.
conversation.upsert(message("a", 3, device: "zzz"))
conversation.upsert(message("b", 3, device: "aaa"))
expect(conversation.messages.suffix(2).map(\.deviceID) == ["aaa", "zzz"],
       "equal sequences break the tie on device id, so every device sorts the same")
expect(conversation.messages.suffix(2).map(\.id) == ["b", "a"],
       "and it is the DEVICE id that breaks it, not the message id")
expect(conversation.lastSequence == 3, "the last sequence is known")

var pendingConversation = Conversation(id: "c2")
pendingConversation.upsert(message("p1", 1, pending: true))
expect(pendingConversation.pendingCount == 1, "a pending message is counted")
pendingConversation.upsert(pendingConversation.message(id: "p1")!.settled())
expect(pendingConversation.pendingCount == 0, "settling clears it in place")

// -- streaming -------------------------------------------------------------

section("streaming")
var stream = StreamAssembler(messageID: "m9")
expect(stream.apply(chunk: "Hel", index: 0), "the first chunk applies")
expect(stream.apply(chunk: "lo", index: 1), "the second chunk applies")
expect(stream.text == "Hello", "chunks assemble in order")
expect(!stream.apply(chunk: "lo", index: 1), "a duplicate chunk is ignored")
expect(!stream.apply(chunk: "!!", index: 7), "a chunk with a gap before it is held, not appended")
expect(stream.text == "Hello", "the held chunk did not corrupt the text")
stream.finish()
expect(stream.isTerminal && stream.displayText == "Hello", "a finished stream shows its text")

var cancelled = StreamAssembler(messageID: "m10")
cancelled.apply(chunk: "Half a th", index: 0)
cancelled.cancel()
expect(cancelled.displayText.hasPrefix("Half a th"), "cancelling keeps what was already said")
expect(cancelled.displayText.contains("Stopped"), "and says it stopped")
expect(!cancelled.apply(chunk: "more", index: 1), "a cancelled stream accepts nothing further")

var failed = StreamAssembler(messageID: "m11")
failed.apply(chunk: "Partial", index: 0)
failed.fail("the connection dropped")
expect(failed.displayText.contains("Partial") && failed.displayText.contains("connection dropped"),
       "a failed stream explains itself instead of leaving a fragment")

// -- secure storage --------------------------------------------------------

section("secure storage")
let storage = SecureStorage()
var refused = false
do {
    try storage.save("token", for: .sessionToken)
} catch SecureStorageError.unavailable {
    refused = true
} catch {
    failures.append("secure storage raised the wrong error")
}
expect(refused, "the default secure store refuses rather than pretending")
expect(Set(SecureKey.allCases.map(\.rawValue)) == [
    "session_token", "refresh_token", "device_key_reference", "push_token",
], "the secure store holds exactly these four slots, and nothing else")
// An ALLOWLIST, not a banned word. The guard was
// `!rawValue.contains("private")`, so adding
// `case deviceSigningKeyMaterial = "device_signing_key_material"` passed every
// check -- a slot that holds a private key by any other name. The claim being
// made is "there is nowhere to put one", and only an exact set says that.
expect(!SecureKey.allCases.map(\.rawValue).contains(where: { $0.contains("private") }),
       "no slot exists for a device private key -- it never leaves the enclave")

// -- account ---------------------------------------------------------------

section("account")
var account = AccountSession()
expect(!account.isUsable && account.userID == nil, "the app starts signed out")
account.beginSignIn(method: "passkey")
expect(!account.isUsable, "signing in is not signed in")
account.signedIn(userID: "user-nick-0001", accessExpiresAt: epoch.addingTimeInterval(600))
expect(account.isUsable && account.userID == "user-nick-0001", "signed in")
expect(!account.needsRefresh(at: epoch), "a fresh token needs no refresh")
expect(account.needsRefresh(at: epoch.addingTimeInterval(560)), "an expiring token triggers a refresh")
expect(account.userID == "user-nick-0001", "refreshing keeps the user on screen")
account.signOut()
expect(!account.isUsable && account.userID == nil, "signing out clears it")

// -- device identity and management ---------------------------------------

section("device identity")
let key = DeviceKeyReference(reference: "enclave://orion-device", publicKey: "public-key-abc", hardwareBacked: true)
expect(key.hardwareBacked, "the key claims hardware backing")
expect(Mirror(reflecting: key).children.compactMap(\.label).allSatisfy { !$0.lowercased().contains("private") },
       "no property could hold a private key")
expect(DeviceManagement.pairingClaimMessage(pairingID: "p1", nonce: "n1", publicKey: "pk") == "pair-join|p1|n1|pk",
       "the pairing claim matches Phase 15's message format")

var management = DeviceManagement(devices: [
    KnownDevice(id: "d1", name: "Nick's iPhone", platform: "ios", isCurrent: true, lastSeen: epoch, revoked: false),
    KnownDevice(id: "d2", name: "Nick's Mac", platform: "macos", isCurrent: false, lastSeen: epoch, revoked: false),
])
expect(management.current?.id == "d1", "the current device is known")
expect(management.revokingIsSelfSignOut("d1"), "revoking this device signs it out, and the model says so")
expect(!management.revokingIsSelfSignOut("d2"), "revoking another device does not")
management.markRevoked("d2")
expect(management.active.count == 1, "a revoked device drops out of the active list")

// -- notifications ---------------------------------------------------------

section("notifications")
var notifications = NotificationSettings()
expect(!notifications.mayDeliver(.requested), "nothing is delivered before permission is granted")
notifications.record(permission: .granted)
expect(notifications.mayDeliver(.requested), "permission enables the ordinary categories")
notifications.setEnabled(.requested, false)
expect(!notifications.mayDeliver(.requested), "a category can be switched off")
notifications.setEnabled(.security, false)
expect(notifications.mayDeliver(.security), "security notifications cannot be switched off")

// -- PHASE 41: the three levels --------------------------------------------
//
// Contents, never counts. `allCases.count == 11` would pass after somebody
// swapped two members for two others, and the members ARE the taxonomy.

let n41Categories = Set(NotificationCategory.allCases.map(\.rawValue))
expect(n41Categories == [
    "approval_required", "security", "schedule_conflict", "remote_task_failure",
    "morning_summary", "evening_summary", "requested", "completion",
    "recommendation", "trend", "discovery",
], "the category set is exactly the manifest's kinds")

// The requirement "do not notify for every ORION observation" as a structural
// fact: there is no category meaning "something happened". Every name below is
// a judgement that has already been made.
expect(!n41Categories.contains(where: { $0.contains("observation") || $0 == "event" || $0 == "info" }),
       "no category means merely 'something happened'")

expect(NotificationLevel.allCases == [.ambient, .brief, .immediate],
       "levels are declared in rising order of urgency, and that order is the meaning")
expect(NotificationLevel.ambient < .brief && NotificationLevel.brief < .immediate,
       "and Comparable agrees with the declaration order")

func n41At(_ level: NotificationLevel) -> Set<String> {
    Set(NotificationCategory.allCases.filter { $0.level == level }.map(\.rawValue))
}

expect(n41At(.immediate) == ["approval_required", "security", "schedule_conflict", "remote_task_failure"],
       "immediate is approvals, security, schedule conflicts and remote failures needing input")
expect(n41At(.brief) == ["morning_summary", "evening_summary", "requested", "completion"],
       "brief is the morning and evening summaries, plus the two non-urgent kinds that predate the taxonomy")
expect(n41At(.ambient) == ["recommendation", "trend", "discovery"],
       "ambient is recommendations, trends and discoveries")

expect(Set(NotificationCategory.allCases.filter(\.mayBreakThrough).map(\.rawValue)) == n41At(.immediate),
       "exactly the immediate categories may break through, because mayBreakThrough is derived from the level")

// -- PHASE 41: an item points at a record, and carries none of it -----------

let n41Epoch = Date(timeIntervalSince1970: 1_772_000_000)
func n41Item(_ id: String, _ category: NotificationCategory, _ subject: String,
             _ summary: String = "text", offset: TimeInterval = 0) -> NotificationItem {
    NotificationItem(id: id, category: category, subject: subject, summary: summary,
                     at: n41Epoch.addingTimeInterval(offset))!
}

expect(NotificationItem(id: "a", category: .trend, subject: "  ", summary: "s", at: n41Epoch) == nil,
       "a notification with no subject is refused -- it would be one whose content exists only in the push")
expect(NotificationItem(id: "", category: .trend, subject: "s1", summary: "s", at: n41Epoch) == nil,
       "and one with no id is refused, because a duplicate push could not then collapse")
expect(NotificationItem(id: "a", category: .trend, subject: "s1", summary: "bad\u{7}bell", at: n41Epoch) == nil,
       "control characters in the summary are refused outright")
expect(NotificationItem(id: "a", category: .trend, subject: "s1",
                        summary: String(repeating: "x", count: 1201), at: n41Epoch) == nil,
       "and an oversized summary is refused")
expect(NotificationItem(id: "a", category: .trend, subject: "s1", summary: "  two   words  ", at: n41Epoch)?.summary
        == "two words", "whitespace is collapsed rather than trusted")

// The structural half of "do not rely on push notifications as state
// synchronization": reflect over the stored properties and pin the set. Adding
// a `state:` or `payload:` field fails HERE, by name, rather than at the point
// somebody starts trusting it.
let n41Fields = Set(Mirror(reflecting: n41Item("a", .trend, "s1")).children.compactMap(\.label))
expect(n41Fields == ["id", "category", "subject", "summary", "at"],
       "a notification carries a pointer and display text -- no state payload")

// -- PHASE 41: routing, collapsing, and order independence ------------------

let n41Stream = [
    n41Item("i1", .approvalRequired, "ap-1", offset: 10),
    n41Item("i2", .approvalRequired, "ap-1", offset: 20),
    n41Item("b1", .morningSummary, "day-2026-09-02", offset: 30),
    n41Item("a1", .trend, "sleep", "sleep is down", offset: 40),
    n41Item("a2", .trend, "sleep", "sleep is down again", offset: 50),
    n41Item("a3", .trend, "steps", "steps are up", offset: 60),
    n41Item("a4", .discovery, "sleep", "a different category, same subject", offset: 70),
]
let n41Plan = NotificationEngine.plan(n41Stream)

expect(n41Plan.interrupting.map(\.id) == ["i1", "i2"],
       "two approvals about one subject stay two -- each is a separate decision")
expect(n41Plan.nextBrief.map(\.id) == ["b1"], "a summary waits for the next brief")
expect(Set(n41Plan.collected.map(\.id)) == ["a2", "a3", "a4"],
       "ambient collapses by category AND subject, newest surviving")
expect(n41Plan.collected.first(where: { $0.subject == "sleep" && $0.category == .trend })?.summary
        == "sleep is down again",
       "and the survivor is the NEWER reading, pinned by its text rather than by a count")

// Ambient has no path to a push. This is the rule, not a consequence.
expect(!n41Plan.interrupting.contains(where: { $0.level == .ambient })
        && !n41Plan.nextBrief.contains(where: { $0.level == .ambient }),
       "an ambient item is never pushed, however many of them there are")

let n41Flood = (0..<200).map { n41Item("f\($0)", .trend, "one-subject", "reading \($0)", offset: Double($0)) }
expect(NotificationEngine.plan(n41Flood).collected.count == 1,
       "two hundred observations about one subject are one item, not two hundred")

// A transport that loses, duplicates or reorders must not change the answer.
expect(NotificationEngine.plan(n41Stream + n41Stream) == n41Plan,
       "delivering everything twice yields the same plan -- pushes are idempotent")
expect(NotificationEngine.plan(n41Stream.reversed()) == n41Plan,
       "and reversing the arrival order changes nothing, so order is not carrying state")
expect(NotificationEngine.plan(n41Stream.shuffled()) == n41Plan,
       "nor does any other arrival order")

// -- PHASE 41: the next brief is a CIVIL time ------------------------------

let n41ISO = ISO8601DateFormatter()
func n41Date(_ text: String) -> Date { n41ISO.date(from: text)! }
let n41London = TimeZone(identifier: "Europe/London")!
let n41NY = TimeZone(identifier: "America/New_York")!

// London, not the machine's zone: an injected value equal to the ambient one
// proves nothing, and this machine is America/New_York.
expect(NotificationEngine.nextBrief(after: n41Date("2026-06-10T06:30:00Z"), in: n41London)?.slot == .morning,
       "before 08:00 the next brief is this morning")
expect(NotificationEngine.nextBrief(after: n41Date("2026-06-10T11:00:00Z"), in: n41London)?.slot == .evening,
       "after it, the next brief is this evening")
expect(NotificationEngine.nextBrief(after: n41Date("2026-06-10T21:00:00Z"), in: n41London)?.slot == .morning,
       "and after the evening slot it is tomorrow morning")

// The clocks go forward in London overnight on 2026-03-29. 22:00 to 08:00 is
// ten hours on the wall and NINE in the world. A brief scheduled by adding
// 86,400 seconds lands at 09:00 on exactly the morning nobody knows what time
// it is.
let n41LondonDST = n41Date("2026-03-28T22:00:00Z")
expect(NotificationEngine.nextBrief(after: n41LondonDST, in: n41London)?.at
        == n41Date("2026-03-29T07:00:00Z"),
       "the brief after the London spring-forward is 08:00 local, which is 07:00Z")
expect(NotificationEngine.nextBrief(after: n41LondonDST, in: n41London)
        .map({ $0.at.timeIntervalSince(n41LondonDST) }) == 9 * 3600,
       "so the gap is nine hours, not ten")

// 22:00 is NOT enough to prove the day arithmetic is civil, and finding that out
// is the finding. Adding 86,400 seconds to 22:00 still lands on the 29th, so the
// hour is then set correctly and the naive version passes by luck. The two only
// diverge in the last hour before midnight: 23:30 GMT plus 86,400 seconds is
// 00:30 BST on the THIRTIETH, so the naive version skips 29 March entirely and
// the morning brief simply never fires. A near-miss assertion is worse than none,
// because it reports the guard as tested.
let n41LondonLate = n41Date("2026-03-28T23:30:00Z")
expect(NotificationEngine.nextBrief(after: n41LondonLate, in: n41London)?.at
        == n41Date("2026-03-29T07:00:00Z"),
       "late on the spring-forward night the next brief is that same morning, not the day after")

// The control: the same wall-clock question a week earlier is ten hours. Without
// this, the nine above could be arithmetic that is wrong everywhere.
let n41LondonPlain = n41Date("2026-03-21T22:00:00Z")
expect(NotificationEngine.nextBrief(after: n41LondonPlain, in: n41London)
        .map({ $0.at.timeIntervalSince(n41LondonPlain) }) == 10 * 3600,
       "and an ordinary night a week earlier is ten, so the nine is DST and not an off-by-one")

// The same transition three weeks earlier in New York, where the app runs.
let n41NYDST = n41Date("2026-03-08T03:00:00Z") // 22:00 EST on the 7th
expect(NotificationEngine.nextBrief(after: n41NYDST, in: n41NY)?.at == n41Date("2026-03-08T12:00:00Z"),
       "New York's spring-forward morning brief is 08:00 EDT")

// -- settings --------------------------------------------------------------

section("settings")
var settings = Settings()
expect(settings.isComplete, "every setting has a value")
expect(settings.value(.requireBiometricUnlock) == .off, "biometric unlock is opt-in")
settings.set(.requireBiometricUnlock, .on)
expect(settings.value(.requireBiometricUnlock).isOn, "a setting can be changed")

// -- security controls -----------------------------------------------------

section("security controls")
var security = SecurityControls()
security.update(sessions: [
    ActiveSession(id: "s1", deviceName: "iPhone", lastUsed: epoch, isCurrent: true),
    ActiveSession(id: "s2", deviceName: "Mac", lastUsed: epoch, isCurrent: false),
])
expect(security.otherSessionCount == 1, "other sessions are counted")
expect(security.availableActions.contains("lock_orion"), "locking is offered while unlocked")
security.lockOrion()
expect(security.lock == .orionLocked, "ORION can be locked")
expect(!security.availableActions.contains("review_sessions"),
       "a locked ORION offers only unlocking and revocation")
expect(security.availableActions.contains("revoke_device"), "revocation survives the lock")
security.unlock()
expect(security.availableActions.contains("review_sessions"), "unlocking restores the rest")

// -- cross-language ordering (Phase 17) ------------------------------------
//
// The ordering rule lives twice: here in MobileCore and in backend/sync. Two
// implementations of one rule is how two devices end up disagreeing about
// history, so both are checked against the same hand-written vectors.

section("shared ordering vectors")
let repositoryRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()   // MobileCoreCheck
    .deletingLastPathComponent()   // Sources
    .deletingLastPathComponent()   // OrionMobile
    .deletingLastPathComponent()   // native
    .deletingLastPathComponent()   // ORION
let vectorsURL = repositoryRoot
    .appendingPathComponent("planning")
    .appendingPathComponent("v2")
    .appendingPathComponent("sync-ordering-vectors.json")

if let data = try? Data(contentsOf: vectorsURL),
   let document = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
   let cases = document["cases"] as? [[String: Any]] {
    expect(cases.count >= 6, "the vectors carry the cases")
    for testCase in cases {
        let name = testCase["name"] as? String ?? "unnamed"
        let inputs = testCase["input"] as? [[String: Any]] ?? []
        let expectedOrder = testCase["expected_order"] as? [String] ?? []
        var conversation = Conversation(id: "vectors")
        for item in inputs {
            conversation.upsert(Message(
                id: item["message_id"] as? String ?? "",
                role: .user,
                text: "",
                sequence: item["sequence"] as? Int ?? 0,
                createdAt: epoch,
                deviceID: item["device_id"] as? String ?? ""
            ))
        }
        expect(conversation.messages.map(\.id) == expectedOrder,
               "vector: \(name) -- got \(conversation.messages.map(\.id)), expected \(expectedOrder)")
    }
} else {
    failures.append("could not read docs/planning/v2/sync-ordering-vectors.json")
}

// -- Today screen (Phase 19) -----------------------------------------------

section("today screen")
expect(TodaySection.allCases.count == 8, "the eight manifest sections exist")
expect(Set(TodaySection.allCases.map(\.rawValue)) == [
    "ORION", "Next", "Priorities", "Tasks",
    "Needs you", "Health", "Worth knowing", "ORION suggests",
], "and they are the manifest's eight, by name")
// A count is not a guard: with only `allCases.count == 8`, deleting "priorities"
// and "action_inbox" and substituting "steps" and "calories" -- the metrics
// dashboard the manifest forbids -- passed all 293 checks.
expect(TodayItem(id: "x", emphasis: .state, meaning: "") == nil, "an item with no meaning cannot exist")
expect(TodayItem(id: "x", emphasis: .state, meaning: "   ") == nil, "nor one that is only whitespace")
expect(TodayItem(id: "x", emphasis: .state, meaning: "7") == nil, "a bare number is not meaning")
expect(TodayItem(id: "x", emphasis: .state, meaning: "82%") == nil, "nor a bare percentage")
expect(TodayItem(id: "x", emphasis: .state, meaning: "3 events, all before noon") != nil,
       "a number inside a sentence is fine")
expect(TodayItem(id: "x", emphasis: .state, meaning: "Clear morning", detail: "3 events") != nil,
       "a number as supporting detail is fine")

var today = TodayModel()
let action = TodayItem(id: "a", emphasis: .action, meaning: "Move the review into it?", actionLabel: "Move")!
let state = TodayItem(id: "s", emphasis: .state, meaning: "You have a clear morning.")!
let meaning = TodayItem(id: "m", emphasis: .meaning, meaning: "It is the only long block this week.")!
expect(today.put(.summary, [action, meaning, state]), "a section can be filled")
expect(today.items(in: .summary).map(\.id) == ["s", "m", "a"],
       "state, then meaning, then action -- whatever order they arrived in")
expect(!today.put(.priorities, []), "an empty section is omitted rather than rendered empty")
expect(today.items(in: .priorities).isEmpty, "and does not appear")

var capped = TodayModel()
let many = (0..<6).compactMap { TodayItem(id: "i\($0)", emphasis: .state, meaning: "Item \($0)") }
capped.put(.tasks, many)
expect(capped.items(in: .tasks).count == TodayModel.maxItemsPerSection,
       "a section is capped, because a screen is not a report")

var full = TodayModel()
for section in [TodaySection.summary, .nextEvents, .priorities, .tasks, .actionInbox] {
    full.put(section, many)
}
expect(full.total == TodayModel.maxItemsOverall, "the whole screen is capped too")
// `<= max` is satisfied by 0, so it could not tell a working cap from a put()
// that silently rejects everything -- which is exactly what was happening.

var refreshable = TodayModel()
for section in [TodaySection.summary, .nextEvents, .priorities, .tasks] {
    refreshable.put(section, Array(many.prefix(3)))
}
expect(refreshable.total == 12, "four full sections fill the screen")
expect(refreshable.put(.summary, [state]),
       "a full screen can still be REFRESHED -- replacing a section is not adding to it")
expect(refreshable.items(in: .summary).map(\.id) == ["s"], "and the refresh actually landed")
expect(refreshable.put(.actionInbox, [action]),
       "and a later section can still appear once an earlier one shrinks")
var clearable = TodayModel()
clearable.put(.summary, [state, meaning])
expect(clearable.put(.summary, []), "an empty put CLEARS a section")
expect(clearable.items(in: .summary).isEmpty, "so a cancelled event can leave the screen")

// A bare measurement is not meaning, whatever punctuation it wears. These all
// constructed before: the guard stripped "%" and "," and asked Double(_:), so
// currency, clock times, ratios and unit-suffixed figures sailed through and a
// whole section could be built out of them.
for metric in ["$1,240", "7:30", "72 bpm", "12/20", "7 kg", "-3°", "1e5", "82 %"] {
    expect(TodayItem(id: "m", emphasis: .state, meaning: metric) == nil,
           "a bare measurement is not meaning: \(metric)")
}
expect(TodayItem(id: "m", emphasis: .state, meaning: "72 bpm, higher than usual") != nil,
       "but a measurement inside a clause is")
// The honest boundary: "$1,240 spent" and "7:30 wake" are LABELLED metrics, and
// a type cannot tell them from "Clear morning" without knowing what the words
// mean. The gate said the metrics-dashboard prohibition is "enforced by the type
// rather than by taste" -- it is enforced against bare measurements only, and
// the rest is a review question. Registered rather than papered over.
expect(TodayItem(id: "m", emphasis: .state, meaning: "$1,240 spent") != nil,
       "a labelled metric still constructs -- the type cannot judge this one")

// Absence is not emptiness. A model that never loaded, one whose source is
// offline, and a quiet day were the same value -- so a view rendered a confident
// "nothing to do" for a failed load.
var unknownToday = TodayModel()
expect(unknownToday.state(of: .nextEvents) == .notYetLoaded,
       "a section that has never loaded says so")
unknownToday.markUnavailable(.nextEvents, reason: "the calendar could not be read")
expect(unknownToday.state(of: .nextEvents) == .unavailable(reason: "the calendar could not be read"),
       "and one that failed to load carries the reason")
expect(unknownToday.items(in: .nextEvents).isEmpty, "with nothing rendered for it")
var quietToday = TodayModel()
quietToday.put(.nextEvents, [])
expect(quietToday.state(of: .nextEvents) == .loaded,
       "a genuinely quiet section is loaded, not unknown")
expect(quietToday.state(of: .nextEvents) != unknownToday.state(of: .nextEvents),
       "so a quiet day and a failed load are distinguishable")

var withoutHealth = TodayModel(healthAvailable: false)
expect(!withoutHealth.put(.health, [state]), "health does not appear until it is available")
var withHealth = TodayModel(healthAvailable: true)
expect(withHealth.put(.health, [state]), "and does once it is")

// -- capture (Phase 20) ----------------------------------------------------

section("unified capture")
expect(CaptureSource.allCases.count == 6, "six capture sources are accepted today")
expect(Set(CaptureSource.allCases.map(\.rawValue)) == [
    "text", "voice", "share_sheet", "screenshot", "photo", "selected_content",
], "and they are the manifest's six, by name")
expect(CaptureSource.later == ["widget", "app_intent"], "widgets and App Intents are marked later")
expect(CaptureSource.later.allSatisfy { later in
    !CaptureSource.allCases.contains { $0.rawValue == later }
}, "nothing marked later is also a live source")
// The two lists were unlinked, so renaming shareSheet's raw value to "widget"
// let a live source claim to be the thing declared not-yet-built. The identical
// bug was found and fixed for HealthType by an earlier review; capture never
// got the same treatment.
expect(CaptureKind.allCases.count == 9, "nine kinds, including unknown")
expect(Set(CaptureKind.allCases.map(\.rawValue)) == [
    "task", "note", "reminder", "event", "shopping_item",
    "reference", "memory_candidate", "health_journal_entry", "unknown",
], "and they are the manifest's nine, by name")
expect(CaptureKind.allCases.contains(.unknown), "ambiguity is representable")

var inbox = CaptureInbox()
let link = inbox.accept(Capture(id: "c1", source: .shareSheet, text: "https://example.com/article",
                                capturedAt: epoch)!)
expect(link.kind == .reference && link.isResolved, "a shared link classifies as a reference")

let vague = inbox.accept(Capture(id: "c2", source: .text, text: "the thing from earlier",
                                 capturedAt: epoch)!)
expect(vague.kind == .unknown, "something vague is admitted to be unknown")
expect(!vague.isResolved, "and is not resolved")
expect(vague.durablePayload() == nil, "an unresolved capture has NO durable payload")

let picture = inbox.accept(Capture(id: "c3", source: .screenshot, text: "screenshot.png",
                                   capturedAt: epoch)!)
expect(picture.kind == .unknown, "an image needs looking at, which nothing here can do")

expect(inbox.needingResolution.map(\.id) == ["c2", "c3"], "the inbox knows what needs a person")
expect(inbox.durablePayloads().count == 1, "only the resolved capture may be saved")

let resolved = inbox.resolve("c2", as: .note)
expect(resolved?.kind == .note, "a person can resolve it")
expect(resolved?.resolvedBy == .user, "and the record says a person did, not the classifier")
expect(resolved?.durablePayload() != nil, "a resolved capture may be saved")
expect(inbox.resolve("c3", as: .unknown)?.kind == .unknown, "resolving AS unknown resolves nothing")
expect(!(inbox.captures.first { $0.id == "c3" }?.isResolved ?? true), "so it still waits")

let lowConfidence = inbox.accept(Capture(id: "c4", source: .text,
                                         text: "my flight is at 6", capturedAt: epoch)!)
expect(!lowConfidence.isResolved, "a low-confidence guess is not a resolution")
expect(lowConfidence.durablePayload() == nil, "and cannot be saved either")
expect(captureConfidenceFloor >= 0.7, "the confidence floor is meaningful")

// The rule the phase exists for, pinned as an invariant rather than a number:
// no keyword heuristic may resolve a capture by itself.
expect(CaptureClassifier.heuristicCeiling < captureConfidenceFloor,
       "a keyword guess can never clear the floor on its own")

// Ordinary English that used to auto-save. Each of these contained "my " inside
// a longer word, or a bare "felt"/"get ", and came back over the floor.
let ambiguous = [
    "Jimmy called about the roof",
    "The academy sent the invoice",
    "enemy contact report",
    "get back to Sarah about the contract",
    "The meeting felt pointless",
    "I am going to buy a house next year",
    "my flight is at 6",
]
expect(ambiguous.allSatisfy { text in
    var probe = CaptureInbox()
    let seen = probe.accept(Capture(id: "p", source: .text, text: text, capturedAt: epoch)!)
    return !seen.isResolved && seen.durablePayload() == nil
}, "ordinary sentences wait for a person instead of saving themselves")
expect(!ambiguous.isEmpty, "and that corpus is not empty")

// The durable payload's SHAPE was never asserted -- only that it was non-nil --
// so resolved_by, the one field this requirement exists to deliver, could be
// dropped from the persisted record with every check still green.
let savedNote = inbox.captures.first { $0.id == "c2" }?.durablePayload()
expect(savedNote?["resolved_by"] == "user", "a saved capture records WHO decided")
expect(savedNote?["kind"] == "note" && savedNote?["capture_id"] == "c2",
       "along with what it is and which capture it was")
expect(Set(savedNote.map { Array($0.keys) } ?? []) ==
       ["capture_id", "kind", "resolved_by", "source", "text"],
       "and carries exactly those fields")

// A verdict is the only way to set kind and confidence, so nothing outside the
// classifier can stamp resolvedBy = .classifier on a capture it chose itself.
expect(Capture(id: "c5", source: .text, text: "   ", capturedAt: epoch) == nil,
       "a whitespace-only capture does not exist")
expect(Capture(id: "  ", source: .text, text: "real text", capturedAt: epoch) == nil,
       "nor one with no id")
expect(Capture(id: "c6", source: .text,
               text: String(repeating: "x", count: Capture.maxTextLength + 1),
               capturedAt: epoch) == nil, "nor one past the length bound")

var dupInbox = CaptureInbox()
dupInbox.accept(Capture(id: "dup", source: .text, text: "first", capturedAt: epoch)!)
dupInbox.accept(Capture(id: "dup", source: .text, text: "second", capturedAt: epoch)!)
expect(dupInbox.captures.count == 1, "an id arrives once")
expect(dupInbox.captures.first?.text == "second", "and the later capture wins")

// -- health, Phase 30 -------------------------------------------------------

section("health")
expect(HealthType.allCases.count == 8, "the eight categories the manifest names")
expect(Set(HealthType.allCases.map(\.rawValue)) == [
    "sleep", "resting_heart_rate", "heart_rate_variability", "respiratory_rate",
    "steps", "active_energy", "workouts", "exercise_minutes",
], "and they are the eight it names, not eight others")
expect(HealthType.allCases.count < HealthTypeCatalogue.approximateAvailableTypes / 10,
       "ORION asks for a small fraction of what HealthKit offers")
expect(HealthTypeCatalogue.neverRequested.count >= 5,
       "the categories deliberately not requested are named, with reasons")
expect(HealthTypeCatalogue.neverRequested.values.allSatisfy { !$0.isEmpty },
       "each says why")
expect(HealthTypeCatalogue.neverRequested["clinical_records"] != nil,
       "clinical records are explicitly excluded")
// The exclusion list and the request set were unlinked, so `neverRequested`
// could name "steps" while HealthType.steps was still requested -- a list that
// flatly contradicts the code and says nothing. Found by an independent review.
expect(HealthTypeCatalogue.neverRequested.keys.allSatisfy { excluded in
    !HealthType.allCases.contains { $0.rawValue == excluded }
}, "nothing is both requested and never-requested")

expect(HealthDevice.iPhone.mayReadHealth, "the iPhone reads health data")
expect(HealthDevice.allCases.filter(\.mayReadHealth).count == 1,
       "and nothing else does -- the manifest says iPhone only")
expect(!HealthDevice.watch.mayReadHealth,
       "the watch is Phase 77, so reading now would make that a migration")

var ledger = HealthAuthorizationLedger()
expect(HealthType.allCases.allSatisfy { ledger.status(of: $0) == .notRequested },
       "nothing is requested until it is")
let firstAsk = try? ledger.request([.sleep, .steps], on: .iPhone)
expect(firstAsk == [.sleep, .steps], "the first request asks for what was wanted")
expect(ledger.status(of: .sleep) == .requested, "and records it")
expect(ledger.status(of: .workouts) == .notRequested, "and asks for nothing else")

let secondAsk = try? ledger.request([.sleep, .steps, .workouts], on: .iPhone)
expect(secondAsk == [.workouts],
       "a later request asks only for what is new -- a repeated sheet teaches dismissal")

var refusedRepeat = false
do { _ = try ledger.request([.sleep], on: .iPhone) } catch { refusedRepeat = true }
expect(refusedRepeat, "re-asking for something already answered is refused")

var refusedDevice = false
var macLedger = HealthAuthorizationLedger(device: .mac)
do { _ = try macLedger.request([.sleep], on: .mac) } catch { refusedDevice = true }
expect(refusedDevice, "a Mac cannot request health authorization")

try? ledger.settle(.sleep, as: .unknowable)
try? ledger.settle(.steps, as: .denied)
expect(ledger.status(of: .sleep) == .unknowable,
       "a completed read request is unknowable -- HealthKit will not say what was granted")
expect(ledger.readable == [.sleep], "only an unknowable type may be read")
expect(ledger.needsAttention == [.steps], "a denial is surfaced")

let sample = HealthSample(type: .sleep, start: epoch, end: epoch.addingTimeInterval(3600),
                          value: 60, unit: "min")
ledger.revoke(.sleep)
expect(ledger.status(of: .sleep) == .revoked, "revocation is its own state, not a denial")
expect(ledger.needsAttention.contains(.sleep), "and it is surfaced too")
expect(!ledger.readable.contains(.sleep), "and a revoked type is not readable")

// A revoked type could never be re-requested -- `outstanding` only returns
// notRequested -- and the only way back to readable was the ungated `settle`.
var reopenFailed = false
do { _ = try ledger.request([.sleep], on: .iPhone) } catch { reopenFailed = true }
expect(reopenFailed, "a revoked type is not simply re-requestable")
var settleAfterRevokeBlocked = false
do { try ledger.reopen(.sleep) } catch { settleAfterRevokeBlocked = true }
expect(!settleAfterRevokeBlocked, "reopen() is the named way back")
expect(ledger.status(of: .sleep) == .notRequested, "and it returns the type to unrequested")

// The stored device was written once and read by nothing.
var watchLedger = HealthAuthorizationLedger(device: .watch)
var watchBlocked = false
do { _ = try watchLedger.request([.sleep], on: .iPhone) } catch { watchBlocked = true }
expect(watchBlocked, "a watch ledger cannot request by claiming to be an iPhone")
var watchSettleBlocked = false
do { try watchLedger.settle(.sleep, as: .unknowable) } catch { watchSettleBlocked = true }
expect(watchSettleBlocked, "nor can it settle its way to readable without requesting")
expect(watchLedger.readable.isEmpty, "so a watch never becomes readable")

var neverAsked = HealthAuthorizationLedger()
var settleWithoutRequest = false
do { try neverAsked.settle(.steps, as: .unknowable) } catch { settleWithoutRequest = true }
expect(settleWithoutRequest, "an outcome for something never asked about is refused")

expect(HealthLocalLayer.interpret([], authorization: .requested) == .notAuthorized,
       "a pending request is not yet authorized")
expect(HealthLocalLayer.interpret([sample], authorization: .revoked) == .samples([sample]),
       "revocation stops new reads and keeps the history already held")

expect(HealthLocalLayer.interpret([], authorization: .unknowable) == .noData,
       "an empty answer under an unknowable grant is noData, not denied")
expect(HealthLocalLayer.interpret([], authorization: .denied) == .notAuthorized,
       "and a denial is notAuthorized")
expect(HealthLocalLayer.interpret([sample], authorization: .unknowable) == .samples([sample]),
       "data is data")
expect(!HealthLocalLayer.contributes(.noData),
       "noData contributes nothing -- missing health data is not zero")
expect(!HealthLocalLayer.contributes(.notAuthorized), "nor does an unauthorized read")
expect(HealthLocalLayer.contributes(.samples([sample])), "a real sample does")

// Raw health data has no serialised form, so nothing can upload it without
// somebody first writing an encoder and being asked why.
expect(!((sample as Any) is any Encodable), "a health sample is not Encodable")
expect(!((sample as Any) is any Decodable), "nor Decodable")
expect(!((HealthReading.samples([sample]) as Any) is any Encodable),
       "nor is a reading that contains one")

var refusingStore = false
do { _ = try RefusingHealthStore().read(.sleep, from: epoch, to: epoch) } catch { refusingStore = true }
expect(refusingStore, "the default health store refuses rather than returning plausible numbers")

// -- health baselines, Phase 31 ---------------------------------------------

section("health baselines")

// Every fixture night ENDS in the past. The first version of this helper put
// its most recent night's end seven hours after `now`, so a "twenty sessions"
// fixture contributed nineteen and a future-dated baseline read as perfectly
// fresh -- which an independent review found by noticing the check hedged
// `acuteSamples == 8 || acuteSamples == 7`.
func nights(_ count: Int, hours: Double, startHour: Int = 23, spacingDays: Int = 1,
            endingDaysBeforeNow: Int = 0, now: Date) -> [HealthSample] {
    (0..<count).map { index in
        let day = now.addingTimeInterval(
            -Double(endingDaysBeforeNow + index * spacingDays + 1) * 86400
        )
        let start = day.addingTimeInterval(Double(startHour - 24) * 3600)
        return HealthSample(type: .sleep, start: start,
                            end: start.addingTimeInterval(hours * 3600),
                            value: hours * 60, unit: "min")
    }
}

let clock = epoch.addingTimeInterval(90 * 86400)

expect(BaselineKind.allCases.count == 6, "the six baselines the manifest names")
expect(Set(BaselineKind.allCases.map(\.rawValue)) == [
    "sleep_duration", "sleep_consistency", "resting_heart_rate",
    "heart_rate_variability", "activity", "training_load",
], "and they are the six it names")

// Below the floor there is no baseline, not a low-confidence number.
expect(BaselineRules.sampleFloor == 7, "a week is the floor")
for count in 0..<BaselineRules.sampleFloor {
    expect(BaselineEngine.baseline(.sleepDuration,
                                   from: nights(count, hours: 8, now: clock),
                                   unit: "min", now: clock) == nil,
           "\(count) nights is not a baseline")
}
let atFloor = BaselineEngine.baseline(
    .sleepDuration, from: nights(BaselineRules.sampleFloor, hours: 8, now: clock),
    unit: "min", now: clock)
expect(atFloor != nil, "at the floor there is one")
expect(atFloor?.sampleCount == BaselineRules.sampleFloor, "and it says how many")

// A missing day is absent, never zero.
var gappy = nights(4, hours: 8, now: clock)
gappy += nights(4, hours: 8, endingDaysBeforeNow: 10, now: clock)
let withGaps = BaselineEngine.baseline(.sleepDuration, from: gappy, unit: "min", now: clock)
expect(withGaps?.sampleCount == 8, "a fortnight with gaps counts the nights that exist")
expect(withGaps?.value == 480,
       "and the gaps do not drag the value down -- missing health data is not zero")

// Median, not mean: one bad night is not a fact about how somebody sleeps.
var withOutlier = nights(7, hours: 8, now: clock)
withOutlier.append(HealthSample(type: .sleep, start: clock.addingTimeInterval(-86400 * 9),
                                end: clock.addingTimeInterval(-86400 * 9 + 7200),
                                value: 120, unit: "min"))
expect(BaselineEngine.baseline(.sleepDuration, from: withOutlier, unit: "min", now: clock)?.value == 480,
       "one two-hour night after a flight does not move the baseline")

// Confidence is earned by evidence and capped by freshness.
expect(BaselineEngine.confidence(sampleCount: 7, freshness: 0) == .low, "seven nights is provisional")
expect(BaselineEngine.confidence(sampleCount: 21, freshness: 0) == .high, "three weeks is not")
expect(BaselineEngine.confidence(sampleCount: 100, freshness: BaselineRules.staleAfter) == .moderate,
       "a large sample cannot outvote staleness")
expect(BaselineEngine.confidence(sampleCount: 100, freshness: BaselineRules.veryStaleAfter) == .low,
       "and very stale is low however much of it there is")

// Freshness is the age of the newest sample, not of the calculation.
// 25 days back, not 21: a sample "21 days ago" ENDS seven hours later, so its
// freshness is just under the threshold. The fixture was wrong, not the rule.
let stale = BaselineEngine.baseline(
    .sleepDuration, from: nights(10, hours: 8, endingDaysBeforeNow: 25, now: clock),
    unit: "min", now: clock)
expect(stale?.isStale == true, "a baseline whose data stopped three weeks ago is stale")
expect(stale?.confidence == .low, "and cannot be confident")
expect((stale?.freshness ?? 0) >= BaselineRules.veryStaleAfter,
       "freshness is measured from the newest contributing sample")

// Precision is not fabricated: the step widens as confidence falls.
expect(BaselineEngine.step(for: .restingHeartRate, at: .high)
       < BaselineEngine.step(for: .restingHeartRate, at: .low),
       "a provisional baseline is reported coarsely")
for kind in BaselineKind.allCases {
    expect(BaselineEngine.step(for: kind, at: .high) <= BaselineEngine.step(for: kind, at: .moderate)
           && BaselineEngine.step(for: kind, at: .moderate) <= BaselineEngine.step(for: kind, at: .low),
           "\(kind.rawValue) steps widen monotonically as confidence falls")
}
expect(BaselineEngine.quantise(58.3719, to: 5) == 60, "58.3719 bpm from six readings is 60")
let odd = nights(7, hours: 7.3, now: clock)
let quantised = BaselineEngine.baseline(.sleepDuration, from: odd, unit: "min", now: clock)
expect(quantised != nil && quantised!.value.truncatingRemainder(
        dividingBy: BaselineEngine.step(for: .sleepDuration, at: quantised!.confidence)) == 0,
       "the reported value sits on the step its confidence allows")

// There is no population table to fall back to.
expect(BaselineEngine.baseline(.restingHeartRate, from: [], unit: "bpm", now: clock) == nil,
       "no samples means no baseline, not the average person's")

// Sleep consistency measures when sleep starts, not how long it lasts.
let steadyLate = nights(10, hours: 7, startHour: 26, now: clock)   // 02:00 every night
let consistency = BaselineEngine.sleepConsistency(from: steadyLate, now: clock)
expect(consistency != nil, "ten nights is enough for a consistency baseline")
expect(consistency?.value == 0,
       "a steady 02:00 is perfectly consistent, however late it is")
var wandering = nights(5, hours: 7, startHour: 22, now: clock)
wandering += nights(5, hours: 7, startHour: 27, endingDaysBeforeNow: 5, now: clock)
let scattered = BaselineEngine.sleepConsistency(from: wandering, now: clock)
expect((scattered?.value ?? 0) > 0, "a wandering bedtime is not")

// Midnight is not a discontinuity: 23:50 and 00:10 are twenty minutes apart.
//
// Anchored on a REAL local midnight. The first version of this fixture built
// its times from an arbitrary epoch offset, so it never actually straddled
// midnight and the assertion passed with the unwrapping removed.
var midnightCalendar = Calendar(identifier: .gregorian)
midnightCalendar.timeZone = TimeZone(identifier: "UTC")!
let localMidnight = midnightCalendar.startOfDay(for: clock)
var acrossMidnight: [HealthSample] = []
for index in 0..<10 {
    // Alternating 23:50 and 00:10, one night apart.
    let offsetMinutes = index % 2 == 0 ? -10.0 : 10.0
    let start = localMidnight
        .addingTimeInterval(-Double(index + 1) * 86400)
        .addingTimeInterval(offsetMinutes * 60)
    acrossMidnight.append(
        HealthSample(type: .sleep, start: start,
                     end: start.addingTimeInterval(7 * 3600), value: 420, unit: "min")
    )
}
let wrapped = BaselineEngine.sleepConsistency(
    from: acrossMidnight, now: clock, calendar: midnightCalendar)
expect((wrapped?.value ?? 999) <= 30,
       "a bedtime straddling midnight is twenty minutes of variation, not twenty-three hours")

// The wrap has two branches and a tight two-cluster fixture only exercises one,
// because the median absolute deviation of a 50/50 split is insensitive to it.
// A bedtime that DRIFTS across midnight exercises both: 22:20 through 01:20.
let drifting: [Double] = [1340, 1370, 1400, 1430, 20, 50, 80]
let driftSamples = drifting.enumerated().map { index, minutes -> HealthSample in
    let start = localMidnight
        .addingTimeInterval(-Double(index + 2) * 86400)
        .addingTimeInterval(minutes * 60)
    return HealthSample(type: .sleep, start: start,
                        end: start.addingTimeInterval(6 * 3600), value: 360, unit: "min")
}
let drift = BaselineEngine.sleepConsistency(
    from: driftSamples, now: clock, calendar: midnightCalendar)
expect(drift?.value == 60,
       "a bedtime drifting from 22:20 to 01:20 is an hour of variation -- both wrap "
       + "branches, not just the one a tight cluster reaches")

// Below the floor, consistency declines too.
for count in 0..<BaselineRules.sampleFloor {
    expect(BaselineEngine.sleepConsistency(
            from: Array(acrossMidnight.prefix(count)), now: clock,
            calendar: midnightCalendar) == nil,
           "\(count) nights is not a consistency baseline either")
}

// A value that is not a number contributes nothing rather than poisoning the
// median -- NaN sorts unpredictably and infinity makes every deviation
// infinite.
var poisoned = nights(7, hours: 8, now: clock)
poisoned.append(HealthSample(type: .sleep, start: clock.addingTimeInterval(-86400 * 2),
                             end: clock.addingTimeInterval(-86400), value: Double.nan, unit: "min"))
poisoned.append(HealthSample(type: .sleep, start: clock.addingTimeInterval(-86400 * 3),
                             end: clock.addingTimeInterval(-86400 * 2), value: Double.infinity, unit: "min"))
let cleaned = BaselineEngine.baseline(.sleepDuration, from: poisoned, unit: "min", now: clock)
expect(cleaned?.sampleCount == 7, "a NaN and an infinity are not observations")
expect(cleaned?.value == 480, "and they do not reach the value")

// Training load: acute against chronic, and no ratio without a denominator.
let workouts = (0..<20).map { index in
    HealthSample(type: .workouts,
                 start: clock.addingTimeInterval(-Double(index + 1) * 86400),
                 end: clock.addingTimeInterval(-Double(index + 1) * 86400 + 3600),
                 value: 60, unit: "min")
}
let load = BaselineEngine.trainingLoad(from: workouts, now: clock)
expect(load != nil, "twenty sessions is a training load")
expect(load?.ratio != nil, "with a ratio")
// Exactly seven, not "seven or eight". The OR was hedging an off-by-one that
// turned out to be a future-dated fixture.
expect(load?.acuteSamples == 7, "the acute window is a week, and all of it counts")
expect(load?.chronicSamples == 20, "and every one of the twenty sessions is in the chronic window")
// The gate calls this "chronic (28d, normalised per week)", and dropping the
// normalisation turns this fixture from heavy into light. Only the ratio's
// VALUE catches that; asserting it is merely non-nil does not.
expect(load?.acute == 420, "seven hour-long sessions in the acute window")
expect(load?.chronic == 300, "and twenty over four weeks is three hundred minutes a week")
expect(abs((load?.ratio ?? 0) - 1.4) < 0.001, "so this week is 1.4x the usual one")
expect(HealthStateEngine.physicalLoad(load).value == .heavy, "which reads as heavy")
expect(BaselineEngine.trainingLoad(from: Array(workouts.prefix(3)), now: clock) == nil,
       "three sessions is not")
let zeroLoad = (0..<10).map { index in
    HealthSample(type: .workouts,
                 start: clock.addingTimeInterval(-Double(index + 1) * 86400),
                 end: clock.addingTimeInterval(-Double(index + 1) * 86400),
                 value: 0, unit: "min")
}
expect(BaselineEngine.trainingLoad(from: zeroLoad, now: clock)?.ratio == nil,
       "no ratio without a denominator -- absent, not 1.0 and not infinity")

// A baseline hands over its uncertainty with its value.
let complete = BaselineEngine.baseline(
    .sleepDuration, from: nights(21, hours: 8, now: clock), unit: "min", now: clock)
expect(complete?.confidence == .high && complete?.sampleCount == 21
       && (complete?.freshness ?? -1) >= 0 && complete?.unit == "min",
       "value, spread, samples, confidence and freshness are all on the same type")

// Raw samples still cannot be encoded; baselines are derived, not raw.
expect(!((complete as Any) is any Encodable), "a baseline is not Encodable either")

// -- health state, Phase 32 -------------------------------------------------

section("health state")

func makeBaseline(_ kind: BaselineKind, value: Double, spread: Double,
                  confidence: BaselineConfidence = .high,
                  freshness: TimeInterval = 3600, unit: String = "min") -> Baseline {
    Baseline(kind: kind, value: value, spread: spread, sampleCount: 21,
             confidence: confidence, freshness: freshness, unit: unit)
}

// All six states the manifest names, each closed and each able to say it does
// not know.
expect(SleepState.allCases.count == 5 && SleepState.allCases.contains(.unknown),
       "sleep_state is a closed set with an unknown")
expect(PhysicalRecovery.allCases.contains(.unknown), "physical_recovery can be unknown")
expect(PhysicalLoad.allCases.contains(.unknown), "physical_load can be unknown")
expect(EnergyState.allCases.contains(.unknown), "energy_state can be unknown")
expect(StressTrend.allCases.contains(.unknown), "stress_trend can be unknown")

// Not a diagnosis, checked against ORION's own vocabulary rather than a filter
// on anything a person types.
expect(ClinicalVocabulary.forbidden.count >= 20, "the clinical word list is real")
let everyStateWord = SleepState.allCases.map(\.rawValue)
    + PhysicalRecovery.allCases.map(\.rawValue)
    + PhysicalLoad.allCases.map(\.rawValue)
    + EnergyState.allCases.map(\.rawValue)
    + StressTrend.allCases.map(\.rawValue)
expect(everyStateWord.allSatisfy { !ClinicalVocabulary.contaminates($0) },
       "no state value is a clinical term")
expect(ClinicalVocabulary.contaminates("looks like insomnia to me"),
       "and the check actually detects one")
expect(ClinicalVocabulary.contaminates("possible SLEEP DISORDER"),
       "case-insensitively")
expect(HealthStateReading(value: SleepState.belowBaseline,
                          reason: "this looks like insomnia", baseline: nil,
                          confidence: .high, freshness: 0) == nil,
       "a reason carrying a clinical term cannot be constructed")
expect(HealthStateReading(value: SleepState.belowBaseline, reason: "   ",
                          baseline: nil, confidence: .high, freshness: 0) == nil,
       "nor can an empty reason -- a state must be able to say why")

// The VALUE check is unreachable through the real enums, because they are all
// clean -- which is the point, and is also why removing it went unnoticed. It
// is the guard that has to fire the day somebody adds a case.
enum WouldBeDiagnosis: String, Sendable {
    case insomnia
}
expect(HealthStateReading(value: WouldBeDiagnosis.insomnia,
                          reason: "you slept less than usual", baseline: nil,
                          confidence: .high, freshness: 0) == nil,
       "a state whose VALUE is a clinical term cannot be constructed either")

// The four things that must always survive.
let sleepBaseline = makeBaseline(.sleepDuration, value: 480, spread: 30)
let shortNight = HealthSample(type: .sleep, start: epoch, end: epoch.addingTimeInterval(6 * 3600),
                              value: 390, unit: "min")
let sleepReading = HealthStateEngine.sleepState(last: shortNight, baseline: sleepBaseline)
expect(sleepReading.value == .wellBelowBaseline, "ninety minutes down on a half-hour spread is a lot")
expect(!sleepReading.reason.isEmpty, "reason survives")
expect(sleepReading.baseline?.value == 480, "the baseline itself survives, not a copy of its number")
expect(sleepReading.confidence == .high, "confidence survives")
expect(sleepReading.freshness == 3600, "freshness survives")
expect(sleepReading.reason.contains("90"), "and the reason says what was observed")

// Departure is relative to the person's own spread, not an absolute.
let steadySleeper = makeBaseline(.sleepDuration, value: 480, spread: 10)
let variableSleeper = makeBaseline(.sleepDuration, value: 480, spread: 120)
let sameNight = HealthSample(type: .sleep, start: epoch, end: epoch.addingTimeInterval(7 * 3600),
                             value: 420, unit: "min")
expect(HealthStateEngine.sleepState(last: sameNight, baseline: steadySleeper).value == .wellBelowBaseline,
       "an hour off is a lot for somebody who never varies")
expect(HealthStateEngine.sleepState(last: sameNight, baseline: variableSleeper).value == .atBaseline,
       "and nothing for somebody who varies by two")

// A state with no evidence is unknown, never a middle value.
let noSleep = HealthStateEngine.sleepState(last: nil, baseline: nil)
expect(noSleep.value == .unknown, "no baseline means unknown")
expect(noSleep.value != .atBaseline, "and specifically not the middle one")
expect(noSleep.reason.contains("no reading"), "and it says which input was missing")
expect(noSleep.confidence == .low, "an unknown is not confident")
expect(HealthStateEngine.physicalRecovery(restingHeartRate: nil, latestRestingHeartRate: nil,
                                          variability: nil, latestVariability: nil).value == .unknown,
       "recovery without a baseline is unknown, not moderate")
expect(HealthStateEngine.physicalLoad(nil).value == .unknown,
       "load without a ratio is unknown, not steady")
expect(HealthStateEngine.stressTrend(recent: nil, earlier: nil).value == .unknown,
       "a trend needs two windows; one is a reading, not a direction")

// Recovery reads both inputs and degrades on either.
let restingBaseline = makeBaseline(.restingHeartRate, value: 55, spread: 2, unit: "bpm")
let hrvBaseline = makeBaseline(.heartRateVariability, value: 60, spread: 5, unit: "ms")
expect(HealthStateEngine.physicalRecovery(restingHeartRate: restingBaseline, latestRestingHeartRate: 55,
                                          variability: hrvBaseline, latestVariability: 60).value == .good,
       "at baseline on both is good")
expect(HealthStateEngine.physicalRecovery(restingHeartRate: restingBaseline, latestRestingHeartRate: 61,
                                          variability: hrvBaseline, latestVariability: 60).value == .limited,
       "a resting heart rate three spreads up is limited")
expect(HealthStateEngine.physicalRecovery(restingHeartRate: restingBaseline, latestRestingHeartRate: 55,
                                          variability: hrvBaseline, latestVariability: 45).value == .limited,
       "so is suppressed variability, on its own")

// data_confidence is the weakest input, never an average.
expect(HealthStateEngine.weakest([.high, .low]) == .low,
       "one provisional input makes the picture provisional")
expect(HealthStateEngine.weakest([.high, .high]) == .high, "and two solid ones do not")
expect(HealthStateEngine.weakest([nil, nil]) == .low, "nothing at all is low, not high")
let provisional = makeBaseline(.restingHeartRate, value: 55, spread: 2,
                               confidence: .low, unit: "bpm")
let mixed = HealthStateEngine.physicalRecovery(
    restingHeartRate: provisional, latestRestingHeartRate: 55,
    variability: hrvBaseline, latestVariability: 60)
expect(mixed.confidence == .low,
       "a solid input cannot hide a provisional one -- averaging is what lets it")

// Freshness across two inputs is the STALEST, for the same reason.
let staleHrv = makeBaseline(.heartRateVariability, value: 60, spread: 5,
                            freshness: 20 * 86400, unit: "ms")
expect(HealthStateEngine.physicalRecovery(restingHeartRate: restingBaseline, latestRestingHeartRate: 55,
                                          variability: staleHrv, latestVariability: 60).freshness
       == 20 * 86400,
       "the picture is as old as its oldest part")

// The assembled state.
let assembled = HealthStateEngine.assemble(
    sleep: sleepReading,
    recovery: mixed,
    load: HealthStateEngine.physicalLoad(nil),
    energy: HealthStateEngine.energyState(sleep: sleepReading, recovery: mixed),
    stress: HealthStateEngine.stressTrend(recent: nil, earlier: nil)
)
expect(assembled.dataConfidence == .low, "the whole picture is as confident as its weakest part")
expect(assembled.energy.value != .unknown, "energy is derived from what IS known")
expect(!assembled.sleep.reason.isEmpty && !assembled.physicalLoad.reason.isEmpty,
       "every state in the picture can say why")

// No decimal score anywhere.
expect(!((assembled as Any) is any Encodable), "a health state is not Encodable either")

// -- states over REAL baselines, and the branches nothing exercised ---------
//
// An independent review found the structural cause of 23 unenforced guards:
// every Phase 32 fixture was a hand-built `Baseline` with a hand-chosen spread,
// so nothing here ever consumed what Phase 31 actually emits.

let realSleep = BaselineEngine.baseline(
    .sleepDuration, from: nights(21, hours: 8, now: clock), unit: "min", now: clock)!
expect(realSleep.spread == 0, "a perfectly regular sleeper has a spread of zero")
expect(realSleep.comparisonSpread == BaselineEngine.step(for: .sleepDuration, at: .high),
       "and the comparison floor is the kind's finest step, not a bare 1")
// With a spread of zero the floor decides, and the floor is the kind's finest
// step (5 min). So three minutes is nothing and an hour is a lot -- the point
// being that a zero spread does not make every difference enormous.
let threeShort = HealthSample(type: .sleep, start: epoch, end: epoch, value: 477, unit: "min")
expect(HealthStateEngine.sleepState(last: threeShort, baseline: realSleep).value == .atBaseline,
       "three minutes down on a regular sleeper is not a departure")
let hourShort = HealthSample(type: .sleep, start: epoch, end: epoch, value: 420, unit: "min")
expect(HealthStateEngine.sleepState(last: hourShort, baseline: realSleep).value == .wellBelowBaseline,
       "and an hour down still is")

// A real spread that quantisation used to round away to zero.
let variedNights = [480.0, 466, 494, 466, 494, 466, 494].enumerated().map { index, minutes in
    HealthSample(type: .sleep,
                 start: clock.addingTimeInterval(-Double(index + 1) * 86400),
                 end: clock.addingTimeInterval(-Double(index + 1) * 86400 + minutes * 60),
                 value: minutes, unit: "min")
}
let varied = BaselineEngine.baseline(.sleepDuration, from: variedNights, unit: "min", now: clock)!
expect(varied.confidence == .low, "seven nights is provisional")
expect(varied.spread == 14, "and the real variability is fourteen minutes")
expect(varied.reportedSpread == 0,
       "which ROUNDS to zero for display at this confidence -- so display is not comparison")
let fifteenShort = HealthSample(type: .sleep, start: epoch, end: epoch, value: 465, unit: "min")
let judged = HealthStateEngine.sleepState(last: fifteenShort, baseline: varied)
expect(judged.value == .belowBaseline,
       "fifteen minutes down on a fourteen-minute spread is one spread out -- slightly below")
expect(judged.value != .wellBelowBaseline,
       "and NOT a crisis, which is what the quantised spread used to make it")

// Non-finite raw readings must not reach an Int conversion.
let nanNight = HealthSample(type: .sleep, start: epoch, end: epoch, value: .nan, unit: "min")
expect(HealthStateEngine.sleepState(last: nanNight, baseline: realSleep).value == .unknown,
       "a NaN sleep reading is unknown, not a crash")
expect(HealthStateEngine.physicalRecovery(restingHeartRate: restingBaseline,
                                          latestRestingHeartRate: .infinity,
                                          variability: nil, latestVariability: nil).value == .unknown,
       "an infinite resting heart rate is unknown, not a crash")
expect(HealthStateEngine.physicalRecovery(restingHeartRate: restingBaseline, latestRestingHeartRate: 55,
                                          variability: hrvBaseline, latestVariability: .nan).value == .good,
       "an unreadable variability is ignored rather than poisoning recovery")

// A TrainingLoad whose ratio is nil -- the object Phase 31 is built to produce.
let ratioless = BaselineEngine.trainingLoad(from: zeroLoad, now: clock)
expect(ratioless != nil && ratioless?.ratio == nil, "zero training gives a load with no ratio")
expect(HealthStateEngine.physicalLoad(ratioless).value == .unknown,
       "and a load with no ratio is unknown, not steady")

// An infinite workout must not reach the consumer at all.
var poisonedWorkouts = workouts
poisonedWorkouts.append(HealthSample(type: .workouts,
                                     start: clock.addingTimeInterval(-86400 * 2),
                                     end: clock.addingTimeInterval(-86400 * 2),
                                     value: .infinity, unit: "min"))
let survivingLoad = BaselineEngine.trainingLoad(from: poisonedWorkouts, now: clock)
expect(survivingLoad?.ratio != nil && survivingLoad!.ratio!.isFinite,
       "an infinite session is not an observation and the ratio stays a number")
expect(HealthStateEngine.physicalLoad(survivingLoad).value != .unknown,
       "so the load still reads")

// A negative session must not invert the ratio.
var negativeWorkouts = workouts
negativeWorkouts.append(HealthSample(type: .workouts,
                                     start: clock.addingTimeInterval(-86400 * 20),
                                     end: clock.addingTimeInterval(-86400 * 20),
                                     value: -699.9, unit: "min"))
let negativeLoad = BaselineEngine.trainingLoad(from: negativeWorkouts, now: clock)
expect((negativeLoad?.ratio ?? 999) < 10,
       "negative training minutes cannot produce a ratio of twenty-eight thousand")

// Future-dated samples are not fresh data.
let futureNights = (0..<10).map { index in
    HealthSample(type: .sleep,
                 start: clock.addingTimeInterval(Double(index + 1) * 86400),
                 end: clock.addingTimeInterval(Double(index + 1) * 86400 + 28800),
                 value: 480, unit: "min")
}
expect(BaselineEngine.baseline(.sleepDuration, from: futureNights, unit: "min", now: clock) == nil,
       "a baseline made of data that has not happened is not a baseline")
expect(BaselineEngine.sleepConsistency(from: futureNights, now: clock) == nil,
       "and neither is a consistency reading")

// A calendar that cannot answer is not midnight.
let impossible = (0..<10).map { _ in
    HealthSample(type: .sleep, start: Date.distantPast,
                 end: Date.distantPast, value: 480, unit: "min")
}
var gregorian = Calendar(identifier: .gregorian)
gregorian.timeZone = TimeZone(identifier: "UTC")!
let fromGarbage = BaselineEngine.sleepConsistency(from: impossible, now: clock, calendar: gregorian)
expect(fromGarbage == nil || (fromGarbage?.value ?? 0) >= 0,
       "garbage dates do not report perfect consistency")

// energyState, every branch.
func reading(_ state: SleepState) -> HealthStateReading<SleepState> {
    HealthStateReading(value: state, reason: "fixture", baseline: realSleep,
                       confidence: .high, freshness: 0)!
}
func recoveryReading(_ state: PhysicalRecovery,
                     _ confidence: BaselineConfidence = .high) -> HealthStateReading<PhysicalRecovery> {
    HealthStateReading(value: state, reason: "fixture", baseline: nil,
                       confidence: confidence, freshness: 0)!
}
expect(HealthStateEngine.energyState(sleep: reading(.atBaseline),
                                     recovery: recoveryReading(.good)).value == .high,
       "slept well and recovered is high energy")
expect(HealthStateEngine.energyState(sleep: reading(.wellBelowBaseline),
                                     recovery: recoveryReading(.limited)).value == .low,
       "badly on both is low")
expect(HealthStateEngine.energyState(sleep: reading(.belowBaseline),
                                     recovery: recoveryReading(.good)).value == .moderate,
       "one bad input is moderate")
expect(HealthStateEngine.energyState(sleep: reading(.atBaseline),
                                     recovery: recoveryReading(.limited)).value == .moderate,
       "and so is the other")
expect(HealthStateEngine.energyState(sleep: reading(.unknown),
                                     recovery: recoveryReading(.good)).value == .moderate,
       "a half-known picture never reads high")
expect(HealthStateEngine.energyState(sleep: HealthStateEngine.sleepState(last: nil, baseline: nil),
                                     recovery: HealthStateEngine.physicalRecovery(
                                        restingHeartRate: nil, latestRestingHeartRate: nil,
                                        variability: nil, latestVariability: nil)).value == .unknown,
       "and neither known is unknown")
expect(HealthStateEngine.energyState(sleep: reading(.atBaseline),
                                     recovery: recoveryReading(.good, .low)).confidence == .low,
       "energy is as confident as its weakest input")
expect(HealthStateEngine.energyState(
        sleep: HealthStateReading(value: SleepState.atBaseline, reason: "f", baseline: nil,
                                  confidence: .high, freshness: 900)!,
        recovery: recoveryReading(.good)).freshness == 900,
       "and as old as its oldest")

// stressTrend: direction, and each window separately.
let calmer = makeBaseline(.heartRateVariability, value: 70, spread: 5, unit: "ms")
let tenser = makeBaseline(.heartRateVariability, value: 50, spread: 5, unit: "ms")
expect(HealthStateEngine.stressTrend(recent: tenser, earlier: calmer).value == .building,
       "variability falling away from where it was is stress building")
expect(HealthStateEngine.stressTrend(recent: calmer, earlier: tenser).value == .easing,
       "and rising is easing")
expect(HealthStateEngine.stressTrend(recent: calmer, earlier: calmer).value == .steady,
       "unchanged is steady")
expect(HealthStateEngine.stressTrend(recent: calmer, earlier: nil).value == .unknown,
       "one window is a reading, not a direction")
expect(HealthStateEngine.stressTrend(recent: nil, earlier: calmer).value == .unknown,
       "in either order")

// physical_load thresholds, in both directions.
func loadWith(_ ratio: Double) -> TrainingLoad {
    TrainingLoad(acute: ratio * 100, chronic: 100, ratio: ratio,
                 acuteSamples: 7, chronicSamples: 21, confidence: .high, freshness: 0)
}
expect(HealthStateEngine.physicalLoad(loadWith(1.5)).value == .heavy, "half again is heavy")
expect(HealthStateEngine.physicalLoad(loadWith(1.0)).value == .steady, "as usual is steady")
expect(HealthStateEngine.physicalLoad(loadWith(0.5)).value == .light, "half is light")

// dataConfidence reads every input, including load and stress.
let allHigh = HealthStateEngine.assemble(
    sleep: reading(.atBaseline), recovery: recoveryReading(.good),
    load: HealthStateEngine.physicalLoad(loadWith(1.0)),
    energy: HealthStateEngine.energyState(sleep: reading(.atBaseline), recovery: recoveryReading(.good)),
    stress: HealthStateEngine.stressTrend(recent: calmer, earlier: calmer))
expect(allHigh.dataConfidence == .high, "all-solid inputs give a solid picture")
let weakLoad = HealthStateEngine.assemble(
    sleep: reading(.atBaseline), recovery: recoveryReading(.good),
    load: HealthStateEngine.physicalLoad(nil),
    energy: HealthStateEngine.energyState(sleep: reading(.atBaseline), recovery: recoveryReading(.good)),
    stress: HealthStateEngine.stressTrend(recent: calmer, earlier: calmer))
expect(weakLoad.dataConfidence == .low, "an unknown load drags the whole picture down")
let weakStress = HealthStateEngine.assemble(
    sleep: reading(.atBaseline), recovery: recoveryReading(.good),
    load: HealthStateEngine.physicalLoad(loadWith(1.0)),
    energy: HealthStateEngine.energyState(sleep: reading(.atBaseline), recovery: recoveryReading(.good)),
    stress: HealthStateEngine.stressTrend(recent: nil, earlier: nil))
expect(weakStress.dataConfidence == .low, "and so does an unknown trend")

// The word list is pinned, not merely "at least twenty".
expect(ClinicalVocabulary.forbidden.count == 23, "the clinical word list has 23 stems")
expect(Set(ClinicalVocabulary.forbidden).count == 23, "with no duplicates")

// A reading whose freshness is negative is refused, and does not blame the
// vocabulary check for it.
expect(HealthStateReading(value: SleepState.atBaseline, reason: "fine", baseline: nil,
                          confidence: .high, freshness: -1) == nil,
       "a negative freshness is not a reading")
expect(HealthStateEngine.sleepState(
        last: threeShort,
        baseline: Baseline(kind: .sleepDuration, value: 480, spread: 10, sampleCount: 21,
                           confidence: .high, freshness: -5, unit: "min")).reason
        .contains("could not be read"),
       "and the fallback says what actually failed, not what did not")
expect(!HealthStateEngine.sleepState(
        last: threeShort,
        baseline: Baseline(kind: .sleepDuration, value: 480, spread: 10, sampleCount: 21,
                           confidence: .high, freshness: -5, unit: "min")).reason
        .contains("vocabulary"),
       "and specifically does not blame the word list, which is not what failed")

// -- phase 34: health sections ---------------------------------------------

section("health sections (phase 34)")

// The manifest names seven, and it names them in this order. Pinned as an exact
// SET rather than a count -- `allCases.count == 8` passed in this codebase once
// after two members were swapped for two others.
expect(HealthSection.allCases.map(\.rawValue)
        == ["today", "sleep", "recovery", "activity", "energy", "trends", "journal"],
       "the seven manifest sections, in the manifest's order")
expect(Set(HealthSection.allCases.map(\.title))
        == ["Today", "Sleep", "Recovery", "Activity", "Energy", "Trends", "Journal"],
       "every section has its own title")

// The three questions. `happened` is required; the other two are inferences and
// may be absent.
let wholeNarrative = SectionNarrative(
    happened: "You slept 6h20, about an hour under your usual.",
    likelyMeans: "A short night on top of a heavy week tends to show up as lower drive.",
    consider: "Keep the morning light and see how you feel by midday.",
    sources: [.whoop], confidence: .high)
expect(wholeNarrative != nil, "a full narrative is accepted")
expect(wholeNarrative?.likelyMeans != nil && wholeNarrative?.consider != nil,
       "and keeps both inferences")

expect(SectionNarrative(happened: "   ", sources: [.whoop], confidence: .high) == nil,
       "an empty observation is not a narrative")
expect(SectionNarrative(happened: "You slept well.", sources: [], confidence: .high) == nil,
       "a section with no source is making things up")

// The asymmetry that matters: low confidence may OBSERVE and may not INTERPRET.
expect(SectionNarrative(happened: "Two nights recorded so far.",
                        sources: [.whoop], confidence: .low) != nil,
       "low confidence may still report what happened")
expect(SectionNarrative(happened: "Two nights recorded so far.",
                        likelyMeans: "You are trending down.",
                        sources: [.whoop], confidence: .low) == nil,
       "low confidence may NOT say what it means")
expect(SectionNarrative(happened: "Two nights recorded so far.",
                        consider: "Go to bed earlier.",
                        sources: [.whoop], confidence: .low) == nil,
       "low confidence may NOT suggest what to do")
expect(SectionNarrative(happened: "Two nights recorded.", likelyMeans: "Trending down.",
                        sources: [.whoop], confidence: .moderate) != nil,
       "moderate confidence may interpret, so the rule is about confidence and not a blanket ban")

// No medical advice, enforced on the text rather than asserted in a comment.
// Each of these is a different field, because a guard on one field is not a
// guard on the type.
expect(SectionNarrative(happened: "Signs of insomnia.", sources: [.whoop], confidence: .high) == nil,
       "a clinical term in the observation is refused")
expect(SectionNarrative(happened: "You slept badly.", likelyMeans: "This is a symptom of overtraining.",
                        sources: [.whoop], confidence: .high) == nil,
       "a clinical term in the interpretation is refused")
expect(SectionNarrative(happened: "You slept badly.", consider: "Ask about medication.",
                        sources: [.whoop], confidence: .high) == nil,
       "advice about medication is refused")
expect(SectionNarrative(happened: "You slept badly.", consider: "Consider therapy.",
                        sources: [.whoop], confidence: .high) == nil,
       "advice about therapy is refused")

// "Do not overload users with raw charts" -- the budget is on DIGITS, so it
// cannot be reworded around.
expect(SectionNarrative.figureCount(in: "no numbers here") == 0, "prose with no figures counts zero")
expect(SectionNarrative.figureCount(in: "6.5 hours") == 1, "a decimal is one figure, not two")
expect(SectionNarrative.figureCount(in: "6:20 to 7:15") == 2, "clock times are one figure each")
expect(SectionNarrative.figureCount(in: "1 2 3 4") == 4, "four figures are four")
expect(SectionNarrative(happened: "Sleep 6.5, HRV 108, RHR 52, recovery 61.",
                        sources: [.whoop], confidence: .high) == nil,
       "four figures in one line is the table this rule exists to prevent")
expect(SectionNarrative(happened: "You slept 6.5 hours, about an hour under your usual 7.5.",
                        sources: [.whoop], confidence: .high) != nil,
       "and three is still a sentence a person reads")

// Sources are inspectable, and every case says something a person understands.
expect(Set(HealthSource.allCases.map(\.rawValue))
        == ["whoop", "manual", "apple_health", "derived"],
       "the four sources, by name")
expect(HealthSource.allCases.allSatisfy { !$0.label.isEmpty && $0.label != $0.rawValue },
       "each source has a human label rather than its raw value")

// Trends: summarised, capped, and honest about a direction it cannot support.
expect(HealthTrend(kind: .sleepDuration, direction: .improving,
                   points: Array(repeating: 450, count: 14), span: 14, confidence: .high) != nil,
       "a fortnight of points is allowed")
expect(HealthTrend(kind: .sleepDuration, direction: .improving,
                   points: Array(repeating: 450, count: 15), span: 15, confidence: .high) == nil,
       "fifteen is over the cap, and the cap is enforced here rather than by the caller slicing")
expect(HealthTrend(kind: .sleepDuration, direction: .improving,
                   points: [450], span: 0, confidence: .high) == nil,
       "a span of zero days is not a trend")
expect(HealthTrend(kind: .sleepDuration, direction: .improving, points: [.nan],
                   span: 7, confidence: .high) == nil,
       "a non-finite point is refused at the boundary, not turned into Int later")
expect(HealthTrend(kind: .sleepDuration, direction: .improving, points: [450],
                   span: 7, confidence: .low) == nil,
       "low confidence cannot claim a direction")
expect(HealthTrend(kind: .sleepDuration, direction: .unclear, points: [450],
                   span: 7, confidence: .low) != nil,
       "and `unclear` is the one it is allowed to claim")

// -- phase 35: the health journal ------------------------------------------

section("health journal (phase 35)")

var journalCalendar = Calendar(identifier: .gregorian)
journalCalendar.timeZone = TimeZone(identifier: "America/New_York")!

// A fixed "now" so every time assertion is about the rule and not about when
// the suite happened to run: 2026-09-01, 21:00 New York.
let evening = journalCalendar.date(from: DateComponents(
    year: 2026, month: 9, day: 1, hour: 21, minute: 0))!
let earlyMorning = journalCalendar.date(from: DateComponents(
    year: 2026, month: 9, day: 1, hour: 7, minute: 0))!

func read(_ text: String, at when: Date = evening) -> JournalExtraction? {
    JournalExtractor.extract(text, now: when, calendar: journalCalendar, id: "j-1")
}

// ORION's own vocabulary may not contain a diagnosis. Asserted over the LIVE
// enum, so adding a case named `.insomnia` fails rather than ships.
expect(JournalExtractor.vocabularyIsClean(),
       "no JournalEventType case name is a clinical term")
expect(JournalEventType.allCases.map(\.rawValue).contains("unwell"),
       "and 'feeling sick' has somewhere to go that is not named 'illness'")
expect(!JournalEventType.allCases.map(\.rawValue).contains("illness"),
       "specifically NOT 'illness', which the forbidden list would reject")

// The manifest's own four examples.
expect(read("Had caffeine around 5.")?.event.eventType == .caffeine,
       "'Had caffeine around 5.' is a caffeine event")
expect(read("Worked out late.")?.event.eventType == .exercise,
       "'Worked out late.' is exercise")
expect(read("Feeling sick.")?.event.eventType == .unwell,
       "'Feeling sick.' is unwell")
expect(read("Really stressed today.")?.event.eventType == .stress,
       "'Really stressed today.' is stress")

// All five manifest fields are populated, not just the type.
if let caffeine = read("Had caffeine around 5.")?.event {
    expect(caffeine.source == .extracted, "source is recorded")
    expect(caffeine.notes == "Had caffeine around 5.", "notes are Nick's words, verbatim")
    expect(caffeine.confidence == .medium,
           "confidence is the WEAKEST of category and time, never an average")
    let hour = journalCalendar.component(.hour, from: caffeine.time)
    expect(hour == 17, "'around 5' typed at 9pm resolves to 5pm, not 5am")
} else {
    expect(false, "the caffeine example produces an event at all")
}

// The asymmetry that matters: ORION's vocabulary is filtered, Nick's is NOT.
// A journal that argues with its author is not a journal.
if let his = read("My anxiety was bad today and I felt depressed.")?.event {
    expect(his.notes.contains("anxiety") && his.notes.contains("depressed"),
           "the user's own clinical words are stored exactly as written")
    expect(!ClinicalVocabulary.contaminates(his.eventType.rawValue),
           "while the category ORION assigned still is not a diagnosis")
} else {
    expect(false, "an entry using clinical words is still accepted")
}

// The escape hatch. An extractor that must classify everything classifies
// wrongly, so anything unrecognised is a real entry at low confidence.
if let odd = read("The plumber came about the boiler.")?.event {
    expect(odd.eventType == .note, "an unrecognised line is a note, not a forced category")
    expect(odd.confidence == .low, "and says it is unsure")
    expect(odd.notes == "The plumber came about the boiler.", "and keeps the line")
} else {
    expect(false, "an unrecognised line is kept rather than discarded")
}

// Time: explicit, marker-based, and absent.
expect(read("Coffee at 17:30")?.event.confidence == .high,
       "an unambiguous 24-hour reading is high confidence")
if let pm = read("Gym at 6pm")?.event {
    expect(journalCalendar.component(.hour, from: pm.time) == 18, "6pm is 18:00")
    expect(pm.confidence == .high, "an explicit meridiem is unambiguous")
}
if let late = read("Worked out late.")?.event {
    expect(journalCalendar.component(.hour, from: late.time) == 22,
           "'late' with no clock resolves to the evening")
}
if let morning = read("Big breakfast this morning.")?.event {
    // 8, not 20. The marker already fixed the meridiem; re-deriving it from
    // "which is more recent" turned this into 8pm in the first version.
    expect(journalCalendar.component(.hour, from: morning.time) == 8,
           "'this morning' resolves to the MORNING, not to whichever 8 was more recent")
}
expect(journalCalendar.component(
        .hour,
        from: JournalExtractor.mostRecent(hour: 8, minute: 0, before: evening,
                                          calendar: journalCalendar)) == 8,
       "mostRecent leaves a known hour alone by default")
expect(journalCalendar.component(
        .hour,
        from: JournalExtractor.mostRecent(hour: 8, minute: 0, before: evening,
                                          calendar: journalCalendar,
                                          tryBothMeridiems: true)) == 20,
       "and only searches both meridiems when explicitly told to")
if let vague = read("Really stressed today.")?.event {
    expect(abs(vague.time.timeIntervalSince(evening)) < 1,
           "an entry with no time at all is stamped now")
    expect(vague.confidence == .low, "and says the time is a guess")
}

// "Ask for clarification only when necessary."
expect(read("Had caffeine around 5.")?.needsClarification == false,
       "the common case asks nothing")
expect(read("Really stressed today.")?.needsClarification == false,
       "and an entry with no time is not an interrogation either")
expect(read("Coffee at 17:30")?.needsClarification == false,
       "nor is an unambiguous one")
expect(read("Coffee around 5", at: earlyMorning)?.needsClarification == false,
       "a bare hour with no claim about the day asks nothing -- the most-recent rule settles it")

// The ONE case worth a question: the sentence says today and the clock says
// yesterday. Typed at 4am, "around 5 today" resolves to 5pm yesterday.
let smallHours = journalCalendar.date(from: DateComponents(
    year: 2026, month: 9, day: 1, hour: 4, minute: 0))!
if let contradicted = JournalExtractor.extract(
    "Coffee around 5 today", now: smallHours, calendar: journalCalendar, id: "j-2") {
    expect(contradicted.needsClarification,
           "a sentence claiming today whose time reads as yesterday IS worth one question")
    expect(contradicted.event.confidence == .low, "and is stored at low confidence meanwhile")
    expect(contradicted.clarification?.contains("yesterday") == true,
           "and the question names the actual contradiction rather than being generic")
} else {
    expect(false, "the contradicted entry is still stored")
}
// And the same sentence at a sane hour asks nothing, so the rule is about the
// contradiction and not about the word "today".
expect(read("Coffee around 5 today", at: evening)?.needsClarification == false,
       "'today' alone does not trigger a question")

// The trap: a bare number that is not a time.
//
// Asserted as "the entry has NO explicit time" rather than as "the hour is not
// 2" -- the weaker form passed a mutation that removed the time-word guard,
// because the both-meridiems rule turned the spurious 2 into 2pm and 14 != 2.
// A near-miss assertion is worse than none: it reports a guard as tested.
if let two = read("Had 2 coffees.")?.event {
    expect(abs(two.time.timeIntervalSince(evening)) < 1,
           "'2 coffees' has no time in it, so the entry is stamped now")
    expect(two.confidence == .low,
           "and says the time is a guess -- a bare digit needs a time word before it")
    expect(two.eventType == .caffeine, "while still being recognised as caffeine")
}
expect(JournalExtractor.explicitHour("had 2 coffees.") == nil,
       "and the hour parser itself finds nothing, which is the actual guard")
expect(JournalExtractor.explicitHour("coffee around 2") != nil,
       "while a time word in front of the same digit does make it an hour")

// Corrections.
if let original = read("Worked out late.")?.event,
   let corrected = original.correcting(eventType: .travel) {
    expect(corrected.eventType == .travel, "a correction changes the type")
    expect(corrected.source == .correction, "and records that a person said so")
    expect(corrected.confidence == .high, "a correction is always high confidence")
    expect(corrected.id == original.id, "and is the same event, not a second one")
    expect(corrected.originalText == "Worked out late.",
           "the original text survives, so Phase 36 can tell a confirmed observation from a guess")
} else {
    expect(false, "an extracted event can be corrected")
}

// The assertion above is a NEAR MISS on its own: the fixture only changes the
// type, so discarding originalText entirely still passes it. A correction that
// edits the notes is the case that distinguishes them, and it is the case that
// matters -- it is the one where provenance is actually destroyed.
if let original = read("Worked out late.")?.event,
   let rewritten = original.correcting(eventType: .travel, notes: "Flew to London.") {
    expect(rewritten.notes == "Flew to London.", "a correction can rewrite the notes")
    expect(rewritten.originalText == "Worked out late.",
           "and the ORIGINAL text still survives that -- otherwise a corrected entry is indistinguishable from one that was always right")
} else {
    expect(false, "an extracted event can be corrected with new notes")
}

// Refusals at the boundary.
expect(read("   ") == nil, "an empty entry is not an event")
expect(JournalEvent(id: "", eventType: .note, time: evening, source: .extracted,
                    confidence: .low, notes: "x") == nil,
       "an event with no id is refused")
expect(JournalEvent(id: "j", eventType: .note, time: evening, source: .extracted,
                    confidence: .low, notes: "   ") == nil,
       "an event with no notes is refused")

// -- phase 36: behaviour correlations --------------------------------------

section("behaviour correlations (phase 36)")

/// Build a run of days. `withCaffeine` days get the behaviour and `hit`; the
/// rest get `miss`. Real fixtures rather than hand-written Associations --
/// Phase 32 shipped 23 unenforced guards by testing stand-ins.
func makeDays(withCount: Int, withoutCount: Int, hit: Double, miss: Double,
              jitter: Double = 0, behaviour: JournalEventType = .caffeine)
-> [CorrelationDay] {
    var days: [CorrelationDay] = []
    for i in 0..<withCount {
        days.append(CorrelationDay(dayKey: "w\(i)", behaviours: [behaviour],
                                   recovery: hit + (i % 2 == 0 ? jitter : -jitter)))
    }
    for i in 0..<withoutCount {
        days.append(CorrelationDay(dayKey: "o\(i)", behaviours: [],
                                   recovery: miss + (i % 2 == 0 ? jitter : -jitter)))
    }
    return days
}

// The permitted vocabulary is exactly the manifest's, and nothing else exists.
expect(Set(AssociationPhrase.allCases.map(\.rawValue))
        == ["associated with", "correlated with", "tends to coincide with", "insufficient data"],
       "the four manifest phrasings, and no fifth")
expect(AssociationPhrase.allCases.allSatisfy { !CausalVocabulary.contaminates($0.rawValue) },
       "none of the permitted phrasings is itself causal")
expect(CausalVocabulary.contaminates("caffeine causes poor sleep"), "'causes' is caught")
expect(CausalVocabulary.contaminates("your recovery improved because of the gym"),
       "'because of' and 'improved' are caught")
expect(!CausalVocabulary.contaminates("caffeine is associated with lower recovery"),
       "and the approved phrasing passes")

// Below the floor there is no finding at all -- and no computed effect.
let thin = makeDays(withCount: 3, withoutCount: 20, hit: 40, miss: 70)
if let a = CorrelationEngine.association(days: thin, behaviour: .caffeine, outcome: .recovery) {
    expect(a.phrase == .insufficientData, "three days with is insufficient")
    expect(a.difference == nil,
           "and the effect is NOT computed -- a number in a field gets quoted")
    expect(a.withCount == 3 && a.withoutCount == 20, "while the sample sizes are still reported")
} else { expect(false, "an under-powered behaviour still produces a row") }

// The floor applies to the SMALLER side, not the total.
//
// `jitter: 3` is load-bearing and was missing. With no jitter all 40 values on
// one side are identical, the pooled spread is 0, and the `guard spread > 0`
// returns insufficientData BEFORE the per-group floor is ever consulted -- so
// the assertion passed without testing the rule it names. Found by an
// independent review on 2026-09-02: applying the floor to the LARGER group
// instead, the exact mutation this is supposed to catch, did not fail it.
let lopsided = makeDays(withCount: 40, withoutCount: 2, hit: 40, miss: 70, jitter: 3)
expect(CorrelationEngine.association(days: lopsided, behaviour: .caffeine,
                                     outcome: .recovery)?.phrase == .insufficientData,
       "forty days with and two without is still insufficient -- the floor is per group")

// A real, large difference over enough days.
let strong = makeDays(withCount: 14, withoutCount: 14, hit: 45, miss: 75, jitter: 3)
if let a = CorrelationEngine.association(days: strong, behaviour: .caffeine, outcome: .recovery) {
    expect(a.phrase == .correlatedWith, "a large difference over 14+ each is 'correlated with'")
    expect(a.confidence == .high, "and high confidence")
    expect((a.difference ?? 0) < 0, "the direction is negative -- lower recovery on caffeine days")
    expect(a.withCount == 14 && a.withoutCount == 14, "sample sizes reported")
    expect(a.sentence?.contains("14 days with") == true, "and the sentence names them")
    expect(a.sentence?.contains("not an explanation") == true,
           "and says out loud that it is an observation")
} else { expect(false, "a strong association is found") }

// Same difference, fewer days: the claim is weaker, not absent.
let fewer = makeDays(withCount: 6, withoutCount: 6, hit: 45, miss: 75, jitter: 3)
expect(CorrelationEngine.association(days: fewer, behaviour: .caffeine,
                                     outcome: .recovery)?.phrase == .associatedWith,
       "the same difference over six days each is the weaker 'associated with'")
expect(CorrelationEngine.association(days: fewer, behaviour: .caffeine,
                                     outcome: .recovery)?.confidence == .moderate,
       "at moderate confidence")

// A difference smaller than the day-to-day spread is noise, not a weak finding.
let noise = makeDays(withCount: 14, withoutCount: 14, hit: 61, miss: 60, jitter: 12)
if let a = CorrelationEngine.association(days: noise, behaviour: .caffeine, outcome: .recovery) {
    expect(a.phrase == .insufficientData,
           "a one-point difference against a twelve-point spread is not an association")
    expect(a.difference == nil, "and no effect size is offered for it")
}

// NOT asserted here, and deliberately so: that pooling both groups is the right
// reference spread. It is a judgement, not a proven property. Measured
// 2026-09-01 while trying to pin it — MAD is resistant by construction, so
// pooling a tight 14-day group with a wide one gives a spread of 0.5 to 1.5
// rather than the wider figure the code comment originally claimed, and no
// fixture separated "pooled" from "within-group" at these thresholds. The
// engine's choice stands; the claim that a test proves it does not. Recorded in
// the phase-36 gate limitations.

// Nothing this file emits may be causal, over the REAL sentences.
for days in [strong, fewer, thin, noise] {
    for association in CorrelationEngine.associations(days: days, outcome: .recovery) {
        expect(!CausalVocabulary.contaminates(association.sentence ?? ""),
               "no causal language in a generated sentence")
        expect(association.sentence != nil, "and every association can say something")
    }
}

// The type refuses an inconsistent finding in BOTH directions.
expect(Association(behaviour: .caffeine, outcome: .recovery, phrase: .insufficientData,
                   withCount: 9, withoutCount: 9, difference: -20, spread: 4,
                   confidence: .high) == nil,
       "'insufficient data' carrying an effect size is refused")
expect(Association(behaviour: .caffeine, outcome: .recovery, phrase: .correlatedWith,
                   withCount: 9, withoutCount: 9, difference: nil, spread: 4,
                   confidence: .high) == nil,
       "and a finding with no effect size is refused")
expect(Association(behaviour: .caffeine, outcome: .recovery, phrase: .correlatedWith,
                   withCount: 9, withoutCount: 9, difference: .nan, spread: 4,
                   confidence: .high) == nil,
       "a non-finite difference is refused at the boundary")

// `.note` is the escape hatch, not a behaviour worth correlating.
let withNotes = makeDays(withCount: 14, withoutCount: 14, hit: 45, miss: 75, behaviour: .note)
expect(CorrelationEngine.associations(days: withNotes, outcome: .recovery).isEmpty,
       "'things Orion could not classify' is not correlated against sleep")

// Every behaviour that occurred gets a row, including the under-powered ones --
// otherwise the screen implies the ones it can discuss are the only ones.
var mixedBehaviours = makeDays(withCount: 14, withoutCount: 14, hit: 45, miss: 75, jitter: 3)
mixedBehaviours.append(CorrelationDay(dayKey: "x1", behaviours: [.alcohol], recovery: 50))
expect(CorrelationEngine.associations(days: mixedBehaviours, outcome: .recovery)
        .contains { $0.behaviour == .alcohol && $0.phrase == .insufficientData },
       "a behaviour seen once still appears, marked insufficient")

// Days with no reading for that outcome are excluded rather than counted as zero.
let missing = [CorrelationDay(dayKey: "m1", behaviours: [.caffeine], recovery: nil)]
expect(CorrelationEngine.associations(days: missing, outcome: .recovery).isEmpty,
       "a day with no recovery reading contributes nothing -- missing is not zero")

// Arithmetic that must not lie.
expect(CorrelationEngine.median([1, 2, 3]) == 2, "odd-length median")
expect(CorrelationEngine.median([1, 2, 3, 4]) == 2.5, "even-length median")
expect(CorrelationEngine.deviation([5, 5, 5, 5]) == 0, "no variation is zero spread")
expect(CorrelationEngine.deviation([1]) == 0, "one value has no spread")
expect(CorrelationEngine.mean([]) == 0, "an empty mean does not divide by zero")

// -- phase 37: experiment mode ---------------------------------------------

section("experiment mode (phase 37)")

// A fortnight of caffeine days followed by a fortnight without, with recovery
// clearly lower on the caffeine days. Real days through the real engine.
func experimentDays(confounderOn: Int = 0) -> [CorrelationDay] {
    var days: [CorrelationDay] = []
    for i in 0..<14 {
        // 2026-09-01 .. 2026-09-14, the experiment window.
        let key = String(format: "2026-09-%02d", i + 1)
        var behaviours: Set<JournalEventType> = [.caffeine]
        if i < confounderOn { behaviours.insert(.travel) }
        days.append(CorrelationDay(dayKey: key, behaviours: behaviours,
                                   recovery: i % 2 == 0 ? 44 : 48))
    }
    for i in 0..<14 {
        // 2026-08-18 .. 2026-08-31, before it started.
        let key = String(format: "2026-08-%02d", i + 18)
        days.append(CorrelationDay(dayKey: key, behaviours: [], recovery: i % 2 == 0 ? 74 : 78))
    }
    return days
}

let trial = Experiment(id: "e1", behaviour: .caffeine, metric: .recovery,
                       durationDays: 14, startedOn: "2026-09-01",
                       confounders: [.travel, .alcohol])
expect(trial != nil, "an experiment with all five definable things is accepted")

// The five things the manifest says must be definable.
if let trial {
    expect(trial.behaviour == .caffeine, "behaviour")
    expect(trial.metric == .recovery, "metric")
    expect(trial.durationDays == 14, "duration")
    expect(trial.confounders == [.travel, .alcohol], "potential confounders")
    expect(ExperimentEngine.captureBaseline(days: experimentDays(), metric: .recovery,
                                            before: "2026-09-01") != nil, "baseline")
}

// Refusals at the boundary.
expect(Experiment(id: "e", behaviour: .caffeine, metric: .recovery, durationDays: 3,
                  startedOn: "2026-09-01") == nil,
       "three days is refused -- shorter than Phase 36 can ever speak about, so it could "
       + "only ever return 'insufficient data' and would look broken rather than careful")
expect(Experiment(id: "e", behaviour: .caffeine, metric: .recovery, durationDays: 14,
                  startedOn: "01/09/2026") == nil, "a non key-shaped start date is refused")
expect(Experiment(id: "e", behaviour: .caffeine, metric: .recovery, durationDays: 14,
                  startedOn: "2026-09-01", confounders: [.caffeine]) == nil,
       "a confounder that IS the behaviour would contaminate every window")
expect(Experiment(id: "e", behaviour: .note, metric: .recovery, durationDays: 14,
                  startedOn: "2026-09-01") == nil,
       "'things Orion could not classify' is not a testable behaviour")
expect(ExperimentBaseline(mean: .nan, spread: 1, dayCount: 3) == nil,
       "a non-finite baseline is refused at the boundary")
expect(ExperimentBaseline(mean: 60, spread: -1, dayCount: 3) == nil, "a negative spread is refused")

// The window is computed with a real calendar, not string arithmetic -- which
// is what breaks at a month boundary.
if let trial {
    expect(ExperimentEngine.endKey(trial) == "2026-09-15",
           "fourteen days from 01 September ends on the 15th, exclusive")
}
if let crossing = Experiment(id: "e2", behaviour: .caffeine, metric: .recovery,
                             durationDays: 20, startedOn: "2026-08-25") {
    expect(ExperimentEngine.endKey(crossing) == "2026-09-14",
           "and twenty days from 25 August crosses the month correctly")
}

// Stages.
if let trial {
    expect(ExperimentEngine.track(trial, days: experimentDays(), today: "2026-08-30").stage
            == .notStarted, "before the start date it has not started")
    expect(ExperimentEngine.track(trial, days: experimentDays(), today: "2026-09-07").stage
            == .running, "inside the window it is running")
    expect(ExperimentEngine.track(trial, days: experimentDays(), today: "2026-09-20").stage
            == .complete, "after the window it is complete")

    // No partial verdicts. This is the single most misread thing an experiment
    // can produce.
    let midway = ExperimentEngine.track(trial, days: experimentDays(), today: "2026-09-07")
    expect(midway.association == nil, "a running experiment offers NO finding")
    expect(midway.summary.contains("No reading until it finishes"), "and says why")
    expect(midway.summary.contains("of 14 days"), "while still reporting progress")
}

// A clean, finished experiment reports in Phase 36's vocabulary and nothing
// stronger.
if let trial {
    let done = ExperimentEngine.track(trial, days: experimentDays(), today: "2026-09-20")
    expect(done.association != nil, "a finished, clean experiment produces a finding")
    expect(done.inconclusive == false, "and is not inconclusive")
    expect(!CausalVocabulary.contaminates(done.summary),
           "and its summary contains no causal language")
    expect(!ClinicalVocabulary.contaminates(done.summary),
           "and no clinical language -- it is not a trial and does not read like one")
    // The prohibition, structurally: there is no verdict field to find.
    expect(!done.summary.lowercased().contains("worked"),
           "no verdict -- an experiment never says whether it 'worked'")
    expect(done.association.map { AssociationPhrase.allCases.contains($0.phrase) } == true,
           "the finding can only be phrased the four permitted ways")
}

// Confounders: counted, named, and able to stop a finding.
if let trial {
    let dirty = ExperimentEngine.track(trial, days: experimentDays(confounderOn: 10),
                                       today: "2026-09-20")
    expect(dirty.confoundedDays == 10, "confounded days are counted")
    expect(dirty.confoundersSeen.contains(.travel), "and the confounder is named")
    expect(dirty.inconclusive, "ten of fourteen days contaminated is inconclusive")
    expect(dirty.association == nil,
           "and NO finding is offered -- a contaminated result is worse than none, "
           + "because it will be acted on")
    expect(dirty.summary.contains("travel"), "the summary names what got in the way")

    // Below the threshold it still reports.
    let slightly = ExperimentEngine.track(trial, days: experimentDays(confounderOn: 2),
                                          today: "2026-09-20")
    expect(slightly.confoundedDays == 2, "two contaminated days are counted")
    expect(!slightly.inconclusive, "but two of fourteen is under the third and still reportable")
    expect(slightly.association != nil, "so a finding is offered")
}

// The baseline is captured from days BEFORE the start, never from the window.
let baseline = ExperimentEngine.captureBaseline(days: experimentDays(), metric: .recovery,
                                                before: "2026-09-01")
expect(baseline?.dayCount == 14, "the baseline uses the fourteen days before the start")
expect((baseline?.mean ?? 0) > 70,
       "and reads the BEFORE values -- a baseline drawn from the window would grade the "
       + "experiment against its own result")
expect(ExperimentEngine.captureBaseline(days: experimentDays(), metric: .recovery,
                                        before: "2026-01-01") == nil,
       "with nothing before the start there is no baseline rather than a fabricated one")

// -- phase 38: health-aware planning ---------------------------------------

section("health-aware planning (phase 38)")

let lecture = Commitment(id: "c1", title: "Lecture", kind: .required,
                         startMinute: 9 * 60, durationMinutes: 60)!
let deepWork = Commitment(id: "c2", title: "the deep work block", kind: .flexible,
                          startMinute: 10 * 60, durationMinutes: 120, demanding: true)!
let admin = Commitment(id: "c3", title: "email", kind: .flexible,
                       startMinute: 13 * 60, durationMinutes: 30, demanding: false)!

// The prohibition, structurally: there IS no cancel or skip to reach for.
expect(Set(PlanningAction.allCases.map(\.rawValue)) == ["move_later", "shorten", "protect_rest"],
       "the three permitted actions -- and no cancel, no skip")
expect(!PlanningAction.allCases.map(\.rawValue).contains("cancel"),
       "'never cancel required commitments' is an absent enum member, not an if-statement")

// A recommendation about a REQUIRED commitment cannot be constructed at all.
expect(Recommendation(id: "r", action: .moveLater, commitment: lecture,
                      because: "You slept below your baseline.") == nil,
       "no recommendation can be built against a required commitment -- so 'never skip class' "
       + "is enforced by the type rather than by whoever wrote the caller")
expect(Recommendation(id: "r", action: .moveLater, commitment: deepWork,
                      because: "You slept below your baseline.") != nil,
       "while a flexible one is fine")

// No medical decisions, and no causal claims, in the reason.
expect(Recommendation(id: "r", action: .moveLater, commitment: deepWork,
                      because: "Your insomnia is worse today.") == nil,
       "a clinical reason is refused")
expect(Recommendation(id: "r", action: .moveLater, commitment: deepWork,
                      because: "Poor sleep causes low output.") == nil,
       "a causal reason is refused")
expect(Recommendation(id: "r", action: .moveLater, commitment: deepWork,
                      because: "   ") == nil, "and an empty reason is refused")

// It is a proposal. The manifest's own example sentence.
if let r = Recommendation(id: "r", action: .moveLater, commitment: deepWork,
                          because: "You slept below your baseline.") {
    expect(r.question == "You slept below your baseline. Would you like me to move the deep work block?",
           "the question reads like the manifest's example")
    expect(r.outcome == .open, "and starts unanswered")
}

// "Always permit user override" -- declined is a real state, not an absence.
if let r = Recommendation(id: "r", action: .moveLater, commitment: deepWork,
                          because: "You slept below your baseline."),
   let no = r.answered(.declined) {
    expect(no.outcome == .declined, "a recommendation can be declined")
    expect(no.outcome != .open,
           "and declined is NOT the same as unanswered -- otherwise it comes back tomorrow "
           + "as though it had never been offered")
}
expect(Set(RecommendationOutcome.allCases.map(\.rawValue)) == ["open", "accepted", "declined"],
       "three outcomes, with declined among them")

// The advisor takes STATES, never numbers -- Phase 33's boundary, consumed.
let strainedDay = PlanningAdvisor.recommendations(
    sleep: .wellBelowBaseline, recovery: .limited, energy: .low,
    confidence: .high, commitments: [lecture, deepWork, admin])
expect(!strainedDay.isEmpty, "a hard day produces a recommendation")
expect(strainedDay.allSatisfy { $0.commitment.kind == .flexible },
       "and never about a required commitment")
expect(strainedDay.contains { $0.commitment.id == "c2" }, "it targets the demanding block")
expect(!strainedDay.contains { $0.commitment.id == "c3" },
       "and leaves the undemanding one alone rather than rearranging the whole day")
expect(strainedDay.allSatisfy { !ClinicalVocabulary.contaminates($0.question) },
       "no clinical language in any generated question")
expect(strainedDay.allSatisfy { !CausalVocabulary.contaminates($0.question) },
       "and no causal language either")

// A good day says nothing. A planner that always has an opinion gets ignored on
// the day it matters.
expect(PlanningAdvisor.recommendations(
        sleep: .aboveBaseline, recovery: .good, energy: .high,
        confidence: .high, commitments: [lecture, deepWork, admin]).isEmpty,
       "a good day produces no recommendations at all")

// No advice from a guess.
expect(PlanningAdvisor.recommendations(
        sleep: .wellBelowBaseline, recovery: .limited, energy: .low,
        confidence: .low, commitments: [lecture, deepWork, admin]).isEmpty,
       "low confidence produces no advice, matching Phase 34's rule")

// A day of nothing but lectures produces nothing to propose, rather than
// proposing something about a lecture.
expect(PlanningAdvisor.recommendations(
        sleep: .wellBelowBaseline, recovery: .limited, energy: .low,
        confidence: .high, commitments: [lecture]).isEmpty,
       "with only required commitments there is nothing ORION may touch")

// At most two, so a bad day does not arrive as a list.
let manyBlocks = (0..<6).compactMap {
    Commitment(id: "f\($0)", title: "block \($0)", kind: .flexible,
               startMinute: 8 * 60 + $0 * 30, durationMinutes: 30, demanding: true)
}
expect(PlanningAdvisor.recommendations(
        sleep: .wellBelowBaseline, recovery: .limited, energy: .low,
        confidence: .high, commitments: manyBlocks).count <= 2,
       "at most two suggestions -- the day it matters most is the day he has least patience")

// Commitment refuses nonsense at the boundary.
expect(Commitment(id: "x", title: "t", kind: .flexible, startMinute: 1500,
                  durationMinutes: 30) == nil, "a start beyond the day is refused")
expect(Commitment(id: "x", title: "t", kind: .flexible, startMinute: 60,
                  durationMinutes: 0) == nil, "a zero-length commitment is refused")
expect(Commitment(id: "", title: "t", kind: .flexible, startMinute: 60,
                  durationMinutes: 30) == nil, "an unnamed commitment is refused")

// -- phase 39: daily planning ----------------------------------------------

section("daily planning (phase 39)")

let morningLecture = Commitment(id: "L1", title: "Lecture", kind: .required,
                                startMinute: 9 * 60, durationMinutes: 120)!
let seminar = Commitment(id: "L2", title: "Seminar", kind: .required,
                         startMinute: 14 * 60, durationMinutes: 60)!
func task(_ id: String, _ minutes: Int, priority: Int = 5,
          actual: Int? = nil, done: Bool = false) -> PlannedTask {
    PlannedTask(id: id, title: "task \(id)", estimateMinutes: minutes,
                priority: priority, actualMinutes: actual, completed: done)!
}

// The six things a morning plan must show.
let plan = DayPlan.propose(
    commitments: [morningLecture, seminar],
    tasks: [task("a", 60, priority: 1), task("b", 90, priority: 2)],
    sleep: .belowBaseline, recovery: .moderate, energy: .moderate)
expect(plan.commitments.count == 2, "fixed commitments")
expect(plan.flexibleMinutes == (22 - 8) * 60 - 180, "flexible time is waking hours minus commitments")
expect(plan.scheduled.map(\.id) == ["a", "b"], "priority tasks, in priority order")
expect(plan.workloadMinutes == 150, "estimated workload")
expect(plan.sleep == .belowBaseline && plan.recovery == .moderate,
       "relevant health state, as CATEGORIES -- there is no percentage anywhere in this type")
expect(plan.conflicts.isEmpty, "and no conflicts on a day that fits")

// "Must not become silent over-scheduling" -- the charter's own words.
let crammed = DayPlan.propose(
    commitments: [morningLecture, seminar],
    tasks: (1...20).map { task("t\($0)", 120, priority: $0) })
expect(!crammed.deferred.isEmpty, "work that does not fit is deferred")
expect(crammed.workloadMinutes <= crammed.flexibleMinutes,
       "and what IS scheduled fits in the time available -- no silent over-scheduling")
expect(crammed.conflicts.contains { $0.kind == .overCommitted },
       "and the day says out loud that it did not all fit")
expect(crammed.scheduled.count + crammed.deferred.count == 20,
       "nothing is dropped -- every task is either scheduled or named as deferred")

// Overlapping required commitments are REPORTED, never resolved.
let clash = Commitment(id: "L3", title: "Lab", kind: .required,
                       startMinute: 9 * 60 + 30, durationMinutes: 60)!
let clashing = DayPlan.propose(commitments: [morningLecture, clash], tasks: [])
expect(clashing.conflicts.contains { $0.kind == .overlap }, "an overlap is reported")
expect(clashing.conflicts.first { $0.kind == .overlap }?.detail.contains("Lecture") == true,
       "and names both commitments")
expect(clashing.commitments.count == 2,
       "and neither is removed -- two lectures at once is Nick's to sort out, and ORION "
       + "resolving it would be Phase 38's prohibition by the back door")

// Calibration: the mechanism behind "use results to improve future planning".
let ranLong = (1...6).map { task("h\($0)", 60, actual: 90, done: true) }
let calibration = EstimateCalibration.from(ranLong)
expect(calibration.isCalibrated, "six timed, finished tasks is enough to calibrate")
expect(abs(calibration.factor - 1.5) < 0.001, "consistently 50% over reads as a factor of 1.5")
expect(calibration.adjusted(60) == 90, "so an hour is budgeted as ninety minutes")

// One chaotic day must not permanently inflate every estimate.
expect(EstimateCalibration.from((1...4).map { task("f\($0)", 60, actual: 300, done: true) })
        .factor == 1,
       "four samples is under the floor, so no factor is applied at all")
let planOutlierHistory = (1...5).map { task("o\($0)", 60, actual: $0 == 1 ? 600 : 60, done: true) }
expect(abs(EstimateCalibration.from(planOutlierHistory).factor - 1) < 0.001,
       "and the MEDIAN ignores one ten-times-over outlier that a mean would not")
expect(EstimateCalibration.from((1...6).map { task("x\($0)", 60, actual: 600, done: true) })
        .factor == EstimateCalibration.bounds.upperBound,
       "a consistently catastrophic history is CLAMPED -- a task that ran six times over is a "
       + "story about an interruption, not about estimating")

// Unfinished and untimed work contributes nothing to the factor.
expect(EstimateCalibration.from((1...6).map { task("u\($0)", 60, actual: 240, done: false) })
        .factor == 1, "unfinished tasks do not calibrate anything")
expect(EstimateCalibration.from((1...6).map { task("n\($0)", 60, done: true) }).factor == 1,
       "nor do finished ones with no recorded time")

// A calibrated history actually changes the plan.
let uncalibrated = DayPlan.propose(commitments: [], tasks: [task("p", 60)])
let calibrated = DayPlan.propose(commitments: [], tasks: [task("p", 60)], history: ranLong)
expect(uncalibrated.workloadMinutes == 60, "without history an hour is an hour")
expect(calibrated.workloadMinutes == 90,
       "with history it is budgeted at ninety -- this is 'use results to improve future planning'")

// The evening review: the four things it must show.
let todaysTasks = [task("d1", 60, actual: 75, done: true),
             task("d2", 30, actual: 30, done: true),
             task("d3", 45, priority: 1),
             task("d4", 20, priority: 9)]
let review = EveningReview.of(todaysTasks)
expect(review.completed.count == 2, "completed work")
expect(review.incomplete.count == 2, "incomplete work")
expect(review.estimateAccuracy != nil, "time-estimate accuracy")
expect(abs((review.estimateAccuracy ?? 0) - 1.125) < 0.001,
       "which is the median ratio of actual to estimate")
expect(review.carryForward.map(\.id) == ["d3", "d4"],
       "carry-forward, in PRIORITY order so tomorrow starts with what mattered most")

// "No data" and "spot on" are different answers.
let nothingDone = EveningReview.of([task("z", 60), task("y", 30)])
expect(nothingDone.estimateAccuracy == nil,
       "a day where nothing finished reports NO accuracy rather than a flattering 1.0")
expect(nothingDone.carryForward.count == 2, "and everything carries forward")

// Boundaries.
expect(PlannedTask(id: "x", title: "t", estimateMinutes: 0) == nil, "a zero estimate is refused")
expect(PlannedTask(id: "x", title: "t", estimateMinutes: 60 * 13) == nil,
       "and an estimate longer than any waking day is refused")
expect(PlannedTask(id: "x", title: "t", estimateMinutes: 60, actualMinutes: -5) == nil,
       "a negative actual is refused")
expect(DayPlan.propose(commitments: (0..<8).compactMap {
        Commitment(id: "c\($0)", title: "c", kind: .required,
                   startMinute: 8 * 60 + $0 * 120, durationMinutes: 120)
       }, tasks: [task("k", 30)]).flexibleMinutes == 0,
       "a fully-booked day has zero flexible time, never a negative")

// -- PHASE 42: the Security Center -----------------------------------------

section("security center")

// The eight panels and the seven actions, by CONTENTS. These two lists ARE the
// manifest's requirement, so a count would be worthless: swapping two members
// for two others keeps the count and loses the phase.
expect(Set(SecurityCenterSection.allCases.map(\.rawValue)) == [
    "devices", "sessions", "connections", "connector_scopes",
    "remote_control", "delegated_permissions", "automation_permissions", "security_events",
], "the Security Center shows exactly the eight things the manifest names")

expect(Set(SecurityAction.allCases.map(\.rawValue)) == [
    "revoke_device", "revoke_session", "disconnect_gmail", "disconnect_calendar",
    "disable_remote_control", "revoke_delegation", "inspect_audit_history",
], "and allows exactly the seven it names")

// The prohibition, as an absent enum member. There is no way to SPELL an action
// on this screen that grants authority, so no reviewer has to notice one.
expect(Set(SecurityActionEffect.allCases.map(\.rawValue)) == ["reduces_authority", "reads_only"],
       "an action here either takes authority away or reads -- there is no granting effect")
expect(SecurityAction.allCases.filter { $0.effect == .reducesAuthority }.count == 6
        && SecurityAction.allCases.filter { $0.effect == .readsOnly } == [.inspectAuditHistory],
       "six of the seven remove something and the seventh is the audit view")
expect(SecurityAction.allCases.allSatisfy { $0.needsConfirmation == ($0.effect == .reducesAuthority) }
        && !SecurityAction.inspectAuditHistory.needsConfirmation,
       "everything destructive is confirmed and reading is not -- a confirmation on an audit view teaches people to dismiss confirmations")

// -- PHASE 42: what is offered, and when -----------------------------------

let n42Now = Date(timeIntervalSince1970: 1_772_000_000)
let n42Hour: TimeInterval = 3600

func n42Scope(_ raw: String, _ summary: String, writes: Bool) -> ConnectorScope {
    ConnectorScope(raw: raw, summary: summary, writes: writes)
}

let n42GmailRead = Connection(
    id: "c-gmail", provider: .gmail, account: "nick@example.com", connected: true,
    scopes: [n42Scope("gmail.readonly", "read your mail", writes: false)], lastUsed: n42Now)
let n42GmailSend = Connection(
    id: "c-gmail", provider: .gmail, account: "nick@example.com", connected: true,
    scopes: [n42Scope("gmail.readonly", "read your mail", writes: false),
             n42Scope("gmail.send", "send mail as you", writes: true)], lastUsed: n42Now)
let n42CalOff = Connection(
    id: "c-cal", provider: .calendar, account: "nick@example.com", connected: false,
    scopes: [], lastUsed: nil)

expect(!n42GmailRead.hasWriteAccess && n42GmailSend.hasWriteAccess,
       "a connection that can only read is distinguished from one that can send mail as you")
expect(n42GmailSend.writeScopes.map(\.summary) == ["send mail as you"],
       "and the screen can name the write scope rather than showing an opaque URL")
expect(Connection.Provider.gmail.disconnectAction == .disconnectGmail
        && Connection.Provider.calendar.disconnectAction == .disconnectCalendar,
       "every provider maps to its own disconnect action")

var n42Controls = SecurityControls()
n42Controls.update(devices: DeviceManagement(devices: [
    KnownDevice(id: "d1", name: "iPhone", platform: "iOS", isCurrent: true, lastSeen: n42Now, revoked: false),
]))
n42Controls.update(sessions: [ActiveSession(id: "s1", deviceName: "iPhone", lastUsed: n42Now, isCurrent: true)])

let n42Live = SecurityCenter(
    controls: n42Controls,
    connections: [n42GmailSend, n42CalOff],
    remoteControl: RemoteControlState(mode: .readOnly, channel: "discord", lastCommandAt: n42Now),
    delegations: [Delegation(id: "g1", what: "reply to routine mail", grantedAt: n42Now,
                             expiresAt: n42Now.addingTimeInterval(n42Hour))])

expect(n42Live.offeredActions(at: n42Now) == [
    .revokeDevice, .revokeSession, .disconnectGmail, .disableRemoteControl,
    .revokeDelegation, .inspectAuditHistory,
], "only the actions with something to act on are offered -- Calendar is disconnected, so disconnecting it is not")

expect(SecurityCenter().offeredActions(at: n42Now) == [.inspectAuditHistory],
       "an empty Security Center still offers the audit view -- an empty history is information, and hiding the way to look at it is how somebody concludes nothing happened")

// Locking must never take a revocation away. This is the whole reason the
// effect enum has no granting member: if every action is a removal or a read,
// there is nothing a lock needs to withhold.
var n42LockedControls = n42Controls
n42LockedControls.lockOrion()
var n42Locked = n42Live
n42Locked.controls = n42LockedControls
expect(n42Locked.controls.lock == .orionLocked, "the fixture really is locked")
expect(n42Locked.offeredActions(at: n42Now) == n42Live.offeredActions(at: n42Now),
       "locking ORION removes nothing from this screen -- a lock that stopped you revoking a stolen device would be backwards")

// -- PHASE 42: delegation expiry, at an injected instant --------------------

let n42Expiring = Delegation(id: "g1", what: "x", grantedAt: n42Now,
                             expiresAt: n42Now.addingTimeInterval(n42Hour))
expect(n42Expiring.isActive(at: n42Now), "a delegation is active before it expires")
expect(!n42Expiring.isActive(at: n42Now.addingTimeInterval(n42Hour)),
       "and is NOT active at the exact instant it expires -- the boundary belongs to the expiry")
expect(Delegation(id: "g2", what: "x", grantedAt: n42Now, expiresAt: nil).isActive(at: n42Now),
       "one with no expiry stays active, which is exactly the kind this screen exists to show")
expect(!Delegation(id: "g3", what: "x", grantedAt: n42Now,
                   expiresAt: n42Now.addingTimeInterval(n42Hour), revoked: true).isActive(at: n42Now),
       "a revoked delegation is inactive even before its expiry")

var n42Expired = n42Live
n42Expired.delegations = [n42Expiring]
expect(!n42Expired.offeredActions(at: n42Now.addingTimeInterval(n42Hour)).contains(.revokeDelegation),
       "and once everything has expired there is nothing left to revoke")

// -- PHASE 42: the audit log is append-only --------------------------------

let n42E1 = SecurityEvent(id: "e1", kind: .devicePaired, at: n42Now, detail: "iPhone paired")
let n42E2 = SecurityEvent(id: "e2", kind: .profileChanged, at: n42Now.addingTimeInterval(60),
                          detail: "external_connected")
let n42Log = SecurityEventLog([n42E1]).appending(n42E2)

expect(SecurityEventLog([n42E1]).entries.map(\.id) == ["e1"],
       "appending returns a new log and leaves the original alone")
expect(n42Log.entries.map(\.id) == ["e1", "e2"], "and the new one has both")
expect(n42Log.recent(1).map(\.id) == ["e2"], "recent() is newest first")
expect(n42Log.recent(0).isEmpty,
       "a limit of zero shows nothing rather than everything -- a bug here should fail closed")
expect(n42Log.recent(50).count == 2, "and asking for more than exists is not an error")
expect(Set(SecurityEvent.Kind.allCases.map(\.rawValue)).isSuperset(of: [
    "device_revoked", "session_revoked", "connection_removed", "profile_changed",
    "remote_control_changed", "delegation_revoked",
]), "every action on this screen has an event kind that records it happening")

// -- PHASE 42: automation permissions decode from the live shape ------------

let n42SnapshotJSON = """
{"schemaVersion":1,"profile":"external_connected",
 "execPolicy":{"security":"allowlist","ask":"off","askFallback":"deny"},
 "counts":{"total":158,"AUTO":99,"NOTIFY":14,"APPROVAL":13,"NEVER":32},
 "availability":[
   {"tier":"calendar","flag":"enableCalendarActions","configOn":true,"profileOn":true,"available":true,"unresolved":false},
   {"tier":"file_mutate","flag":"enableFileMutateActions","configOn":true,"profileOn":false,"available":false,"unresolved":false}]}
"""
let n42Snapshot = try! AuthoritySnapshot.decode(Data(n42SnapshotJSON.utf8))
expect(n42Snapshot.profile == .externalConnected, "the live profile decodes")
expect(n42Snapshot.counts.isConsistent,
       "the four gates add up to the total -- a snapshot that does not means an action was counted twice or dropped, and a dropped action is one nobody is being shown")
expect(!AuthorityCounts(total: 158, auto: 99, notify: 14, approval: 13, never: 31).isConsistent,
       "and one that does not add up is caught")
expect(n42Snapshot.availability.allSatisfy(\.agreesWithItsInputs),
       "each tier's availability equals configOn AND profileOn")
expect(n42Snapshot.enabledTiers.map(\.tier) == ["calendar"], "only the available tiers are listed as on")

// A tier really can have no configuration flag. `simulation` emits "flag": null
// in the live snapshot, and a non-optional String here refused the real file on
// the first run of orion_v2_authority_contract_check.sh -- which would have rendered the
// automation panel blank, and a blank permission list reads as "nothing is
// allowed". The most dangerous wrong answer on a security screen.
let n42NullFlag = """
{"schemaVersion":1,"profile":"external_connected",
 "execPolicy":{"security":"allowlist","ask":"off","askFallback":"deny"},
 "counts":{"total":1,"AUTO":1,"NOTIFY":0,"APPROVAL":0,"NEVER":0},
 "availability":[
   {"tier":"simulation","flag":null,"configOn":true,"profileOn":true,"available":true,"unresolved":false}]}
"""
let n42NullDecoded = try? AuthoritySnapshot.decode(Data(n42NullFlag.utf8))
expect(n42NullDecoded?.availability.first?.flag == nil,
       "a tier with no configuration flag decodes rather than refusing the whole snapshot")
expect(n42NullDecoded?.availability.first?.isConfigGated == false
        && n42Snapshot.availability.allSatisfy(\.isConfigGated),
       "and the screen can say which tiers no configuration key can switch off")

expect(Set(PermissionProfile.allCases.map(\.rawValue)) == [
    "restricted_read_only", "approved_root_edit", "broad_local_filesystem",
    "consequential_local", "external_connected",
], "the five profiles are permissions.ts's five (cross-checked against the live plugin by run-authority-contract-test.sh)")
expect(Set(AuthorityLevel.allCases.map(\.rawValue)) == ["AUTO", "NOTIFY", "APPROVAL", "NEVER"],
       "and the four gates are orion_v2_authority_snapshot.py's four")

// A profile this app has never heard of must fail LOUDLY and name the string,
// not decode to a default that silently under-reports what ORION may do.
let n42Unknown = n42SnapshotJSON.replacingOccurrences(of: "external_connected", with: "brand_new_profile")
var n42Refused = false
do { _ = try AuthoritySnapshot.decode(Data(n42Unknown.utf8)) } catch { n42Refused = true }
expect(n42Refused, "an unrecognised permission profile is refused rather than defaulted away")

// -- PHASE 44: the Mac's outbound link -------------------------------------

section("remote link")

let n44Now = Date(timeIntervalSince1970: 1_772_000_000)
let n44Pin = KeyPin(["AA:BB:CC:DD"])

// Outbound-only as a SHAPE. There is no way to spell a listener here, and this
// pins that by reflection so adding `listenPort` fails by name rather than at
// the point somebody opens a socket with it.
let n44Endpoint = LinkEndpoint(channel: "discord", host: "gateway.example", port: 443, pin: n44Pin)!
expect(Set(Mirror(reflecting: n44Endpoint).children.compactMap(\.label)) == ["channel", "host", "port", "pin"],
       "an endpoint names somewhere to DIAL -- no bind address, no listen port, no backlog")
expect(LinkEndpoint(channel: "discord", host: "  ", port: 443, pin: n44Pin) == nil
        && LinkEndpoint(channel: "discord", host: "h", port: 0, pin: n44Pin) == nil
        && LinkEndpoint(channel: "discord", host: "h", port: 70_000, pin: n44Pin) == nil,
       "and an endpoint with no host or an impossible port is refused")

// -- PHASE 44: key validation fails CLOSED ---------------------------------

expect(!KeyPin().isConfigured && !KeyPin().accepts("aabbccdd"),
       "an unconfigured pin set accepts NOTHING -- treating 'no pins' as 'allow anything' turns a missing config value into a silently unauthenticated connection")
expect(n44Pin.accepts("aabbccdd") && n44Pin.accepts("AA:BB:CC:DD") && n44Pin.accepts("aa:bb:cc:dd"),
       "the same key in any spelling is the same key")
expect(!n44Pin.accepts("aabbccde") && !n44Pin.accepts("") && !n44Pin.accepts("not-hex-at-all"),
       "and a different key, an empty one, or a non-fingerprint is rejected")

// -- PHASE 44: presence, and the distinction the file is built around -------

let n44Policy = HeartbeatPolicy.standard
expect(MacLink().presence(at: n44Now, policy: n44Policy) == .unknown,
       "a Mac never heard from is UNKNOWN, not offline")
expect(MacAvailability(link: MacLink(), at: n44Now).headline == "Never connected",
       "and the phone says never connected rather than borrowing offline's headline -- otherwise a phone with no signal confidently reports the Mac is down")

func n44LinkSeen(_ secondsAgo: TimeInterval) -> MacLink {
    MacLink(lastSeen: n44Now.addingTimeInterval(-secondsAgo), connectionID: "c1",
            establishedAt: n44Now.addingTimeInterval(-secondsAgo))
}
expect(n44LinkSeen(10).presence(at: n44Now, policy: n44Policy) == .online, "a recent beat is online")
expect(n44LinkSeen(119).presence(at: n44Now, policy: n44Policy) == .online, "one second before the stale threshold is still online")
expect(n44LinkSeen(120).presence(at: n44Now, policy: n44Policy) == .stale, "and the threshold itself is stale -- the boundary belongs to the worse state")
expect(n44LinkSeen(299).presence(at: n44Now, policy: n44Policy) == .stale, "one second before offline is still stale")
expect(n44LinkSeen(300).presence(at: n44Now, policy: n44Policy) == .offline, "and the offline threshold is offline")

// A beat from the FUTURE is a clock disagreement, not good health. Reporting it
// as online would pin the screen to the one state nobody re-checks.
expect(MacLink(lastSeen: n44Now.addingTimeInterval(60), connectionID: "c1").presence(at: n44Now) == .unknown,
       "a heartbeat from the future is unknown, not online -- a wrong clock must not pin the screen to Online forever")

expect(Set(MacPresence.allCases.map(\.rawValue)) == ["online", "stale", "offline", "unknown"],
       "there are exactly four presences")
let n44Headlines = [
    MacAvailability(link: n44LinkSeen(10), at: n44Now).headline,
    MacAvailability(link: n44LinkSeen(150), at: n44Now).headline,
    MacAvailability(link: n44LinkSeen(400), at: n44Now).headline,
    MacAvailability(link: MacLink(), at: n44Now).headline,
]
expect(Set(n44Headlines).count == 4 && n44Headlines == ["Online", "Not responding", "Offline", "Never connected"],
       "the four presences read as four DIFFERENT things, which is what 'clearly display' has to mean")

expect(MacAvailability(link: n44LinkSeen(10), at: n44Now).canSend
        && !MacAvailability(link: n44LinkSeen(150), at: n44Now).canSend
        && !MacAvailability(link: MacLink(), at: n44Now).canSend,
       "only an online Mac may be sent to -- queueing into silence and reporting it as sent is worse than refusing")
expect(MacAvailability(link: n44LinkSeen(400), at: n44Now).suggestsReconnect
        && !MacAvailability(link: MacLink(), at: n44Now).suggestsReconnect,
       "offline suggests a retry and never-connected suggests setup -- different affordances")

// -- PHASE 44: a heartbeat policy that cannot be nonsense -------------------

expect(HeartbeatPolicy(interval: 30, staleAfter: 10, offlineAfter: 300) == nil,
       "a stale threshold below the beat interval is refused -- it would mark a healthy link stale on every beat")
expect(HeartbeatPolicy(interval: 30, staleAfter: 120, offlineAfter: 60) == nil,
       "and an offline threshold below the stale one is refused, because it makes the warning state unreachable")
expect(HeartbeatPolicy(interval: 0, staleAfter: 1, offlineAfter: 2) == nil, "as is a zero interval")

// -- PHASE 44: reconnect backoff, bounded at both ends ----------------------

let n44Backoff = ReconnectPolicy.standard
expect(n44Backoff.delay(afterFailures: 0) == 0, "no failures means no wait")
expect(n44Backoff.delay(afterFailures: 1) == 2 && n44Backoff.delay(afterFailures: 2) == 4
        && n44Backoff.delay(afterFailures: 3) == 8,
       "and the delay doubles: 2, 4, 8")
expect(n44Backoff.delay(afterFailures: 100) == 300,
       "a long outage is CAPPED at 300s -- uncapped, the link that heals itself quietly stops trying")
expect((1...200).allSatisfy { n44Backoff.delay(afterFailures: $0) <= n44Backoff.cap },
       "no attempt count exceeds the cap, including ones large enough to overflow a naive shift")
expect((1...200).allSatisfy { n44Backoff.delay(afterFailures: $0, jitter: 1) > 0 },
       "and full jitter never reduces the delay to zero, which would be a reconnect storm against the one channel Nick would use to find out why")
expect(n44Backoff.delay(afterFailures: 5, jitter: 1) == 16 && n44Backoff.delay(afterFailures: 5, jitter: 0) == 32,
       "jitter only ever REDUCES, at most by half -- adding would let the delay exceed the cap it is meant to guarantee")
expect(n44Backoff.delay(afterFailures: 5, jitter: 9) == n44Backoff.delay(afterFailures: 5, jitter: 1),
       "and a jitter outside 0...1 is clamped rather than trusted")
expect(ReconnectPolicy(base: 0, cap: 10) == nil && ReconnectPolicy(base: 10, cap: 1) == nil,
       "a zero base or a cap below the base is refused")

// -- PHASE 44: rotation -----------------------------------------------------

let n44Rotate = RotationPolicy.standard
expect(n44Rotate.shouldRotate(MacLink(lastSeen: n44Now, connectionID: "c1",
                                      establishedAt: n44Now.addingTimeInterval(-12 * 3600)), at: n44Now),
       "a connection at its maximum age is rotated")
expect(!n44Rotate.shouldRotate(MacLink(lastSeen: n44Now, connectionID: "c1",
                                       establishedAt: n44Now.addingTimeInterval(-3600)), at: n44Now),
       "a young one is not")
expect(!n44Rotate.shouldRotate(MacLink(lastSeen: n44Now), at: n44Now),
       "and a link that is not connected is not 'due for rotation' -- answering true would rotate a connection that does not exist, forever")
expect(RotationPolicy(maxAge: 0) == nil, "a zero rotation age is refused")

// -- PHASE 45: remote Mac, read-only ---------------------------------------

section("remote read-only jobs")

let n45Now = Date(timeIntervalSince1970: 1_772_000_000)
let n45Minute: TimeInterval = 60

// "Do not modify anything", as an absent enum member. A write capability cannot
// be NAMED, so no job can request one and no handler can exist for one.
expect(Set(ReadOnlyCapability.allCases.map(\.rawValue)) ==
        ["device.status.read", "application.list", "files.safe_metadata"],
       "exactly the manifest's three low-risk capabilities, by their own dotted names")
expect(!ReadOnlyCapability.allCases.contains { c in
    ["write", "delete", "move", "send", "modify", "run", "exec"].contains { c.rawValue.contains($0) }
}, "and not one of them can modify anything")
expect(ReadOnlyCapability.allCases.allSatisfy(\.isIdempotent),
       "every capability is a pure read -- which is precisely what makes a lost-answer retry safe, and is why the manifest starts here")
expect(ReadOnlyCapability.filesSafeMetadata.describesReturn.contains("never contents"),
       "and safe metadata says out loud that it is names, sizes and dates, never contents")

func n45Job(_ id: String, device: String = "mac-1", capability: ReadOnlyCapability = .deviceStatusRead,
            ttl: TimeInterval = 5 * 60) -> RemoteJob {
    RemoteJob(id: id, capability: capability, targetDeviceID: device,
              issuedAt: n45Now, expiresAt: n45Now.addingTimeInterval(ttl))!
}
let n45Gate = JobGate(deviceID: "mac-1")!

// -- MALFORMED JOBS: not coped with, made unconstructable ------------------

expect(RemoteJob(id: "", capability: .deviceStatusRead, targetDeviceID: "mac-1",
                 issuedAt: n45Now, expiresAt: n45Now.addingTimeInterval(60)) == nil,
       "a job with no id cannot be built")
expect(RemoteJob(id: "j1", capability: .deviceStatusRead, targetDeviceID: "   ",
                 issuedAt: n45Now, expiresAt: n45Now.addingTimeInterval(60)) == nil,
       "nor one addressed to nobody -- an unaddressed job is refused rather than treated as a broadcast")
expect(RemoteJob(id: "j 1; rm -rf /", capability: .deviceStatusRead, targetDeviceID: "mac-1",
                 issuedAt: n45Now, expiresAt: n45Now.addingTimeInterval(60)) == nil,
       "an id carrying a space or a shell word is refused -- ids are opaque handles, not text")
expect(RemoteJob(id: "j1", capability: .deviceStatusRead, targetDeviceID: "mac-1",
                 issuedAt: n45Now, expiresAt: n45Now) == nil,
       "and one that expires at the instant it was issued is broken, not short-lived -- accepting it would make every freshness check meaningless")
expect(RemoteJob(id: "j1", capability: .deviceStatusRead, targetDeviceID: "mac-1",
                 issuedAt: n45Now, expiresAt: n45Now.addingTimeInterval(-60)) == nil,
       "as is one that expired before it was issued")
expect(JobGate(deviceID: " ") == nil && JobGate(deviceID: "mac-1", memory: 0) == nil,
       "a gate with no device or no replay memory is refused")

// -- WRONG-DEVICE ROUTING, and the memory it must not consume --------------

let n45Foreign = n45Gate.evaluate(n45Job("f1", device: "mac-2"), at: n45Now, issuer: "phone-1")
expect(n45Foreign.verdict == .rejected(.wrongDevice), "a job for another Mac is refused")
expect(n45Foreign.gate.seen.isEmpty,
       "and is NOT recorded as seen -- otherwise anyone could fill this device's replay memory with jobs addressed to somebody else, a denial of service costing them nothing and needing no credential")

// -- EXPIRATION ------------------------------------------------------------

expect(n45Gate.evaluate(n45Job("e1", ttl: 300), at: n45Now.addingTimeInterval(299), issuer: "phone-1")
        .verdict == .accepted, "one second before expiry the job is good")
expect(n45Gate.evaluate(n45Job("e2", ttl: 300), at: n45Now.addingTimeInterval(300), issuer: "phone-1")
        .verdict == .rejected(.expired),
       "and at the expiry instant it is expired -- the boundary belongs to the expiry")
expect(n45Gate.evaluate(n45Job("e3", ttl: 300), at: n45Now.addingTimeInterval(86_400), issuer: "phone-1")
        .verdict == .rejected(.expired),
       "a job from yesterday does not become good again by being unseen. scripts/orion-remote stamps an envelope with a time and never reads it back, which is exactly this rule's absence")

// -- REVOCATION ------------------------------------------------------------

let n45Revoked = n45Gate.revoking("phone-2")
expect(n45Revoked.evaluate(n45Job("r1"), at: n45Now, issuer: "phone-2").verdict == .rejected(.revoked),
       "a revoked issuer's job is refused")
expect(n45Revoked.evaluate(n45Job("r2"), at: n45Now, issuer: "phone-1").verdict == .accepted,
       "and revoking one issuer does not silence the others")
expect(n45Revoked.evaluate(n45Job("r3", ttl: 60), at: n45Now.addingTimeInterval(120), issuer: "phone-2")
        .verdict == .rejected(.revoked),
       "authority is judged BEFORE freshness -- reporting a revoked device's stale job as merely expired would suggest a newer one would work")

// -- REPLAY vs DUPLICATE, which are deliberately different ------------------

let n45First = n45Gate.evaluate(n45Job("d1"), at: n45Now, issuer: "phone-1")
expect(n45First.verdict == .accepted, "a job is accepted once")
expect(n45First.gate.evaluate(n45Job("d1"), at: n45Now, issuer: "phone-1").verdict == .rejected(.replay),
       "and the SAME id a second time is a replay -- a resent id is indistinguishable from an attacker resending a captured one, and the gate must not have to guess")
expect(n45First.gate.evaluate(n45Job("d2"), at: n45Now, issuer: "phone-1").verdict == .accepted,
       "but the same REQUEST under a new id is a duplicate, not a replay, and is accepted -- that is what an honest client does when its answer was lost, and it is safe because the capability is a read")

// A rejected id is still remembered, so it cannot be retried into a different
// answer by waiting for the gate to forget.
let n45AfterExpired = n45Gate.evaluate(n45Job("x1", ttl: 60), at: n45Now.addingTimeInterval(120), issuer: "phone-1")
expect(n45AfterExpired.verdict == .rejected(.expired), "an expired job is rejected")
expect(n45AfterExpired.gate.seen == ["x1"],
       "and is still recorded, so the same id cannot be retried into a different verdict")

// -- NETWORK FAILURE: the same job, judged twice, cannot double-answer ------

// A dropped reply is indistinguishable from a dropped request, so the client
// retries. Judging is pure and total, so replaying the WHOLE stream from any
// point gives the same accepted set -- nothing depends on how far the network
// got before it failed.
let n45Stream = ["n1", "n2", "n3"].map { n45Job($0) }
func n45Run(_ jobs: [RemoteJob]) -> [String] {
    var gate = n45Gate
    var accepted: [String] = []
    for job in jobs {
        let outcome = gate.evaluate(job, at: n45Now, issuer: "phone-1")
        if outcome.verdict.isAccepted { accepted.append(job.id) }
        gate = outcome.gate
    }
    return accepted
}
expect(n45Run(n45Stream) == ["n1", "n2", "n3"], "three distinct jobs are all answered")
expect(n45Run(n45Stream + n45Stream) == ["n1", "n2", "n3"],
       "and the whole stream re-delivered after a network failure answers each exactly once")
expect(n45Run([n45Stream[0], n45Stream[0], n45Stream[1], n45Stream[0]]) == ["n1", "n2"],
       "however many times the retry lands, each id is answered once and only once")

expect(Set(JobRejection.allCases.map(\.rawValue)) == ["wrong_device", "revoked", "expired", "replay"],
       "the four rejections cover the manifest's failure modes, and malformed is absent because a malformed job cannot be constructed at all")

// -- POST-REVIEW CORRECTIONS (2026-09-02, phases 35 and 37) -----------------
//
// An independent reviewer that had not been told the implementers' conclusions
// found both of these. Neither was caught by any existing assertion: the whole
// suite stayed at 665/0 with either bug present, which is why the repairs are
// pinned here rather than trusted.

section("post-review corrections")

// -- D1: an experiment's finding must be about the EXPERIMENT ---------------
//
// ExperimentEngine.track computed `window` and `observed`, used them for
// observedDays / confoundedDays / stage, and then built the association from
// `days` -- the entire history. A 14-day experiment reported "34 with, 14
// without" beside "14 days observed" on the same screen, out-of-window data
// could invert the sign of the finding, and durationDays had no effect on the
// result at all.

func prDay(_ key: String, _ behaviours: Set<JournalEventType>, recovery: Double) -> CorrelationDay {
    CorrelationDay(dayKey: key, behaviours: behaviours, sleepPerformance: nil, recovery: recovery)
}

// The window itself: 7 caffeine days and 7 without, caffeine clearly worse.
var prWindow: [CorrelationDay] = []
for i in 1...7 { prWindow.append(prDay(String(format: "2026-09-%02d", i), [.caffeine], recovery: 40)) }
for i in 8...14 { prWindow.append(prDay(String(format: "2026-09-%02d", i), [], recovery: 80)) }

// History from outside the window that says the OPPOSITE, loudly.
let prOutside = (1...20).map { prDay(String(format: "2025-01-%02d", $0), [.caffeine], recovery: 95) }

let prExperiment = Experiment(id: "pr1", behaviour: .caffeine, metric: .recovery,
                              durationDays: 14, startedOn: "2026-09-01")!
let prClean = ExperimentEngine.track(prExperiment, days: prWindow, today: "2026-09-20")
let prPolluted = ExperimentEngine.track(prExperiment, days: prOutside + prWindow, today: "2026-09-20")

expect(prClean.observedDays == 14 && prPolluted.observedDays == 14,
       "both fixtures observe the same 14 days -- only the out-of-window history differs")
expect(prPolluted.association == prClean.association,
       "twenty days of contradictory history from OUTSIDE the window do not change the experiment's finding")
if let a = prPolluted.association {
    expect(a.withCount + a.withoutCount == prPolluted.observedDays,
           "and the sample counts in the sentence agree with the observed-day count printed beside them")
    expect(a.withCount == 7 && a.withoutCount == 7,
           "seven days with and seven without, which is the experiment and nothing else")
} else {
    expect(false, "a complete, uncontaminated experiment produces a finding")
}

// The bug's signature: duration had no effect, because the association never
// looked at the window. A longer experiment over the same days must differ.
let prLong = Experiment(id: "pr2", behaviour: .caffeine, metric: .recovery,
                        durationDays: 400, startedOn: "2026-09-01")!
expect(ExperimentEngine.track(prLong, days: prOutside + prWindow, today: "2026-09-20").stage == .running,
       "a 400-day experiment on the same day is still running, where the 14-day one has completed")

// -- D5: the clarification rule now matches the rule as written -------------
//
// The gate said "exactly one trigger: the sentence claims today and the
// resolved clock lands on another day". The test for it lived only inside the
// explicit-hour branch, so the marker paths -- which resolve BACKWARDS -- put
// "Worked out late today" on yesterday at 22:00 and asked nothing.

var prCal = Calendar(identifier: .gregorian)
prCal.timeZone = TimeZone(identifier: "Europe/London")!
func prAt(_ hour: Int) -> Date {
    prCal.date(from: DateComponents(year: 2026, month: 6, day: 10, hour: hour, minute: 0))!
}
func prAsk(_ text: String, at hour: Int) -> String? {
    JournalExtractor.extract(text, now: prAt(hour), calendar: prCal, id: "pr5")?.clarification
}

expect(prAsk("Worked out late today.", at: 10) != nil,
       "'late today' at 10am lands on YESTERDAY evening, and the sentence said today -- so it asks")
expect(prAsk("Ran this morning.", at: 6) != nil,
       "and 'this morning' at 6am lands on yesterday morning, which is the same contradiction")
expect(prAsk("Worked out late.", at: 10) == nil,
       "but with no claim about today there is nothing to contradict, so it stays quiet")
expect(prAsk("Worked out late tonight.", at: 23) == nil,
       "and at 11pm 'tonight' resolves to tonight, so there is no contradiction to raise")
expect(prAsk("Really stressed today.", at: 10) == nil,
       "a sentence with no time in it is stamped now and asks nothing -- 'today' alone is not a contradiction")

// -- D6: the finding sentence has to be a sentence --------------------------
//
// The template said "\(behaviour) is \(phrase.rawValue) ...", which is right
// for two participles and wrong for the one VERB phrase -- and that one is the
// else branch, used for every finding below strong magnitude, so it was the
// most common sentence the feature could print:
//   "Caffeine is tends to coincide with lower recovery."
// The existing assertions only checked the sentence was non-nil and non-causal.
// Nothing read it.

let prExpectedOpening: [AssociationPhrase: String] = [
    .associatedWith: "Caffeine is associated with lower recovery",
    .correlatedWith: "Caffeine is correlated with lower recovery",
    .tendsToCoincideWith: "Caffeine tends to coincide with lower recovery",
]
for prPhrase in AssociationPhrase.allCases where prPhrase.isFinding {
    let prAssociation = Association(
        behaviour: .caffeine, outcome: .recovery, phrase: prPhrase,
        withCount: 14, withoutCount: 14, difference: -8, spread: 4, confidence: .high)
    guard let prSentence = prAssociation?.sentence else {
        expect(false, "the \(prPhrase.rawValue) association produces a sentence at all")
        continue
    }
    // The first draft of this guard also checked for a doubled "is is" -- and it
    // fired on all three, because "Th-is is an observation" contains it. A
    // substring check written while fixing a substring bug; kept in the comment
    // because it is the same mistake one layer up, and the exact-prefix
    // assertion below is the one that actually pins the wording.
    expect(!prSentence.contains("is tends"),
           "the \(prPhrase.rawValue) sentence reads as English, not as a phrase wedged after a copula")
    expect(prSentence.hasPrefix(prExpectedOpening[prPhrase] ?? "\u{0}"),
           "and the \(prPhrase.rawValue) sentence opens exactly as written out, copula included where the phrase needs one")
}

// -- D2: vocabulary matches WORDS, not substrings ---------------------------
//
// "ate" is a meal marker and "late" contains it, and the meal row is checked
// before stress, unwell, travel, screen and social -- so "Really stressed and
// worked late" was a MEAL. The file's own header says a silent misreading
// "fabricates a finding", and Phase 36 consumes these categories directly.

let prNow = Date(timeIntervalSince1970: 1_772_000_000)
func prType(_ text: String) -> JournalEventType? {
    JournalExtractor.extract(text, now: prNow, id: "pr")?.event.eventType
}

expect(prType("Really stressed and worked late.") == .stress,
       "'worked late' is stress, not a meal -- 'late' contains 'ate' and the meal row is checked first")
expect(prType("Stayed up late.") == .note,
       "and a line with no category at all stays a note rather than becoming a meal")
expect(prType("I procrastinated.") == .note, "nor does 'procrastinated' contain a meal")
expect(JournalExtractor.containsPhrase("i ate lunch", "ate")
        && !JournalExtractor.containsPhrase("worked late", "ate")
        && !JournalExtractor.containsPhrase("i procrastinated", "ate")
        && !JournalExtractor.containsPhrase("chocolate cake", "late"),
       "containsPhrase requires a word boundary at the start, which is what kills the whole family")

// The opposite failure, and the reason a hard boundary at BOTH ends is wrong:
// requiring one broke "Had 2 coffees", because "coffee" no longer matched.
expect(prType("Had 2 coffees.") == .caffeine, "plurals still match: 'coffees' is 'coffee'")
expect(prType("Lifted this morning.") == .exercise && prType("Went running.") == .exercise,
       "and ordinary inflections still match")

// But an inflection is a short closed list, not 'anything may follow'. These
// are the accidents the vocabulary used to dodge with trailing spaces on
// "ran " and "run ", which this replaces.
expect(!JournalExtractor.containsPhrase("had a ranch salad", "ran"),
       "'ranch' is not 'ran' -- which is why the vocabulary used to carry a trailing space")
expect(!JournalExtractor.containsPhrase("a runny nose", "run"), "and 'runny' is not 'run'")
expect(!JournalExtractor.containsPhrase("the team meeting", "tea"), "'team' is not 'tea'")
expect(!JournalExtractor.containsPhrase("went through it", "rough"), "'through' is not 'rough'")

// -- result ----------------------------------------------------------------

print("\n\(checked) checks, \(failures.count) failed")
for failure in failures {
    print("  FAIL \(failure)")
}
exit(failures.isEmpty ? 0 : 1)
