import XCTest
@testable import Orion

/// The notch pill's placement, from plain screen numbers (no NSScreen), for the two Mac sizes Nick named.
final class NotchGeometryTests: XCTestCase {

    /// 16-inch MacBook Pro default: 1728x1117, 32 pt notch band, about 185 pt wide, centred.
    private let notched = NotchScreenMetrics(
        frame: CGRect(x: 0, y: 0, width: 1728, height: 1117),
        visibleFrame: CGRect(x: 0, y: 0, width: 1728, height: 1117 - 32),
        safeAreaTop: 32,
        auxLeft: CGRect(x: 0, y: 1117 - 32, width: 771.5, height: 32),
        auxRight: CGRect(x: 956.5, y: 1117 - 32, width: 771.5, height: 32))

    /// 1440x900, no notch: a plain 24 pt menu bar.
    private let flat = NotchScreenMetrics(
        frame: CGRect(x: 0, y: 0, width: 1440, height: 900),
        visibleFrame: CGRect(x: 0, y: 0, width: 1440, height: 900 - 24),
        safeAreaTop: 0, auxLeft: nil, auxRight: nil)

    func testNotchRectIsTheGapBetweenTheTwoAuxiliaryAreas() throws {
        let notch = try XCTUnwrap(NotchGeometry.notch(notched))
        XCTAssertEqual(notch.width, 185, accuracy: 0.01)
        XCTAssertEqual(notch.height, 32, accuracy: 0.01)
        XCTAssertEqual(notch.midX, 864, accuracy: 0.01)
        XCTAssertEqual(notch.maxY, 1117, accuracy: 0.01)
    }

    func testNoNotchOnAFlatScreen() {
        XCTAssertNil(NotchGeometry.notch(flat))
    }

    func testSafeAreaWithoutAuxiliaryAreasIsNotANotch() {
        let odd = NotchScreenMetrics(frame: flat.frame, visibleFrame: flat.visibleFrame, safeAreaTop: 24, auxLeft: nil, auxRight: nil)
        XCTAssertNil(NotchGeometry.notch(odd))
    }

    func testCompactPillHugsTheNotchAndSitsFlushWithTheTopEdge() throws {
        let frame = NotchGeometry.pillFrame(notched, size: .compact)
        XCTAssertEqual(frame.maxY, 1117, accuracy: 0.01, "flush with the top of the screen")
        XCTAssertEqual(frame.midX, 864, accuracy: 0.01, "centred on the notch, not on the screen")
        XCTAssertEqual(frame.height, 32, accuracy: 0.01, "same height as the notch band")
        let notch = try XCTUnwrap(NotchGeometry.notch(notched))
        XCTAssertGreaterThan(frame.width, notch.width + 200, "wings either side hold the orb and the line")
        XCTAssertEqual(NotchGeometry.notchGap(notched), 185, accuracy: 0.01)
    }

    func testExpandedSizesGrowDownwardFromTheSameTopEdge() {
        let compact = NotchGeometry.pillFrame(notched, size: .compact)
        let preview = NotchGeometry.pillFrame(notched, size: .preview)
        let expanded = NotchGeometry.pillFrame(notched, size: .expanded)
        for frame in [preview, expanded] {
            XCTAssertEqual(frame.maxY, 1117, accuracy: 0.01)
            XCTAssertEqual(frame.midX, 864, accuracy: 0.01)
        }
        XCTAssertGreaterThan(preview.height, compact.height)
        XCTAssertGreaterThan(expanded.height, preview.height)
        XCTAssertGreaterThanOrEqual(preview.width, compact.width)
    }

    func testFlatScreenFallsBackToTopCentreUnderTheMenuBar() {
        let frame = NotchGeometry.pillFrame(flat, size: .compact)
        XCTAssertEqual(frame.midX, 720, accuracy: 0.01)
        XCTAssertLessThan(frame.maxY, flat.visibleFrame.maxY + 0.01, "below the menu bar, not over it")
        XCTAssertGreaterThan(frame.maxY, flat.visibleFrame.maxY - 12, "but close under it")
        XCTAssertEqual(NotchGeometry.notchGap(flat), 0)
    }

    func testHostFrameHoldsTheLargestPillAndStaysOnScreen() {
        for metrics in [notched, flat] {
            let host = NotchGeometry.hostFrame(metrics)
            let largest = NotchGeometry.pillFrame(metrics, size: .expanded)
            XCTAssertTrue(host.contains(largest))
            XCTAssertTrue(metrics.frame.contains(host))
        }
    }

    func testOffsetFromAFloatingOrbPointsFromItsCentreToThePill() {
        let orbCentre = CGPoint(x: 1500, y: 800)
        let offset = NotchGeometry.flyOffset(from: orbCentre, metrics: flat)
        let pill = NotchGeometry.pillFrame(flat, size: .compact)
        XCTAssertEqual(offset.width, orbCentre.x - pill.midX, accuracy: 0.01)
        // SwiftUI y grows downward: the orb is below the pill, so its offset is positive.
        XCTAssertEqual(offset.height, pill.midY - orbCentre.y, accuracy: 0.01)
        XCTAssertGreaterThan(offset.height, 0, "the orb starts below the pill, so it rises up into place")
    }
}
