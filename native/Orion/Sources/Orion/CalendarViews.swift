//
//  The month and week grids, and what a day looks like when you glance at it.
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

// MARK: - One day

struct CalendarDayCell: View {
    let day: Date
    let entries: [CalendarEntry]
    let score: DayScore?
    let inMonth: Bool
    let isToday: Bool
    let isPast: Bool
    let isSelected: Bool
    let height: CGFloat
    let compact: Bool
    let onTap: () -> Void
    let onDoubleTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            // The date and the mark, and nothing else on this line.
            //
            // The tick count and the focus minutes used to share this row, and
            // adding the score to it squeezed them: three small things and a
            // number in 40 points of width means the first thing to go is the
            // tick, which is the thing worth seeing most. They get their own
            // line below, where they cannot be crowded out.
            HStack(spacing: 4) {
                Text(Self.dayNumber(day))
                    .font(.system(size: compact ? 11 : 12,
                                  weight: isToday ? .bold : .regular))
                    .foregroundStyle(numberTint)

                Spacer(minLength: 0)

                // The mark out of ten. Trailing, because the day number is the
                // thing you scan for and this is the thing you land on.
                //
                // A provisional score — one standing on a minority of the day's
                // inputs, typically the watch alone — is drawn lighter rather
                // than hidden or asterisked. It is still true, it just knows
                // less, and dimming says that without a legend.
                if let score, score.hasValue {
                    Text(score.displayValue)
                        .font(.system(size: compact ? 9 : 10, weight: .semibold,
                                      design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(OrionTheme.accent.opacity(score.isProvisional ? 0.55 : 0.95))
                }
            }

            if completedCount != nil || (focusMinutes ?? 0) > 0 {
                HStack(spacing: 4) {
                    if let count = completedCount, count > 0 {
                        // The tick is the thing he was looking for and could not
                        // find. Shown as a count, because "three things done"
                        // and "one thing done" are different days.
                        Label("\(count)", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(OrionTheme.green)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(OrionTheme.green.opacity(0.18)))
                    }

                    if let focusMinutes, focusMinutes > 0 {
                        Text("\(focusMinutes)m")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(OrionTheme.accent)
                    }

                    Spacer(minLength: 0)
                }
                .fixedSize(horizontal: false, vertical: true)
            }

            if !compact {
                ForEach(entries.prefix(entryLimit)) { entry in
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 1, style: .continuous)
                            .fill(entry.tint)
                            .frame(width: 2, height: 9)
                        Text(entry.title)
                            .font(.system(size: 10))
                            .foregroundStyle(OrionTheme.textSoft)
                            .lineLimit(1)
                    }
                }
                if entries.count > entryLimit {
                    Text("+\(entries.count - entryLimit)")
                        .font(.system(size: 9))
                        .foregroundStyle(OrionTheme.textDim)
                }
            } else if !entries.isEmpty {
                // Compact cells get dots rather than titles — enough to say
                // "something happened" without pretending to be readable.
                HStack(spacing: 2) {
                    ForEach(entries.prefix(4)) { entry in
                        Circle().fill(entry.tint).frame(width: 3, height: 3)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(compact ? 4 : 6)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .topLeading)
        .background(background)
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(isSelected ? OrionTheme.accent.opacity(0.7) : .clear, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .simultaneousGesture(
            TapGesture(count: 2).onEnded(onDoubleTap)
        )
    }

    // MARK: What the colour means

    /// Tinted by the score, recorded completed work, or the simple fact that
    /// the date is already behind us. The past-date state is intentionally
    /// neutral: it communicates time passing, not performance.
    ///
    /// Completion is a recorded fact, unlike a missing score. It earns a calm
    /// state without implying that the day was good or bad overall.
    private var background: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(fill)
    }

    private var fill: Color {
        guard inMonth else { return .clear }
        guard let value = score?.value else {
            if completedCount != nil { return OrionTheme.green.opacity(0.24) }
            return isPast ? OrionTheme.textSoft.opacity(0.13) : OrionTheme.card
        }
        // One hue, varying weight. A red-to-green ramp reads as pass/fail and
        // invites arguing with the number; a single accent that gets stronger
        // reads as "more", which is what it actually measures.
        //
        // The ramp is not linear in the score. Real days cluster between 5 and
        // 9, and a linear opacity turns that whole range into four barely
        // distinguishable washes — the grid looked flat even once every day had
        // a number. Anchoring the bottom of the visible range at 3 and spending
        // the opacity across what is left is what makes a 6 and an 8 read as
        // different days from across the room.
        let spread = min(1, max(0, (value - 0.3) / 0.7))
        return OrionTheme.accent.opacity(0.08 + 0.42 * spread)
    }

    private var numberTint: Color {
        if isToday { return OrionTheme.accent }
        guard inMonth else { return OrionTheme.textDim }
        return OrionTheme.textSoft
    }

    /// How many entry titles fit, given whether the tick row is taking a line.
    private var entryLimit: Int {
        let base = height > 90 ? 3 : 2
        let hasMetaRow = completedCount != nil || (focusMinutes ?? 0) > 0
        return max(1, hasMetaRow ? base - 1 : base)
    }

    private var completedCount: Int? {
        let done = entries.filter { if case .completed = $0.kind { return true }; return false }
        return done.isEmpty ? nil : done.count
    }

    private var focusMinutes: Int? {
        let minutes = entries.compactMap { entry -> Int? in
            if case .focus(let minutes, _) = entry.kind { return minutes }
            return nil
        }
        guard !minutes.isEmpty else { return nil }
        return minutes.reduce(0, +)
    }

    static func dayNumber(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: day)
    }
}

// MARK: - The month

struct MonthGrid: View {
    @ObservedObject var model: CalendarModel
    let height: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                ForEach(Array(CalendarViewSupport.weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                    Text(symbol)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(OrionTheme.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            let weeks = model.weeks
            // A definite row height, divided from what the tab was actually
            // given. Sizing to content is what makes the page grow a scrollbar
            // for something meant to fit.
            let rowHeight = max(58, (height - 40) / CGFloat(max(1, weeks.count)))

            ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                HStack(spacing: 5) {
                    ForEach(week, id: \.self) { day in
                        // Month pages are about this month. Neighbouring-month
                        // dates used to crowd the last row with a misleading
                        // preview; keep their place in the seven-column grid,
                        // but leave those cells intentionally blank.
                        if model.range.isInMonth(day, as: model.focusDate) {
                            CalendarDayCell(
                                day: day,
                                entries: model.entries(on: day),
                                score: model.score(on: day),
                                inMonth: true,
                                isToday: model.range.isSameDay(day, Date()),
                                isPast: day < Calendar.current.startOfDay(for: Date()),
                                isSelected: model.range.isSameDay(day, model.selectedDay),
                                height: rowHeight,
                                compact: rowHeight < 74,
                                onTap: { model.select(day) },
                                onDoubleTap: { model.showDay(day) }
                            )
                        } else {
                            Color.clear
                                .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - The week

/// Deliberately smaller than the month's cells were.
///
/// The first version gave each day the whole remaining height, which made a
/// week of mostly-empty days into a wall. A week is a row you scan, not seven
/// pages.
struct WeekGrid: View {
    @ObservedObject var model: CalendarModel
    let height: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                ForEach(model.weekDays, id: \.self) { day in
                    VStack(spacing: 3) {
                        Text(CalendarViewSupport.weekdayLetter(day))
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(OrionTheme.textDim)

                        CalendarDayCell(
                            day: day,
                            entries: model.entries(on: day),
                            score: model.score(on: day),
                            inMonth: true,
                            isToday: model.range.isSameDay(day, Date()),
                            isPast: day < Calendar.current.startOfDay(for: Date()),
                            isSelected: model.range.isSameDay(day, model.selectedDay),
                            height: min(150, max(96, height * 0.34)),
                            compact: false,
                            onTap: { model.select(day) },
                            onDoubleTap: { model.showDay(day) }
                        )
                    }
                }
            }

            // The rest of the column belongs to the selected day, which is what
            // makes the week view useful rather than seven columns of stubs.
            CalendarDayList(model: model)
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
                     : "Nothing to show — see the notice above.")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textDim)
            }

            ForEach(entries) { entry in
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 1, style: .continuous)
                        .fill(entry.tint)
                        .frame(width: 2, height: 14)
                    Text(entry.title)
                        .font(.system(size: 12))
                        .foregroundStyle(OrionTheme.text)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(CalendarViewSupport.describe(entry))
                        .font(.system(size: 10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }

            // Why a day has no score, when it does not. Silence here would look
            // like the feature being broken.
            if let score = model.score(on: model.selectedDay), !score.hasValue,
               let why = score.insufficient {
                Text(why)
                    .font(.system(size: 10))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
    }
}

// MARK: - Shared bits

enum CalendarViewSupport {

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
