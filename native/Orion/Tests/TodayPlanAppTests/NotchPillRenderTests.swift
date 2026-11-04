import AppKit
import SwiftUI
import XCTest
import ThinkingOrbsKit
@testable import Orion

/// The pill's states drawn the way the panel draws them, at the top of a 1728x1117 screen (with the notch) and a
/// 1440x900 one (without). PNGs only when ORION_UI_RENDER_DIR is set.
@MainActor
final class NotchPillRenderTests: XCTestCase {

    private let notched = NotchScreenMetrics(
        frame: CGRect(x: 0, y: 0, width: 1728, height: 1117),
        visibleFrame: CGRect(x: 0, y: 0, width: 1728, height: 1085),
        safeAreaTop: 32,
        auxLeft: CGRect(x: 0, y: 1085, width: 771.5, height: 32),
        auxRight: CGRect(x: 956.5, y: 1085, width: 771.5, height: 32))
    private let flat = NotchScreenMetrics(
        frame: CGRect(x: 0, y: 0, width: 1440, height: 900),
        visibleFrame: CGRect(x: 0, y: 0, width: 1440, height: 876),
        safeAreaTop: 0, auxLeft: nil, auxRight: nil)

    private func state(_ mode: NotchPillMode, answer: String = "", hovering: Bool = false) -> NotchPillState {
        var s = NotchPillState()
        s.mode = mode; s.answer = answer; s.hovering = hovering
        return s
    }

    private let answer = "Two things before six. The slides need a final pass, about forty minutes, and Priya is waiting on your half of the problem set."

    /// A strip of desktop: menu bar, the real notch cut-out in black, the pill over it.
    private func frame(_ name: String, _ state: NotchPillState, metrics: NotchScreenMetrics, style: HologramStyle = .blueOrion, light: Bool = false) throws {
        let strip = CGSize(width: 640, height: 190)
        let pill = NotchGeometry.pillFrame(metrics, size: state.size)
        let notch = NotchGeometry.notch(metrics)
        let band = notch?.height ?? NotchGeometry.flatHeight
        let model = HologramModel()
        let scene = ZStack(alignment: .top) {
            UIRender.wallpaper(light: light)
            // Menu bar.
            VStack(spacing: 0) {
                Rectangle().fill(Color.black.opacity(light ? 0.12 : 0.3)).frame(height: notch?.height ?? 24)
                Spacer()
            }
            if let notch {
                UnevenRoundedRectangle(bottomLeadingRadius: 10, bottomTrailingRadius: 10, style: .continuous)
                    .fill(Color.black).frame(width: notch.width, height: notch.height)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            NotchPillView(state: state, notchGap: NotchGeometry.notchGap(metrics), hasNotch: notch != nil,
                          pillSize: pill.size, bandHeight: band, hologram: model, orbStyle: style,
                          docked: true, flyOffset: .zero)
                .padding(.top, notch == nil ? 24 + NotchGeometry.flatGap : 0)
                .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(width: strip.width, height: strip.height)
        .environment(\.colorScheme, .dark)
        .environment(\.orionFrozenMotion, 1)
        try UIRender.write(name, scene, size: strip)
    }

    func testNotchedStates() throws {
        try frame("notch-1-thinking", state(.thinking), metrics: notched)
        try frame("notch-2-speaking", state(.speaking, answer: answer), metrics: notched)
        try frame("notch-3-done-preview", state(.preview, answer: answer), metrics: notched)
        try frame("notch-4-hover-expanded", state(.speaking, answer: answer, hovering: true), metrics: notched)
        try frame("notch-5-preview-light-desktop", state(.preview, answer: answer), metrics: notched, light: true)
    }

    func testFlatScreenStates() throws {
        try frame("flat-1-thinking", state(.thinking), metrics: flat)
        try frame("flat-2-speaking", state(.speaking, answer: answer), metrics: flat)
        try frame("flat-3-done-preview", state(.preview, answer: answer), metrics: flat)
        try frame("flat-4-hover-expanded", state(.preview, answer: answer, hovering: true), metrics: flat)
    }

    func testOtherCoreStyles() throws {
        try frame("orb-thinkingOrion", state(.speaking, answer: answer), metrics: notched, style: .thinkingOrion)
        try frame("orb-blackHole", state(.speaking, answer: answer), metrics: notched, style: .blackHole)
    }
}
