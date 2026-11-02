import SwiftUI
import MobileCore

/*
 PHASE 34, reshaped in wave 14. The seven parts are not a list on the page: Today is the line a fixed hover stage
 rests on, and each other part appears in that stage when its metric is hovered (HealthPartHover.swift). The journal
 UI is gone (Nick: he tells ORION instead).

 The rules are unchanged and live in `HealthSectionsModel`: the view cannot render an interpretation the data does not
 support, because `SectionNarrative` refuses to hold one. Confidence is shown with every part.
*/

/// The "Today" part as a single serif line: what the hover stage rests on when nothing is hovered.
struct HealthTodayText: View {
    let part: HealthSectionContent

    var body: some View {
        Text(part.narrative.happened)
            .font(OrionTheme.serif(21))
            .foregroundStyle(OrionTheme.text.opacity(0.92))
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 560, alignment: .leading)
    }
}

enum HealthSectionsView {
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
