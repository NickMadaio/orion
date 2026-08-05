import AppKit
import SwiftUI

/// Orion's desktop command center.
///
/// This deliberately keeps the existing floating orb separate: that surface is
/// for quick, interruption-free voice interaction. This is where a deliberate
/// click goes — the same assistant, but with the day's context visible around
/// it instead of a standalone chat popover.
struct DashboardView: View {
    @ObservedObject var state: AppState
    var onDismiss: () -> Void

    @FocusState private var composerFocused: Bool
    @State private var selectedTab: DashboardTab = .home
    @State private var quickOpenExpanded = false
    @StateObject private var quickOpen = QuickOpenSettings()
    @State private var quickOpenEditorVisible = false
    @State private var quickOpenAppPickerVisible = false
    @State private var newFocusTask = ""
    /// The task list lives in Apple Reminders, not in AppState — see
    /// AppleRemindersSync for why a task Orion can only show on this Mac is a
    /// worse to-do list than the one already on your phone.
    @StateObject private var reminders = AppleRemindersSync()
    @StateObject private var agenda = AppleCalendarSync()
    @StateObject private var connections = ConnectionsModel()
    @StateObject private var whoop = WhoopClient()
    @AppStorage("orion.dashboard.coreStyle") private var coreStyle = "blackHole"
    @AppStorage("orion.quickOpen.iconScale") private var iconScale = 1.0

    private let ink = Color(red: 0.018, green: 0.027, blue: 0.045)
    private let panel = Color(red: 0.045, green: 0.061, blue: 0.088)
    private let cyan = Color(red: 0.18, green: 0.83, blue: 1.0)
    private let teal = Color(red: 0.26, green: 0.9, blue: 0.7)
    private let amber = Color(red: 1.0, green: 0.67, blue: 0.25)

    var body: some View {
        VStack(spacing: 0) {
            topBar
            // Home is the orb and should stay uncluttered; every other tab
            // carries the same handful of live numbers at the top, so they are
            // never more than a glance away.
            if selectedTab != .home {
                vitalsStrip
                    .padding(.horizontal, 22)
                    .padding(.bottom, 12)
            }
            Divider().overlay(OrionTheme.line)

            ScrollView { tabContent.padding(22) }
            Divider().overlay(OrionTheme.line)
            tabBar
        }
        .background(OrionTheme.ink)
        .preferredColorScheme(.dark)
        .onAppear {
            composerFocused = true
            // Prompts for Reminders access the first time, then keeps the list
            // live off EKEventStoreChanged.
            reminders.start()
            agenda.start()
            whoop.start()
        }
        .onDisappear {
            reminders.stop()
            agenda.stop()
            whoop.stop()
        }
        .onChange(of: state.focusComposerToken) { _, _ in composerFocused = true }
        .sheet(isPresented: $quickOpenEditorVisible) { QuickOpenEditor(settings: quickOpen) }
        .sheet(isPresented: $quickOpenAppPickerVisible) {
            QuickOpenAppPicker(settings: quickOpen) { app in
                quickOpen.addApplication(app)
                quickOpenAppPickerVisible = false
            }
        }
    }

    private var topBar: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("ORION")
                    .font(.system(size: 14, weight: .semibold))
                    .tracking(6)
                    .foregroundStyle(cyan)
                Text(greeting)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer()
            StatusPill(title: state.gatewayUp ? "ONLINE" : "OFFLINE", color: state.gatewayUp ? teal : amber)
            Text(now, style: .time)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(.white.opacity(0.55))
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .padding(9)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white.opacity(0.55))
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 16)
    }

    private var hero: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(phaseColor).frame(width: 7, height: 7)
                Text(coreStyle == "blackHole" ? "BLACK HOLE • \(phaseTitle.uppercased())" : "ORION CORE • \(phaseTitle.uppercased())")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.7)
                    .foregroundStyle(.white.opacity(0.48))
            }

            // No enclosing dashboard card: Orion is the landing surface, not
            // another widget. The content below is intentionally pushed down
            // the page so scrolling reveals the day around him.
            ZStack {
                RadialGradient(colors: [cyan.opacity(0.15), cyan.opacity(0.035), .clear], center: .center, startRadius: 35, endRadius: 290)
                Group {
                    if coreStyle == "blackHole" {
                        // The live Orion hologram remains intact in the
                        // floating assistant. This study tests whether the
                        // orbital launcher reads as an event horizon.
                        BlackHoleHologramView(phase: state.phase)
                    } else {
                        HologramView(model: state.hologram)
                    }
                }
                .frame(width: 465, height: 465)
                .allowsHitTesting(false)
                // Launchers deliberately sit above the visual core so an app
                // can cross the front of a black hole rather than disappearing
                // as though every orbit were behind it.
                HomeLauncherSurface(
                    settings: quickOpen,
                    onAddApp: { quickOpenAppPickerVisible = true },
                    onManage: { quickOpenEditorVisible = true }
                )
            }
            .frame(maxWidth: .infinity)
            .frame(height: 520)
            .padding(.top, -20)

            Text(state.statusLine)
                .font(.system(size: 10, weight: .medium))
                .tracking(1)
                .foregroundStyle(phaseColor)

            composer
                .frame(maxWidth: 510)
        }
        .padding(.top, 10)
        .padding(.bottom, 24)
    }

    private var dailyGrid: some View {
        HStack(alignment: .center, spacing: 28) {
            WhoopSurface()
                .frame(maxWidth: .infinity)

            DayProgressSurface(progress: dayProgress, title: energyTitle, hoursLeft: hoursLeft, cyan: cyan)
                .frame(width: 260)

            FocusSurface(reminders: reminders, newTask: $newFocusTask, cyan: cyan)
                .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 16)
    }

    private var lowerGrid: some View {
        HStack(alignment: .top, spacing: 18) {
            DashboardCard(title: "HEALTH & RECOVERY", icon: "heart.fill") {
                HStack(spacing: 10) {
                    MetricTile(title: "HYDRATION", value: "\(state.hydrationBottles)", suffix: " bottles", color: cyan, actionTitle: "+ Bottle", action: state.logHydration, secondaryActionTitle: "−", secondaryAction: state.removeHydration)
                    MetricTile(title: "WORKOUT", value: state.workoutLogged ? "Done" : "—", suffix: " today", color: teal, actionTitle: state.workoutLogged ? "Undo" : "Log workout", action: state.toggleWorkoutLogged)
                    MetricTile(title: "SUPPLEMENTS", value: "\(state.supplementsLogged)", suffix: " logged", color: amber, actionTitle: "+ Log", action: state.logSupplement)
                }
                Text("Manual-first today. WHOOP and other wearable data appear here only after their real connection is set up.")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.45))
                    .padding(.top, 12)
            }
            .frame(maxWidth: .infinity)

            DashboardCard(title: "ORION NOTICED", icon: "sparkles") {
                Text("No new priority alerts.")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white.opacity(0.82))
                Text("When you ask Orion to monitor a condition, it will surface its result here and, when explicitly requested, send a Discord alert.")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.top, 5)
            }
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var tabContent: some View {
        switch selectedTab {
        case .home:
            // Untouched on purpose. The orb is the one surface that already
            // worked, and it is what Orion *is*; the rest of the tabs are what
            // needed to catch up to it.
            hero
        case .focus:
            TasksTab(reminders: reminders, agenda: agenda, newTask: $newFocusTask,
                     dayProgress: dayProgress, hoursLeft: hoursLeft, energyTitle: energyTitle)
        case .health:
            HealthTab(state: state, whoop: whoop, connections: connections)
        case .finance:
            FinanceTab(connections: connections)
        case .brand:
            BrandTab(state: state, connections: connections)
        case .settings:
            SettingsTab(coreStyle: $coreStyle, iconScale: $iconScale, connections: connections)
        }
    }

    /// The always-present strip under the header: the handful of numbers that
    /// should be true on every tab, in the reference's one-line form.
    private var vitalsStrip: some View {
        HStack(spacing: 8) {
            StatChip(icon: "drop.fill", value: "\(state.hydrationBottles)", tint: OrionTheme.blue)
            StatChip(icon: "pills.fill", value: "\(state.supplementsLogged)", tint: OrionTheme.violet)
            StatChip(icon: "figure.run",
                     value: state.workoutLogged ? "done" : "—",
                     tint: state.workoutLogged ? OrionTheme.green : OrionTheme.textDim)
            StatChip(icon: "checkmark.circle",
                     value: "\(reminders.doneCount)/\(reminders.tasks.count)",
                     tint: OrionTheme.orange)
            if reminders.overdueCount > 0 {
                StatChip(icon: "exclamationmark.triangle.fill",
                         value: "\(reminders.overdueCount) overdue",
                         tint: OrionTheme.red)
            }
            Spacer()
            StatChip(icon: state.gatewayUp ? "bolt.fill" : "bolt.slash.fill",
                     value: state.gatewayUp ? "online" : "offline",
                     tint: state.gatewayUp ? OrionTheme.green : OrionTheme.red)
        }
    }

    /// The reference marks the active tab with a short underline rather than a
    /// filled pill. It is quieter, and at six tabs the filled version turned the
    /// whole bar into a row of competing buttons.
    private var tabBar: some View {
        HStack(spacing: 2) {
            ForEach(DashboardTab.allCases) { tab in
                Button { selectedTab = tab } label: {
                    VStack(spacing: 5) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 15, weight: .medium))
                        Text(tab.title)
                            .font(OrionTheme.mono(9, .semibold))
                            .tracking(0.6)
                        Capsule()
                            .fill(selectedTab == tab ? Color.white : .clear)
                            .frame(width: 18, height: 2)
                    }
                    .frame(width: 84, height: 52)
                    .foregroundStyle(selectedTab == tab ? OrionTheme.text : OrionTheme.textDim)
                    // SwiftUI otherwise uses only the icon and label glyphs as
                    // the hit region in this custom button style. The whole
                    // tab is deliberately one large target.
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(Color.black.opacity(0.35))
        .animation(.easeOut(duration: 0.18), value: selectedTab)
    }

    private var composer: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform")
                .foregroundStyle(cyan)
            TextField("Ask Orion anything…", text: $state.composer, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .focused($composerFocused)
                .foregroundStyle(.white.opacity(0.9))
                .onSubmit(submit)
            Button(action: submit) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .bold))
                    .padding(10)
                    .background(Circle().fill(canSend ? cyan : Color.white.opacity(0.12)))
                    .foregroundStyle(ink)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(10)
        .background(Capsule().fill(Color.black.opacity(0.35)).overlay(Capsule().stroke(cyan.opacity(0.35), lineWidth: 1)))
    }

    private var canSend: Bool { !state.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private func submit() { guard canSend else { return }; state.submitTyped(); composerFocused = true }

    private var now: Date { Date() }
    private var greeting: String { Calendar.current.component(.hour, from: now) < 12 ? "Good morning" : Calendar.current.component(.hour, from: now) < 18 ? "Good afternoon" : "Good evening" }
    private var dayProgress: Double { let hour = Calendar.current.component(.hour, from: now); return min(1, max(0.04, Double(hour) / 24)) }
    private var hoursLeft: Int { max(0, 24 - Calendar.current.component(.hour, from: now)) }
    private var energyTitle: String { let hour = Calendar.current.component(.hour, from: now); return hour < 12 ? "Morning setup" : hour < 17 ? "Active window" : "Evening reset" }
    private var phaseTitle: String { switch state.phase { case .idle: "Orion is ready"; case .listening: "Listening"; case .thinking: "Thinking"; case .speaking: "Speaking"; case .error: "Needs attention" } }
    private var phaseColor: Color { switch state.phase { case .idle: teal; case .listening: cyan; case .thinking: Color(red: 0.72, green: 0.43, blue: 1); case .speaking: amber; case .error: Color.red } }
}

// MARK: - Tabs
//
// One file-private view per tab, rather than five inline `case` bodies in one
// switch. The switch had grown to the point where the tabs could only be
// compared by scrolling, which is a large part of how they ended up identical.

/// Tasks. Added, ticked and deleted here; stored in Apple Reminders, so the
/// same list is on the phone and a dated one actually interrupts you.
private struct TasksTab: View {
    @ObservedObject var reminders: AppleRemindersSync
    @ObservedObject var agenda: AppleCalendarSync
    @Binding var newTask: String
    let dayProgress: Double
    let hoursLeft: Int
    let energyTitle: String

    @State private var dueDate = Date().addingTimeInterval(3600)
    @State private var wantsDueDate = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "The day",
                        trailing: Date().formatted(.dateTime.weekday(.wide).month().day()))
            OrionPanel {
                HStack(alignment: .center, spacing: 20) {
                    RingMeter(progress: dayProgress,
                              value: "\(Int(dayProgress * 100))%",
                              caption: energyTitle,
                              subcaption: Date().formatted(date: .omitted, time: .shortened),
                              tint: OrionTheme.orange)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(energyTitle)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(OrionTheme.text)
                        Text("\(hoursLeft)h of awake time left")
                            .font(OrionTheme.mono(12))
                            .foregroundStyle(OrionTheme.textSoft)
                        Text(summary)
                            .font(OrionTheme.mono(11))
                            .foregroundStyle(summaryTint)
                    }
                    Spacer()
                }
            }

            SectionRule(title: "Tasks",
                        trailing: "\(reminders.doneCount) / \(reminders.tasks.count) done")

            if !reminders.access.isGranted {
                OrionPanel { accessNotice }
            }

            OrionPanel {
                // One dash per task. "How much is left" without counting.
                HStack(spacing: 4) {
                    if reminders.tasks.isEmpty {
                        Capsule().fill(Color.white.opacity(0.07)).frame(height: 4)
                    } else {
                        ForEach(reminders.tasks) { task in
                            Capsule()
                                .fill(task.isComplete ? OrionTheme.green : Color.white.opacity(0.10))
                                .frame(height: 4)
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
                        .padding(.vertical, 6)
                } else {
                    VStack(spacing: 0) {
                        ForEach(reminders.tasks) { task in
                            TaskRow(task: task,
                                    onToggle: { reminders.setComplete(task.id, !task.isComplete) },
                                    onDelete: { reminders.remove(task.id) })
                            if task.id != reminders.tasks.last?.id {
                                Divider().overlay(OrionTheme.line)
                            }
                        }
                    }
                }

                composer
            }

            SectionRule(title: "Sync", trailing: reminders.access.isGranted ? "two-way" : "not connected")
            OrionPanel {
                DataRow(label: "Apple Reminders",
                        sublabel: "list “\(AppleRemindersSync.listTitle)” · edits on your phone appear here",
                        value: reminders.access.isGranted ? "ON" : "OFF",
                        valueTint: reminders.access.isGranted ? OrionTheme.green : OrionTheme.textDim)
                Text(reminders.statusLine)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
                if let error = reminders.lastError {
                    Text(error)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.red)
                }
            }

            SectionRule(title: "Today's agenda", trailing: agenda.statusLine)
            OrionPanel {
                if !agenda.access.isGranted {
                    Text(agenda.statusLine)
                        .font(OrionTheme.mono(11))
                        .foregroundStyle(OrionTheme.textDim)
                } else if agenda.events.isEmpty {
                    Text("Nothing on the calendar today.")
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.textDim)
                } else {
                    VStack(spacing: 0) {
                        ForEach(agenda.events) { event in
                            AgendaRow(event: event)
                            if event.id != agenda.events.last?.id {
                                Divider().overlay(OrionTheme.line)
                            }
                        }
                    }
                    if agenda.committedMinutesRemaining > 0 {
                        Text("\(agenda.committedMinutesRemaining / 60)h \(agenda.committedMinutesRemaining % 60)m still committed today.")
                            .font(OrionTheme.mono(10))
                            .foregroundStyle(OrionTheme.textDim)
                    }
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 9) {
            HStack(spacing: 9) {
                TextField("Add a task…", text: $newTask)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 10).fill(OrionTheme.cardRaised)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(OrionTheme.line, lineWidth: 1))
                    )
                    .onSubmit(add)
                Button { wantsDueDate.toggle() } label: {
                    Image(systemName: wantsDueDate ? "bell.fill" : "bell")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(wantsDueDate ? OrionTheme.orange : OrionTheme.textDim)
                        .frame(width: 36, height: 36)
                        .background(
                            RoundedRectangle(cornerRadius: 10).fill(OrionTheme.cardRaised)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(OrionTheme.line, lineWidth: 1))
                        )
                        .contentShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .help("Remind me at a time")
                Button(action: add) {
                    Text("Add")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(OrionTheme.ink)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(.white))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(!reminders.access.isGranted)
            }
            if wantsDueDate {
                HStack(spacing: 8) {
                    Image(systemName: "alarm")
                        .font(.system(size: 11))
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
                .foregroundStyle(OrionTheme.orange)
            VStack(alignment: .leading, spacing: 3) {
                Text("Reminders access is needed for the task list")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.text)
                Text(reminders.statusLine)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }
            Spacer(minLength: 8)
            Button {
                // Straight to the exact pane. Telling someone to "check
                // Privacy settings" and leaving them to find it is most of why
                // a denied permission stays denied.
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders") {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Text("Open Settings")
                    .font(OrionTheme.mono(10, .semibold))
                    .foregroundStyle(OrionTheme.blue)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(Capsule().stroke(OrionTheme.blue.opacity(0.4), lineWidth: 1))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
        }
    }

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
        HStack(spacing: 11) {
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
            Spacer(minLength: 8)

            if task.isOverdue {
                Text("OVERDUE")
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1)
                    .foregroundStyle(OrionTheme.red)
            }
            Button(action: onDelete) {
                Image(systemName: "trash")
                    .font(.system(size: 11))
                    .foregroundStyle(OrionTheme.textDim)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .opacity(hovering ? 1 : 0)
        }
        .padding(.vertical, 7)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
    }
}

/// Water, the daily stack, and the wearable that is not plugged in yet.
private struct HealthTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var whoop: WhoopClient
    @ObservedObject var connections: ConnectionsModel

    private let bottleTarget = 9
    private let supplementTarget = 10

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Water", trailing: "resets at 6 am")
            OrionPanel {
                BigStat(value: "\(state.hydrationBottles)",
                        unit: "/ \(bottleTarget)",
                        caption: "bottles drank today",
                        tint: OrionTheme.text)
                ZoneBar(value: state.hydrationBottles, target: bottleTarget, tint: OrionTheme.blue)
                HStack(spacing: 9) {
                    StepButton(systemImage: "minus") { state.removeHydration() }
                    LogButton(title: "Drank a bottle") { state.logHydration() }
                }
                Text(hydrationNote)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }

            SectionRule(title: "Daily stack", trailing: "\(state.supplementsLogged) / \(supplementTarget) taken")
            OrionPanel {
                ZoneBar(value: state.supplementsLogged, target: supplementTarget,
                        zoneLabel: "on track", tint: OrionTheme.violet)
                LogButton(title: "Took one", systemImage: "plus", tint: OrionTheme.violet) {
                    state.logSupplement()
                }
            }

            SectionRule(title: "Movement")
            OrionPanel {
                DataRow(label: "Workout",
                        sublabel: state.workoutLogged ? "logged today" : "not logged yet",
                        value: state.workoutLogged ? "DONE" : "—",
                        valueTint: state.workoutLogged ? OrionTheme.green : OrionTheme.textDim)
                LogButton(title: state.workoutLogged ? "Undo workout" : "Log workout",
                          systemImage: state.workoutLogged ? "arrow.uturn.backward" : "checkmark",
                          tint: state.workoutLogged ? OrionTheme.cardRaised : OrionTheme.green) {
                    state.toggleWorkoutLogged()
                }
            }

            SectionRule(title: "Whoop", trailing: connections.state(.whoop).label)
            OrionPanel {
                if let snapshot = whoop.snapshot {
                    HStack(alignment: .center, spacing: 20) {
                        RingMeter(progress: Double(snapshot.recovery ?? 0) / 100,
                                  value: "\(snapshot.recovery ?? 0)",
                                  caption: "recovery",
                                  tint: recoveryTint(snapshot.recovery),
                                  diameter: 112)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(snapshot.call.headline)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(recoveryTint(snapshot.recovery))
                            Text(snapshot.call.detail)
                                .font(.system(size: 12))
                                .foregroundStyle(OrionTheme.textSoft)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                    }
                    Divider().overlay(OrionTheme.line)
                    HStack(spacing: 8) {
                        if let value = snapshot.sleepPerformance {
                            StatChip(icon: "moon.fill", value: "\(value)%", tint: OrionTheme.violet)
                        }
                        if let value = snapshot.sleepHours {
                            StatChip(icon: "bed.double.fill", value: String(format: "%.1fh", value), tint: OrionTheme.violet)
                        }
                        if let value = snapshot.strain {
                            StatChip(icon: "flame.fill", value: String(format: "%.1f", value), tint: OrionTheme.orange)
                        }
                        if let value = snapshot.hrvMilliseconds {
                            StatChip(icon: "waveform.path.ecg", value: "\(value)ms", tint: OrionTheme.blue)
                        }
                        if let value = snapshot.restingHeartRate {
                            StatChip(icon: "heart.fill", value: "\(value)bpm", tint: OrionTheme.red)
                        }
                        Spacer()
                    }
                } else if connections.state(.whoop).isConnected {
                    Text(whoop.lastError ?? "Waiting for today's Whoop data…")
                        .font(OrionTheme.mono(11))
                        .foregroundStyle(OrionTheme.textDim)
                } else {
                    NotConnected(what: "Whoop",
                                 detail: "Recovery, sleep, strain and HRV. Set it up in Settings ▸ Connections.")
                }
            }
        }
    }

    private var hydrationNote: String {
        let remaining = bottleTarget - state.hydrationBottles
        if remaining <= 0 { return "Target hit. Anything more is a bonus." }
        return "\(state.hydrationBottles) down. \(remaining) to go — you're below the healthy zone."
    }
}

/// Money. Every row here is a connection, because none of it should be typed in
/// by hand and none of it is connected yet.
private struct FinanceTab: View {
    @ObservedObject var connections: ConnectionsModel
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Accounts", trailing: connections.state(.plaid).label)
            OrionPanel {
                NotConnected(what: "Chase", detail: "Balances and recent transactions, via Plaid.")
                Divider().overlay(OrionTheme.line)
                NotConnected(what: "Fidelity", detail: "Balances and positions, via Plaid.")
                Divider().overlay(OrionTheme.line)
                Text("Both banks connect through one Plaid account — set it up in Settings ▸ Connections.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }

            SectionRule(title: "How this will connect", trailing: "read-only")
            OrionPanel {
                // Straight from INTEGRATION_HANDOFF.md, on the screen rather
                // than in a document, because this is the moment it matters.
                Label("Plaid Link, with you present. Orion never sees or stores a bank password.",
                      systemImage: "lock.shield")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textSoft)
                Label("Account names, masked numbers, balances, recent transactions.",
                      systemImage: "eye")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textSoft)
                Label("Transfers, payments and trading stay out of scope entirely.",
                      systemImage: "xmark.shield")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.red.opacity(0.85))
            }

            SectionRule(title: "Subscriptions")
            OrionPanel {
                NotConnected(what: "Recurring charges",
                             detail: "Detected from transactions once an account is linked.")
            }
        }
    }
}

/// The brand tab: posting rhythm is local and real, follower counts need APIs.
private struct BrandTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var connections: ConnectionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Audience")
            OrionPanel {
                DataRow(label: "TikTok", sublabel: "follower count and recent post performance",
                        value: connections.state(.tiktok).isConnected ? "LIVE" : "OFF",
                        valueTint: connections.state(.tiktok).isConnected ? OrionTheme.green : OrionTheme.textDim)
                Divider().overlay(OrionTheme.line)
                DataRow(label: "Instagram", sublabel: "follower count and reel performance",
                        value: connections.state(.instagram).isConnected ? "LIVE" : "OFF",
                        valueTint: connections.state(.instagram).isConnected ? OrionTheme.green : OrionTheme.textDim)
                Divider().overlay(OrionTheme.line)
                DataRow(label: "YouTube", sublabel: "subscriber count — uses the Google connection",
                        value: connections.state(.google).isConnected ? "LIVE" : "OFF",
                        valueTint: connections.state(.google).isConnected ? OrionTheme.green : OrionTheme.textDim)
                Text("Set these up in Settings ▸ Connections.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }

            SectionRule(title: "Today's reflection")
            OrionPanel {
                Text("Where is the account going? What's working? What's failing?")
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(OrionTheme.textDim)
                Text("Say it to Orion and it lands in your notes — the composer on Home takes it in plain language.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
            }
        }
    }
}

private struct SettingsTab: View {
    @Binding var coreStyle: String
    @Binding var iconScale: Double
    @ObservedObject var connections: ConnectionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Orion core")
            OrionPanel {
                Picker("Visual", selection: $coreStyle) {
                    Text("Original Orion").tag("original")
                    Text("Black Hole").tag("blackHole")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Text("The floating voice hologram always stays Original Orion; this changes the dashboard centrepiece only.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }

            SectionRule(title: "Quick open")
            OrionPanel {
                HStack {
                    Text("Icon size")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OrionTheme.text)
                    Spacer()
                    Text("\(Int(iconScale * 100))%")
                        .font(OrionTheme.mono(11, .semibold))
                        .foregroundStyle(OrionTheme.blue)
                }
                Slider(value: $iconScale, in: 0.72...1.45, step: 0.05)
                    .tint(OrionTheme.blue)
                Text("Use Customize on Home to place the icons; this only changes their scale.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }

            SectionRule(title: "Voice timing")
            OrionPanel {
                DataRow(label: "Pause before Orion answers",
                        sublabel: "raise it if he cuts you off mid-sentence",
                        value: "\(VoiceTuning.endpointingMs) ms",
                        valueTint: OrionTheme.blue)
                Divider().overlay(OrionTheme.line)
                DataRow(label: "Stuck-speech watchdog",
                        sublabel: "forces the speaking phase to end if audio stalls",
                        value: "\(Int(VoiceTuning.stallTimeout)) s",
                        valueTint: OrionTheme.blue)
                Text("Orion can change these himself — just tell him to wait longer before answering.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }

            ConnectionsView(connections: connections)
        }
    }
}

/// One line of the day's agenda. Read-only, like everything calendar here.
private struct AgendaRow: View {
    let event: AgendaEvent

    var body: some View {
        HStack(spacing: 11) {
            Rectangle()
                .fill(event.isNow ? OrionTheme.green : (event.isPast ? OrionTheme.textDim.opacity(0.4) : OrionTheme.blue))
                .frame(width: 2, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(event.isPast ? OrionTheme.textDim : OrionTheme.text)
                    .lineLimit(1)
                Text(event.calendarName)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
            Spacer(minLength: 8)
            if event.isNow {
                Text("NOW")
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1)
                    .foregroundStyle(OrionTheme.green)
            }
            Text(event.timeLabel)
                .font(OrionTheme.mono(11, .semibold))
                .foregroundStyle(event.isPast ? OrionTheme.textDim : OrionTheme.textSoft)
        }
        .padding(.vertical, 7)
    }
}

private func recoveryTint(_ recovery: Int?) -> Color {
    guard let recovery else { return OrionTheme.textDim }
    if recovery >= 67 { return OrionTheme.green }
    if recovery >= 34 { return OrionTheme.orange }
    return OrionTheme.red
}

private enum DashboardTab: String, CaseIterable, Identifiable {
    case home, focus, health, finance, brand, settings
    var id: String { rawValue }

    /// Spelled out rather than derived from `rawValue`. The focus tab is a task
    /// list backed by Apple Reminders now, and "Focus" described the thing it
    /// used to be — a scratch list that lived and died in this window.
    var title: String {
        switch self {
        case .home: "Home"
        case .focus: "Tasks"
        case .health: "Health"
        case .finance: "Finances"
        case .brand: "Brand"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .home: "house.fill"
        case .focus: "checklist"
        case .health: "heart.fill"
        case .finance: "dollarsign.circle"
        case .brand: "megaphone.fill"
        case .settings: "gearshape.fill"
        }
    }
}

private struct SectionHero: View {
    let title: String; let subtitle: String; let icon: String; let color: Color
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 22, weight: .semibold)).foregroundStyle(color)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 28, weight: .bold, design: .rounded)).foregroundStyle(.white.opacity(0.94))
                Text(subtitle).font(.system(size: 13)).foregroundStyle(.white.opacity(0.55))
            }
            Spacer()
        }
        .padding(22)
        .cardBackground(Color(red: 0.045, green: 0.061, blue: 0.088))
    }
}

private struct QuickOpenWheel: View {
    @ObservedObject var settings: QuickOpenSettings
    @Binding var isExpanded: Bool
    var onCustomize: () -> Void
    var body: some View {
        HStack(spacing: 10) {
            Button { withAnimation(.spring(response: 0.32, dampingFraction: 0.8)) { isExpanded.toggle() } } label: {
                ZStack {
                    // A stroked circle has an almost-empty hit region. This
                    // transparent fill makes the entire hollow center clickable
                    // without changing how it looks.
                    Circle().fill(Color.black.opacity(0.001))
                    Circle().stroke(Color.white.opacity(0.24), lineWidth: 1.3)
                    Circle().stroke(Color(red: 0.18, green: 0.83, blue: 1).opacity(0.35), lineWidth: 5).blur(radius: 4)
                }
                .frame(width: 38, height: 38)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Quick Open")
            if isExpanded {
                HStack(spacing: 8) {
                    ForEach(settings.items) { target in
                        Button { settings.open(target) } label: {
                            Text(target.icon.isEmpty ? "✦" : target.icon)
                                .font(.system(size: 15, weight: .semibold))
                                .frame(width: 34, height: 34)
                                .foregroundStyle(Color.white.opacity(0.85))
                                .background(Circle().fill(Color.white.opacity(0.07)))
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .help(target.name)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .leading)))
            }
            Button("Customize", action: onCustomize)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.5))
        }
    }
}

private struct DashboardCard<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            Label(title, systemImage: icon)
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(.white.opacity(0.52))
            content
        }
        .padding(18)
        .cardBackground(Color(red: 0.045, green: 0.061, blue: 0.088))
    }
}

private struct ConnectionRow: View {
    let name: String; let detail: String; let color: Color
    var body: some View {
        HStack(spacing: 9) {
            Circle().fill(color).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.84))
                Text(detail).font(.system(size: 11)).foregroundStyle(.white.opacity(0.45))
            }
            Spacer()
        }
    }
}

private struct FocusRow: View {
    let text: String
    var body: some View {
        HStack(spacing: 9) {
            Circle().stroke(Color.white.opacity(0.36), lineWidth: 1.5).frame(width: 16, height: 16)
            Text(text).font(.system(size: 12)).foregroundStyle(.white.opacity(0.72))
            Spacer()
        }
    }
}

/// Intentionally empty until the user connects WHOOP. A clean unconnected
/// state is more useful than fabricated recovery data.
private struct WhoopSurface: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("WHOOP", systemImage: "waveform.path.ecg")
                .font(.system(size: 10, weight: .semibold)).tracking(1.5)
                .foregroundStyle(.white.opacity(0.5))
            HStack(spacing: 10) {
                Circle().stroke(Color.white.opacity(0.17), lineWidth: 1.4).frame(width: 42, height: 42)
                    .overlay(Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.34)))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Not connected")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white.opacity(0.78))
                    Text("Recovery, sleep, and strain will appear here.")
                        .font(.system(size: 11)).foregroundStyle(.white.opacity(0.42))
                }
            }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.025)))
    }
}

private struct DayProgressSurface: View {
    let progress: Double; let title: String; let hoursLeft: Int; let cyan: Color
    var body: some View {
        VStack(spacing: 9) {
            Text("DAY PROGRESS").font(.system(size: 10, weight: .semibold)).tracking(1.7).foregroundStyle(.white.opacity(0.48))
            ZStack {
                Circle().stroke(Color.white.opacity(0.11), lineWidth: 11)
                // A linear gradient has no angular seam at zero, so the
                // leading cap stays round and luminous instead of starting as
                // a visibly flat half-ring.
                Circle().trim(from: 0, to: progress)
                    .stroke(LinearGradient(colors: [cyan, cyan.opacity(0.38)], startPoint: .topLeading, endPoint: .bottomTrailing), style: StrokeStyle(lineWidth: 11, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 1) {
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                    Text(title.uppercased()).font(.system(size: 9, weight: .semibold)).tracking(1.1).foregroundStyle(cyan)
                }
            }
            .frame(width: 158, height: 158)
            Text("\(hoursLeft) hours left today").font(.system(size: 11)).foregroundStyle(.white.opacity(0.46))
        }
    }
}

/// Home's compact task list.
///
/// Same visual design as before -- Home was the surface that already worked and
/// was explicitly not to be restyled. What changed is underneath: it reads the
/// same Apple Reminders list the Tasks tab does, rather than the local scratch
/// list it used to own. Two task lists that disagree is a bug, not a feature,
/// and it would have been one the moment the Tasks tab shipped.
private struct FocusSurface: View {
    @ObservedObject var reminders: AppleRemindersSync
    @Binding var newTask: String
    let cyan: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("TODAY'S FOCUS", systemImage: "target")
                    .font(.system(size: 10, weight: .semibold)).tracking(1.5).foregroundStyle(.white.opacity(0.52))
                Spacer()
                Text("\(reminders.doneCount)/\(reminders.tasks.count)")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(cyan)
            }
            if reminders.tasks.isEmpty {
                Text("Add the one thing that matters next.").font(.system(size: 12)).foregroundStyle(.white.opacity(0.43))
            } else {
                ForEach(reminders.tasks) { task in
                    HStack(spacing: 9) {
                        Button { reminders.setComplete(task.id, !task.isComplete) } label: {
                            Image(systemName: task.isComplete ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(task.isComplete ? cyan : .white.opacity(0.42))
                                .font(.system(size: 17))
                                .frame(width: 24, height: 24)
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Text(task.title).font(.system(size: 12))
                            .strikethrough(task.isComplete, color: .white.opacity(0.4))
                            .foregroundStyle(task.isComplete ? .white.opacity(0.35) : .white.opacity(0.75))
                            .lineLimit(1)
                        Spacer()
                        Button { reminders.remove(task.id) } label: {
                            Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 22, height: 22).contentShape(Rectangle())
                        }.buttonStyle(.plain).foregroundStyle(.white.opacity(0.28))
                    }
                }
            }
            HStack(spacing: 7) {
                TextField("Add a focus…", text: $newTask)
                    .textFieldStyle(.plain).font(.system(size: 12))
                    .onSubmit(addTask)
                Button(action: addTask) { Image(systemName: "plus").font(.system(size: 11, weight: .bold)).frame(width: 26, height: 24).contentShape(Rectangle()) }
                    .buttonStyle(.plain).foregroundStyle(cyan)
            }
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(Capsule().fill(Color.white.opacity(0.045)))
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.025)))
    }
    private func addTask() { reminders.add(newTask); newTask = "" }
}

private struct MetricTile: View {
    let title: String; let value: String; let suffix: String; let color: Color
    let actionTitle: String; let action: () -> Void
    var secondaryActionTitle: String? = nil
    var secondaryAction: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 9, weight: .semibold)).tracking(1.1).foregroundStyle(color)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.system(size: 24, weight: .bold, design: .rounded))
                Text(suffix).font(.system(size: 10)).foregroundStyle(.white.opacity(0.46))
            }
        }
        HStack(spacing: 5) {
            Button(action: action) {
                Text(actionTitle)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(color.opacity(0.12)))
            }
            if let secondaryActionTitle, let secondaryAction {
                Button(action: secondaryAction) {
                    Text(secondaryActionTitle).font(.system(size: 13, weight: .bold)).foregroundStyle(color).frame(width: 28, height: 28).background(Circle().fill(color.opacity(0.1))).contentShape(Circle())
                }
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.22)))
    }
}

private struct StatusPill: View {
    let title: String; let color: Color
    var body: some View {
        HStack(spacing: 6) { Circle().fill(color).frame(width: 6, height: 6); Text(title) }
            .font(.system(size: 10, weight: .bold)).tracking(1).foregroundStyle(color)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Capsule().fill(color.opacity(0.11)))
    }
}

private extension View {
    func cardBackground(_ color: Color) -> some View {
        background(RoundedRectangle(cornerRadius: 18).fill(color).overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.white.opacity(0.08), lineWidth: 1)))
    }
}
