//
//  The month and week views, and what a day looks like when you glance at it.
//
//  Wave 14: a day is a circle, not a cell. The notes below still hold for what
//  the colour means; the shape around it is what changed.
//
//  A day cell has to answer one question without being read: was this a good
//  day. The colour answers it at a glance and the mark out of ten answers it
//  exactly, in the corner, for when a glance is not enough.
//
//  "No score" and "a bad score" must not look similar. A scored day is tinted;
//  an unscored day with completed work gets a calmer green state; an unscored
//  past day is grey. Most days ARE scored now — Whoop carries them even when
//  nothing else happened — so grey has gone back to meaning what it says.
//
//  Everything drawn here is a fact: events, things ticked off, focus sessions,
//  deadlines. The tint is the only derived thing on screen and it refuses to
//  exist below half coverage.
//

import SwiftUI
import SessionDomain

// MARK: - One day, as a circle

/// A day as a number in a circle, with small coloured dots under it for what is on it.
///
/// Wave 14: no cell boxes. Today is a filled ring with a soft glow; the selected day keeps a thin ring; a scored
/// day carries a wash inside its circle whose weight is the score (one hue getting stronger, never a red-to-green
/// pass/fail); a day with only completed work gets a calm green wash; past days read dimmer. The dots are one per
/// kind of thing (CalendarDots), so three lectures are one violet dot, not three.
struct CalendarDayCircle: View {
    let day: Date
    let entries: [CalendarEntry]
    let score: DayScore?
    let isToday: Bool
    let isPast: Bool
    let isSelected: Bool
    var diameter: CGFloat = 34
    let onTap: () -> Void
    let onDoubleTap: () -> Void

    @State private var hovering = false

    var body: some View {
        VStack(spacing: 5) {
            ZStack {
                Circle().fill(wash)
                if isToday {
                    Circle().fill(OrionTheme.accent.opacity(0.20))
                    Circle().strokeBorder(OrionTheme.accent, lineWidth: 1.5)
                        .shadow(color: OrionTheme.accent.opacity(0.55), radius: 7)
                } else if isSelected {
                    Circle().strokeBorder(Color.white.opacity(0.55), lineWidth: 1)
                } else if hovering {
                    Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.8)
                }
                Text(CalendarViewSupport.dayNumber(day))
                    .font(.system(size: max(10, diameter * 0.36), weight: isToday ? .semibold : .regular, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(numberTint)
            }
            .frame(width: diameter, height: diameter)
            .scaleEffect(hovering ? 1.06 : 1)

            dots.frame(height: 5)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
        .onTapGesture(perform: onTap)
        .simultaneousGesture(TapGesture(count: 2).onEnded(onDoubleTap))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { onTap() }
        .accessibilityAction(named: "Open this day") { onDoubleTap() }
    }

    private var dots: some View {
        let result = CalendarDots.make(for: entries, limit: 4)
        return HStack(spacing: 3) {
            ForEach(result.shown) { entry in
                Circle().fill(entry.tint).frame(width: 4.5, height: 4.5)
                    .shadow(color: entry.tint.opacity(0.6), radius: 2)
            }
            if result.overflow > 0 {
                Circle().strokeBorder(OrionTheme.textDim, lineWidth: 0.8).frame(width: 4.5, height: 4.5)
            }
        }
    }

    /// The score as weight in one hue. Real days cluster between 5 and 9, so the visible range starts at 3.
    private var wash: Color {
        guard let value = score?.value else {
            if entries.contains(where: { if case .completed = $0.kind { return true }; return false }) {
                return OrionTheme.green.opacity(0.14)
            }
            return .clear
        }
        let spread = min(1, max(0, (value - 0.3) / 0.7))
        return OrionTheme.accent.opacity((score?.isProvisional == true ? 0.04 : 0.06) + 0.26 * spread)
    }

    private var numberTint: Color {
        if isToday { return OrionTheme.text }
        if isSelected { return OrionTheme.text }
        return isPast ? OrionTheme.textDim : OrionTheme.textSoft
    }

    private var accessibilityText: String {
        let things = entries.isEmpty ? "nothing on it" : "\(entries.count) \(entries.count == 1 ? "thing" : "things")"
        let mark = score.flatMap { $0.hasValue ? "scored \($0.displayValue) of 10" : nil }
        return [CalendarViewSupport.longDay(day), things, mark].compactMap { $0 }.joined(separator: ", ")
    }
}

// MARK: - The month

/// The month as a calm field of circles: weekday letters over seven columns, one circle per date, nothing for
/// the neighbouring months' dates. Changing month cross-fades and slides the way time moved.
struct MonthGrid: View {
    @ObservedObject var model: CalendarModel
    /// The height the column gives the month. Rows divide it; the page never sizes itself to content.
    let height: CGFloat

    @State private var shownMonth = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let weeks = model.weeks
        let rowHeight = max(40, (height - 26) / CGFloat(max(1, weeks.count)))
        let diameter = min(40, max(24, rowHeight - 16))
        let direction = MonthTravel.direction(from: shownMonth, to: model.focusDate)
        let monthKey = model.key(for: model.range.startOfMonth(containing: model.focusDate))

        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 0) {
                ForEach(Array(CalendarViewSupport.weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                    Text(symbol)
                        .font(OrionTheme.mono(9, .semibold))
                        .tracking(1.2)
                        .foregroundStyle(OrionTheme.textDim)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 20)

            ZStack(alignment: .top) {
                VStack(spacing: 0) {
                    ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                        HStack(spacing: 0) {
                            ForEach(week, id: \.self) { day in
                                if model.range.isInMonth(day, as: model.focusDate) {
                                    CalendarDayCircle(
                                        day: day,
                                        entries: model.entries(on: day),
                                        score: model.score(on: day),
                                        isToday: model.range.isSameDay(day, Date()),
                                        isPast: day < Calendar.current.startOfDay(for: Date()),
                                        isSelected: model.range.isSameDay(day, model.selectedDay),
                                        diameter: diameter,
                                        onTap: { model.select(day) },
                                        onDoubleTap: { model.showDay(day) }
                                    )
                                } else {
                                    Color.clear.frame(maxWidth: .infinity)
                                }
                            }
                        }
                        .frame(height: rowHeight)
                    }
                }
                .id(monthKey)
                .transition(.asymmetric(
                    insertion: reduceMotion ? .opacity : .opacity.combined(with: .offset(x: CGFloat(direction) * 36)),
                    removal: reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.97))))
            }
            .animation(OrionMotion.resolved(OrionMotion.page, reduceMotion: reduceMotion), value: monthKey)
        }
        .frame(height: height, alignment: .top)
        .clipped()
        .onAppear { shownMonth = model.focusDate }
        .onChange(of: model.focusDate) { _, day in shownMonth = day }
    }
}

// MARK: - The week

/// Seven columns of circles with the day's events hanging under each as rounded capsules, then the selected
/// day's list. No boxes: the columns are held apart by spacing alone.
struct WeekGrid: View {
    @ObservedObject var model: CalendarModel
    let height: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 6) {
                ForEach(Array(model.weekDays.enumerated()), id: \.element) { index, day in
                    VStack(spacing: 8) {
                        Text(CalendarViewSupport.weekdayLetter(day))
                            .font(OrionTheme.mono(9, .semibold))
                            .foregroundStyle(OrionTheme.textDim)
                        CalendarDayCircle(
                            day: day,
                            entries: [],
                            score: model.score(on: day),
                            isToday: model.range.isSameDay(day, Date()),
                            isPast: day < Calendar.current.startOfDay(for: Date()),
                            isSelected: model.range.isSameDay(day, model.selectedDay),
                            diameter: 36,
                            onTap: { model.select(day) },
                            onDoubleTap: { model.showDay(day) }
                        )
                        weekCapsules(model.entries(on: day))
                    }
                    .frame(maxWidth: .infinity, alignment: .top)
                    .orionEntrance(order: index, distance: 8)
                }
            }

            // The rest of the column belongs to the selected day, which is what makes the week view useful
            // rather than seven columns of stubs.
            CalendarDayList(model: model)
        }
    }

    private func weekCapsules(_ entries: [CalendarEntry]) -> some View {
        let limit = 4
        return VStack(spacing: 4) {
            ForEach(entries.prefix(limit)) { entry in
                Text(entry.title)
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(OrionTheme.text.opacity(0.85))
                    .lineLimit(1)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .frame(maxWidth: .infinity)
                    .background(Capsule().fill(entry.tint.opacity(0.16)))
                    .overlay(Capsule().strokeBorder(entry.tint.opacity(0.45), lineWidth: 0.7))
            }
            if entries.count > limit {
                Text("+\(entries.count - limit)")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
    }
}

// MARK: - One day, listed

struct CalendarDayList: View {
    @ObservedObject var model: CalendarModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionRule(title: CalendarViewSupport.longDay(model.selectedDay),
                        trailing: model.score(on: model.selectedDay)
                            .map { $0.hasValue ? "\($0.displayValue) / 10" : "not scored" })

            let entries = model.entries(on: model.selectedDay)
            if entries.isEmpty {
                Text(model.disclosures.isEmpty
                     ? "Nothing recorded for this day."
                     : "Nothing to show yet.")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textDim)
            }

            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                HStack(spacing: 10) {
                    Circle().fill(entry.tint).frame(width: 7, height: 7)
                        .shadow(color: entry.tint.opacity(0.6), radius: 3)
                    Text(entry.title)
                        .font(.system(size: 12))
                        .foregroundStyle(OrionTheme.text)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(CalendarViewSupport.describe(entry))
                        .font(OrionTheme.mono(9.5))
                        .foregroundStyle(OrionTheme.textDim)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Capsule().fill(entry.tint.opacity(0.05)))
                .overlay(Capsule().strokeBorder(entry.tint.opacity(0.2), lineWidth: 0.7))
                .orionEntrance(order: index, distance: 6)
            }

            // Why a day has no score, when it does not. Silence here would look like the feature being broken.
            if let score = model.score(on: model.selectedDay), !score.hasValue,
               let why = score.insufficient {
                Text(why)
                    .font(.system(size: 10))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .id(model.key(for: model.selectedDay))
    }
}

// MARK: - Shared bits

enum CalendarViewSupport {

    static func dayNumber(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: day)
    }

    static var weekdaySymbols: [String] {
        let formatter = DateFormatter()
        let symbols = formatter.veryShortWeekdaySymbols ?? ["S", "M", "T", "W", "T", "F", "S"]
        let first = Calendar.current.firstWeekday - 1
        return Array(symbols[first...] + symbols[..<first])
    }

    static func weekdayLetter(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEEE"
        return formatter.string(from: day)
    }

    static func longDay(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = Calendar.current.isDateInToday(day) ? "'today' — EEEE d MMM" : "EEEE d MMM"
        return formatter.string(from: day)
    }

    static func describe(_ entry: CalendarEntry) -> String {
        switch entry.kind {
        case .event:
            guard !entry.isAllDay else { return "all day" }
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm"
            return formatter.string(from: entry.start)
        case .completed: return "done"
        case .deadline(let overdue): return overdue ? "overdue" : "due"
        case .focus(let minutes, let reason):
            return reason == .abandoned ? "focus \(minutes)m, abandoned" : "focus \(minutes)m"
        }
    }
}
