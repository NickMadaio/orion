import SwiftUI

/*
 The brief, in its two shapes.

 It takes over Home the first time Orion is opened in a day, because that is the
 moment it is worth something. But "dismiss" is the wrong verb for something you
 might want to read properly in ten minutes — so the single action PARKS it: the
 orb comes back, and the brief lives on as a card at the side of Home for the
 rest of the day, one click from being open again.

 Which is the difference between a notification and an assistant. A notification
 is gone when you look away.
*/

/// Full or parked, remembered per logical day.
enum BriefPresentation: String {
    case full
    case parked

    private static func key(_ day: LogicalDay) -> String { "orion.brief.state.\(day.key)" }

    static func stored(for day: LogicalDay, isFirstSession: Bool) -> BriefPresentation {
        if let raw = UserDefaults.standard.string(forKey: key(day)),
           let value = BriefPresentation(rawValue: raw) {
            return value
        }
        // No stored state for this day: full if this is the first time Orion
        // has been used since the day began, parked otherwise — reopening the
        // window at 4pm should not replay the morning at you.
        return isFirstSession ? .full : .parked
    }

    func store(for day: LogicalDay) {
        UserDefaults.standard.set(rawValue, forKey: BriefPresentation.key(day))
    }
}

// MARK: - Full

struct MorningBriefPanel: View {
    let facts: BriefFacts
    @ObservedObject var writer: NarrativeWriter
    var onStartDay: () -> Void

    /// Centred, and centred properly: the panel is centred in the window AND
    /// its own contents are centred within it. Left-aligning a 700pt column in
    /// the middle of a wide window reads as a document that lost its page —
    /// the eye finds the centre of the screen and the text is not there.
    ///
    /// The two detail columns stay left-aligned inside themselves, because a
    /// list of times and titles with ragged left edges is unreadable. Centring
    /// applies to the composition, not to every line in it.
    var body: some View {
        VStack(spacing: 34) {
            heading
            if facts.hasHealth { readings }
            narrative
            FadingRule().frame(width: 220)
            HStack(alignment: .top, spacing: 70) {
                schedule
                due
            }
            .frame(maxWidth: 620)
            LogButton(title: "Start the day", systemImage: "arrow.right") { onStartDay() }
                .padding(.top, 6)
        }
        .frame(maxWidth: 900)
        .frame(maxWidth: .infinity)
        .padding(.top, 18)
    }

    private var heading: some View {
        VStack(spacing: 10) {
            Text(facts.day.start.formatted(.dateTime.weekday(.wide).month(.wide).day()).uppercased())
                .font(OrionTheme.mono(9, .semibold))
                .tracking(3)
                .foregroundStyle(OrionTheme.textDim)
            Text(facts.salutation)
                .font(OrionTheme.display(46))
                .foregroundStyle(OrionTheme.text)
                .multilineTextAlignment(.center)
            if let wokeAt = facts.wokeAt {
                Text("Up at \(wokeAt.formatted(date: .omitted, time: .shortened))")
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(OrionTheme.textSoft)
            }
        }
    }

    private var readings: some View {
        HStack(alignment: .center, spacing: 40) {
            if let recovery = facts.readings.recovery {
                RingMeter(progress: Double(recovery) / 100,
                          value: "\(recovery)",
                          caption: "recovery",
                          tint: recoveryTint(recovery),
                          diameter: 118)
            }
            VStack(alignment: .leading, spacing: 14) {
                if let sleep = facts.readings.sleepPerformance {
                    Reading(label: "sleep",
                            value: "\(sleep)",
                            unit: "%",
                            note: facts.readings.sleepHours.map { String(format: "%.1fh in bed", $0) },
                            tint: OrionTheme.violet)
                }
                if let hrvDelta = facts.readings.hrvDelta {
                    Reading(label: "hrv",
                            value: hrvDelta,
                            unit: "ms",
                            note: "vs your 7-day average",
                            tint: OrionTheme.blue)
                }
            }
            if facts.readings.recovery != nil {
                VStack(alignment: .leading, spacing: 6) {
                    Text("STRAIN BAND")
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1.6)
                        .foregroundStyle(OrionTheme.textDim)
                    Text("\(Int(facts.readings.strainTarget.low))–\(Int(facts.readings.strainTarget.high))")
                        .font(OrionTheme.display(26))
                        .foregroundStyle(OrionTheme.orange)
                    Text(facts.readings.strainTarget.headline)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 150, alignment: .leading)
                }
            }
        }
    }

    /// Present only when there is something written. No placeholder, no
    /// spinner: the brief is complete without it, and a shimmer where a
    /// sentence will be is a promise the local model might not keep.
    @ViewBuilder private var narrative: some View {
        if let text = writer.text {
            Text(text)
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(OrionTheme.text.opacity(0.9))
                .lineSpacing(6)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 620)
                .transition(.opacity)
        }
    }

    private var schedule: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionRule(title: "Today", trailing: committedLabel)
            if facts.events.isEmpty {
                Text("Nothing on the calendar.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                ForEach(facts.events.prefix(5)) { event in
                    HStack(spacing: 12) {
                        Text(event.timeLabel)
                            .font(OrionTheme.mono(10, .semibold))
                            .foregroundStyle(event.isPast ? OrionTheme.textDim : OrionTheme.accent)
                            .frame(width: 62, alignment: .leading)
                        Text(event.title)
                            .font(.system(size: 13))
                            .foregroundStyle(event.isPast ? OrionTheme.textDim : OrionTheme.text)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }
                if facts.events.count > 5 {
                    Text("+\(facts.events.count - 5) more")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var committedLabel: String? {
        guard facts.committedMinutes > 0 else { return nil }
        return "\(facts.committedMinutes / 60)h \(facts.committedMinutes % 60)m committed"
    }

    private var due: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionRule(title: "Due", trailing: facts.overdue.isEmpty ? nil : "\(facts.overdue.count) overdue")
            if facts.dueToday.isEmpty && facts.overdue.isEmpty {
                Text("Nothing due.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                ForEach(facts.overdue.prefix(3)) { task in
                    DueLine(title: task.title, tint: OrionTheme.red, note: "overdue")
                }
                ForEach(facts.dueToday.prefix(4)) { task in
                    DueLine(title: task.title,
                            tint: OrionTheme.textSoft,
                            note: task.dueDate?.formatted(date: .omitted, time: .shortened))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Reading: View {
    let label: String
    let value: String
    let unit: String
    var note: String?
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(tint.opacity(0.85))
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(OrionTheme.display(26))
                    .foregroundStyle(OrionTheme.text)
                Text(unit)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }
            if let note {
                Text(note)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
    }
}

private struct DueLine: View {
    let title: String
    let tint: Color
    var note: String?

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .strokeBorder(tint.opacity(0.6), lineWidth: 1)
                .frame(width: 7, height: 7)
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.text)
                .lineLimit(1)
            if let note {
                Text(note)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(tint)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Parked

/// What the brief becomes once you have started the day: a card at the side of
/// Home, still showing the numbers, one click from opening again.
struct ParkedBriefCard: View {
    let facts: BriefFacts
    var onOpen: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 12) {
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [OrionTheme.accent.opacity(0.75), OrionTheme.accent.opacity(0.05)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 2)

                VStack(alignment: .leading, spacing: 9) {
                    Text("TODAY'S BRIEF")
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1.8)
                        .foregroundStyle(OrionTheme.textDim)

                    if let recovery = facts.readings.recovery {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text("\(recovery)")
                                .font(OrionTheme.display(26))
                                .foregroundStyle(recoveryTint(recovery))
                            Text("recovery")
                                .font(OrionTheme.mono(9))
                                .foregroundStyle(OrionTheme.textDim)
                        }
                    }
                    if let sleep = facts.readings.sleepPerformance {
                        Text("sleep \(sleep)%")
                            .font(OrionTheme.mono(10))
                            .foregroundStyle(OrionTheme.textSoft)
                    }
                    if let next = facts.nextEvent {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("NEXT · \(next.timeLabel.uppercased())")
                                .font(OrionTheme.mono(8, .semibold))
                                .tracking(1.2)
                                .foregroundStyle(OrionTheme.textDim)
                            Text(next.title)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(OrionTheme.text)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    if !facts.overdue.isEmpty {
                        Text("\(facts.overdue.count) overdue")
                            .font(OrionTheme.mono(10))
                            .foregroundStyle(OrionTheme.red)
                    }

                    Text(hovering ? "Open brief →" : "Read it")
                        .font(OrionTheme.mono(9, .semibold))
                        .foregroundStyle(OrionTheme.accent.opacity(hovering ? 1 : 0.7))
                        .padding(.top, 2)
                }
            }
            .frame(width: 168, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering)
    }
}
