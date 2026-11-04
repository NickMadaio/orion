import OrionViews
import ThinkingOrbsKit
import SwiftUI

/*
 The typed summon overlay's contents, from plain values (renders use it directly; TypedSummonController feeds it live data).
 No plate and no blur: the screen shows through. The composer is Home's, the hologram is Home's (so it follows the Core
 style Nick picked), and the answer is body text with a hairline, no box.
*/

struct TypedSummonView: View {
    let flow: TypedSummonFlow
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    let hologram: HologramModel
    let listening: Bool
    let bottomInset: CGFloat
    var onVoice: () -> Void = {}
    var onChat: () -> Void = {}
    var onSend: () -> Void = {}
    var onDismiss: () -> Void = {}
    /// Renders only.
    var animated = true
    var hologramFrozenTime: Double?
    var hologramStyle: HologramStyle?
    /// What the text, scrims, hologram rim and composer look like over the desktop behind (TypedSummonLegibility).
    var theme = TypedSummonLegibility.decide(backdrop: nil)

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var measuredAnswer: CGFloat = 120
    @State private var measuredComposer: CGFloat = TypedSummonGeometry.composerHeight

    private var geometry: (CGSize) -> TypedSummonGeometry {
        { size in
            TypedSummonGeometry.layout(screen: size, bottomInset: bottomInset, hologramLeft: flow.hologramLeft,
                                       answerHeight: measuredAnswer, composerHeight: measuredComposer)
        }
    }

    var body: some View {
        GeometryReader { proxy in
            let frames = geometry(proxy.size)
            ZStack(alignment: .topLeading) {
                Color.clear.contentShape(Rectangle()).onTapGesture(perform: onDismiss)

                hologramScrim(frames.hologram)
                    .opacity(flow.stage == .dismissed ? 0 : 1)

                if let answer = flow.answer {
                    answerScrim(frames.answer).id(answer).transition(.opacity)
                }

                hologramView
                    .frame(width: frames.hologram.width, height: frames.hologram.height)
                    .position(x: frames.hologram.midX, y: frames.hologram.midY)
                    .opacity(flow.stage == .dismissed ? 0 : 1)
                    // Reduce Motion: a new view per side, so the two positions crossfade and nothing travels.
                    .id(reduceMotion ? flow.hologramLeft : false)
                    .transition(.opacity)
                    .animation(slide, value: flow.hologramLeft)

                if let answer = flow.answer {
                    answerView(answer, frame: frames.answer)
                }

                HomeComposerBar(text: $text, focus: focus, listening: listening, line: HomeComposerLine(),
                                onVoice: onVoice, onChat: onChat, onSend: onSend, animated: animated,
                                legibility: theme.composerOutline > 0 || theme.solid
                                    ? .lifted(fill: theme.composerFill, outline: theme.composerOutline)
                                    : .lifted(fill: theme.composerFill, outline: 0))
                    .frame(width: frames.composer.width)
                    .background(GeometryReader { box in Color.clear.preference(key: ComposerHeightKey.self, value: box.size.height) })
                    .position(x: frames.composer.midX, y: frames.composer.maxY - measuredComposer / 2)
            }
            .animation(OrionMotion.enter, value: flow.answer)
            .onPreferenceChange(ComposerHeightKey.self) { measuredComposer = max(TypedSummonGeometry.composerHeight, $0) }
        }
        .environment(\.colorScheme, .dark)
    }

    // MARK: Legibility

    private var ink: Color { theme.darkInk ? Color(red: 0.05, green: 0.06, blue: 0.09) : OrionTheme.text }
    private var halo: Color { theme.haloIsLight ? Color(red: 0.98, green: 0.98, blue: 1) : Color.black }
    private var scrimTone: Color { theme.textScrimIsLight ? Color(red: 0.98, green: 0.98, blue: 1) : Color(red: 0.03, green: 0.04, blue: 0.08) }

    /// The hologram's lines are luminous, so a light desktop gets a dark rim (shadows hug the drawn lines) and more opacity.
    @ViewBuilder
    private var hologramView: some View {
        let holo = HomeHologram(model: hologram, frozenTime: hologramFrozenTime, styleOverride: hologramStyle)
        if theme.hologramRim {
            holo
                .shadow(color: Color(red: 0.01, green: 0.02, blue: 0.06).opacity(0.9), radius: 1)
                .shadow(color: Color(red: 0.01, green: 0.02, blue: 0.06).opacity(0.7), radius: 4)
        } else {
            holo
        }
    }

    /// A soft dark depth behind the hologram on light desktops; a solid disc under Reduce Transparency; nothing when dark.
    @ViewBuilder
    private func hologramScrim(_ frame: CGRect) -> some View {
        let reach = frame.width * 0.72
        let deep = Color(red: 0.02, green: 0.03, blue: 0.09)
        if theme.solid, theme.hologramHalo > 0 {
            Circle().fill(OrionTheme.ink.opacity(0.94)).frame(width: frame.width * 0.9, height: frame.width * 0.9)
                .position(x: frame.midX, y: frame.midY).allowsHitTesting(false)
        } else if theme.hologramHalo > 0 {
            Circle()
                .fill(RadialGradient(stops: [.init(color: deep.opacity(theme.hologramHalo), location: 0),
                                             .init(color: deep.opacity(theme.hologramHalo * 0.92), location: 0.45),
                                             .init(color: deep.opacity(theme.hologramHalo * 0.4), location: 0.75),
                                             .init(color: .clear, location: 1)],
                                     center: .center, startRadius: 0, endRadius: reach))
                .frame(width: reach * 2, height: reach * 2)
                .position(x: frame.midX, y: frame.midY).allowsHitTesting(false)
        }
    }

    /// A feathered wash behind the answer, never a box: an ellipse that fades to nothing. Solid under Reduce Transparency.
    @ViewBuilder
    private func answerScrim(_ frame: CGRect) -> some View {
        let wide = frame.width + 170, tall = frame.height + 130
        if theme.solid {
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(scrimTone)
                .frame(width: frame.width + 36, height: frame.height + 28)
                .position(x: frame.midX, y: frame.midY).allowsHitTesting(false)
        } else {
            Circle()
                .fill(RadialGradient(stops: [.init(color: scrimTone.opacity(theme.textScrim), location: 0),
                                             .init(color: scrimTone.opacity(theme.textScrim * 0.95), location: 0.6),
                                             .init(color: scrimTone.opacity(theme.textScrim * 0.4), location: 0.82),
                                             .init(color: .clear, location: 1)],
                                     center: .center, startRadius: 0, endRadius: wide / 2))
                .frame(width: wide, height: wide)
                .scaleEffect(x: 1, y: tall / wide)
                .position(x: frame.midX, y: frame.midY).allowsHitTesting(false)
        }
    }

    /// Spring, about half a second; Reduce Motion gets a plain crossfade and the hologram does not travel.
    private var slide: Animation? {
        reduceMotion ? .easeInOut(duration: 0.3) : .spring(response: 0.5, dampingFraction: 0.86)
    }

    /// Long answers scroll inside the capped height. Renders (ImageRenderer cannot draw a ScrollView) clip instead.
    @ViewBuilder
    private func reading(_ answer: String) -> some View {
        let text = Text(answer)
            .font(.system(size: 17, design: .serif))
            .lineSpacing(5)
            .foregroundStyle(ink)
            .shadow(color: halo.opacity(0.95), radius: 1.2)
            .shadow(color: halo.opacity(0.85), radius: 6)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(GeometryReader { box in Color.clear.preference(key: AnswerHeightKey.self, value: box.size.height) })
        if animated {
            ScrollView(.vertical, showsIndicators: false) { text }
        } else {
            text.fixedSize(horizontal: false, vertical: true).frame(maxHeight: .infinity, alignment: .top).clipped()
        }
    }

    private func answerView(_ answer: String, frame: CGRect) -> some View {
        HStack(alignment: .top, spacing: 18) {
            FadingVerticalHairline(peak: theme.darkInk ? 0.45 : 0.22).frame(height: max(frame.height, 24))
            reading(answer)
        }
        .frame(width: frame.width, height: frame.height, alignment: .topLeading)
        .opacity(flow.answerDimmed ? 0.4 : 1)
        .animation(OrionMotion.fade, value: flow.answerDimmed)
        .onPreferenceChange(AnswerHeightKey.self) { measuredAnswer = $0 }
        .position(x: frame.midX, y: frame.midY)
        .id(answer)
        .transition(.softReveal(reduceMotion: reduceMotion))
    }
}

private struct ComposerHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

private struct AnswerHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
