import AppKit
import MobileCore
import SwiftUI
import Vision
import XCTest
@testable import Orion

/// Wave 18 (Health). Wave 17's tests checked HealthTodayLine, a string the page shows only while nothing is hovered,
/// and never looked at what hovering puts on screen. On the installed build, parking the pointer on a ring shows
/// "The available WHOOP recovery reading is 78%." over "Whoop · high history confidence": the number already in the
/// ring, restated as provenance. These tests read the strings the real views put on screen, at rest and on hover.
@MainActor
final class Wave18HealthVisibleTextTests: XCTestCase {
    /// Words that only ever appear in coverage or provenance sentences. Whole words, so "recovery" is not "cover".
    static let banned = ["available", "unavailable", "cover", "covers", "reading", "readings", "source", "sources",
                         "confidence", "provenance", "record", "records", "reports", "reported", "history",
                         "unknown", "establish"]

    static func bannedWords(in text: String) -> [String] {
        let words = Set(text.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init))
        return banned.filter(words.contains)
    }

    /// Nick on 2026-11-03: WHOOP connected, recovery 57, 4.3 h in bed, strain present, a week of history.
    static var nick: HealthReads.Inputs {
        HealthReads.Inputs(recovery: 57, recoveryDelta: -8, sleepHours: 4.3, sleepPerformance: 52, usualSleepHours: 6.9,
                           strain: 6.3, hrvDelta: -7, restingHeartRateDelta: 2, days: 7,
                           bottles: 0, bottleTarget: 9, calories: 0, calorieTarget: 2_200)
    }

    // MARK: - What hover shows

    func testEveryHoverPartSaysSomethingAndNothingAboutProvenance() {
        for section in [HealthSection.recovery, .sleep, .activity, .trends, .energy] {
            guard let part = HealthReads.part(section, Self.nick) else { return XCTFail("\(section) has nothing to show") }
            let text = ([part.line, part.note ?? ""]).joined(separator: " ")
            XCTAssertEqual(Self.bannedWords(in: text), [], "\(section): \(text)")
        }
    }

    func testHoverAddsWhatTheRingDoesNotAlreadySay() {
        // The ring already shows 57. Hover has to say what 57 means and how it compares.
        let recovery = HealthReads.part(.recovery, Self.nick)
        XCTAssertEqual(recovery?.line, "Recovery 57, 8 below your usual.")
        XCTAssertEqual(recovery?.note, "Middle of the road. Steady effort, not a max day.")
        let sleep = HealthReads.part(.sleep, Self.nick)
        XCTAssertEqual(sleep?.line, "4.3 hours in bed, 52% of what you needed.")
        XCTAssertEqual(sleep?.note, "A short night, 2.6 hours under your usual. An early one tonight pays it back.")
        let strain = HealthReads.part(.activity, Self.nick)
        XCTAssertEqual(strain?.line, "Strain 6.3 so far. Today can carry about 10 to 14.")
        XCTAssertEqual(strain?.note, "Room for a proper session.")
    }

    func testMissingPartsSayWhatIsMissingInPlainWords() {
        let empty = HealthReads.Inputs(recovery: nil, recoveryDelta: nil, sleepHours: nil, sleepPerformance: nil,
                                       usualSleepHours: nil, strain: nil, hrvDelta: nil, restingHeartRateDelta: nil,
                                       days: 0, bottles: 0, bottleTarget: 9, calories: 0, calorieTarget: 2_200)
        for section in [HealthSection.recovery, .sleep, .activity] {
            let caption = HealthReads.caption(section, empty)
            XCTAssertEqual(Self.bannedWords(in: caption), [], caption)
            XCTAssertEqual(Self.bannedWords(in: HealthReads.part(section, empty)?.line ?? ""), [])
        }
        XCTAssertNil(HealthReads.part(.trends, empty), "no week, nothing to compare")
    }

    func testRingCaptionsAreAReadNotALabelOfTheData() {
        XCTAssertEqual(HealthReads.caption(.recovery, Self.nick), "steady day")
        XCTAssertEqual(HealthReads.caption(.sleep, Self.nick), "in bed · 52% of need")
        XCTAssertEqual(HealthReads.caption(.activity, Self.nick), "aim for 10–14 today")
    }

    // MARK: - Hover and pin

    func testHoverWinsOverAPinSoTheOtherRingsStillRespond() {
        let controller = HealthHoverController(grace: .milliseconds(5))
        controller.toggle(.sleep)
        XCTAssertEqual(controller.current, .sleep)
        controller.enter(.recovery)
        XCTAssertEqual(controller.current, .recovery, "a pin must not make hovering the other rings do nothing")
        controller.exit(.recovery)
        let settled = expectation(description: "grace passes")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { settled.fulfill() }
        wait(for: [settled], timeout: 1)
        XCTAssertEqual(controller.current, .sleep, "leaving falls back to the pinned part")
        controller.toggle(.sleep)
        XCTAssertNil(controller.current)
    }

    // MARK: - The real views, read back

    func testHealthTabAtRestShowsNoProvenance() throws {
        let page = UIRender.onDesktop(TabRender.page(.health) { Self.healthTab() }, light: false, size: TabRender.size)
        let strings = try VisibleText.read(page, size: TabRender.size)
        XCTAssertTrue(strings.contains { $0.contains("Recovery 57 and 4.3 hours of sleep") },
                      "control: the reader sees the page's real text — got \(strings)")
        XCTAssertTrue(strings.contains("57"), "control: and the ring figures")
        for text in strings { XCTAssertEqual(Self.bannedWords(in: text), [], text) }
    }

    func testEveryHoverStageShowsNoProvenance() throws {
        for section in [HealthSection.recovery, .sleep, .activity, .trends, .energy] {
            let stage = HealthHoverStage(controller: HealthHoverController(), reads: Self.nick, forced: section)
                .frame(width: 600, height: 200).background(Color.black)
            let strings = try VisibleText.read(stage, size: CGSize(width: 600, height: 200))
            let title = HealthReads.part(section, Self.nick)?.title.uppercased() ?? "?"
            XCTAssertTrue(strings.joined(separator: " ").contains(title),
                          "control: \(section) stage text was read — got \(strings)")
            for text in strings { XCTAssertEqual(Self.bannedWords(in: text), [], "\(section): \(text)") }
        }
    }

    static func healthTab() -> HealthTab {
        HealthTab(state: AppState(), whoop: TabRender.whoop(), health: HealthLog(), connections: ConnectionsModel(),
                  day: LogicalDay(start: Calendar.current.startOfDay(for: Date()).addingTimeInterval(7 * 3600), fromWakeTime: true))
    }
}

/// Reads back what a SwiftUI view actually draws: the real view rendered to pixels, then text recognition over the
/// image. A string that reaches the screen is a string that is found, whichever model or helper produced it.
@MainActor
enum VisibleText {
    static func read<V: View>(_ view: V, size: CGSize) throws -> [String] {
        let framed = view.environment(\.orionFrozenMotion, 1).frame(width: size.width, height: size.height)
        let renderer = ImageRenderer(content: framed)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.cgImage, "nothing rendered")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    }
}

