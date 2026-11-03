//
//  The compact now / next strip over the field, with a tiny Blue Orion orb. A running session replaces "now".
//

import SwiftUI

struct PaletteStrip: View {
    let glance: QuickGlance?
    let session: QuickSession?
    let problem: String?
    /// Renders hold the clock still.
    var clockDate: Date?

    var body: some View {
        HStack(spacing: 18) {
            PaletteOrb(size: 12)
            nowPart
            if let next = glance?.next {
                fact("NEXT", "\(next.at) · \(next.title)")
            }
            Spacer(minLength: 8)
            if let problem {
                Text(problem).font(.system(size: 10.5)).foregroundStyle(OrionTheme.orange).lineLimit(1)
            } else if let focus = glance?.focusToday {
                fact("FOCUS", focus)
            }
        }
        .padding(.horizontal, 22)
        .frame(height: 44)
    }

    @ViewBuilder private var nowPart: some View {
        if let session {
            HStack(spacing: 8) {
                kicker(session.paused ? "PAUSED" : session.onBreak ? "BREAK" : "FOCUS", session.onBreak ? OrionTheme.violet : OrionTheme.accent)
                if let clockDate {
                    clock(session, at: clockDate)
                } else {
                    TimelineView(.periodic(from: .now, by: 1)) { clock(session, at: $0.date) }
                }
                Text(session.label).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
            }
        } else if let now = glance?.now {
            fact("NOW", "\(now.title) · until \(now.until)")
        } else {
            fact("NOW", glance == nil ? "…" : "nothing planned")
        }
    }

    private func clock(_ session: QuickSession, at date: Date) -> some View {
        let total = max(0, Int(session.remaining(at: date).rounded()))
        let text = total >= 3600 ? String(format: "%d:%02d:%02d", total / 3600, (total / 60) % 60, total % 60)
                                 : String(format: "%d:%02d", total / 60, total % 60)
        return Text(text).font(OrionTheme.mono(13, .medium)).foregroundStyle(OrionTheme.text)
    }

    private func kicker(_ text: String, _ hue: Color) -> some View {
        Text(text).font(OrionTheme.mono(8.5, .semibold)).tracking(1.8).foregroundStyle(hue)
    }

    private func fact(_ title: String, _ value: String) -> some View {
        HStack(spacing: 8) {
            kicker(title, OrionTheme.accent.opacity(0.85))
            Text(value).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
        }
    }
}
