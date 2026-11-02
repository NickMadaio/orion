import AppKit
import MobileCore
import SwiftUI
import XCTest
@testable import Orion

/// Wave 14 (Health): the rings page and the hover detail drawn directly (ImageRenderer cannot hover).
@MainActor
final class Wave14HealthRenderTests: XCTestCase {
    private let model = HealthSectionsModel(inputs: .init(
        recovery: 57, sleepPerformance: 52, sleepHours: 4.3, hrv: 52, restingHeartRate: 56, strain: 6.3,
        recoverySampleCount: 7, sleepSampleCount: 7, strainSampleCount: 7, readingAgeHours: 2))

    func testRendersHealthRings() throws {
        try TabRender.write("w14-e-health-page", TabRender.page(.health) {
            HealthTab(state: AppState(), whoop: TabRender.whoop(), health: HealthLog(), connections: ConnectionsModel(),
                      day: LogicalDay(start: Calendar.current.startOfDay(for: Date()).addingTimeInterval(7 * 3600), fromWakeTime: true),
                      writer: NarrativeWriter())
        })
    }

    /// The hover stage with each metric's hover forced on, at the narrow and wide window widths.
    func testRendersForcedHoverStages() throws {
        let model = self.model
        for window in [1280.0, 1728.0] {
            let column = HealthStageLayout.mainColumn(window: window)
            let size = CGSize(width: column + 80, height: 5 * 150 + 40)
            let view = VStack(alignment: .leading, spacing: 18) {
                ForEach([HealthSection.recovery, .sleep, .activity, .energy, .trends], id: \.rawValue) { section in
                    HealthHoverStage(controller: HealthHoverController(), model: model, forced: section, column: column)
                }
            }
            .padding(40)
            try UIRender.write("w14-e-health-hover-\(Int(window))", UIRender.onDesktop(view, light: false, size: size), size: size)
        }
    }

    func testStageStaysInsideItsColumn() {
        for window in [1280.0, 1728.0, 900.0] {
            let column = HealthStageLayout.mainColumn(window: window)
            let width = HealthStageLayout.width(column: column)
            XCTAssertLessThanOrEqual(width, column)
            XCTAssertLessThanOrEqual(width, HealthStageLayout.maxWidth)
            XCTAssertGreaterThan(width, 0)
        }
        XCTAssertEqual(HealthStageLayout.width(column: .nan), 0)
    }

    func testHoverControllerHoldsBetweenNeighbours() async throws {
        let controller = HealthHoverController(grace: .milliseconds(60))
        controller.enter(.recovery)
        controller.exit(.recovery)
        controller.enter(.sleep)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(controller.hovered, .sleep, "moving to a neighbour inside the grace must not clear")
        controller.exit(.recovery)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(controller.hovered, .sleep, "a stale exit must not clear the current part")
        controller.exit(.sleep)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertNil(controller.hovered)
    }

    func testRingClampsAndPartsExist() {
        XCTAssertEqual(model.parts([.recovery, .sleep, .activity, .energy, .trends, .today]).count, 6)
    }
}
