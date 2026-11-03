import XCTest
@testable import PaletteKit

final class FuzzyTests: XCTestCase {
    private func score(_ q: String, _ t: String, _ k: String = "") -> Double? { Fuzzy.score(query: q, title: t, keywords: k) }

    func testExactBeatsPrefixBeatsSubstring() throws {
        let exact = try XCTUnwrap(score("health", "Health"))
        let prefix = try XCTUnwrap(score("heal", "Health"))
        let inside = try XCTUnwrap(score("alth", "Health"))
        XCTAssertGreaterThan(exact, prefix)
        XCTAssertGreaterThan(prefix, inside)
    }

    func testAcronymFindsGameReady() throws {
        let hit = try XCTUnwrap(score("gr", "Game ready"))
        XCTAssertGreaterThan(hit, 60)
        XCTAssertNil(score("gr", "Mute"))
    }

    func testAcronymOutranksLooseSubsequence() throws {
        XCTAssertGreaterThan(try XCTUnwrap(score("gr", "Game ready")), try XCTUnwrap(score("gr", "Gym and run", "")))
    }

    func testThreeLetterQueriesDoNotMatchLooselyInsideOtherWords() throws {
        XCTAssertNil(score("mus", "Mouse setup"))
        XCTAssertGreaterThan(try XCTUnwrap(score("mus", "Music")), 80)
    }

    func testTyposStillMatch() throws {
        XCTAssertNotNil(score("gmae", "Game ready"))
        XCTAssertNotNil(score("healht", "Health"))
        XCTAssertNotNil(score("safri", "Safari"))
        XCTAssertNotNil(score("closs unused", "Close unused apps"))
    }

    func testTypoScoresBelowACleanMatch() throws {
        XCTAssertGreaterThan(try XCTUnwrap(score("safari", "Safari")), try XCTUnwrap(score("safri", "Safari")))
    }

    func testUnrelatedDoesNotMatch() {
        XCTAssertNil(score("xyz", "Game ready"))
        XCTAssertNil(score("zq", "Health"))
    }

    func testKeywordsMatchButWeighLess() throws {
        let viaKeyword = try XCTUnwrap(score("pomodoro", "Start focus", "pomodoro timer"))
        let viaTitle = try XCTUnwrap(score("focus", "Start focus", "pomodoro timer"))
        XCTAssertGreaterThan(viaTitle, viaKeyword)
    }

    func testEveryTokenMustMatch() {
        XCTAssertNotNil(score("log water", "Log water +1"))
        XCTAssertNil(score("log banana", "Log water +1"))
    }

    func testShortQueriesDoNotGetTypoTolerance() {
        XCTAssertNil(score("hx", "Health"))
    }

    func testEditDistanceCountsATransposeAsOne() {
        XCTAssertEqual(Fuzzy.distance("game", "gmae"), 1)
        XCTAssertEqual(Fuzzy.distance("safari", "safri"), 1)
        XCTAssertEqual(Fuzzy.distance("abc", "abc"), 0)
    }
}
