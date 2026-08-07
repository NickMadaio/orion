import AppKit
import SwiftUI

/// Tasks. Added, ticked and deleted here; stored in Apple Reminders, so the
/// same list is on the phone and a dated one actually interrupts you.
///
/// Two columns of deliberately different weight, and the narrow one starts
/// lower than the wide one. That offset is the layout: the day and the list are
/// what this tab is about, and the agenda is a reference the eye should reach
/// second rather than a third equal card in a row of three.
struct TasksTab: View {
    @ObservedObject var reminders: AppleRemindersSync
    @ObservedObject var agenda: AppleCalendarSync
    @Binding var newTask: String
    let dayProgress: Double
    let hoursLeft: Int
    let energyTitle: String

    @State private var dueDate = Date().addingTimeInterval(3600)
    @State private var wantsDueDate = false

    var body: some View {
        HStack(alignment: .top, spacing: 54) {
            VStack(alignment: .leading, spacing: 34) {
                dayHeader
                tasksSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            agendaColumn
                .frame(width: 296)
                // The offset. Nothing on this tab starts on the same line as
                // anything beside it.
                .padding(.top, 52)
        }
    }

    // MARK: - The day

    private var dayHeader: some View {
        HStack(alignment: .top, spacing: 30) {
            VStack(alignment: .leading, spacing: 7) {
                Text(Date().formatted(.dateTime.weekday(.wide).month().day()).uppercased())
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(2.2)
                    .foregroundStyle(OrionTheme.textDim)
                Text(energyTitle)
                    .font(OrionTheme.display(34))
                    .foregroundStyle(OrionTheme.text)
                Text("\(hoursLeft)h of awake time left")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
                Text(summary)
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(summaryTint)
                    .padding(.top, 2)
            }

            Spacer(minLength: 12)

            RingMeter(progress: dayProgress,
                      value: "\(Int(dayProgress * 100))%",
                      caption: Date().formatted(date: .omitted, time: .shortened),
                      tint: OrionTheme.orange,
                      diameter: 104)
        }
    }

    // MARK: - Tasks

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionRule(title: "Tasks", trailing: "\(reminders.doneCount) / \(reminders.tasks.count) done")

            if !reminders.access.isGranted { accessNotice }

            // One dash per task. "How much is left" without counting.
            HStack(spacing: 4) {
                if reminders.tasks.isEmpty {
                    Capsule().fill(Color.white.opacity(0.07)).frame(height: 3)
                } else {
                    ForEach(reminders.tasks) { task in
                        Capsule()
                            .fill(task.isComplete ? OrionTheme.green : Color.white.opacity(0.10))
                            .frame(height: 3)
                    }
                }
            }
            .animation(.easeOut(duration: 0.3), value: reminders.doneCount)

            if reminders.tasks.isEmpty {
                Text(reminders.access.isGranted
                     ? "Nothing on the list. Add one below, or just tell Orion."
                     : "Waiting on Reminders access.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textDim)
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(reminders.tasks) { task in
                        TaskRow(task: task,
                                onToggle: { reminders.setComplete(task.id, !task.isComplete) },
                                onDelete: { reminders.remove(task.id) })
                        if task.id != reminders.tasks.last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
            }

            composer.padding(.top, 4)
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                TextField("Add a task…", text: $newTask)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
                    .padding(.vertical, 7)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
                    }
                    .onSubmit(add)

                Button { wantsDueDate.toggle() } label: {
                    Image(systemName: wantsDueDate ? "bell.fill" : "bell")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(wantsDueDate ? OrionTheme.orange : OrionTheme.textDim)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Remind me at a time")

                LogButton(title: "Add", systemImage: "plus", action: add)
                    .disabled(!reminders.access.isGranted)
            }

            if wantsDueDate {
                HStack(spacing: 9) {
                    Image(systemName: "alarm")
                        .font(.system(size: 10))
                        .foregroundStyle(OrionTheme.orange)
                    DatePicker("", selection: $dueDate)
                        .labelsHidden()
                        .datePickerStyle(.compact)
                    Text("Reminders will notify you on every device.")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                    Spacer()
                }
            }
        }
    }

    @ViewBuilder private var accessNotice: some View {
        HStack(spacing: 11) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12))
                .foregroundStyle(OrionTheme.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Reminders access is needed for the task list")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.text)
                Text(reminders.statusLine)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }
            Spacer(minLength: 12)
            // Straight to the exact pane. Telling someone to "check Privacy
            // settings" and leaving them to find it is most of why a denied
            // permission stays denied.
            InlineAction(title: "Open Settings", systemImage: "arrow.up.right") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: - Agenda

    private var agendaColumn: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Today", trailing: agenda.access.isGranted ? nil : "no access")

            if !agenda.access.isGranted {
                Text(agenda.statusLine)
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            } else if agenda.events.isEmpty {
                Text("Nothing on the calendar today.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                VStack(spacing: 0) {
                    ForEach(agenda.events) { event in
                        AgendaRow(event: event)
                        if event.id != agenda.events.last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
                if agenda.committedMinutesRemaining > 0 {
                    Text("\(agenda.committedMinutesRemaining / 60)h \(agenda.committedMinutesRemaining % 60)m still committed today.")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                        .padding(.top, 4)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - Derived

    private var summary: String {
        if reminders.overdueCount > 0 { return "\(reminders.overdueCount) overdue." }
        if reminders.tasks.isEmpty { return "Nothing on the list." }
        if reminders.openCount == 0 { return "Everything on the list is done." }
        return "\(reminders.openCount) still open."
    }

    private var summaryTint: Color {
        if reminders.overdueCount > 0 { return OrionTheme.red }
        if reminders.openCount == 0 && !reminders.tasks.isEmpty { return OrionTheme.green }
        return OrionTheme.textDim
    }

    private func add() {
        let trimmed = newTask.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        reminders.add(trimmed, due: wantsDueDate ? dueDate : nil)
        newTask = ""
        wantsDueDate = false
    }
}

/// One task line: tick, title, when it is due, and a delete that only appears
/// on hover so the list is not a wall of destructive buttons.
private struct TaskRow: View {
    let task: SyncedTask
    let onToggle: () -> Void
    let onDelete: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: task.isComplete ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 15))
                    .foregroundStyle(task.isComplete ? OrionTheme.green : OrionTheme.textDim)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(task.isComplete ? OrionTheme.textDim : OrionTheme.text)
                    .strikethrough(task.isComplete, color: OrionTheme.textDim)
                if let due = task.dueDate {
                    HStack(spacing: 5) {
                        Image(systemName: task.hasAlarm ? "bell.fill" : "calendar")
                            .font(.system(size: 8))
                        Text(due.formatted(date: .abbreviated, time: .shortened))
                            .font(OrionTheme.mono(10))
                    }
                    .foregroundStyle(task.isOverdue ? OrionTheme.red : OrionTheme.textDim)
                }
            }
            Spacer(minLength: 12)

            if task.isOverdue {
                Text("OVERDUE")
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1.2)
                    .foregroundStyle(OrionTheme.red)
            }
            Button(action: onDelete) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(OrionTheme.textDim)
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .opacity(hovering ? 1 : 0)
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

/// One line of the day's agenda. Read-only, like everything calendar here.
private struct AgendaRow: View {
    let event: AgendaEvent

    var body: some View {
        HStack(spacing: 11) {
            Rectangle()
                .fill(event.isNow ? OrionTheme.green : (event.isPast ? OrionTheme.textDim.opacity(0.35) : OrionTheme.accent))
                .frame(width: 2, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(event.isPast ? OrionTheme.textDim : OrionTheme.text)
                    .lineLimit(1)
                Text(event.calendarName)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            if event.isNow {
                Text("NOW")
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.2)
                    .foregroundStyle(OrionTheme.green)
            }
            Text(event.timeLabel)
                .font(OrionTheme.mono(10, .semibold))
                .foregroundStyle(event.isPast ? OrionTheme.textDim : OrionTheme.textSoft)
        }
        .padding(.vertical, 9)
    }
}
