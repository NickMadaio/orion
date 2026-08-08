import SwiftUI

/*
 The day, as time rather than as a list.

 A list of events tells you what is happening. A timeline tells you what is
 NOT — the two free hours between lunch and the lecture are the whole reason to
 draw hours at all, and they are invisible in a list. That gap is what a
 scheduling app is actually for.

 Three things make it read correctly:

   • Every hour is the same height, including empty ones. Collapsing empty
     hours to save space destroys the only thing the layout is communicating.
   • The now-line moves. It is the anchor for "where am I in this", and it
     ticks on its own rather than only when something else redraws.
   • Overlapping events sit side by side rather than on top of each other.
     Two meetings booked at once is a fact worth seeing, not a rendering bug.
*/

struct DayTimeline: View {
    let date: Date
    let events: [AgendaEvent]
    /// Tapping an empty hour offers to fill it.
    var onCreate: (Date) -> Void
    var onSelect: (AgendaEvent) -> Void

    /// The window drawn. Not midnight-to-midnight: fourteen empty hours of
    /// night push the part of the day you actually use off the screen.
    private let firstHour = 6
    private let lastHour = 23
    private let hourHeight: CGFloat = 52
    private let gutter: CGFloat = 54

    @State private var now = Date()
    private let tick = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    private var calendar: Calendar { Calendar.current }
    private var hours: [Int] { Array(firstHour...lastHour) }
    private var timed: [AgendaEvent] { events.filter { !$0.isAllDay } }
    private var allDay: [AgendaEvent] { events.filter(\.isAllDay) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if !allDay.isEmpty { allDayRow }

            ScrollViewReader { proxy in
                ScrollView {
                    ZStack(alignment: .topLeading) {
                        grid
                        blocks
                        if isToday { nowLine }
                        // Anchor for the initial scroll — see below.
                        Color.clear
                            .frame(height: 1)
                            .offset(y: offset(for: max(now, startOfWindow).addingTimeInterval(-3600)))
                            .id("now")
                    }
                    .frame(height: CGFloat(hours.count) * hourHeight + 8)
                }
                .onAppear {
                    // Open on the current hour rather than at 6am. The first
                    // thing you want is where you are, not where the day began.
                    guard isToday else { return }
                    DispatchQueue.main.async {
                        withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("now", anchor: .top) }
                    }
                }
            }
        }
        .onReceive(tick) { now = $0 }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(date.formatted(.dateTime.weekday(.wide)))
                .font(OrionTheme.display(22))
                .foregroundStyle(OrionTheme.text)
            Text(date.formatted(.dateTime.month(.wide).day()).uppercased())
                .font(OrionTheme.mono(9, .semibold))
                .tracking(1.8)
                .foregroundStyle(OrionTheme.textDim)
            Spacer(minLength: 8)
            Text(summary)
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textSoft)
        }
    }

    /// What the day costs, which is the number a schedule is for.
    private var summary: String {
        let minutes = timed.reduce(0) { $0 + $1.durationMinutes }
        guard minutes > 0 else { return "nothing booked" }
        let free = max(0, (lastHour - firstHour) * 60 - minutes)
        return "\(minutes / 60)h \(minutes % 60)m booked · \(free / 60)h free"
    }

    private var allDayRow: some View {
        HStack(spacing: 8) {
            Text("ALL DAY")
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.4)
                .foregroundStyle(OrionTheme.textDim)
                .frame(width: gutter - 12, alignment: .trailing)
            ForEach(allDay) { event in
                let tint = OrionTheme.color(hex: event.colorHex)
                Text(event.title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(OrionTheme.text)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        Capsule().fill(tint.opacity(0.32))
                            .overlay(Capsule().strokeBorder(tint.opacity(0.6), lineWidth: 1))
                    )
                    .contentShape(Capsule())
                    .onTapGesture { onSelect(event) }
                    .help("\(event.title) — click to edit")
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: - Grid

    private var grid: some View {
        VStack(spacing: 0) {
            ForEach(hours, id: \.self) { hour in
                HStack(alignment: .top, spacing: 0) {
                    Text(label(for: hour))
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textDim)
                        .frame(width: gutter - 12, alignment: .trailing)
                        .offset(y: -5)
                    Rectangle()
                        .fill(OrionTheme.line)
                        .frame(height: 1)
                        .padding(.leading, 12)
                }
                .frame(height: hourHeight, alignment: .top)
                .contentShape(Rectangle())
                // An empty hour is an offer, not decoration.
                .onTapGesture { onCreate(dateFor(hour: hour)) }
            }
        }
    }

    private func label(for hour: Int) -> String {
        let display = hour % 12 == 0 ? 12 : hour % 12
        return "\(display) \(hour < 12 ? "AM" : "PM")"
    }

    // MARK: - Blocks

    private var blocks: some View {
        GeometryReader { geometry in
            let lanes = DayTimeline.lanes(for: timed)
            let width = max(60, geometry.size.width - gutter - 10)
            ForEach(timed) { event in
                let lane = lanes[event.id] ?? (0, 1)
                let laneWidth = width / CGFloat(lane.total)
                let blockHeight = max(20, height(for: event))
                EventBlock(event: event, isNow: event.isNow, height: blockHeight)
                    .frame(width: max(40, laneWidth - 4), height: blockHeight)
                    .offset(x: gutter + CGFloat(lane.index) * laneWidth,
                            y: offset(for: event.start))
                    .onTapGesture { onSelect(event) }
            }
        }
    }

    private var startOfWindow: Date {
        calendar.date(bySettingHour: firstHour, minute: 0, second: 0, of: date) ?? date
    }

    private func dateFor(hour: Int) -> Date {
        calendar.date(bySettingHour: hour, minute: 0, second: 0, of: date) ?? date
    }

    /// Points from the top of the window. Clamped, so an event that began
    /// yesterday renders at the top rather than off-screen above it.
    private func offset(for moment: Date) -> CGFloat {
        let minutes = moment.timeIntervalSince(startOfWindow) / 60
        let maximum = CGFloat(hours.count) * hourHeight
        return min(maximum, max(0, CGFloat(minutes) / 60 * hourHeight))
    }

    private func height(for event: AgendaEvent) -> CGFloat {
        let top = offset(for: event.start)
        let bottom = offset(for: event.end)
        return max(20, bottom - top)
    }

    private var isToday: Bool { calendar.isDateInToday(date) }

    private var nowLine: some View {
        HStack(spacing: 0) {
            Circle()
                .fill(OrionTheme.red)
                .frame(width: 7, height: 7)
                .shadow(color: OrionTheme.red.opacity(0.9), radius: 4)
            Rectangle()
                .fill(OrionTheme.red.opacity(0.75))
                .frame(height: 1)
        }
        .padding(.leading, gutter - 3)
        .offset(y: offset(for: now))
        .allowsHitTesting(false)
    }

    // MARK: - Overlap

    /// Which column each event sits in, so two things booked at once are drawn
    /// beside each other instead of one hiding the other.
    ///
    /// A simple sweep: events are laid out in start order, and each one takes
    /// the first column whose previous occupant has already ended. The total is
    /// shared across an overlapping cluster so the columns line up.
    static func lanes(for events: [AgendaEvent]) -> [String: (index: Int, total: Int)] {
        let sorted = events.sorted { $0.start < $1.start }
        var result: [String: (index: Int, total: Int)] = [:]
        var cluster: [AgendaEvent] = []
        var clusterEnd: Date?

        func flush() {
            guard !cluster.isEmpty else { return }
            var columnEnds: [Date] = []
            var assigned: [String: Int] = [:]
            for event in cluster {
                if let free = columnEnds.firstIndex(where: { $0 <= event.start }) {
                    columnEnds[free] = event.end
                    assigned[event.id] = free
                } else {
                    columnEnds.append(event.end)
                    assigned[event.id] = columnEnds.count - 1
                }
            }
            for event in cluster {
                result[event.id] = (assigned[event.id] ?? 0, max(1, columnEnds.count))
            }
            cluster = []
            clusterEnd = nil
        }

        for event in sorted {
            if let end = clusterEnd, event.start >= end { flush() }
            cluster.append(event)
            clusterEnd = max(clusterEnd ?? event.end, event.end)
        }
        flush()
        return result
    }
}

/// An event, made to read at a glance.
///
/// The previous version was a 15%-opacity wash of one hard-coded blue for every
/// event on every calendar, with a title and nothing else. Three changes:
///
///   • THE CALENDAR'S OWN COLOUR. `colorHex` was being fetched as a literal nil
///     and then used to pick a tint, so every block looked identical no matter
///     which calendar it came from. Colour is how you know what a thing IS
///     before you read its name.
///   • ENOUGH FILL TO BE A BLOCK. A wash that faint over a translucent window
///     reads as a smudge. It is a solid-enough shape with a saturated edge bar,
///     which is what makes the day scannable.
///   • DETAIL BY HEIGHT. A 15-minute block has room for a title; a two-hour one
///     has room for the time range and the calendar. Rendering the same three
///     lines in both means the short one clips and the tall one looks empty.
private struct EventBlock: View {
    let event: AgendaEvent
    let isNow: Bool
    /// Drives how much is shown. Not a style choice — it is what stops a short
    /// event from clipping its own title.
    let height: CGFloat

    @State private var hovering = false

    private var tint: Color { OrionTheme.color(hex: event.colorHex) }
    private var showsTime: Bool { height >= 34 }
    private var showsCalendar: Bool { height >= 58 }

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(tint)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(event.isPast ? OrionTheme.textSoft : OrionTheme.text)
                    .strikethrough(false)
                    .lineLimit(showsCalendar ? 2 : 1)
                    .multilineTextAlignment(.leading)

                if showsTime {
                    Text(event.start.formatted(date: .omitted, time: .shortened)
                         + " – " + event.end.formatted(date: .omitted, time: .shortened))
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textSoft)
                }
                if showsCalendar {
                    HStack(spacing: 5) {
                        Text(event.calendarName)
                            .font(OrionTheme.mono(9))
                            .foregroundStyle(OrionTheme.textDim)
                            .lineLimit(1)
                        if event.hasAttendees {
                            Image(systemName: "person.2.fill")
                                .font(.system(size: 7))
                                .foregroundStyle(OrionTheme.textDim)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(tint.opacity(fill))
                .overlay {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(tint.opacity(isNow ? 0.95 : 0.55), lineWidth: isNow ? 1.5 : 1)
                }
                .shadow(color: .black.opacity(0.35), radius: hovering ? 8 : 4, y: 2)
        }
        // Past events fade rather than vanish: what you already did is context
        // for what is left, and greying it out entirely loses the shape of the
        // day behind you.
        .opacity(event.isPast ? 0.55 : 1)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: hovering)
        .help(event.isReadOnly ? "\(event.title) — read-only calendar" : "\(event.title) — click to edit")
    }

    private var fill: Double {
        if hovering { return 0.46 }
        return isNow ? 0.42 : 0.30
    }
}
