import AppKit
import SwiftUI
import SessionDomain

/*
 Tasks, and the day they have to fit into.

 The two halves are deliberately not equal. On the left is what you have to do;
 on the right is the time you actually have. Keeping them on one screen is the
 entire point — a to-do list that does not know your calendar will happily let
 you plan six hours of work into an afternoon with four hours of lectures in it,
 and a calendar that does not know your tasks is just a record of other people's
 claims on you.

 The bridge between them is `Schedule` on a task row: it opens the composer with
 the title already filled, at the time you clicked. That is the seed of the
 thing this is eventually meant to be — for now it is one button, and it is the
 one that matters.

 Tasks live in Apple Reminders, so everything here is on the phone too. Priority
 is a real EventKit field and syncs; progress is local, and TaskPriority says
 why at length.
*/

struct TasksTab: View {
    @ObservedObject var reminders: AppleRemindersSync
    @ObservedObject var agenda: AppleCalendarSync
    @Binding var newTask: String
    let dayProgress: Double
    let hoursLeft: Int
    let energyTitle: String
    /// How much window the dashboard actually has to give this tab.
    ///
    /// Needed because the schedule column contains a ScrollView and this whole
    /// tab sits inside the dashboard's ScrollView. Nested on the same axis, the
    /// inner one is proposed an unbounded height, grows to its full content, and
    /// silently stops being scrollable. Pinning the column to the real window
    /// height is what gives the timeline a viewport of its own.
    let availableHeight: CGFloat
    /// The dashboard viewport less its horizontal page padding. Passing the
    /// measured value avoids SwiftUI's ideal-width behavior inside ScrollView.
    let availableWidth: CGFloat

    /// The calendar, folded in rather than living as its own tab.
    ///
    /// Tasks and the calendar were two tabs showing two halves of the same day —
    /// what is due on the left, what happened on the right — and switching
    /// between them to answer one question is the sort of thing that makes a
    /// dashboard feel like filing. One tab, and the right-hand column changes
    /// granularity instead.
    @ObservedObject var calendar: CalendarModel
    /// ORION's plan for the day: the tasks below, placed into the calendar's gaps.
    @ObservedObject var todayPlan: TodayPlanModel
    var refreshPlanSources: () -> Void

    @State private var dueDate = Date().addingTimeInterval(3600)
    @State private var wantsDueDate = false
    @State private var newPriority: TaskPriority = .none
    @State private var sheetMode: EventSheetMode?
    @State private var composerTitle = ""

    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 32) {
                OrionPanel(padding: 20) {
                    dayHeader.frame(maxWidth: .infinity, alignment: .topLeading)
                }
                OrionPanel(padding: 20) {
                    TodayPlanView(model: todayPlan, refresh: refreshPlanSources)
                }
                OrionPanel(padding: 20) {
                    tasksSection.frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            .frame(width: splitWidths.left, alignment: .topLeading)

            OrionPanel(padding: 18) {
                calendarColumn.frame(maxWidth: .infinity, alignment: .topLeading)
            }
                // Definite on BOTH axes. The height is what turns the timeline
                // into a scrollable region instead of a 24-hour-tall column that
                // drags the whole page with it; whatever sits above it keeps its
                // natural height and the timeline takes the remainder.
                .frame(height: max(360, availableHeight), alignment: .topLeading)
                .frame(width: splitWidths.calendar, alignment: .topLeading)
        }
        .frame(width: max(0, availableWidth), alignment: .topLeading)
        .sheet(isPresented: Binding(
            get: { sheetMode != nil },
            set: { if !$0 { sheetMode = nil; composerTitle = "" } }
        )) {
            if let mode = sheetMode {
                EventComposer(agenda: agenda, mode: mode, prefilledTitle: composerTitle) {
                    sheetMode = nil
                    composerTitle = ""
                }
            }
        }
    }

    // MARK: - The day

    private var dayHeader: some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 7) {
                Text(Date().formatted(.dateTime.weekday(.wide).month().day()).uppercased())
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(2.2)
                    .foregroundStyle(OrionTheme.textDim)
                Text(energyTitle)
                    .font(OrionTheme.display(32))
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
            RingMeter(progress: completion,
                      value: "\(Int(completion * 100))%",
                      caption: "done",
                      tint: completion >= 1 ? OrionTheme.green : OrionTheme.accent,
                      diameter: 98)
        }
    }

    /// Weighted by progress, not just by ticks. A list of five with four of
    /// them half-finished is not 0% done, and showing 0% is why progress bars
    /// on to-do lists feel like a lie.
    private var completion: Double {
        let open = reminders.tasks
        guard !open.isEmpty else { return 0 }
        return open.reduce(0.0) { $0 + ($1.isComplete ? 1 : $1.progress) } / Double(open.count)
    }

    // MARK: - Tasks

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Tasks", trailing: "\(reminders.doneCount) / \(reminders.tasks.count) done")

            if !reminders.access.isGranted { accessNotice }

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
                        TaskRow(
                            task: task,
                            onToggle: { reminders.setComplete(task.id, !task.isComplete) },
                            onDelete: { reminders.remove(task.id) },
                            onPriority: { reminders.setPriority(task.id, task.priority.next) },
                            onProgress: { reminders.setProgress(task.id, $0) },
                            onSchedule: {
                                composerTitle = task.title
                                sheetMode = .create(start: task.dueDate ?? nextFreeHour())
                            }
                        )
                        if task.id != reminders.tasks.last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
            }

            composer.padding(.top, 6)
        }
    }

    /// Where a task would go if scheduled now: the next hour that has not
    /// started yet, so "Schedule" never proposes a slot in the past.
    private func nextFreeHour() -> Date {
        let calendar = Calendar.current
        let now = Date()
        let hour = calendar.component(.hour, from: now)
        return calendar.date(bySettingHour: min(23, hour + 1), minute: 0, second: 0, of: now) ?? now
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

                // Priority before it exists, so it does not have to be set
                // twice — once when adding and once when correcting.
                Button {
                    withAnimation(.easeOut(duration: 0.14)) { newPriority = newPriority.next }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: newPriority.mark)
                            .font(.system(size: 9, weight: .bold))
                        Text(newPriority == .none ? "PRIORITY" : newPriority.label.uppercased())
                            .font(OrionTheme.mono(8, .semibold))
                            .tracking(1.1)
                    }
                    .foregroundStyle(newPriority.tint)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Capsule().strokeBorder(newPriority.tint.opacity(0.4), lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help("Priority")

                Button { wantsDueDate.toggle() } label: {
                    Image(systemName: wantsDueDate ? "bell.fill" : "bell")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(wantsDueDate ? OrionTheme.orange : OrionTheme.textDim)
                        .frame(width: 26, height: 26)
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
            InlineAction(title: "Open Settings", systemImage: "arrow.up.right") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: - Schedule

    /// The right-hand column: a granularity switcher over one of three views.
    private var calendarColumn: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text(calendarTitle)
                    .font(OrionTheme.display(19))
                    .foregroundStyle(OrionTheme.text)

                Spacer(minLength: 8)

                ForEach(CalendarGranularity.allCases, id: \.self) { option in
                    InlineAction(
                        title: option.title,
                        tint: option == calendar.granularity ? OrionTheme.accent : OrionTheme.textDim
                    ) { calendar.show(option) }
                }

                InlineAction(title: "‹", tint: OrionTheme.textSoft) { calendar.step(-1) }
                InlineAction(title: "•", tint: OrionTheme.textSoft) { calendar.goToToday() }
                InlineAction(title: "›", tint: OrionTheme.textSoft) { calendar.step(1) }
            }

            ForEach(calendar.disclosures, id: \.self) { line in
                Text(line)
                    .font(.system(size: 11))
                    .foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            switch calendar.granularity {
            case .day:
                schedule
            case .week:
                WeekGrid(model: calendar, height: max(300, availableHeight - 90))
            case .month:
                // Leave a deliberate lower margin below the final week. Month
                // cells remain easy to scan, but the grid no longer reads as
                // pressed against the dashboard's lower edge.
                MonthGrid(model: calendar, height: max(300, availableHeight - 132))
            }
        }
        // Month/week use CalendarModel; the detailed day timeline is backed by
        // AppleCalendarSync. Keep them in lockstep when a cell promotes itself
        // to day view, otherwise its heading can say "7th" while the timeline
        // silently remains on the previously selected date.
        .onChange(of: calendar.focusDate) { _, day in
            guard calendar.granularity == .day else { return }
            agenda.selectedDate = day
            _ = agenda.load(for: day)
        }
    }

    private var calendarTitle: String {
        let formatter = DateFormatter()
        switch calendar.granularity {
        case .month: formatter.dateFormat = "MMMM yyyy"
        case .week:  formatter.dateFormat = "MMMM"
        case .day:   formatter.dateFormat = "EEEE d MMMM"
        }
        return formatter.string(from: calendar.focusDate)
    }

    private var schedule: some View {
        VStack(alignment: .leading, spacing: 20) {
            WeekStrip(days: agenda.weekDays,
                      selected: $agenda.selectedDate,
                      load: { agenda.load(for: $0) },
                      onToday: {
                          withAnimation(.easeOut(duration: 0.2)) {
                              agenda.selectedDate = Calendar.current.startOfDay(for: Date())
                          }
                      })

            if !agenda.access.isGranted {
                Text(agenda.statusLine)
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let error = agenda.lastError {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No calendars")
                        .font(OrionTheme.display(18))
                        .foregroundStyle(OrionTheme.orange)
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                    InlineAction(title: "Open Internet Accounts", systemImage: "arrow.up.right") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.preferences.internetaccounts") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
            } else {
                DayTimeline(
                    date: agenda.selectedDate,
                    events: agenda.events(on: agenda.selectedDate),
                    onCreate: { moment in
                        composerTitle = ""
                        sheetMode = .create(start: moment)
                    },
                    onSelect: { event in
                        // Opens for everything, including read-only calendars —
                        // the sheet explains why those cannot be changed rather
                        // than the click doing nothing and looking broken.
                        composerTitle = ""
                        sheetMode = .edit(event)
                    }
                )
            }
        }
        .onChange(of: agenda.selectedDate) { _, _ in agenda.refresh() }
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
        reminders.add(trimmed, due: wantsDueDate ? dueDate : nil, priority: newPriority)
        newTask = ""
        wantsDueDate = false
        newPriority = .none
    }

    /// A substantial work column, with every remaining point assigned to the
    /// calendar. The cap keeps task rows readable on very wide displays.
    private var splitWidths: (left: CGFloat, calendar: CGFloat) {
        let usableWidth = max(0, availableWidth - 28)
        let calendarFloor = min(640, max(360, usableWidth * 0.48))
        let desiredLeft = min(820, max(480, usableWidth * 0.43))
        let left = max(0, min(desiredLeft, usableWidth - calendarFloor))
        return (left, max(0, usableWidth - left))
    }
}

/// One task: priority on the left edge, progress underneath, and the actions
/// that only appear when you are looking at it.
private struct TaskRow: View {
    let task: SyncedTask
    let onToggle: () -> Void
    let onDelete: () -> Void
    let onPriority: () -> Void
    let onProgress: (Double) -> Void
    let onSchedule: () -> Void

    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 11) {
                Button(action: onToggle) {
                    Image(systemName: task.isComplete ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 15))
                        .foregroundStyle(task.isComplete ? OrionTheme.green : OrionTheme.textDim)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)

                // Cycles rather than opening a menu. Four values is not worth a
                // popover, and one click per step is faster than two per change.
                Button(action: onPriority) {
                    Image(systemName: task.priority.mark)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(task.priority.tint)
                        .frame(width: 16, height: 16)
                        .background(Circle().strokeBorder(task.priority.tint.opacity(0.35), lineWidth: 1))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Priority: \(task.priority.label)")
                .opacity(task.isComplete ? 0.4 : 1)

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

                if !task.isComplete {
                    Text("\(Int(task.progress * 100))%")
                        .font(OrionTheme.mono(10, .semibold))
                        .foregroundStyle(task.progress > 0 ? OrionTheme.accent : OrionTheme.textDim)
                        .frame(width: 34, alignment: .trailing)
                }

                if hovering {
                    InlineAction(title: "Schedule", tint: OrionTheme.violet, action: onSchedule)
                    Button(action: onDelete) {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(OrionTheme.textDim)
                            .frame(width: 20, height: 20)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            // Drag anywhere along it to set progress. A slider control would be
            // four times the height for the same gesture.
            if !task.isComplete {
                ProgressTrack(progress: task.progress, tint: task.priority == .none ? OrionTheme.accent : task.priority.tint,
                              onChange: onProgress)
                    .padding(.leading, 42)
            }
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

/// A hairline you can drag. Two pixels tall, with a much taller invisible
/// target — a 2pt hit region would be unusable, and a 2pt bar is what the rest
/// of this design language uses.
private struct ProgressTrack: View {
    let progress: Double
    let tint: Color
    let onChange: (Double) -> Void

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 2)
                Capsule()
                    .fill(tint)
                    .frame(width: max(0, geometry.size.width * progress), height: 2)
                    .shadow(color: tint.opacity(0.6), radius: 4)
            }
            .frame(height: 14)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        onChange(min(1, max(0, value.location.x / max(1, geometry.size.width))))
                    }
            )
        }
        .frame(height: 14)
    }
}
