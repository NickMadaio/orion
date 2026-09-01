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
expect(NotificationCategory.approvalRequired.mayBreakThrough && !NotificationCategory.completion.mayBreakThrough,
       "only approval and security may interrupt")

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
    failures.append("could not read planning/v2/sync-ordering-vectors.json")
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

// -- result ----------------------------------------------------------------

print("\n\(checked) checks, \(failures.count) failed")
for failure in failures {
    print("  FAIL \(failure)")
}
exit(failures.isEmpty ? 0 : 1)
