import SwiftUI
import ThinkingOrbsKit
import XCTest
@testable import Orion

/// Idle and answered over pure white, a busy bright web page mock, and dark. Writes PNGs only with ORION_UI_RENDER_DIR.
@MainActor
final class TypedSummonLegibilityRenderTests: XCTestCase {
    private struct Host: View {
        let flow: TypedSummonFlow
        let hologram: HologramModel
        let theme: TypedSummonTheme
        @FocusState private var focused: Bool
        var body: some View {
            TypedSummonView(flow: flow, text: .constant(""), focus: $focused, hologram: hologram, listening: false, bottomInset: 110,
                            animated: false, hologramFrozenTime: 3, hologramStyle: .thinkingOrion, theme: theme)
        }
    }

    private enum Backdrop: String, CaseIterable {
        case white, web, dark
        var luminance: Double { switch self { case .white: 1; case .web: 0.62; case .dark: 0.02 } }
    }

    private let answer = "You have two things today: the lab report at four, and the MKTG slides, which are due by midnight. "
        + "I would do the slides first, since the report only needs a read-through. Want me to block the evening for them?"

    @ViewBuilder
    private func backdrop(_ kind: Backdrop) -> some View {
        switch kind {
        case .white: Color.white
        case .dark: UIRender.wallpaper(light: false)
        case .web: WebMock()
        }
    }

    private func render(_ kind: Backdrop, _ stage: String, flow: TypedSummonFlow, reduceTransparency: Bool = false) throws {
        let theme = TypedSummonLegibility.decide(backdrop: kind.luminance, reduceTransparency: reduceTransparency)
        let scene = ZStack { backdrop(kind); Host(flow: flow, hologram: HomeHologram.advanced(by: 2), theme: theme) }
            .environment(\.orionFrozenMotion, 1)
        try UIRender.write("typedvis-\(kind.rawValue)-\(stage)", scene, size: CGSize(width: 1440, height: 900))
    }

    func testRendersIdleAndAnsweredOverEveryBackdrop() throws {
        var idle = TypedSummonFlow()
        idle.present()
        var answered = idle
        answered.sent(); answered.answered(answer)
        for kind in Backdrop.allCases {
            try render(kind, "idle", flow: idle)
            try render(kind, "answered", flow: answered)
        }
    }

    func testRendersReduceTransparencySolidBackings() throws {
        var flow = TypedSummonFlow()
        flow.present(); flow.sent(); flow.answered(answer)
        try render(.web, "answered-solid", flow: flow, reduceTransparency: true)
    }
}

/// A busy bright page: white body, a coloured hero, cards, a sidebar, dense grey text lines.
private struct WebMock: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(red: 0.97, green: 0.97, blue: 0.98)
            Rectangle().fill(Color(red: 0.93, green: 0.95, blue: 1)).frame(height: 60)
            Rectangle().fill(LinearGradient(colors: [Color(red: 1, green: 0.85, blue: 0.4), Color(red: 1, green: 0.6, blue: 0.5)],
                                            startPoint: .leading, endPoint: .trailing))
                .frame(height: 260).offset(y: 60)
            ForEach(0..<14, id: \.self) { row in
                RoundedRectangle(cornerRadius: 3).fill(Color(red: 0.2, green: 0.2, blue: 0.25).opacity(row % 3 == 0 ? 0.8 : 0.45))
                    .frame(width: CGFloat(500 + (row * 97) % 520), height: 9).offset(x: 80, y: CGFloat(350 + row * 24))
            }
            ForEach(0..<4, id: \.self) { col in
                RoundedRectangle(cornerRadius: 10).fill(Color.white).shadow(radius: 4)
                    .frame(width: 280, height: 190).offset(x: CGFloat(70 + col * 320), y: 640)
                    .overlay(alignment: .topLeading) {
                        Rectangle().fill([Color.blue, .green, .red, .purple][col].opacity(0.7)).frame(width: 280, height: 70)
                            .offset(x: CGFloat(70 + col * 320), y: 640)
                    }
            }
            ForEach(0..<8, id: \.self) { row in
                Circle().fill(Color.black.opacity(0.7)).frame(width: 14).offset(x: 1100, y: CGFloat(380 + row * 40))
            }
        }
    }
}
