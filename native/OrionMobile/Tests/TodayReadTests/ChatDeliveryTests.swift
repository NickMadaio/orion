import XCTest
@testable import MobileCore

/// W18 phone chat: a sent message has a visible life (sending, waiting, thinking, answered) and a way out when it stalls or fails.
final class ChatDeliveryTests: XCTestCase {
    private let sent = Date(timeIntervalSince1970: 1_800_000_000)
    private func state(_ status: LinkCommandStatus, _ upload: ChatUpload = .saved, after seconds: TimeInterval = 5) -> ChatDelivery {
        ChatDelivery.state(status: status, upload: upload, sentAt: sent, now: sent.addingTimeInterval(seconds))
    }

    func testTheLifecycleReadsInOrder() {
        XCTAssertEqual(state(.pending, .uploading, after: 1), .sending)
        XCTAssertEqual(state(.pending, .saved, after: 3), .waiting)
        XCTAssertEqual(state(.running, .saved, after: 20), .thinking)
        XCTAssertEqual(state(.done, .saved, after: 40), .answered)
    }

    func testAFailedUploadIsNotSentAndRetriesWithTheSameId() {
        let s = state(.pending, .failed)
        XCTAssertEqual(s, .notSent)
        XCTAssertTrue(s.canRetry)
        XCTAssertTrue(s.retriesSameID, "the id may already be in iCloud, so a same-id resend is idempotent")
    }

    func testAMacFailureOffersARetryUnderANewId() {
        let s = state(.failed)
        XCTAssertEqual(s, .failed)
        XCTAssertTrue(s.canRetry)
        XCTAssertFalse(s.retriesSameID, "orion-remote refuses a second run of the same id")
    }

    func testAMacThatNeverPicksItUpStalls() {
        XCTAssertEqual(state(.pending, .saved, after: ChatDelivery.waitLimit - 1), .waiting)
        XCTAssertEqual(state(.pending, .saved, after: ChatDelivery.waitLimit + 1), .stalled)
        XCTAssertTrue(ChatDelivery.stalled.canRetry)
        XCTAssertFalse(ChatDelivery.stalled.retriesSameID)
    }

    func testAMacThatDiedMidAnswerStopsShowingTheTypingIndicator() {
        XCTAssertEqual(state(.running, .saved, after: ChatDelivery.thinkLimit - 1), .thinking)
        XCTAssertEqual(state(.running, .saved, after: ChatDelivery.thinkLimit + 1), .stalled)
        XCTAssertFalse(ChatDelivery.stalled.inFlight)
    }

    func testOnlyLiveStatesAreInFlight() {
        XCTAssertTrue(ChatDelivery.sending.inFlight); XCTAssertTrue(ChatDelivery.waiting.inFlight); XCTAssertTrue(ChatDelivery.thinking.inFlight)
        for done in [ChatDelivery.answered, .notSent, .failed, .stalled] { XCTAssertFalse(done.inFlight) }
        XCTAssertFalse(ChatDelivery.answered.canRetry)
    }

    func testTheCaptionsAreTheVisibleState() {
        XCTAssertEqual(ChatDelivery.sending.caption(macOnline: true), "Sending…")
        XCTAssertEqual(ChatDelivery.waiting.caption(macOnline: true), "Delivered")
        XCTAssertEqual(ChatDelivery.waiting.caption(macOnline: false), "Delivered · waiting for your Mac")
        XCTAssertNil(ChatDelivery.answered.caption(macOnline: true))
        XCTAssertEqual(ChatDelivery.notSent.caption(macOnline: true), "Didn’t send — tap to retry")
        XCTAssertEqual(ChatDelivery.failed.caption(macOnline: true), "Didn’t go through — tap to retry")
        XCTAssertEqual(ChatDelivery.stalled.caption(macOnline: true), "No answer yet — tap to retry")
    }
}

/// The text of a ChatExchange: plumbing and 24-hour times never show, even in history written before the fix.
final class ChatSanitizerTests: XCTestCase {
    func testJobOutputIsHidden() {
        XCTAssertNil(ChatSanitizer.display("[daily-memory] 2026-11-03: 4 requests -> memory/2026-11-03.md\n  archived 4 rows"))
    }

    func testAMilestoneShowsItsSentence() {
        let raw = "Orion | MILESTONE REACHED | standing-check\nHeads up 9:00 AM — Seminar. Starts in 1h 57m.\nNo action needed."
        XCTAssertEqual(ChatSanitizer.display(raw), "Heads up 9:00 AM — Seminar. Starts in 1h 57m.")
    }

    func testAHeldDigestShowsItsSentences() {
        let raw = "Orion | HELD UPDATES | 2 update(s)\n- [MILESTONE REACHED] standing-check: Heads up 3:30 PM — Lecture.\n- [MILESTONE REACHED] standing-evening: Evening done."
        XCTAssertEqual(ChatSanitizer.display(raw), "Heads up 3:30 PM — Lecture.\nEvening done.")
    }

    func testTwentyFourHourTimesBecomeTwelveHour() {
        XCTAssertEqual(ChatSanitizer.twelveHour("It's 22:18. Phone down — 8h 10m left."), "It's 10:18 PM. Phone down — 8h 10m left.")
        XCTAssertEqual(ChatSanitizer.twelveHour("Bed at 00:00."), "Bed at 12:00 AM.")
        XCTAssertEqual(ChatSanitizer.twelveHour("CS2100 at 09:00 tomorrow"), "CS2100 at 9:00 AM tomorrow")
        XCTAssertEqual(ChatSanitizer.twelveHour("It's 10:08 PM, up at 5:50 AM; what was 12:30 to 3:30?"), "It's 10:08 PM, up at 5:50 AM; what was 12:30 to 3:30?")
    }

    func testOrdinaryTextIsUntouched() {
        XCTAssertEqual(ChatSanitizer.display("Where are you at? I'll log it."), "Where are you at? I'll log it.")
    }
}

/// Phone-only notifications mirrored into the thread: a pile of superseded nudges is one message, at the time it fired.
final class PhoneMirrorCondenseTests: XCTestCase {
    private func note(_ id: String, _ minute: Int) -> PhoneMirror.Delivered {
        .init(identifier: id, body: "It's \(minute)", date: Date(timeIntervalSince1970: 1_800_000_000 + Double(minute) * 60))
    }

    func testOnlyTheNewestNightNudgeIsMirroredFromAPile() {
        let pile = [note("orion.night.1", 18), note("orion.night.2", 26), note("orion.night.3", 36)]
        let result = PhoneMirror.condense(pile)
        XCTAssertEqual(result.keep.map(\.identifier), ["orion.night.3"])
        XCTAssertEqual(result.superseded.map(\.identifier), ["orion.night.1", "orion.night.2"])
    }

    func testDifferentFamiliesAndLoneItemsAreKept() {
        let mixed = [note("orion.night.1", 18), note("orion.screen.morning", 20), note("orion.screen.note", 21)]
        let result = PhoneMirror.condense(mixed)
        XCTAssertEqual(Set(result.keep.map(\.identifier)), ["orion.night.1", "orion.screen.morning", "orion.screen.note"])
        XCTAssertTrue(result.superseded.isEmpty)
    }

    func testOrderIsOldestFirst() {
        let result = PhoneMirror.condense([note("orion.screen.b", 30), note("orion.screen.a", 10)])
        XCTAssertEqual(result.keep.map(\.identifier), ["orion.screen.a", "orion.screen.b"])
    }

    func testTheMacIsToldWhenTheNotificationFired() {
        let at = Date(timeIntervalSince1970: 1_793_744_280)
        let args = PhoneMirror.reachArguments(id: "phone.orion.night.1", text: "It's 22:18.", at: at) ?? []
        XCTAssertEqual(args.suffix(2), ["--at", ISO8601DateFormatter().string(from: at)])
        XCTAssertFalse((PhoneMirror.reachArguments(id: "phone.x", text: "hi") ?? []).contains("--at"))
    }
}
