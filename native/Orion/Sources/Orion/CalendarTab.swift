//
//  The month, the week, the day.
//
//  No ScrollView. The dashboard already provides one, and a second on the same
//  axis is proposed an unbounded height, grows to its content, and silently
//  stops scrolling. A month grid is a fixed number of rows, so it does not need
//  one; the day view defers to the existing DayTimeline, which owns its own
//  bounded viewport.
//

import SwiftUI
import SessionDomain

struct CalendarTab: View {

    @ObservedObject var model: CalendarModel
    let availableHeight: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            controls

            if !model.disclosures.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(model.disclosures, id: \.self) { line in
                        Text(line)
                            .font(.system(size: 12))
                            .foregroundStyle(OrionTheme.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            switch model.granularity {
            case .month: monthGrid
            case .week:  weekStrip
            case .day:   dayList
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Controls

    private var controls: some View {
        HStack(spacing: 16) {
            Text(title)
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(OrionTheme.text)

            Spacer()

            ForEach(CalendarGranularity.allCases, id: \.self) { option in
                InlineAction(
                    title: option.title,
                    tint: option == model.granularity ? OrionTheme.accent : OrionTheme.textDim
                ) { model.show(option) }
            }

            InlineAction(title: "‹", tint: OrionTheme.textSoft) { model.step(-1) }
            InlineAction(title: "Today", tint: OrionTheme.textSoft) { model.goToToday() }
            InlineAction(title: "›", tint: OrionTheme.textSoft) { model.step(1) }
        }
    }

    private var title: String {
        let formatter = DateFormatter()
        switch model.granularity {
        case .month: formatter.dateFormat = "MMMM yyyy"
        case .week:  formatter.dateFormat = "'Week of' d MMMM"
        case .day:   formatter.dateFormat = "EEEE d MMMM"
        }
        return formatter.string(from: model.focusDate)
    }

    // MARK: Month

    private var monthGrid: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(weekdaySymbols, id: \.self) { symbol in
                    Text(symbol)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(OrionTheme.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            // A definite height per row, divided from what the dashboard gave
            // us. Without it the grid sizes to its content and the page grows a
            // scrollbar for a thing that is meant to fit.
            let rows = max(1, model.weeks.count)
            let rowHeight = max(72, (availableHeight - 160) / CGFloat(rows))

            ForEach(Array(model.weeks.enumerated()), id: \.offset) { _, week in
                HStack(spacing: 6) {
                    ForEach(week, id: \.self) { day in
                        dayCell(day, height: rowHeight)
                    }
                }
            }
        }
    }

    private func dayCell(_ day: Date, height: CGFloat) -> some View {
        let entries = model.entries(on: day)
        let inMonth = model.range.isInMonth(day, as: model.focusDate)
        let isToday = model.range.isSameDay(day, Date())

        return VStack(alignment: .leading, spacing: 3) {
            Text(dayNumber(day))
                .font(.system(size: 12, weight: isToday ? .bold : .regular))
                .foregroundStyle(isToday ? OrionTheme.accent
                                 : (inMonth ? OrionTheme.textSoft : OrionTheme.textDim))

            ForEach(entries.prefix(3)) { entry in
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

            if entries.count > 3 {
                Text("+\(entries.count - 3)")
                    .font(.system(size: 9))
                    .foregroundStyle(OrionTheme.textDim)
            }

            Spacer(minLength: 0)
        }
        .padding(6)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(inMonth ? OrionTheme.card : Color.clear)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            model.focus(on: day)
            model.show(.day)
        }
    }

    // MARK: Week

    private var weekStrip: some View {
        HStack(spacing: 6) {
            ForEach(model.range.monthGrid(containing: model.focusDate)
                .first(where: { week in
                    week.contains { model.range.isSameDay($0, model.focusDate) }
                }) ?? [], id: \.self) { day in
                dayCell(day, height: max(160, availableHeight - 200))
            }
        }
    }

    // MARK: Day

    private var dayList: some View {
        VStack(alignment: .leading, spacing: 10) {
            let entries = model.entries(on: model.focusDate)
            if entries.isEmpty {
                Text(model.disclosures.isEmpty
                     ? "Nothing recorded for this day."
                     : "Nothing to show — see above for why.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textDim)
            }
            ForEach(entries) { entry in
                DataRow(label: entry.title, sublabel: describe(entry), value: time(entry))
            }
        }
    }

    private func describe(_ entry: CalendarEntry) -> String {
        switch entry.kind {
        case .event: return "event"
        case .completed: return "completed"
        case .deadline(let overdue): return overdue ? "overdue" : "due"
        case .focus(let minutes, let reason): return "focus — \(minutes)m, \(reason.rawValue)"
        }
    }

    private func time(_ entry: CalendarEntry) -> String {
        guard !entry.isAllDay else { return "all day" }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: entry.start)
    }

    private func dayNumber(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: day)
    }

    private var weekdaySymbols: [String] {
        let formatter = DateFormatter()
        let symbols = formatter.shortWeekdaySymbols ?? ["S","M","T","W","T","F","S"]
        let first = Calendar.current.firstWeekday - 1
        return Array(symbols[first...] + symbols[..<first])
    }
}
