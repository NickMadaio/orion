import XCTest
@testable import MobileCore

/// WP5: `LinkLog.place`, the `audio` field on `.signal`, `knownPlaces`, and the thread reply rule.
final class PlaceAudioLogTests: XCTestCase {
    private let at = "2026-10-16T16:03:42Z"

    func testAPlaceEnterRoundTripsAndRoundsItsCoordinates() throws {
        let entry = LinkLog.place(event: "enter", placeId: "home", at: at, latitude: 51.5273608, longitude: -0.0865265)
        let back = try LinkLog.decode(try entry.encoded())
        XCTAssertEqual(back, .place(event: "enter", placeId: "home", at: at, latitude: 51.527, longitude: -0.087))
    }

    func testAPlaceWithoutAFixCarriesNoCoordinates() throws {
        let text = try LinkLog.place(event: "exit", placeId: "gym", at: at).encoded()
        XCTAssertFalse(text.contains("latitude"))
        XCTAssertEqual(try LinkLog.decode(text), .place(event: "exit", placeId: "gym", at: at, latitude: nil, longitude: nil))
    }

    func testBadPlaceEntriesAreRefused() {
        XCTAssertThrowsError(try LinkLog.place(event: "arrive", placeId: "home", at: at).validated())
        XCTAssertThrowsError(try LinkLog.place(event: "enter", placeId: "../home", at: at).validated())
        XCTAssertThrowsError(try LinkLog.place(event: "enter", placeId: "home", at: "yesterday").validated())
        XCTAssertThrowsError(try LinkLog.place(event: "enter", placeId: "home", at: at, latitude: 91, longitude: 0).validated())
    }

    func testSignalAudioIsValidatedAgainstTheFourRoutes() throws {
        for route in ["bluetooth", "wired", "speaker", "unknown"] {
            let entry = LinkLog.signal(at: at, motion: "still", charging: false, latitude: nil, longitude: nil, audio: route)
            XCTAssertEqual(try entry.validated(), entry, route)
        }
        XCTAssertThrowsError(try LinkLog.signal(at: at, motion: "still", charging: false, latitude: nil, longitude: nil, audio: "airplay").validated())
    }

    func testAnOldSignalWithoutAudioStillDecodes() throws {
        let old = #"{"signal":{"at":"\#(at)","charging":true,"motion":"walking","latitude":51.528,"longitude":-0.087}}"#
        XCTAssertEqual(try LinkLog.decode(old), .signal(at: at, motion: "walking", charging: true, latitude: 51.528, longitude: -0.087, audio: nil))
    }

    func testKnownPlacesRoundTripAndOlderSnapshotsDecode() throws {
        let mac = LinkSnapshot.Mac(name: "Mac", runningApps: [], locked: false)
        let home = LinkSnapshot.KnownPlace(id: "home", name: "Scape Shoreditch", lat: 51.5273608, lon: -0.0865265, radiusM: 120, kind: "home")
        let snapshot = LinkSnapshot(generatedAt: Date(timeIntervalSince1970: 1_790_000_000), mac: mac, knownPlaces: [home])
        XCTAssertEqual(try LinkSnapshot.decode(try LinkSnapshot.encode(snapshot)).knownPlaces, [home])
        let bare = try LinkSnapshot.encode(LinkSnapshot(generatedAt: Date(timeIntervalSince1970: 1_790_000_000), mac: mac))
        XCTAssertNil(try LinkSnapshot.decode(bare).knownPlaces)
    }

    // MARK: the reply rule

    private let now = Date(timeIntervalSince1970: 1_790_000_000)
    private func line(_ id: String, _ minutesAgo: Double, orion: Bool) -> OutreachThread.Line {
        .init(id: id, sentAt: now.addingTimeInterval(-minutesAgo * 60), fromORION: orion)
    }

    func testATypedReplyCarriesTheLatestPushedMessageId() {
        let thread = [line("reach-1", 80, orion: true)]
        XCTAssertEqual(OutreachThread.replyTarget(thread: thread, now: now), "reach-1")   // an ask is answered late
    }

    func testTheTappedMessageWinsAndAnsweredOrOldOnesDoNotLink() {
        let thread = [line("reach-1", 30, orion: true), line("reach-2", 5, orion: true)]
        XCTAssertEqual(OutreachThread.replyTarget(thread: thread, tapped: "reach-1", now: now), "reach-1")
        XCTAssertEqual(OutreachThread.replyTarget(thread: thread, now: now), "reach-2")
        XCTAssertNil(OutreachThread.replyTarget(thread: thread + [line("u", 2, orion: false)], now: now), "he already answered")
        XCTAssertNil(OutreachThread.replyTarget(thread: [line("reach-3", 120, orion: true)], now: now), "past 90 minutes")
        XCTAssertNil(OutreachThread.replyTarget(thread: [line("u", 5, orion: false)], now: now))
    }

    // MARK: review 11: a full offline queue drops plain samples, not place events

    func testAFullSignalQueueDropsPlainSamplesBeforePlaceEvents() throws {
        let sample = { (n: Int) in LinkLog.signal(at: self.at, motion: "still", charging: false, latitude: nil, longitude: nil, audio: nil) }
        let place = LinkLog.place(event: "enter", placeId: "home", at: at)
        // oldest first: a place event at the very front, then 5 samples; limit 3
        var items: [LinkLog] = [place] + (0..<5).map(sample)
        items = SignalQueuePolicy.trim(items, limit: 3, isPlace: SignalQueuePolicy.isPlace)
        XCTAssertEqual(items.count, 3)
        XCTAssertTrue(items.contains(place), "the oldest entry was a place event and it survived")
        XCTAssertEqual(items.filter(SignalQueuePolicy.isPlace).count, 1)
        // only place events over the limit: the oldest of them goes
        let places = (0..<4).map { LinkLog.place(event: $0 % 2 == 0 ? "enter" : "exit", placeId: "p\($0)", at: at) }
        XCTAssertEqual(SignalQueuePolicy.trim(places, limit: 2, isPlace: SignalQueuePolicy.isPlace), Array(places.suffix(2)))
        XCTAssertEqual(SignalQueuePolicy.trim([1, 2], limit: 5, isPlace: { _ in false }), [1, 2])
    }
}
