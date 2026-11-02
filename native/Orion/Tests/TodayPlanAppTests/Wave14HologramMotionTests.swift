import AppKit
import SwiftUI
import ThinkingOrbsKit
import XCTest
@testable import OrionViews
@testable import Orion

/// Wave 14 (Nick, build 1253: "the hologram on the home page ... isnt moving", then "it IS moving now"). It froze
/// for the whole day he ran on battery with Low Power on, and moved again once he plugged in: the pause rule read
/// Low Power as "nobody is looking". These pin the decision table and the pause → resume transitions.
@MainActor
final class Wave14HologramMotionTests: XCTestCase {
    // MARK: Decision table

    func testVisibleWindowRuns() {
        XCTAssertEqual(AmbientPolicy.decide(AmbientSignals()), .run)
    }

    func testLowPowerThrottlesAVisibleWindowAndNeverPausesIt() {
        let lowPower = AmbientSignals(windowOpaque: false, lowPower: true)
        XCTAssertEqual(AmbientPolicy.decide(lowPower), .throttle)
        XCTAssertFalse(AmbientPolicy.decide(lowPower).paused)
    }

    func testTransparentWindowReportingOccludedStillTicks() {
        // The dashboard window: transparent, LSUIElement; occlusion is not a "can be seen" signal for it.
        let transparent = AmbientSignals(occlusionVisible: false, windowOpaque: false)
        XCTAssertEqual(AmbientPolicy.decide(transparent), .run)
        XCTAssertEqual(AmbientPolicy.decide(AmbientSignals(occlusionVisible: false, windowOpaque: false, lowPower: true)), .throttle)
    }

    func testOpaqueWindowFullyCoveredPauses() {
        XCTAssertEqual(AmbientPolicy.decide(AmbientSignals(occlusionVisible: false, windowOpaque: true)), .pause)
    }

    func testTrulyHiddenWindowsPauseWhateverTheyAre() {
        let hidden: [AmbientSignals] = [
            AmbientSignals(orderedIn: false, windowOpaque: false),
            AmbientSignals(miniaturized: true, windowOpaque: false),
            AmbientSignals(appHidden: true, windowOpaque: false),
            AmbientSignals(onActiveSpace: false, windowOpaque: false),
            AmbientSignals(screensAsleep: true, windowOpaque: false),
            AmbientSignals(miniaturized: true, lowPower: true),
        ]
        for signals in hidden { XCTAssertEqual(AmbientPolicy.decide(signals), .pause, "\(signals)") }
    }

    // MARK: Pause → resume

    /// Replays a day as the probe sees it: each step must land on the expected decision, and every return to a
    /// visible window must resume (run or throttle), never stay paused.
    func testEveryReturnToVisibleResumes() {
        var s = AmbientSignals(windowOpaque: false)
        let steps: [(String, (inout AmbientSignals) -> Void, AmbientDecision)] = [
            ("unplugged, Low Power on", { $0.lowPower = true }, .throttle),
            ("minimised", { $0.miniaturized = true }, .pause),
            ("restored", { $0.miniaturized = false }, .throttle),
            ("plugged in", { $0.lowPower = false }, .run),
            ("switched Space", { $0.onActiveSpace = false }, .pause),
            ("back", { $0.onActiveSpace = true }, .run),
            ("lid closed / locked", { $0.screensAsleep = true }, .pause),
            ("unlocked, occlusion lags", { $0.screensAsleep = false; $0.occlusionVisible = false }, .run),
            ("window closed", { $0.orderedIn = false }, .pause),
            ("reopened", { $0.orderedIn = true; $0.occlusionVisible = true }, .run),
            ("app hidden", { $0.appHidden = true }, .pause),
            ("app shown", { $0.appHidden = false }, .run),
        ]
        for (label, change, expected) in steps {
            change(&s)
            XCTAssertEqual(AmbientPolicy.decide(s), expected, label)
        }
    }

    func testPhaseResumesWithoutAJumpAfterAPause() {
        let phase = AmbientPhase()
        let t0 = Date(timeIntervalSinceReferenceDate: 5000)
        phase.advance(to: t0)
        phase.advance(to: t0.addingTimeInterval(0.5))
        let before = phase.advance(to: t0.addingTimeInterval(0.55))
        phase.pause()
        // Resumed ten minutes later: it carries on from where it stood, then moves again.
        XCTAssertEqual(phase.advance(to: t0.addingTimeInterval(600)), before, accuracy: 1e-9)
        XCTAssertGreaterThan(phase.advance(to: t0.addingTimeInterval(600.05)), before)
    }

    // MARK: Frame rates

    func testThrottledRatesKeepEveryStyleMoving() {
        XCTAssertEqual(AmbientPolicy.frameRate(30, throttled: false), 30)
        XCTAssertEqual(AmbientPolicy.frameRate(30, throttled: true), 20)
        XCTAssertEqual(AmbientPolicy.frameRate(60, throttled: true), 40)
        XCTAssertEqual(AmbientPolicy.frameRate(12, throttled: true), 12)
        // The model clamps a step to 0.05 s; a throttled Home step must fit, or Low Power would also slow the orb.
        XCTAssertLessThanOrEqual(1 / AmbientPolicy.frameRate(HomeHologram.fps, throttled: true), 0.05 + 1e-9)
    }

    // MARK: Every Visual moves

    func testEveryStyleDrawsADifferentFrameAtTwoTimes() throws {
        let orb = CGSize(width: 360, height: 360)
        let prefix = ProcessInfo.processInfo.environment["ORION_UI_RENDER_PREFIX"] ?? "w14-a-holo-"
        let styles: [(HologramStyle, String)] = [(.thinkingOrion, "thinking"), (.blueOrion, "blue"),
                                                 (.original, "original"), (.blackHole, "blackhole")]
        for (style, name) in styles {
            var frames: [Data] = []
            for (label, time) in [("t1", 3.0), ("t2", 4.5)] {
                let model = HomeHologram.advanced(by: time, palette: style.palette)
                let view = HomeHologram(model: model, frozenTime: time, styleOverride: style).padding(20)
                let image = try UIRender.write("\(prefix)\(name)-\(label)", UIRender.onDesktop(view, light: false, size: orb), size: orb)
                frames.append(Self.pixels(image))
            }
            XCTAssertNotEqual(frames[0], frames[1], "\(name): two times drew the same frame")
        }
    }

    private static func pixels(_ image: CGImage) -> Data {
        let width = image.width, height = image.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let context = CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return Data(bytes)
    }
}
