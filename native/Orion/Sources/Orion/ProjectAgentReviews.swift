import SwiftUI

/// What the reviewer actually said.
///
/// The run ledger shows *that* a task was accepted; this shows **why**, which is
/// the thing Nick reads in the morning when he wants to know whether the night
/// was any good. It is also the only place a `PASS_WITH_TASKS` is legible as
/// what it is — work the loop sent back to itself rather than a problem — and
/// the place a reviewer-authored repair is visible as code that was written by
/// the model that then approved it.
///
/// Nothing here is narrated by a model. Every line is a field the reviewer
/// returned in its structured verdict, recorded durably by the controller.
struct ProjectAgentReviewNotes: View {
    let run: ProjectAgentStatus
    var limit: Int = 4

    private var notes: [ProjectAgentStatus.Review] { Array(run.reviewNotes.prefix(limit)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // The reviewer-authored count rides on the section rule itself:
            // independence is what a review is worth, so where the reviewer
            // crossed into writing code belongs beside what it approved.
            SectionRule(title: "Review notes",
                        trailing: run.reviewerAuthoredChanges > 0
                            ? "\(run.reviewerAuthoredChanges) authored by the reviewer" : nil)

            if notes.isEmpty {
                Text("Nothing reviewed yet.")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                ForEach(notes) { note in
                    row(note)
                    if note.id != notes.last?.id {
                        Rectangle()
                            .fill(Color.white.opacity(0.05))
                            .frame(height: 0.5)
                    }
                }
            }
        }
    }

    private func row(_ note: ProjectAgentStatus.Review) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Circle()
                    .fill(tint(note))
                    .frame(width: 5, height: 5)
                Text(note.subject)
                    .font(OrionTheme.mono(9, .semibold))
                    .foregroundStyle(note.isRunLevel ? OrionTheme.blue : OrionTheme.text)
                Text(verdictLabel(note))
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.1)
                    .foregroundStyle(tint(note))
                Spacer()
                Text(note.reviewer)
                    .font(OrionTheme.mono(7))
                    .foregroundStyle(OrionTheme.textDim)
            }

            if !note.summary.isEmpty {
                Text(note.summary)
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textSoft)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(3)
            }

            // Findings carry their severity, because "minor" and "blocking" are
            // not the same news and a flat list reads as though they were.
            ForEach(Array((note.failed ?? []).prefix(3).enumerated()), id: \.offset) { _, finding in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(finding.severity.uppercased())
                        .font(OrionTheme.mono(7, .semibold))
                        .foregroundStyle(severityTint(finding.severity))
                    Text(finding.criterion)
                        .font(.system(size: 11))
                        .foregroundStyle(OrionTheme.textDim)
                        .lineLimit(2)
                }
            }

            if note.returnedWork > 0 {
                Text("→ \(note.returnedWork) correction\(note.returnedWork == 1 ? "" : "s") returned to the worker")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(OrionTheme.accent.opacity(0.85))
            }
        }
    }

    private func verdictLabel(_ note: ProjectAgentStatus.Review) -> String {
        switch note.verdict ?? note.decision {
        case "PASS", "accept": return "PASS"
        case "PASS_WITH_TASKS", "accept_with_tasks": return "PASS · WITH TASKS"
        case "BLOCKED", "blocked": return "BLOCKED"
        case "changes_requested": return "CHANGES REQUESTED"
        default: return (note.verdict ?? note.decision).uppercased()
        }
    }

    private func tint(_ note: ProjectAgentStatus.Review) -> Color {
        switch note.verdict ?? note.decision {
        case "PASS", "accept": return OrionTheme.green
        case "BLOCKED", "blocked": return OrionTheme.orange
        default: return OrionTheme.accent
        }
    }

    private func severityTint(_ severity: String) -> Color {
        switch severity {
        case "blocking": return OrionTheme.orange
        case "major": return OrionTheme.accent
        default: return OrionTheme.textDim
        }
    }
}
