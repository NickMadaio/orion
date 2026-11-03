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

                HomeHologram(model: hologram, frozenTime: hologramFrozenTime, styleOverride: hologramStyle)
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
                                onVoice: onVoice, onChat: onChat, onSend: onSend, animated: animated)
                    .frame(width: frames.composer.width)
                    .background(GeometryReader { box in Color.clear.preference(key: ComposerHeightKey.self, value: box.size.height) })
                    .position(x: frames.composer.midX, y: frames.composer.maxY - measuredComposer / 2)
            }
            .animation(OrionMotion.enter, value: flow.answer)
            .onPreferenceChange(ComposerHeightKey.self) { measuredComposer = max(TypedSummonGeometry.composerHeight, $0) }
        }
        .environment(\.colorScheme, .dark)
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
            .foregroundStyle(OrionTheme.text)
            .shadow(color: .black.opacity(0.75), radius: 6)
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
            FadingVerticalHairline(peak: 0.22).frame(height: max(frame.height, 24))
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
