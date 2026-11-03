import SwiftUI
import ThinkingOrbsKit
import XCTest
@testable import Orion

/// Idle, thinking and answered, at 1440x900 on a bare wallpaper (the overlay has no plate of its own).
@MainActor
final class TypedSummonRenderTests: XCTestCase {
    private struct Host: View {
        let flow: TypedSummonFlow
        let text: String
        let hologram: HologramModel
        @FocusState private var focused: Bool
        var body: some View {
            TypedSummonView(flow: flow, text: .constant(text), focus: $focused, hologram: hologram, listening: false, bottomInset: 110,
                            animated: false, hologramFrozenTime: 3, hologramStyle: .thinkingOrion)
        }
    }

    private let answer = "You have two things today: the lab report at four, and the MKTG slides, which are due by midnight. "
        + "I would do the slides first, since the report only needs a read-through. Want me to block the evening for them?"

    private func render(_ name: String, flow: TypedSummonFlow, text: String = "", size: CGSize = CGSize(width: 1440, height: 900),
                        state: HologramState = .idle) throws {
        let model = HomeHologram.advanced(by: 2, state: state)
        let scene = ZStack { UIRender.wallpaper(light: false); Host(flow: flow, text: text, hologram: model) }
            .environment(\.orionFrozenMotion, 1)
        try UIRender.write(name, scene, size: size)
    }

    func testRendersIdleThinkingAnswered() throws {
        var flow = TypedSummonFlow()
        flow.present()
        try render("typed-summon-idle", flow: flow)
        flow.sent()
        try render("typed-summon-thinking", flow: flow, text: "", state: .thinking)
        flow.answered(answer)
        try render("typed-summon-answered", flow: flow)
        flow.sent()
        try render("typed-summon-followup", flow: flow, state: .thinking)
    }

    func testRendersLargeScreenAndLongAnswer() throws {
        var flow = TypedSummonFlow()
        flow.present(); flow.sent()
        flow.answered(Array(repeating: answer, count: 6).joined(separator: "\n\n"))
        try render("typed-summon-answered-long-1728", flow: flow, size: CGSize(width: 1728, height: 1117))
    }
}
