import SwiftUI

/*
 Small round controls for the project run settings: a pill segmented choice, a round toggle, a bubble chip and a
 round -/+ stepper. They replace the system segmented picker, checkbox and stepper, which carried default form
 chrome that did not belong beside Home's outline cards. Each one takes the same bindings the system control did.
*/

/// A choice between a few options, as pills on a hairline outline. The selected one is a glowing capsule that slides.
struct ProjectPillChoice<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    var hue: Color = OrionTheme.accent
    @Namespace private var marker

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.value) { option in
                let on = option.value == selection
                Button { withAnimation(OrionMotion.select) { selection = option.value } } label: {
                    Text(option.label)
                        .font(.system(size: 12, weight: on ? .semibold : .medium))
                        .foregroundStyle(on ? OrionTheme.text : OrionTheme.textSoft)
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .background {
                            if on {
                                Capsule().fill(hue.opacity(0.14))
                                    .overlay(Capsule().strokeBorder(hue.opacity(0.7), lineWidth: 0.8))
                                    .shadow(color: hue.opacity(0.35), radius: 6)
                                    .matchedGeometryEffect(id: "pill", in: marker)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.8))
        .fixedSize()
    }
}

/// A round switch: an outline track with a dot that slides and lights in the hue when on.
struct ProjectRoundToggle: View {
    @Binding var isOn: Bool
    var hue: Color = OrionTheme.accent
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button { withAnimation(OrionMotion.select) { isOn.toggle() } } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? hue.opacity(0.16) : Color.clear)
                Capsule().strokeBorder(isOn ? hue.opacity(0.8) : Color.white.opacity(0.22), lineWidth: 0.9)
                Circle().fill(isOn ? hue : Color.white.opacity(0.45))
                    .frame(width: 14, height: 14).padding(3)
                    .shadow(color: isOn ? hue.opacity(0.8) : .clear, radius: 4)
            }
            .frame(width: 38, height: 20)
            .shadow(color: isOn ? hue.opacity(0.25) : .clear, radius: 6)
            .opacity(enabled ? 1 : 0.5)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOn ? "on" : "off")
        .accessibilityAddTraits(.isButton)
    }
}

/// A small outlined bubble: a suggestion to tap, or a value to read.
struct ProjectBubble: View {
    let text: String
    var symbol: String? = nil
    var hue: Color = OrionTheme.accent
    var action: (() -> Void)? = nil
    @State private var hovering = false

    var body: some View {
        if let action {
            Button(action: action) { chip }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .animation(OrionMotion.hover, value: hovering)
        } else {
            chip
        }
    }

    private var chip: some View {
        HStack(spacing: 5) {
            if let symbol { Image(systemName: symbol).font(.system(size: 9, weight: .semibold)) }
            Text(text).font(OrionTheme.mono(10.5)).lineLimit(1)
        }
        .foregroundStyle(hue.opacity(hovering ? 1 : 0.85))
        .padding(.horizontal, 11).padding(.vertical, 5)
        .background(Capsule().fill(hue.opacity(hovering ? 0.12 : 0.06)))
        .overlay(Capsule().strokeBorder(hue.opacity(hovering ? 0.7 : 0.4), lineWidth: 0.8))
        .contentShape(Capsule())
    }
}

/// Round minus and plus either side of the value, for a whole number in a range.
struct ProjectRoundStepper: View {
    @Binding var value: Int
    let range: ClosedRange<Int>
    var unit = "min"

    var body: some View {
        HStack(spacing: 8) {
            step("minus", value > range.lowerBound) { value -= 1 }
            Text("\(value) \(unit)").font(OrionTheme.mono(11)).monospacedDigit()
                .foregroundStyle(OrionTheme.text).frame(minWidth: 52)
            step("plus", value < range.upperBound) { value += 1 }
        }
    }

    private func step(_ symbol: String, _ allowed: Bool, _ change: @escaping () -> Void) -> some View {
        Button(action: change) {
            Image(systemName: symbol).font(.system(size: 9, weight: .bold))
                .foregroundStyle(allowed ? OrionTheme.text : OrionTheme.textDim)
                .frame(width: 22, height: 22)
                .overlay(Circle().strokeBorder(Color.white.opacity(allowed ? 0.3 : 0.12), lineWidth: 0.8))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!allowed)
    }
}
