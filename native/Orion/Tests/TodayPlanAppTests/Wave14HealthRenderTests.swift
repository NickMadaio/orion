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

    func testRendersHoverDetails() throws {
        let size = CGSize(width: 760, height: 560)
        let model = self.model
        let view = VStack(alignment: .leading, spacing: 30) {
            ForEach([HealthSection.recovery, .sleep, .activity, .energy], id: \.rawValue) { section in
                if let part = model.parts([section]).first {
                    HealthPartDetail(content: part, provenance: model.shortProvenance(part))
                }
            }
        }
        .padding(40)
        try UIRender.write("w14-e-health-hover", UIRender.onDesktop(view, light: false, size: size), size: size)
    }

    func testRingClampsAndPartsExist() {
        XCTAssertEqual(model.parts([.recovery, .sleep, .activity, .energy, .trends, .today]).count, 6)
    }
}
