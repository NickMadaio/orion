import MobileCore
import SwiftUI

/*
 Wave 14 (Health): the seven parts, moved off the page and onto the thing they describe. Hovering a ring (or the
 glance line it belongs to) floats that part's sentence, what it likely means, and its source and confidence, as bare
 type over a fading hairline: no plate, the way Knowledge's hover card reads. Nothing here decides what may be said;
 the text is `HealthSectionsModel`'s, rendered as given.
*/

/// The floating detail for one part. Pure presentation, so a render can draw it directly.
struct HealthPartDetail: View {
    let content: HealthSectionContent
    let provenance: String
    var width: CGFloat = 300

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 10) {
                Kicker(text: content.title, hue: HealthSectionsView.hue(content.section))
                FadingRule().frame(width: 60)
            }
            Text(content.narrative.happened)
                .font(OrionTheme.serif(16))
                .foregroundStyle(OrionTheme.text)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            if let means = content.narrative.likelyMeans {
                note(means)
            }
            if let consider = content.narrative.consider {
                note(consider)
            }
            Text(provenance)
                .font(OrionTheme.mono(9))
                .foregroundStyle(Color.white.opacity(0.36))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: width, alignment: .leading)
        // The fading hairline down the left edge in place of a plate.
        .padding(.leading, 14)
        .overlay(alignment: .leading) {
            LinearGradient(colors: [.clear, HealthSectionsView.hue(content.section).opacity(0.7), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(width: 1)
        }
        .shadow(color: OrionTheme.ink.opacity(0.9), radius: 14)
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(Color.white.opacity(0.62))
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct HealthPartHoverModifier: ViewModifier {
    let parts: [HealthSectionContent]
    let model: HealthSectionsModel
    let width: CGFloat
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(parts, id: \.section.rawValue) { part in
                        HealthPartDetail(content: part, provenance: model.shortProvenance(part), width: width)
                    }
                }
                .fixedSize()
                .offset(y: hovering ? 12 + 0 : 4)
                .alignmentGuide(.bottom) { $0[.top] }
                .opacity(hovering ? 1 : 0)
                .allowsHitTesting(false)
            }
            .zIndex(hovering ? 10 : 0)
            .animation(reduceMotion ? .easeInOut(duration: 0.15) : .spring(response: 0.38, dampingFraction: 0.88), value: hovering)
    }
}

extension View {
    /// Hovering this view floats the given parts' detail just below it.
    func healthPartHover(_ parts: [HealthSectionContent], model: HealthSectionsModel, width: CGFloat = 300) -> some View {
        modifier(HealthPartHoverModifier(parts: parts, model: model, width: width))
    }
}
