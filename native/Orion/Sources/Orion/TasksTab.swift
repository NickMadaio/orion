import AppKit
import SwiftUI
import SessionDomain
import MobileCore
import OrionViews

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
    @ObservedObject var state: AppState
    @ObservedObject var reminders: AppleRemindersSync
    @ObservedObject var agenda: AppleCalendarSync
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
    var onOpenChat: () -> Void

    @FocusState private var planningComposerFocused: Bool
    @State private var submittedPlanningMessage = false
    @State private var sheetMode: EventSheetMode?
    @State private var composerTitle = ""

    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 32) {
                PlainSection(padding: 18) {
                    VStack(alignment: .leading, spacing: 12) {
                        dayHeader
                        Button { state.finishEarly("auto"); refreshPlanSources() } label: {
                            Label(DoneEarly.label, systemImage: DoneEarly.symbol)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(OrionTheme.textSoft)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 0.5))
                        }.buttonStyle(.plain).disabled(state.earlyBusy)   // with nothing on it still works: ORION says so and offers what is next
                            .accessibilityLabel(DoneEarly.accessibilityLabel(for: state.earlyFinish))
                            .accessibilityHint(DoneEarly.accessibilityHint(for: state.earlyFinish))
                        if let feedback = state.earlyFeedback { Text(feedback).font(.caption).foregroundStyle(OrionTheme.textSoft) }
                    }.onAppear { state.refreshEarlyContext() }.frame(maxWidth: .infinity, alignment: .topLeading)
                }
                PlainSection(padding: 18) {
                    TodayPlanView(model: todayPlan, refresh: refreshPlanSources)
                }
                planningComposer
                PlainSection(padding: 18) {
                    tasksSection.frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            .frame(width: splitWidths.left, alignment: .topLeading)

            // 2026-10-16 UI audit #5/#7: a hairline between unequal columns
            // instead of a card around each, and room above the day header so
            // nothing starts flush under the nav scrim.
            FadingVerticalHairline()
                .frame(height: max(360, availableHeight))
            calendarColumn.frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(.top, 12)
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

    private var canSendPlanningMessage: Bool {
        state.phase != .thinking && !state.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func sendPlanningMessage() {
        guard canSendPlanningMessage else { return }
        submittedPlanningMessage = true
        state.submitTyped()
    }

    private var planningComposer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: "waveform")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(planningComposerFocused ? OrionTheme.accent : OrionTheme.textDim)
                TextField("What do you need?", text: $state.composer, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14))
                    .lineLimit(1...3)
                    .foregroundStyle(OrionTheme.text)
                    .focused($planningComposerFocused)
                    .onSubmit(sendPlanningMessage)
                Button(action: sendPlanningMessage) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(canSendPlanningMessage ? OrionTheme.accent : OrionTheme.textDim)
                        .frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(canSendPlanningMessage ? OrionTheme.accent.opacity(0.7) : Color.white.opacity(0.2), lineWidth: 0.7))
                }
                .buttonStyle(.plain)
                .disabled(!canSendPlanningMessage)
                .accessibilityLabel("Send to ORION")
            }
            Rectangle()
                .fill(planningComposerFocused ? OrionTheme.accent.opacity(0.65) : Color.white.opacity(0.12))
                .frame(height: 1)
            if submittedPlanningMessage {
                HStack(alignment: .top, spacing: 12) {
                    if state.phase == .thinking {
                        Text("Thinking…").foregroundStyle(OrionTheme.textDim)
                    } else if let reply = state.chatConversation?.messages.last, reply.role == .orion {
                        Text(reply.text).foregroundStyle(OrionTheme.textSoft).lineLimit(2)
                    } else {
                        Text(state.statusLine).foregroundStyle(OrionTheme.textDim).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Button("Open chat", action: onOpenChat).buttonStyle(.plain).foregroundStyle(OrionTheme.accent)
                }.font(.system(size: 12))
            }
        }
        .padding(.vertical, 4)
        .animation(.easeOut(duration: 0.18), value: planningComposerFocused)
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

    /// The to-do list (2026-10-13): the shared OrionViews screen the phone also draws,
    /// rebuilt after his old Notion list. Everything is set while adding and edited in place.
    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !reminders.access.isGranted { accessNotice }
            TodoListScreen(items: todoItems, actions: todoActions, density: .pointer)
                .disabled(!reminders.access.isGranted)
        }
    }

    private var todoItems: [TodoItem] {
        reminders.tasks.map { task in
            TodoItem(id: task.id, title: task.title, due: task.dueDate.map { task.dueHasTime ? $0 : Self.endOfDay($0) },
                     done: task.isComplete, priority: TodoPriority(eventKit: task.priority.rawValue), notes: task.notes)
        }
    }

    private static func endOfDay(_ date: Date) -> Date {
        Calendar.current.date(bySettingHour: 23, minute: 59, second: 0, of: date) ?? date
    }

    private var todoActions: TodoActions {
        TodoActions(
            add: { draft in
                var notes = TaskNotes(); notes.tags = draft.tags
                reminders.add(draft.title, due: draft.due, priority: TaskPriority.from(draft.priority.eventKit), notes: notes.text)
            },
            toggle: { id in
                guard let task = reminders.tasks.first(where: { $0.id == id }) else { return }
                reminders.setComplete(id, !task.isComplete)
            },
            rename: { reminders.rename($0, to: $1) },
            setPriority: { reminders.setPriority($0, TaskPriority.from($1.eventKit)) },
            setDue: { reminders.setDue($0, $1) },
            setNotes: { reminders.setNotes($0, $1) },
            delete: { reminders.remove($0) },
            reorder: { changes in withAnimation(.spring(response: 0.3)) { reminders.applyOrder(changes) } },
            schedule: { id in
                guard let task = reminders.tasks.first(where: { $0.id == id }) else { return }
                composerTitle = task.title
                sheetMode = .create(start: task.dueHasTime ? task.dueDate ?? nextFreeHour() : nextFreeHour())
            }
        )
    }

    /// Where a task would go if scheduled now: the next hour that has not
    /// started yet, so "Schedule" never proposes a slot in the past.
    private func nextFreeHour() -> Date {
        let calendar = Calendar.current
        let now = Date()
        let hour = calendar.component(.hour, from: now)
        return calendar.date(bySettingHour: min(23, hour + 1), minute: 0, second: 0, of: now) ?? now
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
                    },
                    night: NightMarkers.load(for: agenda.selectedDate)
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

    /// A substantial work column, with every remaining point assigned to the
    /// calendar. The cap keeps task rows readable on very wide displays.
    private var splitWidths: (left: CGFloat, calendar: CGFloat) {
        let usableWidth = max(0, availableWidth - 57)
        let calendarFloor = min(640, max(360, usableWidth * 0.48))
        // 2026-10-16 UI audit #7: still about 0.43 / 0.57, deliberately unequal
        // (LayoutRuleTests pins the 0.43); the audit asked for about 0.42.
        let desiredLeft = min(820, max(480, usableWidth * 0.43))
        let left = max(0, min(desiredLeft, usableWidth - calendarFloor))
        return (left, max(0, usableWidth - left))
    }
}
