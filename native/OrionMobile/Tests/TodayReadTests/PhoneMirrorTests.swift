import XCTest
@testable import MobileCore

/// W10-E: phone-only notifications also go into the chat thread, as the Mac's outreach threadRecord does.
final class PhoneMirrorTests: XCTestCase {
    func testTheIdIsStableSafeAndBounded() {
        let id = PhoneMirror.id(forNotification: "orion.night.1793000000")
        XCTAssertEqual(id, "phone.orion.night.1793000000")
        XCTAssertEqual(id, PhoneMirror.id(forNotification: "orion.night.1793000000"))
        let odd = PhoneMirror.id(forNotification: "orion.screen. x/y" + String(repeating: "a", count: 200))
        XCTAssertLessThanOrEqual(odd.count, 80)
        XCTAssertTrue(odd.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "._:-".contains($0)) })
        XCTAssertTrue(PhoneMirror.isMirrorID(id))
        XCTAssertFalse(PhoneMirror.isMirrorID("reach-123"))
    }

    func testOnlyPhoneLocalNotificationsAreMirrored() {
        XCTAssertTrue(PhoneMirror.isPhoneLocal(identifier: "orion.night.snooze-1"))
        XCTAssertTrue(PhoneMirror.isPhoneLocal(identifier: "orion.screen.morning.20261103"))
        XCTAssertFalse(PhoneMirror.isPhoneLocal(identifier: "reach-abc"))
    }

    func testRecordShapeMatchesTheMacsOutreachThreadRecord() {
        let r = PhoneMirror.record(id: "phone.orion.night.1", text: "Bed at 23:30.")
        XCTAssertEqual(r.recordName, "phone.orion.night.1")
        XCTAssertEqual(r.fields[LinkSchema.commandDevice], "orion")
        XCTAssertEqual(r.fields[LinkSchema.commandStatus], LinkCommandStatus.done.rawValue)
        XCTAssertEqual(r.fields[LinkSchema.commandKind], LinkCommandKind.chat.rawValue)
        XCTAssertEqual(r.fields[LinkSchema.commandConversation], LinkSchema.threadID)
        XCTAssertEqual(r.fields[LinkSchema.commandAskID], "phone.orion.night.1")
        XCTAssertEqual(r.fields[LinkSchema.commandReply], "Bed at 23:30.")
        XCTAssertEqual(r.fields[LinkSchema.commandText], "")
    }

    func testMacIngestBuildsAnAlreadySentReachCall() {
        let args = PhoneMirror.reachArguments(id: "phone.orion.night.1", text: " Bed at 23:30. ") ?? []
        XCTAssertEqual(args.first, "Bed at 23:30.")
        XCTAssertEqual(Array(args[1..<5]), ["--already-sent", "phone", "--id", "phone.orion.night.1"])
        XCTAssertNil(PhoneMirror.reachArguments(id: "reach-1", text: "x"))
        XCTAssertNil(PhoneMirror.reachArguments(id: "phone.x", text: "  "))
    }

    func testLedgerDedupesAndCaps() {
        var ledger = PhoneMirror.Ledger()
        let items = ["a", "b", "a", "c"]
        XCTAssertEqual(ledger.fresh(items) { $0 }, ["a", "b", "c"])
        ledger = ledger.adding("a").adding("a")
        XCTAssertEqual(ledger.ids, ["a"])
        XCTAssertEqual(ledger.fresh(items) { $0 }, ["b", "c"])
        for i in 0..<400 { ledger = ledger.adding("id\(i)") }
        XCTAssertEqual(ledger.ids.count, 300)
        XCTAssertTrue(ledger.contains("id399"))
        XCTAssertFalse(ledger.contains("a"))
    }
}
