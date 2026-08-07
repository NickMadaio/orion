import SwiftUI

/// The week, above the day.
///
/// Seven cells, each carrying a density mark rather than a count — the question
/// a week strip answers is "which day is heavy", and a number makes you read
/// where a bar makes you see. Today is ringed, the selected day is filled, and
/// they are deliberately different marks so "today" never disappears just
/// because you are looking at Thursday.
struct WeekStrip: View {
    let days: [Date]
    @Binding var selected: Date
    /// 0...1 busy-ness per day.
    let load: (Date) -> Double
    var onToday: () -> Void

    private var calendar: Calendar { Calendar.current }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(monthLabel.uppercased())
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(2.2)
                    .foregroundStyle(OrionTheme.textDim)
                FadingRule()
                if !calendar.isDateInToday(selected) {
                    InlineAction(title: "Today", action: onToday)
                }
            }

            HStack(spacing: 6) {
                ForEach(days, id: \.timeIntervalSince1970) { day in
                    DayCell(
                        date: day,
                        isSelected: calendar.isDate(day, inSameDayAs: selected),
                        isToday: calendar.isDateInToday(day),
                        load: load(day)
                    ) {
                        withAnimation(.easeOut(duration: 0.18)) { selected = day }
                    }
                }
            }
        }
    }

    private var monthLabel: String {
        guard let first = days.first, let last = days.last else { return "" }
        if calendar.isDate(first, equalTo: last, toGranularity: .month) {
            return first.formatted(.dateTime.month(.wide).year())
        }
        return first.formatted(.dateTime.month(.abbreviated))
            + " – " + last.formatted(.dateTime.month(.abbreviated).year())
    }
}

private struct DayCell: View {
    let date: Date
    let isSelected: Bool
    let isToday: Bool
    let load: Double
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Text(date.formatted(.dateTime.weekday(.narrow)).uppercased())
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.2)
                    .foregroundStyle(isSelected ? OrionTheme.accent : OrionTheme.textDim)

                Text("\(Calendar.current.component(.day, from: date))")
                    .font(OrionTheme.display(16))
                    .foregroundStyle(numberTint)

                // Density, not a count. A short bar is a light day.
                Capsule()
                    .fill(load > 0 ? OrionTheme.accent.opacity(0.35 + load * 0.55) : Color.white.opacity(0.08))
                    .frame(width: 16 + CGFloat(load) * 12, height: 2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(isSelected ? OrionTheme.accent.opacity(0.10) : (hovering ? Color.white.opacity(0.04) : .clear))
            }
            .overlay {
                // Today keeps its own mark even when another day is selected.
                if isToday {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(OrionTheme.accent.opacity(isSelected ? 0.7 : 0.35), lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: hovering)
    }

    private var numberTint: Color {
        if isSelected { return OrionTheme.text }
        if isToday { return OrionTheme.accent }
        return OrionTheme.textSoft
    }
}
