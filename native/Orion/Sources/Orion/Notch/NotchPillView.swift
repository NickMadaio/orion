import SwiftUI
import ThinkingOrbsKit

/// The notch pill, drawn: a black Dynamic-Island-style body (square against the top edge so it merges with the notch,
/// rounded below), the tiny orb, a one-line status, and under it the answer when it is showing a preview or hovered.
///
/// Pure of AppKit: everything it needs is passed in, so the render tests draw it exactly as the panel does.
struct NotchPillView: View {
    let state: NotchPillState
    /// Width of the cut-out the content must route around; 0 on a screen without one.
    let notchGap: CGFloat
    let hasNotch: Bool
    let pillSize: CGSize
    let bandHeight: CGFloat
    let hologram: HologramModel
    let orbStyle: HologramStyle
    /// False while the pill is flying in from, or retracting toward, the notch.
    let docked: Bool
    /// Where the pill starts, relative to its docked place, when it flies up out of the panel.
    let flyOffset: CGSize
    var onCancel: () -> Void = {}

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shape: UnevenRoundedRectangle {
        let bottom: CGFloat = hasNotch ? 18 : 17
        let top: CGFloat = hasNotch ? 0 : 17
        return UnevenRoundedRectangle(topLeadingRadius: top, bottomLeadingRadius: bottom,
                                      bottomTrailingRadius: bottom, topTrailingRadius: top, style: .continuous)
    }

    var body: some View {
        VStack(spacing: 0) {
            band.frame(height: bandHeight)
            if state.size != .compact { detail }
        }
        .frame(width: pillSize.width, height: pillSize.height, alignment: .top)
        .background(shape.fill(Color.black))
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.white.opacity(hasNotch ? 0.0 : 0.08), lineWidth: 0.5))
        .contentShape(shape)
        .scaleEffect(docked ? 1 : (reduceMotion ? 1 : 0.35), anchor: .top)
        .offset(reduceMotion || docked ? .zero : flyOffset)
        .opacity(docked ? 1 : 0)
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.42, dampingFraction: 0.78), value: docked)
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.38, dampingFraction: 0.82), value: pillSize)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("ORION, \(state.statusLine)"))
    }

    // MARK: Pieces

    private var band: some View {
        HStack(spacing: 0) {
            HStack(spacing: 8) {
                orb
                cancelButton
            }
            .frame(width: leftWidth, alignment: .leading)
            .padding(.leading, 12)
            Spacer(minLength: notchGap)
            Text(state.statusLine)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(Color.white.opacity(state.mode == .preview ? 0.9 : 0.72))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: rightWidth, alignment: .leading)
                .padding(.trailing, 12)
        }
    }

    /// With a notch the wings share the width the notch leaves; without, content simply flows.
    private var leftWidth: CGFloat { hasNotch ? 52 : 52 }
    private var rightWidth: CGFloat {
        hasNotch ? max(40, (pillSize.width - notchGap) / 2 - 24) : max(40, pillSize.width - 52 - 12 - 12 - 8)
    }

    private var orb: some View {
        // Drawn at a size the projection is designed for, then scaled down: at 22 pt its glow has no room and clips white.
        HologramView(model: hologram, style: orbStyle.rawValue)
            .frame(width: 110, height: 110)
            .scaleEffect(0.2)
            .frame(width: 22, height: 22)
    }

    private var cancelButton: some View {
        Image(systemName: "xmark")
            .font(.system(size: 8.5, weight: .bold))
            .foregroundStyle(Color.white.opacity(0.6))
            .frame(width: 18, height: 18)
            .background(Circle().fill(Color.white.opacity(0.1)))
            .contentShape(Circle())
            .onTapGesture(perform: onCancel)
            .accessibilityLabel(Text("Cancel and stop"))
            .accessibilityAddTraits(.isButton)
    }

    private var detail: some View {
        Text(detailText)
            .font(.system(size: 12.5, weight: .regular))
            .foregroundStyle(Color.white.opacity(0.82))
            .lineSpacing(2)
            .lineLimit(state.size == .expanded ? 6 : 2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(.horizontal, 16)
            .padding(.top, 2)
            .transition(.opacity)
    }

    private var detailText: String {
        let text = state.previewText
        if !text.isEmpty { return text }
        return state.mode == .thinking ? "Working on it. Click to open." : "Click to open."
    }
}
