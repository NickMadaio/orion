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
    @ObservedObject var journal: JournalStore

    @State private var expanded: Set<String> = []
    @State private var draft = ""

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

            if [.today, .sleep, .recovery, .activity].contains(content.section) {
                Text(model.readingStatus)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

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

            if content.section == .journal { journalEntry }

            provenance(content)
        }
    }

    /// Writing in the journal, and the one question an entry may raise.
    ///
    /// The clarification is shown as a QUESTION with the entry already saved,
    /// not as a blocking prompt. "Ask for clarification only when necessary"
    /// does not mean "refuse the entry until answered" — an entry Nick typed is
    /// his, and holding it hostage to a meridiem is how a journal stops being
    /// used.
    @ViewBuilder
    private var journalEntry: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField("Had caffeine around 5…", text: $draft, onCommit: commit)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14))
                Button("Add", action: commit)
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))

            if let question = journal.pendingClarification {
                Text(question)
                    .font(.system(size: 12))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = journal.lastError {
                Text(error).font(.system(size: 12)).foregroundStyle(.red)
            }

            ForEach(journal.entries.prefix(5)) { entry in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(entry.time, format: .dateTime.hour().minute())
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.tertiary)
                    Text(entry.notes).font(.system(size: 13))
                    Spacer(minLength: 0)
                    Text(entry.eventType.rawValue)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.tertiary)
                    // A corrected entry says so. Hiding it would make Orion's
                    // guesses look like it was always right.
                    if entry.source == .correction {
                        Image(systemName: "pencil").font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(.top, 4)
    }

    private func commit() {
        let text = draft.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        journal.add(text)
        draft = ""
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
        return "\(sources) · \(confidenceWord(content.narrative.confidence)) history confidence"
    }

    private func longProvenance(_ content: HealthSectionContent) -> String {
        model.provenanceDetail(for: content.section)
    }

    private func confidenceWord(_ confidence: BaselineConfidence) -> String {
        switch confidence {
        case .low: return "low"
        case .moderate: return "moderate"
        case .high: return "high"
        }
    }
}
