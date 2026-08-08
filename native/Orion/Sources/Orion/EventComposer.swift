import EventKit
import SwiftUI

/*
 Making and changing an event.

 One sheet for both, because they are the same form with a different starting
 point, and two sheets would drift apart the first time either changed.

 The slow part of every calendar UI is the end time, and it is slow because it
 is asked as an absolute while people think in durations. Nobody schedules a
 thing "until 3:45"; they schedule it "for 45 minutes". So duration is the
 control, the end time is derived, and the header shows the range as it changes
 — confirmed, never typed.

 Deleting asks twice. It is the one action here that cannot be undone, and an
 event removed by a mis-click is gone from every device within seconds.
*/

enum EventSheetMode: Equatable {
    /// Opened from an empty hour, already knowing when.
    case create(start: Date)
    case edit(AgendaEvent)
}

struct EventComposer: View {
    @ObservedObject var agenda: AppleCalendarSync
    let mode: EventSheetMode
    /// Set when scheduling an existing task, so the title arrives filled.
    var prefilledTitle: String = ""
    var onClose: () -> Void

    @State private var title = ""
    @State private var minutes = 60
    @State private var isAllDay = false
    @State private var startDate = Date()
    @State private var calendarID = ""
    @State private var confirmingDelete = false
    @FocusState private var titleFocused: Bool

    private let durations = [15, 30, 45, 60, 90, 120, 180]

    private var editing: AgendaEvent? {
        if case .edit(let event) = mode { return event }
        return nil
    }

    private var isReadOnly: Bool { editing?.isReadOnly ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            header
            titleField
            if !isAllDay { timing }
            options
            if isReadOnly { readOnlyNotice }
            if editing?.hasAttendees == true { attendeeNotice }
            actions
        }
        .padding(30)
        .frame(width: 470)
        .background(OrionTheme.ink)
        .onAppear(perform: prime)
    }

    /// Fill the form from whichever mode opened it.
    private func prime() {
        calendarID = agenda.defaultCalendar?.calendarIdentifier ?? ""
        switch mode {
        case .create(let start):
            title = prefilledTitle
            startDate = start
        case .edit(let event):
            title = event.title
            startDate = event.start
            isAllDay = event.isAllDay
            if !event.calendarID.isEmpty { calendarID = event.calendarID }
            // Snap to the nearest offered duration so the chips show a
            // selection; an event of 37 minutes should not leave every chip
            // looking unselected.
            let actual = max(5, Int(event.end.timeIntervalSince(event.start) / 60))
            minutes = durations.min { abs($0 - actual) < abs($1 - actual) } ?? actual
        }
        titleFocused = !isReadOnly
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(editing == nil ? "NEW EVENT" : "EDIT EVENT")
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(2.4)
                    .foregroundStyle(OrionTheme.textDim)
                Text(rangeLabel)
                    .font(OrionTheme.display(22))
                    .foregroundStyle(OrionTheme.text)
            }
            Spacer(minLength: 0)
            if let editing {
                Circle()
                    .fill(OrionTheme.color(hex: editing.colorHex))
                    .frame(width: 9, height: 9)
                Text(editing.calendarName)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textSoft)
            }
        }
    }

    /// The whole point of the duration control: this changes as you pick, so
    /// the end time is confirmed rather than worked out in your head.
    private var rangeLabel: String {
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
                .disabled(isReadOnly)
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
                    .disabled(isReadOnly)
            }

            Text("FOR")
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(OrionTheme.textDim)
            HStack(spacing: 6) {
                ForEach(durations, id: \.self) { option in
                    Button {
                        withAnimation(.easeOut(duration: 0.14)) { minutes = option }
                    } label: {
                        Text(label(for: option))
                            .font(OrionTheme.mono(10, .semibold))
                            .foregroundStyle(minutes == option ? OrionTheme.ink : OrionTheme.textSoft)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background {
                                Capsule()
                                    .fill(minutes == option ? OrionTheme.accent : .clear)
                                    .overlay(Capsule().strokeBorder(OrionTheme.line, lineWidth: minutes == option ? 0 : 1))
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isReadOnly)
                }
            }
        }
    }

    private func label(for option: Int) -> String {
        if option < 60 { return "\(option)m" }
        return option % 60 == 0 ? "\(option / 60)h" : "\(option / 60)h\(option % 60)"
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
            .disabled(isReadOnly)

            if agenda.writableCalendars.count > 1 && !isReadOnly {
                HStack {
                    Text("CALENDAR")
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1.6)
                        .foregroundStyle(OrionTheme.textDim)
                    Spacer()
                    Picker("", selection: $calendarID) {
                        // Only calendars that can take an event — offering a
                        // subscribed one produces a save that fails after
                        // everything has been typed.
                        ForEach(agenda.writableCalendars, id: \.calendarIdentifier) { calendar in
                            Text(calendar.title).tag(calendar.calendarIdentifier)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 210)
                }
            }
        }
    }

    private var readOnlyNotice: some View {
        notice(icon: "lock.fill", tint: OrionTheme.textSoft,
               text: "This is on a subscribed or birthday calendar, which EventKit will not let anything write to — not Orion and not Calendar.app.")
    }

    private var attendeeNotice: some View {
        notice(icon: "person.2.fill", tint: OrionTheme.orange,
               text: "Other people are on this event. Saving a change sends them an update.")
    }

    private func notice(icon: String, tint: Color, text: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundStyle(tint)
            Text(text)
                .font(OrionTheme.mono(10))
                .foregroundStyle(tint.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error = agenda.lastError {
                Text(error)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 14) {
                // Two presses, always. This is the only irreversible thing on
                // the sheet, and a deleted event is gone from every device
                // before you have finished noticing.
                if editing != nil && !isReadOnly {
                    if confirmingDelete {
                        InlineAction(title: "Really delete", systemImage: "trash", tint: OrionTheme.red) {
                            if let editing { agenda.delete(editing) }
                            onClose()
                        }
                        InlineAction(title: "Keep", tint: OrionTheme.textSoft) {
                            withAnimation(.easeOut(duration: 0.14)) { confirmingDelete = false }
                        }
                    } else {
                        InlineAction(title: "Delete", systemImage: "trash", tint: OrionTheme.textSoft) {
                            withAnimation(.easeOut(duration: 0.14)) { confirmingDelete = true }
                        }
                    }
                }

                Spacer(minLength: 0)
                InlineAction(title: isReadOnly ? "Close" : "Cancel",
                             tint: OrionTheme.textSoft, action: onClose)
                if !isReadOnly {
                    LogButton(title: editing == nil ? "Add" : "Save",
                              systemImage: editing == nil ? "plus" : "checkmark",
                              action: save)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func save() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isReadOnly else { return }
        let calendar = agenda.writableCalendars.first { $0.calendarIdentifier == calendarID }
        let end = isAllDay
            ? Calendar.current.date(byAdding: .day, value: 1, to: startDate) ?? startDate
            : startDate.addingTimeInterval(TimeInterval(minutes * 60))

        let ok: Bool
        if let editing {
            ok = agenda.update(editing, title: trimmed, start: startDate, end: end,
                               isAllDay: isAllDay, calendar: calendar)
        } else {
            ok = agenda.createEvent(title: trimmed, start: startDate, end: end,
                                    isAllDay: isAllDay, calendar: calendar)
        }
        if ok { onClose() }
    }
}
