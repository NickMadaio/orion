import XCTest
@testable import Orion

/// Luminance in, ink / halo / scrim out; and the WCAG AA arithmetic behind it. Pure values, no window.
final class TypedSummonLegibilityTests: XCTestCase {
    func testContrastRatioMatchesWCAGReferenceValues() {
        XCTAssertEqual(TypedSummonLegibility.contrast(1, 0), 21, accuracy: 0.01)
        XCTAssertEqual(TypedSummonLegibility.contrast(0, 1), 21, accuracy: 0.01)
        XCTAssertEqual(TypedSummonLegibility.contrast(0.5, 0.5), 1, accuracy: 0.0001)
        // #767676 on white is the textbook 4.54:1.
        XCTAssertEqual(TypedSummonLegibility.contrast(1, TypedSummonLegibility.luminance(red: 0x76 / 255, green: 0x76 / 255, blue: 0x76 / 255)),
                       4.54, accuracy: 0.02)
    }

    func testLuminanceOfPrimaries() {
        XCTAssertEqual(TypedSummonLegibility.luminance(red: 1, green: 1, blue: 1), 1, accuracy: 0.0001)
        XCTAssertEqual(TypedSummonLegibility.luminance(red: 0, green: 0, blue: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(TypedSummonLegibility.luminance(red: 1, green: 0, blue: 0), 0.2126, accuracy: 0.0001)
    }

    func testWhiteBackdropGetsDarkInkWithLightHaloAndLightScrim() {
        let theme = TypedSummonLegibility.decide(backdrop: 1.0)
        XCTAssertTrue(theme.darkInk)
        XCTAssertTrue(theme.haloIsLight)
        XCTAssertTrue(theme.textScrimIsLight)
        XCTAssertTrue(theme.hologramRim, "a dark rim and depth halo for the luminous lines")
        XCTAssertGreaterThan(theme.hologramHalo, 0.4)
        XCTAssertGreaterThan(theme.composerFill, 0.8)
    }

    func testBlackBackdropKeepsLightInkWithDarkHalo() {
        let theme = TypedSummonLegibility.decide(backdrop: 0.01)
        XCTAssertFalse(theme.darkInk)
        XCTAssertFalse(theme.haloIsLight)
        XCTAssertFalse(theme.textScrimIsLight)
        XCTAssertFalse(theme.hologramRim)
        XCTAssertEqual(theme.hologramHalo, 0, accuracy: 0.0001)
    }

    func testEveryBackdropMeetsAAAfterTheScrim() {
        for step in 0...100 {
            let backdrop = Double(step) / 100
            let theme = TypedSummonLegibility.decide(backdrop: backdrop)
            XCTAssertGreaterThanOrEqual(theme.textContrast, TypedSummonLegibility.aa, "backdrop \(backdrop): \(theme)")
            XCTAssertLessThanOrEqual(theme.textScrim, TypedSummonLegibility.maxScrim)
        }
    }

    func testMidGreyNeedsTheStrongestScrimAndPureEndsOnlyTheSubtleOne() {
        let mid = TypedSummonLegibility.decide(backdrop: TypedSummonLegibility.worstCase)
        let white = TypedSummonLegibility.decide(backdrop: 1)
        let black = TypedSummonLegibility.decide(backdrop: 0)
        XCTAssertGreaterThanOrEqual(mid.textScrim, white.textScrim)
        XCTAssertEqual(white.textScrim, TypedSummonLegibility.baseScrim, accuracy: 0.0001)
        XCTAssertEqual(black.textScrim, TypedSummonLegibility.baseScrim, accuracy: 0.0001)
    }

    func testUnknownBackdropAssumesTheWorstCaseAndStillPassesAA() {
        let theme = TypedSummonLegibility.decide(backdrop: nil)
        XCTAssertGreaterThanOrEqual(theme.textContrast, TypedSummonLegibility.aa)
        XCTAssertGreaterThanOrEqual(theme.textScrim, TypedSummonLegibility.decide(backdrop: 0.5).textScrim)
    }

    func testReduceTransparencyUsesSolidBackingsAtHighContrast() {
        for backdrop in [0.0, 0.2, 0.5, 1.0] {
            let theme = TypedSummonLegibility.decide(backdrop: backdrop, reduceTransparency: true)
            XCTAssertTrue(theme.solid)
            XCTAssertEqual(theme.textScrim, 1, accuracy: 0.0001)
            XCTAssertEqual(theme.composerFill, 1, accuracy: 0.0001)
            XCTAssertGreaterThanOrEqual(theme.textContrast, 7)
        }
    }

    func testOutOfRangeLuminanceIsClamped() {
        XCTAssertEqual(TypedSummonLegibility.decide(backdrop: 3), TypedSummonLegibility.decide(backdrop: 1))
        XCTAssertEqual(TypedSummonLegibility.decide(backdrop: -2), TypedSummonLegibility.decide(backdrop: 0))
    }

    func testAverageLuminanceOfPixelBuffer() {
        let white = [UInt8](repeating: 255, count: 4 * 16)
        XCTAssertEqual(TypedSummonLegibility.averageLuminance(bgra: white) ?? -1, 1, accuracy: 0.001)
        var half = [UInt8]()
        for index in 0..<16 { half += index % 2 == 0 ? [255, 255, 255, 255] : [0, 0, 0, 255] }
        XCTAssertEqual(TypedSummonLegibility.averageLuminance(bgra: half) ?? -1, 0.5, accuracy: 0.001)
        XCTAssertNil(TypedSummonLegibility.averageLuminance(bgra: []))
    }
}
