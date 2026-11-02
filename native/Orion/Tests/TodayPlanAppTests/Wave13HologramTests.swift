import AppKit
import SwiftUI
import ThinkingOrbsKit
import XCTest
@testable import Orion

/// Wave 13 (Nick, 11-02): the composer rim centred on blue, the hologram moving as it did before wave 12, and a
/// fourth Visual, "Blue Orion", that Home honours as well as the floating voice view.
@MainActor
final class Wave13HologramTests: XCTestCase {
    // MARK: Style mapping

    func testStoredStylesMapToTheirCase() {
        XCTAssertEqual(HologramStyle(stored: "thinkingOrion"), .thinkingOrion)
        XCTAssertEqual(HologramStyle(stored: "original"), .original)
        XCTAssertEqual(HologramStyle(stored: "blackHole"), .blackHole)
        XCTAssertEqual(HologramStyle(stored: "blueOrion"), .blueOrion)
    }

    func testAnUnknownOrMissingStyleFallsBackToThinkingOrion() {
        XCTAssertEqual(HologramStyle(stored: nil), .thinkingOrion)
        XCTAssertEqual(HologramStyle(stored: ""), .thinkingOrion)
        XCTAssertEqual(HologramStyle(stored: "hologramV9"), .thinkingOrion)
    }

    func testTheStoredTagsAreStable() {
        // These strings live in Nick's defaults under orion.dashboard.coreStyle; renaming one loses his choice.
        XCTAssertEqual(HologramStyle.allCases.map(\.rawValue), ["thinkingOrion", "original", "blackHole", "blueOrion"])
        XCTAssertEqual(HologramStyle.storageKey, "orion.dashboard.coreStyle")
    }

    func testOnlyBlueOrionRecolours() {
        XCTAssertEqual(HologramStyle.blueOrion.palette, .blue)
        XCTAssertEqual(HologramStyle.thinkingOrion.palette, .gold)
        XCTAssertEqual(HologramStyle.original.palette, .gold)
    }

    // MARK: Blue palette

    /// The Home background: near-black ink.
    private let background = HoloRGB(r: 8, g: 10, b: 16)

    func testBlueOrbAccentPopsOnNearBlack() {
        for (state, label) in [(OrbState.breathing, "idle"), (.listening, "listening"), (.solving, "thinking")] {
            let accent = HoloPalette.blue.orbAccent(state: state, isError: false)
            XCTAssertGreaterThan(accent.contrast(against: background), 8, "\(label) blue is too dim")
            XCTAssertGreaterThan(accent.relativeLuminance, 0.38, "\(label) blue reads as navy")
        }
    }

    func testBlueIsBlueAndHasDepth() {
        let blue = HoloPalette.blue
        for colour in [blue.hot, blue.mid, blue.deep, blue.orbAccent(state: .breathing, isError: false)] {
            XCTAssertGreaterThan(colour.b, colour.r, "\(colour) is not blue")
            XCTAssertGreaterThanOrEqual(colour.b, colour.g, "\(colour) drifts to green")
        }
        // Lighter highlights, deeper shadows: not one flat hue.
        XCTAssertGreaterThan(blue.core.relativeLuminance, blue.hot.relativeLuminance)
        XCTAssertGreaterThan(blue.hot.relativeLuminance, blue.mid.relativeLuminance)
        XCTAssertGreaterThan(blue.mid.relativeLuminance, blue.deep.relativeLuminance)
        // The main stroke hue is luminous azure, not steel or slate.
        XCTAssertGreaterThan(blue.mid.relativeLuminance, 0.30)
        XCTAssertGreaterThan(blue.mid.contrast(against: background), 6)
        // Even the limb must stay visible.
        XCTAssertGreaterThan(blue.deep.contrast(against: background), 3)
    }

    func testGoldIsUnchangedForThePhoneAndThinkingOrion() {
        XCTAssertEqual(HoloPalette.gold.core, HoloRGB(r: 255, g: 246, b: 214))
        XCTAssertEqual(HoloPalette.gold.mid, HoloRGB(r: 255, g: 158, b: 38))
        XCTAssertEqual(HoloPalette.gold.orbAccent(state: .breathing, isError: false), HoloRGB(r: 255, g: 176, b: 69))
    }

    func testBlueCarriesStrongerStrokesAndGoldIsUntouched() {
        XCTAssertEqual(HoloPalette.gold.strokeGain, 1)
        XCTAssertEqual(HoloPalette.gold.bloomGain, 1)
        XCTAssertFalse(HoloPalette.gold.rampThroughMid)
        XCTAssertGreaterThanOrEqual(HoloPalette.blue.strokeGain, 1.5)
        XCTAssertGreaterThan(HoloPalette.blue.bloomGain, 1)
    }

    func testTheModelCarriesAPaletteAndDefaultsToGold() {
        let model = HologramModel()
        XCTAssertEqual(model.palette, .gold)
        model.palette = .blue
        XCTAssertEqual(model.palette, .blue)
    }

    // MARK: Motion

    func testHomeMovesLikeTheSummonPanel() {
        // Before wave 12 Home drew BalancedOrionHologram itself; wave 12 slowed Home to 0.3 at 20 fps.
        XCTAssertEqual(HomeHologram.motionScale, BalancedOrionHologram.motionScale)
        XCTAssertEqual(HomeHologram.fps, BalancedOrionHologram.fps)
        XCTAssertEqual(BalancedOrionHologram.motionScale, 0.45)
        XCTAssertGreaterThanOrEqual(HomeHologram.fps, 30)
    }

    // MARK: Composer rim

    func testComposerSpectrumIsCentredOnBlue() throws {
        var violet = 0
        for colour in HomeComposerBar.spectrum {
            let ns = try XCTUnwrap(NSColor(colour).usingColorSpace(.sRGB))
            let hue = ns.hueComponent * 360
            XCTAssertTrue((180...282).contains(hue), "hue \(hue) is outside blue/cyan (no rose, no amber)")
            if hue > 250 { violet += 1 }
        }
        XCTAssertLessThanOrEqual(violet, 1, "at most a small accent of violet")
        XCTAssertGreaterThanOrEqual(HomeComposerBar.spectrum.count, 5)
    }
}
