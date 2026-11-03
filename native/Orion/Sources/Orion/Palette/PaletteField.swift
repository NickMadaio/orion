//
//  The palette's search field: large, with the blue-centred rim from the Home composer drifting round it.
//

import OrionViews
import PaletteKit
import SwiftUI

struct PaletteField: View {
    @ObservedObject var model: PaletteModel
    var focus: FocusState<Bool>.Binding
    /// Renders: the rim at a fixed phase and the text as a Text (ImageRenderer cannot draw an AppKit text field).
    var animated = true

    private static let corner: CGFloat = 18
    private static let prompt = "Search ORION, apps, to-dos…  or ask anything"

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: mode.symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(mode.hue)
                .frame(width: 22)
            if animated {
                TextField(Self.prompt, text: $model.query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 21, weight: .light))
                    .foregroundStyle(OrionTheme.text)
                    .focused(focus)
            } else {
                Text(model.query.isEmpty ? Self.prompt : model.query)
                    .font(.system(size: 21, weight: .light))
                    .foregroundStyle(model.query.isEmpty ? OrionTheme.textDim : OrionTheme.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let label = mode.label {
                Text(label)
                    .font(OrionTheme.mono(8.5, .semibold)).tracking(1.8)
                    .foregroundStyle(mode.hue)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .overlay(Capsule().strokeBorder(mode.hue.opacity(0.55), lineWidth: 0.8))
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 15)
        .background(RoundedRectangle(cornerRadius: Self.corner, style: .continuous).fill(OrionTheme.ink.opacity(0.55)))
        .overlay(rim)
        .animation(OrionMotion.hover, value: mode.label)
    }

    /// The drifting rim: three strokes of one slowly turning gradient, fine to soft. No blur, so a frame is cheap.
    private var rim: some View {
        AmbientTimeline(fps: 20, running: animated, stillTime: 6) { time in
            let gradient = AngularGradient(colors: HomeComposerBar.spectrum, center: .center, angle: .degrees(time * 15))
            let shape = RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
            ZStack {
                shape.stroke(gradient, lineWidth: 10).opacity(0.05)
                shape.stroke(gradient, lineWidth: 4).opacity(0.16)
                shape.stroke(gradient, lineWidth: 1).opacity(focus.wrappedValue || !animated ? 0.95 : 0.7)
            }
        }
        .allowsHitTesting(false)
    }

    private var mode: (symbol: String, label: String?, hue: Color) {
        switch model.input {
        case .ask: return ("sparkle", "ASK", OrionTheme.lavender)
        case .addTodo: return ("plus.circle", "TO-DO", OrionTheme.orange)
        case .calc: return ("equal.circle", "CALC", OrionTheme.green)
        case .action: return ("chevron.right.circle", "ACTION", OrionTheme.accent)
        case .browse, .search: return ("magnifyingglass", nil, OrionTheme.accent)
        }
    }
}
