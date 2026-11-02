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
    /// Renders draw the columns without their ScrollViews, which ImageRenderer cannot draw.
    var snapshot = false

    @FocusState private var planningComposerFocused: Bool
    @State private var submittedPlanningMessage = false
    @State private var sheetMode: EventSheetMode?
    @State private var composerTitle = ""

    var body: some View {
        // Wave 14: the page itself never scrolls (Nick: "things should scroll separately, not the whole page").
        // The header stays put; the plan column and the calendar column each scroll on their own, inside a
        // definite height. DashboardView hands this tab exactly its viewport, so the outer ScrollView has nothing to move.
        VStack(alignment: .leading, spacing: 30) {
            PageHeader(title: energyTitle, subline: headline) { doneEarly }
            HStack(alignment: .top, spacing: 28) {
                planColumn
                    .frame(width: splitWidths.left, alignment: .topLeading)
                    .frame(maxHeight: .infinity, alignment: .top)

                // 2026-10-16 UI audit #5/#7: a hairline between unequal columns instead of a card around each.
                FadingVerticalHairline()
                    .frame(maxHeight: .infinity)
                calendarColumn.frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(.top, 4)
                    .frame(maxHeight: .infinity, alignment: .topLeading)
                    .frame(width: splitWidths.calendar, alignment: .topLeading)
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        // Definite on BOTH axes: the height is what turns each column into a viewport of its own.
        .frame(width: max(0, availableWidth), height: max(360, availableHeight), alignment: .topLeading)
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

    /// The left column: the day's rings, ORION's plan and the to-do list scroll together; the composer stays
    /// pinned under them, the way Home keeps its composer at the bottom of the scene.
    private var planColumn: some View {
        VStack(alignment: .leading, spacing: 14) {
            ColumnScroll(snapshot: snapshot) {
                VStack(alignment: .leading, spacing: 32) {
                    dayFigures
                        .onAppear { state.refreshEarlyContext() }
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .deal(order: 0, rise: 12)
                    TodayPlanView(model: todayPlan, refresh: refreshPlanSources)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .deal(order: 1, rise: 12)
                    tasksSection.frame(maxWidth: .infinity, alignment: .topLeading)
                        .deal(order: 2, rise: 12)
                }
                // Room for the rings' strokes and glows, which the scroll bounds would otherwise clip.
                .padding(.leading, 6)
                .padding(.top, 8)
                .padding(.trailing, 10)
                .padding(.bottom, 28)
            }
            planningComposer
                .padding(.trailing, 10)
                .padding(.bottom, 6)
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

    /// The header's one true line: the date, then what is open, what is late and how much day is left.
    private var headline: String {
        let date = Date().formatted(.dateTime.weekday(.wide).month().day())
        let line = PlanHeadline.line(open: reminders.openCount, overdue: reminders.overdueCount,
                                     total: reminders.tasks.count, hoursLeft: hoursLeft)
        return PageSummary.line([date, line])
    }

    /// "Done early" as the header's one glowing action, with what ORION said about it underneath.
    private var doneEarly: some View {
        VStack(alignment: .trailing, spacing: 8) {
            // With nothing on it still works: ORION says so and offers what is next.
            GlowPill(title: DoneEarly.label, hue: OrionTheme.green, symbol: DoneEarly.symbol, working: state.earlyBusy) {
                state.finishEarly("auto"); refreshPlanSources()
            }
            .disabled(state.earlyBusy)
            .accessibilityLabel(DoneEarly.accessibilityLabel(for: state.earlyFinish))
            .accessibilityHint(DoneEarly.accessibilityHint(for: state.earlyFinish))
            if let feedback = state.earlyFeedback {
                Text(feedback).font(.caption).foregroundStyle(OrionTheme.textSoft)
                    .multilineTextAlignment(.trailing).frame(maxWidth: 320, alignment: .trailing)
            }
        }
        .padding(.top, 4)
    }

    /// The day's numbers as rings (wave 14): Done fills as the list gets done and its figure counts up; Open is
    /// the share of the list still waiting; Overdue appears only when something is late, and is the only red.
    /// Staggered vertically, not lined up in a grid.
    private var dayFigures: some View {
        HStack(alignment: .top, spacing: 34) {
            RingMeter(progress: completion, value: "\(Int(completion * 100))", caption: "% done",
                      tint: completion >= 1 ? OrionTheme.green : OrionTheme.accent, diameter: 118, drawInAfter: 0.1)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(Int(completion * 100)) percent done")
            RingMeter(progress: PlanRings.openFraction(open: reminders.openCount, total: reminders.tasks.count),
                      value: "\(reminders.openCount)", caption: "open", tint: OrionTheme.blue, diameter: 92, drawInAfter: 0.25)
                .padding(.top, 22)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(reminders.openCount) open")
            if reminders.overdueCount > 0 {
                RingMeter(progress: PlanRings.openFraction(open: reminders.overdueCount, total: reminders.tasks.count),
                          value: "\(reminders.overdueCount)", caption: "overdue", tint: OrionTheme.red, diameter: 80, drawInAfter: 0.4)
                    .padding(.top, 8)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(reminders.overdueCount) overdue")
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("\(hoursLeft)h").font(OrionTheme.display(26)).foregroundStyle(OrionTheme.text)
                Text("of awake time left").font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
                Text(summary).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft).padding(.top, 4)
            }
            .padding(.top, 40)
            Spacer(minLength: 0)
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
            Button { state.todoFloat.togglePopOut() } label: {
                Label(state.todoFloat.isPoppedOut ? "Close floating to-dos" : "Float to-dos", systemImage: "arrow.up.forward.square")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OrionTheme.textSoft)
                    .padding(.horizontal, 4).hitTarget(shape: Rectangle())
            }
            .buttonStyle(.plain)
            .help("Keep the to-do list on top of everything, in its own small window")
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
                TodoCompletion.toggle(id: id, in: reminders.tasks) { reminders.setComplete($0, $1) }
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

    // MARK: - Schedule

    /// The right-hand column: a granularity switcher over one of three views. It scrolls or pages on its own:
    /// the month pages with ‹ ›, the week and the selected day's list scroll, the day timeline has its own scroll.
    private var calendarColumn: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Text(calendarTitle)
                    .font(OrionTheme.display(21))
                    .foregroundStyle(OrionTheme.text)
                    .contentTransition(.opacity)
                    .animation(OrionMotion.fade, value: calendarTitle)

                Spacer(minLength: 8)

                CalendarGranularityPills(selected: calendar.granularity) { calendar.show($0) }

                HStack(spacing: 6) {
                    PlanRoundAction(symbol: "chevron.left", help: "Previous", hue: OrionTheme.textSoft) { calendar.step(-1) }
                    PlanRoundAction(symbol: "circle.fill", help: "Today", hue: OrionTheme.accent) { calendar.goToToday() }
                    PlanRoundAction(symbol: "chevron.right", help: "Next", hue: OrionTheme.textSoft) { calendar.step(1) }
                }
            }

            if let notice = PlanNotice.make(disclosures: calendar.disclosures, remindersGranted: reminders.access.isGranted) {
                PlanNoticeCapsule(notice: notice, settingsURL: notice.title.hasPrefix("Reminders")
                                  ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders"
                                  : "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")
            }

            switch calendar.granularity {
            case .day:
                schedule
            case .week:
                ColumnScroll(snapshot: snapshot) {
                    WeekGrid(model: calendar, height: max(300, availableHeight - 90))
                        .padding(.bottom, 24)
                }
            case .month:
                // The month is a fixed page of circles, sized from the height it is given; the selected day's
                // list takes what is left underneath and scrolls on its own.
                GeometryReader { proxy in
                    VStack(alignment: .leading, spacing: 18) {
                        MonthGrid(model: calendar, height: min(440, max(260, proxy.size.height * 0.62)))
                        ColumnScroll(snapshot: snapshot) {
                            CalendarDayList(model: calendar).padding(.bottom, 24)
                        }
                    }
                }
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
