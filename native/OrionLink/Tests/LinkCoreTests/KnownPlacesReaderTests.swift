import XCTest
import MobileCore
@testable import LinkCore

final class KnownPlacesReaderTests: XCTestCase {
    func testNoFileMeansTheSeededHomeAt150m() {
        let places = KnownPlacesReader.places(fileData: nil)
        XCTAssertEqual(places, [.seededHome])
        XCTAssertEqual(places.first?.radiusM, 150)
    }

    func testAnEmptyOrBrokenFileAlsoFallsBackToHome() {
        XCTAssertEqual(KnownPlacesReader.places(fileData: Data(#"{"places":[]}"#.utf8)), [.seededHome])
        XCTAssertEqual(KnownPlacesReader.places(fileData: Data("nope".utf8)), [.seededHome])
    }

    func testAFileOfPlacesIsPublishedAndBadRowsDropped() {
        let json = #"{"places":[{"id":"gym","name":"Gym","lat":51.5,"lon":-0.1,"radiusM":80,"kind":"gym"},{"id":"bad","lat":999,"lon":0}]}"#
        let places = KnownPlacesReader.places(fileData: Data(json.utf8))
        XCTAssertEqual(places, [.init(id: "gym", name: "Gym", lat: 51.5, lon: -0.1, radiusM: 80, kind: "gym")])
    }

    func testThePublishedPlacesSurviveTheSnapshot() throws {
        let mac = LinkSnapshot.Mac(name: "Mac", runningApps: [], locked: false)
        let snapshot = LinkSnapshot(generatedAt: Date(timeIntervalSince1970: 1_790_000_000), mac: mac,
                                    knownPlaces: KnownPlacesReader.places(fileData: nil))
        XCTAssertEqual(try LinkSnapshot.decode(try LinkSnapshot.encode(snapshot)).knownPlaces, [.seededHome])
    }
}
