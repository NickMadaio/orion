import SwiftUI
import MobileCore

/*
 PHASE 34, reshaped in wave 14. The seven parts are no longer a list on the page: the first, Today, is one short
 serif line here, and each other part floats from the metric it describes (`healthPartHover`, HealthPartHover.swift).
 What stays on the page is the one part that is a function rather than a reading, the journal, folded away until
 asked for.

 The rules are unchanged and live in `HealthSectionsModel`: the view cannot render an interpretation the data does not
 support, because `SectionNarrative` refuses to hold one. Confidence is still shown for every part, now in its hover.
*/

/// The "Today" part as a single serif line, with its detail on hover.
struct HealthTodayLine: View {
    let model: HealthSectionsModel

    var body: some View {
        if let today = model.parts([.today]).first {
            Text(today.narrative.happened)
                .font(OrionTheme.serif(21))
                .foregroundStyle(OrionTheme.text.opacity(0.92))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 620, alignment: .leading)
                .healthPartHover([today], model: model, width: 340)
        }
    }
}

/// The journal: a quiet, collapsible entry field. Unchanged in behaviour from the old seventh section.
struct HealthSectionsView: View {

    let model: HealthSectionsModel
    @ObservedObject var journal: JournalStore

    @State private var open = false
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                withAnimation(OrionMotion.page) { open.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Kicker(text: "Journal", hue: OrionTheme.rose.opacity(0.9))
                    FadingRule()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.36))
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open { journalEntry.transition(.opacity.combined(with: .offset(y: -6))) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Writing in the journal, and the one question an entry may raise.
    ///
    /// The clarification is shown as a QUESTION with the entry already saved, not as a blocking prompt: an entry
    /// Nick typed is his, and holding it hostage to a meridiem is how a journal stops being used.
    @ViewBuilder
    private var journalEntry: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let part = model.parts([.journal]).first {
                Text(part.narrative.happened)
                    .font(OrionTheme.serif(16))
                    .foregroundStyle(OrionTheme.text.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                TextField("Had caffeine around 5…", text: $draft, onCommit: commit)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14))
                Button("Add", action: commit)
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.vertical, 8)
            .overlay(alignment: .bottom) { FadingRule(tint: OrionTheme.rose) }

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
                    // A corrected entry says so; hiding it would make Orion's guesses look always right.
                    if entry.source == .correction {
                        Image(systemName: "pencil").font(.system(size: 9)).foregroundStyle(.tertiary)
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

    /// One hue per part, from the Home palette.
    static func hue(_ section: HealthSection) -> Color {
        switch section {
        case .today: OrionTheme.accent
        case .sleep: OrionTheme.lavender
        case .recovery: OrionTheme.green
        case .activity: OrionTheme.orange
        case .energy: Color(red: 0.95, green: 0.80, blue: 0.40)
        case .trends: OrionTheme.violet
        case .journal: OrionTheme.rose
        }
    }
}
