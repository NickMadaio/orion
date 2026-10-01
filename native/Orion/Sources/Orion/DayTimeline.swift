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
    /// Wake (the ORION alarm) and "asleep by" for this day; wind-down ends on the second.
    var night: NightMarkers? = nil

    /// The whole day, midnight to midnight.
    ///
    /// This used to start at 6am, on the reasoning that fourteen empty night
    /// hours push the useful part of the day off screen. That reasoning was
    /// sound and the fix was in the wrong place: `offset(for:)` CLAMPS, so a
    /// 2am event did not scroll off, it was drawn on top of the 6 AM row. The
    /// day was not shortened, it was falsified. Now every hour exists and the
    /// view opens on the current one instead, which solves the original
    /// complaint without lying about the night.
    private let firstHour = 0
    private let lastHour = 23
    private let hourHeight: CGFloat = 52
    private let gutter: CGFloat = 54

    /// Only the waking window counts as "free" in the header. Drawing midnight
    /// to midnight must not turn eight hours of sleep into eight hours of
    /// availability.
    private let wakingStart = 6
    private let wakingEnd = 23

    @State private var now = Date()
    /// Owned across renders: a timer stored on this struct was re-created every
    /// second by the dashboard's re-render and never fired (see ProjectRefresh.swift).
    @StateObject private var clock = RefreshTicker(interval: 30)

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
                        if let asleep = night?.fellAsleep { marker(at: asleep, label: "Fell asleep", systemImage: "bed.double.fill", tint: OrionTheme.violet.opacity(0.7)) }
                        if let wake = night?.wake { marker(at: wake, label: night?.woke == true ? "Woke" : "Wake", systemImage: "sunrise.fill", tint: OrionTheme.orange) }
                        if let bed = night?.bed { marker(at: bed, label: "Asleep by", systemImage: "moon.zzz.fill", tint: OrionTheme.violet) }
                        if isToday { nowLine }
                    }
                    .frame(height: CGFloat(hours.count) * hourHeight + 8)
                }
                // Anchoring happens against the hour rows themselves — they are
                // the only things here with a real layout position. See the note
                // on `scrollToAnchor`.
                .onAppear { scrollToAnchor(proxy, animated: false) }
                .onChange(of: date) { _, _ in scrollToAnchor(proxy, animated: true) }
            }
            // The whole point. Without a definite height this ScrollView is
            // proposed the unbounded height of the dashboard's own ScrollView,
            // sizes itself to its full 24-hour content, and so has no viewport
            // to scroll WITHIN — every wheel event falls through to the page
            // behind it. Taking the remaining height of the column gives it a
            // viewport smaller than its content, which is what makes it a
            // scroll view rather than a tall picture of one.
            .frame(maxHeight: .infinity)
        }
        .onChange(of: clock.tick) { _, _ in now = Date() }
    }

    // MARK: - Opening position

    /// Where the timeline should be looking when it appears.
    ///
    /// Today: an hour before now, so the current hour has context above it
    /// rather than being jammed against the top edge. Any other day: an hour
    /// before its first event. A day with nothing on it opens at the start of
    /// the waking window, because midnight is never the useful answer.
    private var anchorHour: Int {
        DayTimeline.anchorHour(
            hourOfInterest: isToday
                ? calendar.component(.hour, from: now)
                : timed.min(by: { $0.start < $1.start }).map { calendar.component(.hour, from: $0.start) },
            fallback: wakingStart,
            bounds: firstHour...lastHour
        )
    }

    /// Pulled out as a pure function so it can be checked without a window —
    /// see Tests/LayoutHarness. The "opens on the current hour" promise is the
    /// half of this fix that a height measurement cannot see.
    ///
    /// One hour earlier than the hour of interest, so that hour has context
    /// above it instead of being jammed against the top edge.
    static func anchorHour(hourOfInterest: Int?, fallback: Int, bounds: ClosedRange<Int>) -> Int {
        let target = (hourOfInterest ?? fallback) - 1
        return min(bounds.upperBound, max(bounds.lowerBound, target))
    }

    /// Scroll to an HOUR ROW, never to a positioned spacer.
    ///
    /// The previous version put its `.id("now")` on a `Color.clear` pushed down
    /// the day with `.offset(y:)`. `offset` is a render-time transform: it moves
    /// the pixels and leaves the view's layout position alone. In a ZStack
    /// aligned `.topLeading` that anchor's layout position is y=0 for every hour
    /// of the day, so `scrollTo` faithfully scrolled to the top of the window
    /// and looked like it was doing nothing at all. The hour rows are laid out
    /// by a VStack and are therefore where they appear to be.
    private func scrollToAnchor(_ proxy: ScrollViewProxy, animated: Bool) {
        // A hop to the next runloop pass: on first appearance the rows do not
        // have their final geometry yet and the scroll lands short.
        DispatchQueue.main.async {
            guard animated else {
                proxy.scrollTo(hourID(anchorHour), anchor: .top)
                return
            }
            withAnimation(.easeOut(duration: 0.25)) {
                proxy.scrollTo(hourID(anchorHour), anchor: .top)
            }
        }
    }

    private func hourID(_ hour: Int) -> String { "hour-\(hour)" }

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
        let free = max(0, (wakingEnd - wakingStart) * 60 - minutes)
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
                // The scroll target. On the row rather than on a spacer so that
                // ScrollViewReader is aiming at something with a real position.
                .id(hourID(hour))
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
        // True size, never taller than the event: a 20-pt floor drew a 15-minute
        // break over the next block (2026-10-01: "lunch goes into my break which
        // goes into my lab"). Short events get a compact label instead (EventBlock).
        return max(4, bottom - top - 1)
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

    /// A thin line across the day with a small label: when the alarm goes, and
    /// when he should be asleep. Quieter than the now-line; it is a boundary,
    /// not an event, so it never takes a click.
    private func marker(at moment: Date, label: String, systemImage: String, tint: Color) -> some View {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return HStack(spacing: 6) {
            Rectangle()
                .fill(tint.opacity(0.7))
                .frame(height: 1)
                .overlay(Rectangle().stroke(tint.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
            Label("\(label) \(formatter.string(from: moment))", systemImage: systemImage)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(tint)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(OrionTheme.ink.opacity(0.85), in: Capsule())
                .fixedSize()
        }
        .padding(.leading, gutter)
        .padding(.trailing, 6)
        .offset(y: offset(for: min(moment, calendar.startOfDay(for: date).addingTimeInterval(24 * 3600 - 60))) - 8)
        .allowsHitTesting(false)
        .accessibilityLabel("\(label) \(formatter.string(from: moment))")
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
                    .font(.system(size: height < 20 ? 9.5 : 11.5, weight: .semibold))
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
        .padding(.vertical, height < 20 ? 1 : 5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Nothing drawn outside the event's own time.
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
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
