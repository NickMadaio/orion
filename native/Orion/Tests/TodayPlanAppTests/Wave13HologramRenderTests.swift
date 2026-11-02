import AppKit
import SwiftUI
import ThinkingOrbsKit
import XCTest
@testable import Orion

/// Wave 13 renders: the composer rim, and each Visual on Home's own view at two phases. PNGs are written only when
/// ORION_UI_RENDER_DIR is set (prefix with ORION_UI_RENDER_PREFIX); the blank-render check always runs.
@MainActor
final class Wave13HologramRenderTests: XCTestCase {
    private var prefix: String { ProcessInfo.processInfo.environment["ORION_UI_RENDER_PREFIX"] ?? "w13a-" }

    func testRendersTheComposer() throws {
        let size = CGSize(width: 1100, height: 120)
        let view = ComposerHost().padding(.horizontal, 60).padding(.vertical, 30)
        try UIRender.write("\(prefix)composer", UIRender.onDesktop(view, light: false, size: size), size: size)
    }

    func testRendersEveryStyleAtTwoPhases() throws {
        let orb = CGSize(width: 520, height: 520)
        let styles: [(HologramStyle, String)] = [(.thinkingOrion, "thinking"), (.blueOrion, "blue"),
                                                 (.original, "original"), (.blackHole, "blackhole")]
        for (style, name) in styles {
            for (phase, time) in [("a", 2.0), ("b", 14.0)] {
                let model = HomeHologram.advanced(by: time, palette: style.palette)
                let view = HomeHologram(model: model, frozenTime: time, styleOverride: style).padding(30)
                try UIRender.write("\(prefix)hologram-\(name)-\(phase)", UIRender.onDesktop(view, light: false, size: orb), size: orb)
            }
        }
    }

    func testBlueHologramIsBrightAndBlue() throws {
        let orb = CGSize(width: 520, height: 520)
        let model = HomeHologram.advanced(by: 6, palette: .blue)
        let view = HomeHologram(model: model, frozenTime: 6, styleOverride: .blueOrion).padding(30)
        let image = try UIRender.write("\(prefix)hologram-blue-check", UIRender.onDesktop(view, light: false, size: orb), size: orb)
        let (blue, warm) = Self.countBrightPixels(image)
        XCTAssertGreaterThan(blue, 2_000, "too few bright blue pixels: the blue hologram is not clearly visible")
        XCTAssertLessThan(warm, blue / 20, "the blue hologram still draws gold")
    }

    /// As Home shows it with few cards: the faint ring, the orb inset, the whole at 0.75 opacity.
    func testBlueHologramStillPopsAtHomeOpacity() throws {
        let orb = CGSize(width: 520, height: 520)
        let model = HomeHologram.advanced(by: 2, palette: .blue)
        let view = ZStack {
            Circle().strokeBorder(Color.white.opacity(0.16), lineWidth: 0.8)
                .shadow(color: OrionTheme.accent.opacity(0.35), radius: 10).padding(10)
            HomeHologram(model: model, frozenTime: 2, styleOverride: .blueOrion).padding(40)
        }
        .opacity(0.75)
        let image = try UIRender.write("\(prefix)hologram-blue-home", UIRender.onDesktop(view, light: false, size: orb), size: orb)
        let (blue, warm) = Self.countBrightPixels(image)
        XCTAssertGreaterThan(blue, 2_000, "at Home's 0.75 opacity the blue hologram fades out")
        XCTAssertLessThan(warm, blue / 20)
    }

    /// Bright pixels whose blue channel leads (blue) or whose red leads (warm).
    private static func countBrightPixels(_ image: CGImage) -> (blue: Int, warm: Int) {
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        var blue = 0, warm = 0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let r = Int(pixels[i]), g = Int(pixels[i + 1]), b = Int(pixels[i + 2])
            guard max(r, g, b) > 110 else { continue }
            if b > r + 40 && b >= g { blue += 1 } else if r > b + 40 { warm += 1 }
        }
        return (blue, warm)
    }
}

private struct ComposerHost: View {
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HomeComposerBar(text: $text, focus: $focused, listening: false, line: HomeComposerLine(),
                        onVoice: {}, onChat: {}, onSend: {}, animated: false)
    }
}
