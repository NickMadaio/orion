import SwiftUI
import MobileCore

/*
 PHASE 34 — the seven sections on screen.

 What the manifest asks for is a shape, not a redesign: seven named sections,
 each answering what happened, what it likely means, and what to consider, with
 source and confidence inspectable and without a wall of charts.

 So this is ADDITIVE. `HealthTab` keeps its phase-aware headline — the design
 note at the top of that file explains why a dashboard whose headline never
 changes is one you stop reading after breakfast, and that reasoning still
 holds. This renders the seven sections underneath it, from
 `HealthSectionsModel`, which is where every rule actually lives.

 Nothing here decides what may be said. The view cannot render an interpretation
 the data does not support, because `SectionNarrative` refuses to hold one; it
 cannot render a clinical term, for the same reason. That is deliberate: a rule
 enforced in a view holds only on the screens somebody remembered to apply it
 to.

 The one judgement this file does make is that confidence is shown ALWAYS rather
 than only when it is low. "Make source and confidence inspectable" is a
 property of every claim, and a confidence line that appears only when things
 are uncertain teaches people that its absence means certainty.
*/

struct HealthSectionsView: View {

    let model: HealthSectionsModel

    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            SectionRule(title: "In seven parts")
            ForEach(model.sections(), id: \.section.rawValue) { content in
                sectionBlock(content)
            }
        }
    }

    @ViewBuilder
    private func sectionBlock(_ content: HealthSectionContent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(content.title)
                .font(.system(size: 13, weight: .semibold))
                .textCase(.uppercase)
                .kerning(0.6)
                .foregroundStyle(.secondary)

            // What happened. Always present.
            Text(content.narrative.happened)
                .font(.system(size: 15))
                .fixedSize(horizontal: false, vertical: true)

            if let means = content.narrative.likelyMeans {
                labelled("What this likely means", means)
            }
            if let consider = content.narrative.consider {
                labelled("Worth considering", consider)
            }

            provenance(content)
        }
    }

    @ViewBuilder
    private func labelled(_ label: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.tertiary)
            Text(body)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Source and confidence, on every section without exception.
    ///
    /// Tappable to expand rather than always spelled out, because seven copies
    /// of a full provenance sentence IS the overload the manifest warns about —
    /// but the short form still names both, so nothing is hidden behind the tap.
    @ViewBuilder
    private func provenance(_ content: HealthSectionContent) -> some View {
        let key = content.section.rawValue
        let isOpen = expanded.contains(key)
        VStack(alignment: .leading, spacing: 4) {
            Button {
                if isOpen { expanded.remove(key) } else { expanded.insert(key) }
            } label: {
                HStack(spacing: 6) {
                    Text(shortProvenance(content))
                    Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                }
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)

            if isOpen {
                Text(longProvenance(content))
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 2)
    }

    private func shortProvenance(_ content: HealthSectionContent) -> String {
        let sources = content.narrative.sources.map(\.label).joined(separator: ", ")
        return "\(sources) · \(confidenceWord(content.narrative.confidence)) confidence"
    }

    private func longProvenance(_ content: HealthSectionContent) -> String {
        switch content.narrative.confidence {
        case .low:
            return "Fewer than seven days of history, so Orion will report what it sees "
                + "and will not tell you what it means. That is why this section has no "
                + "interpretation under it."
        case .moderate:
            return "Between one and three weeks of history. Enough to compare today "
                + "against your own normal, not yet enough to be confident about a trend."
        case .high:
            return "Three weeks or more of history, so today is being compared against "
                + "a baseline built from your own readings rather than a general one."
        }
    }

    private func confidenceWord(_ confidence: BaselineConfidence) -> String {
        switch confidence {
        case .low: return "low"
        case .moderate: return "moderate"
        case .high: return "high"
        }
    }
}
