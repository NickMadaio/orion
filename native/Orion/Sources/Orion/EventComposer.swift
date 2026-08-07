import EventKit
import SwiftUI

/// Making an event, in as few decisions as possible.
///
/// The slow part of every calendar UI is the end time, and it is slow because
/// it is asked as an absolute when people think in durations. Nobody schedules
/// a thing "until 3:45"; they schedule it "for 45 minutes". So duration is the
/// control and the end time is derived — shown, never typed.
///
/// Opened from an empty hour in the timeline, it arrives already knowing when.
/// That is most of the work done before the sheet appears.
struct EventComposer: View {
    @ObservedObject var agenda: AppleCalendarSync
    /// Pre-filled from wherever it was opened.
    let start: Date
    /// Set when scheduling an existing task, so the title is already right.
    var prefilledTitle: String = ""
    var onClose: () -> Void

    @State private var title: String = ""
    @State private var minutes: Int = 60
    @State private var isAllDay = false
    @State private var startDate: Date = Date()
    @State private var calendarID: String = ""
    @FocusState private var titleFocused: Bool

    private let durations = [15, 30, 45, 60, 90, 120]

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            header
            titleField
            if !isAllDay { timing }
            options
            actions
        }
        .padding(30)
        .frame(width: 460)
        .background(OrionTheme.ink)
        .onAppear {
            title = prefilledTitle
            startDate = start
            calendarID = agenda.defaultCalendar?.calendarIdentifier ?? ""
            titleFocused = true
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NEW EVENT")
                .font(OrionTheme.mono(9, .semibold))
                .tracking(2.4)
                .foregroundStyle(OrionTheme.textDim)
            Text(endsAt)
                .font(OrionTheme.display(22))
                .foregroundStyle(OrionTheme.text)
        }
    }

    /// The whole point of the duration control: this line changes as you pick,
    /// so the end time is confirmed rather than calculated in your head.
    private var endsAt: String {
        if isAllDay { return startDate.formatted(.dateTime.weekday(.wide).month().day()) }
        let end = startDate.addingTimeInterval(TimeInterval(minutes * 60))
        return startDate.formatted(date: .omitted, time: .shortened)
            + " – " + end.formatted(date: .omitted, time: .shortened)
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("What is it?", text: $title)
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .foregroundStyle(OrionTheme.text)
                .focused($titleFocused)
                .onSubmit(save)
            Rectangle()
                .fill(titleFocused ? OrionTheme.accent.opacity(0.65) : Color.white.opacity(0.14))
                .frame(height: 1)
        }
        .animation(.easeOut(duration: 0.16), value: titleFocused)
    }

    private var timing: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("STARTS")
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.6)
                    .foregroundStyle(OrionTheme.textDim)
                Spacer()
                DatePicker("", selection: $startDate)
                    .labelsHidden()
                    .datePickerStyle(.compact)
            }

            Text("FOR")
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(OrionTheme.textDim)
            HStack(spacing: 7) {
                ForEach(durations, id: \.self) { option in
                    Button {
                        withAnimation(.easeOut(duration: 0.14)) { minutes = option }
                    } label: {
                        Text(option < 60 ? "\(option)m" : (option % 60 == 0 ? "\(option / 60)h" : "\(option / 60)h\(option % 60)"))
                            .font(OrionTheme.mono(10, .semibold))
                            .foregroundStyle(minutes == option ? OrionTheme.ink : OrionTheme.textSoft)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 6)
                            .background {
                                Capsule()
                                    .fill(minutes == option ? OrionTheme.accent : .clear)
                                    .overlay(Capsule().strokeBorder(OrionTheme.line, lineWidth: minutes == option ? 0 : 1))
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var options: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $isAllDay) {
                Text("All day")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
            }
            .toggleStyle(.switch)
            .tint(OrionTheme.accent)

            if agenda.writableCalendars.count > 1 {
                HStack {
                    Text("CALENDAR")
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1.6)
                        .foregroundStyle(OrionTheme.textDim)
                    Spacer()
                    Picker("", selection: $calendarID) {
                        // Only calendars that can actually take an event —
                        // offering a subscribed one produces a save that fails
                        // after everything has been typed.
                        ForEach(agenda.writableCalendars, id: \.calendarIdentifier) { calendar in
                            Text(calendar.title).tag(calendar.calendarIdentifier)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 200)
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 14) {
            if let error = agenda.lastError {
                Text(error)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            InlineAction(title: "Cancel", tint: OrionTheme.textSoft, action: onClose)
            LogButton(title: "Add", systemImage: "plus", action: save)
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func save() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let calendar = agenda.writableCalendars.first { $0.calendarIdentifier == calendarID }
        let end = isAllDay
            ? Calendar.current.date(byAdding: .day, value: 1, to: startDate) ?? startDate
            : startDate.addingTimeInterval(TimeInterval(minutes * 60))
        if agenda.createEvent(title: trimmed, start: startDate, end: end,
                              isAllDay: isAllDay, calendar: calendar) {
            onClose()
        }
    }
}
