import AppKit
import SwiftUI

/*
 Orion's desktop command center — the shell only.

 This file used to be 1,400 lines holding six tabs, twelve private subviews and
 two entire layouts that nothing referenced any more. The tabs could only be
 compared by scrolling past each other, which is a large part of how they ended
 up looking identical. Each one lives in its own file now; what is left here is
 the chrome: the header, the navigation, and the surface everything floats on.

 The floating orb stays deliberately separate. That surface is for quick,
 interruption-free voice interaction; this is where a deliberate click goes.
*/

struct DashboardView: View {
    @ObservedObject var state: AppState
    var onDismiss: () -> Void

    @State private var selectedTab: DashboardTab = .home
    @Namespace private var navUnderline

    @State private var quickOpenEditorVisible = false
    @State private var quickOpenAppPickerVisible = false
    @State private var newFocusTask = ""

    @StateObject private var quickOpen = QuickOpenSettings()
    /// The task list lives in Apple Reminders, not in AppState — see
    /// AppleRemindersSync for why a task Orion can only show on this Mac is a
    /// worse to-do list than the one already on your phone.
    @StateObject private var reminders = AppleRemindersSync()
    @StateObject private var agenda = AppleCalendarSync()

    /// The calendar's own model, built here because it needs the same EventKit
    /// syncs this view already owns. Fetches the visible interval plus padding
    /// rather than a fixed window, so paging never shows a blank edge.
    ///
    /// `@State` holding an optional, built on first use: it cannot be a
    /// `@StateObject` initialiser because it needs `reminders` and `agenda`,
    /// which are themselves `@StateObject`s and not available at init.
    @State private var calendarModelStorage: CalendarModel?

    private func calendarModel(_ state: AppState) -> CalendarModel {
        if let calendarModelStorage { return calendarModelStorage }
        let built = CalendarModel(agenda: agenda, reminders: reminders,
                                  history: state.session.history, health: health)
        DispatchQueue.main.async { calendarModelStorage = built }
        return built
    }
    @StateObject private var connections = ConnectionsModel()
    /// Deliberately NOT loaded here. `load()` runs from the Settings view's
    /// `onAppear`, so opening the dashboard does not read openclaw.json —
    /// nothing new goes on the launch path. See SecretStore.queue.
    @StateObject private var capabilities = CapabilitiesModel()
    @StateObject private var whoop = WhoopClient()
    @StateObject private var health = HealthLog()
    @StateObject private var plaid = PlaidClient()
    @StateObject private var contacts = ContactsClient()
    @StateObject private var messages = MessagesReader()
    /// What day it is for a person — see OrionDay. Everything that buckets by
    /// day reads this rather than the civil date.
    @StateObject private var dayModel = DayModel()
    @StateObject private var briefWriter = NarrativeWriter()
    @StateObject private var healthWriter = NarrativeWriter()
    @StateObject private var financeWriter = NarrativeWriter()
    @State private var briefPresentation: BriefPresentation = .parked
    @State private var sessionPreview: SessionPreview?

    private enum SessionPreview { case focus, breakTime }

    /// Bound so the Settings controls change the surface live rather than on
    /// the next launch.
    @AppStorage(SurfaceSettings.opacityKey) private var surfaceOpacity = SurfaceSettings.defaultOpacity
    @AppStorage(SurfaceSettings.blurKey) private var surfaceBlur = false
    @AppStorage("orion.dashboard.coreStyle") private var coreStyle = "blackHole"
    @AppStorage("orion.quickOpen.iconScale") private var iconScale = 1.0

    var body: some View {
        VStack(spacing: 0) {
            // Header and navigation carry their own scrim, so they stay
            // readable over any wallpaper while the body of the window stays
            // as transparent as the slider says it is. That local trade is
            // what lets the default be genuinely see-through.
            VStack(spacing: 0) {
                header
                navigation
            }
            .chromeScrim(edge: .top, strength: 0.5)

            // Two content shapes, because the tabs are two different kinds of
            // thing. The reading tabs are documents: a column capped at a
            // comfortable measure and set against the left margin, so the eye
            // does not have to travel the width of a 6K display to find the
            // next line. Home is a scene — the orb, and the apps in orbit
            // around it — so it takes the whole window and centres in it.
            //
            // Giving Home the document treatment is what shrank it: the
            // launcher field sizes itself from its container, so capping the
            // width pulled every icon inward, and the left alignment slid the
            // whole constellation off centre.
            //
            // Home is NOT vertically centred, and that was a wrong turn worth
            // recording. Centring 600pt of content in 900pt of window splits
            // the slack evenly — which puts 150pt of nothing between the
            // navigation and the top of the orb. It sits at the top and the orb
            // is sized from the height instead, so the space goes into the
            // artwork rather than above it.
            GeometryReader { proxy in
                ScrollView {
                    if selectedTab.fillsWindow {
                        tabContent(availableHeight: proxy.size.height - 24)
                            .padding(.horizontal, 22)
                            .padding(.top, 6)
                            .padding(.bottom, 18)
                            .frame(maxWidth: .infinity)
                    } else if selectedTab == .tasks {
                        // A vertical ScrollView gives its child an ideal width,
                        // not a promise to fill the viewport. Tasks needs the
                        // measured window width so its calendar can genuinely
                        // reach the right side instead of stopping at an old
                        // document-style ideal size.
                        tabContent(availableHeight: proxy.size.height - 86,
                                   availableWidth: max(0, proxy.size.width - 92))
                            .padding(.horizontal, 46)
                            .padding(.top, 26)
                            .padding(.bottom, 60)
                            .frame(width: proxy.size.width, alignment: .leading)
                    } else {
                        // Minus its own vertical padding, the same way the
                        // branch above nets off its 6+18. A tab told it has the
                        // full window and then padded by 86 sizes itself 86pt
                        // too tall and makes the page scroll for no reason.
                        tabContent(availableHeight: proxy.size.height - 86)
                            .padding(.horizontal, 46)
                            .padding(.top, 26)
                            .padding(.bottom, 60)
                            .frame(maxWidth: 1180, alignment: .leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .overlay {
            if state.sessionTabModel.isActiveFocus || sessionPreview == .focus {
                FocusSessionHome(
                    hologram: state.hologram,
                    model: state.sessionTabModel,
                    isPreview: sessionPreview == .focus,
                    onExitPreview: sessionPreview == .focus ? { sessionPreview = nil } : nil,
                    onDismiss: onDismiss
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea()
                .transition(.opacity)
                .zIndex(10)
            } else if sessionPreview == .breakTime {
                ZStack(alignment: .topTrailing) {
                    BreakSanctuaryView(
                        remaining: 600,
                        progress: 0,
                        prompt: "Preview the reset surface before a real break takes over.",
                        guided: true,
                        presence: nil,
                        onHoldExit: { sessionPreview = nil }
                    )
                    Button("Exit preview") { sessionPreview = nil }
                        .buttonStyle(.plain)
                        .font(OrionTheme.mono(9, .semibold))
                        .tracking(1.4)
                        .foregroundStyle(OrionTheme.textSoft)
                        .padding(26)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea()
                .zIndex(10)
            }
        }
        .onChange(of: briefPresentation) { _, next in
            next.store(for: dayModel.day)
        }
        // Whoop landing a wake time can change which day it is, so re-read
        // rather than leaving the window describing the day it opened on.
        .onChange(of: whoop.snapshot) { _, _ in
            dayModel.refresh()
            loadBrief()
        }
        // Every day the watch scored, written to the health log — from here
        // rather than from the Health tab, so it happens whichever tab is open.
        // Whoop's week is the only input that arrives on days Nick did nothing
        // else, and it is what lets the calendar colour them.
        .onChange(of: whoop.week) { _, week in
            health.recordWearable(week.readingsByDay)
        }
        .onChange(of: agenda.events) { _, _ in loadBrief() }
        .onChange(of: reminders.tasks) { _, _ in loadBrief() }
        .dashboardSurface(opacity: surfaceOpacity, blur: surfaceBlur)
        .preferredColorScheme(.dark)
        .onAppear(perform: start)
        .onDisappear(perform: stop)
        .sheet(isPresented: $quickOpenEditorVisible) { QuickOpenEditor(settings: quickOpen) }
        .sheet(isPresented: $quickOpenAppPickerVisible) {
            QuickOpenAppPicker(settings: quickOpen) { app in
                quickOpen.addApplication(app)
                quickOpenAppPickerVisible = false
            }
        }
    }

    // MARK: - Lifecycle

    private func start() {
        // Read the day's state BEFORE noting the session, since noting it is
        // what makes this no longer the first session.
        briefPresentation = BriefPresentation.stored(
            for: dayModel.day,
            isFirstSession: dayModel.isFirstSession
        )
        dayModel.noteSession()
        // Surfaces a paragraph already written for this day immediately, rather
        // than waiting for a client to publish something.
        loadBrief()

        // Prompts for Reminders access the first time, then keeps the list live
        // off EKEventStoreChanged.
        reminders.start()
        agenda.start()
        whoop.start()
        health.start()
        contacts.start()
        // Handed the contact book so a thread reads as a person rather than a
        // phone number.
        messages.contacts = contacts
        messages.start()
        // Plaid's flow lives in its own client; hand it to the model so Connect
        // can run it.
        connections.plaid = plaid
        plaid.refresh()
        // The moment a grant lands, pull data. Without this a client only
        // discovers the new token on its own 15-minute tick, so connecting
        // looked like it had silently done nothing.
        connections.onConnected = { connector in
            if connector == .whoop { whoop.refresh() }
            if connector == .plaid { plaid.refresh() }
        }
    }

    /// The brief's paragraph, and only when there is something to say about.
    private func loadBrief() {
        let facts = briefFacts
        briefWriter.load(key: facts.narrativeKey) {
            facts.hasAnything ? facts.prompt() : nil
        }
    }

    private func stop() {
        reminders.stop()
        agenda.stop()
        whoop.stop()
        health.stop()
        messages.stop()
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 3) {
                Text("ORION")
                    .font(.system(size: 13, weight: .semibold))
                    .tracking(7)
                    .foregroundStyle(OrionTheme.accent)
                Text(greeting)
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textSoft)
            }

            Spacer(minLength: 24)

            // The handful of numbers that should be true on every tab, inline
            // in the header rather than in a second strip of pills below it.
            // Six capsules stacked under a title bar was two rows of chrome
            // before any content had been reached.
            vitals

            Text(Date(), style: .time)
                .font(OrionTheme.mono(12))
                .foregroundStyle(OrionTheme.textSoft)

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(OrionTheme.textDim)
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 46)
        .padding(.top, 20)
        .padding(.bottom, 16)
    }

    private var vitals: some View {
        HStack(spacing: 16) {
            StatChip(icon: "drop.fill", value: "\(health.hydrationBottles)", tint: OrionTheme.blue)
            hairline
            StatChip(icon: "pills.fill", value: "\(health.takenToday.count)", tint: OrionTheme.violet)
            hairline
            StatChip(icon: "checkmark.circle",
                     value: "\(reminders.doneCount)/\(reminders.tasks.count)",
                     tint: OrionTheme.orange)
            if reminders.overdueCount > 0 {
                hairline
                StatChip(icon: "exclamationmark.triangle.fill",
                         value: "\(reminders.overdueCount) overdue",
                         tint: OrionTheme.red)
            }
            if messages.unreadTotal > 0 {
                hairline
                StatChip(icon: "bubble.left.fill",
                         value: "\(messages.unreadTotal)",
                         tint: OrionTheme.accent)
            }
            hairline
            StatChip(icon: state.gatewayUp ? "bolt.fill" : "bolt.slash.fill",
                     value: state.gatewayUp ? "online" : "offline",
                     tint: state.gatewayUp ? OrionTheme.green : OrionTheme.red)
        }
        .fixedSize()
    }

    private var hairline: some View {
        Rectangle()
            .fill(Color.white.opacity(0.10))
            .frame(width: 1, height: 11)
    }

    // MARK: - Navigation

    /// Left-aligned text navigation with a sliding underline, rather than a
    /// filled bar of six equal buttons pinned to the bottom of the window.
    ///
    /// The underline travels with `matchedGeometryEffect`, so switching tabs
    /// reads as one continuous movement instead of one marker vanishing and
    /// another appearing somewhere else.
    private var navigation: some View {
        HStack(spacing: 30) {
            ForEach(DashboardTab.allCases) { tab in
                NavItem(
                    tab: tab,
                    isSelected: selectedTab == tab,
                    namespace: navUnderline
                ) {
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                        selectedTab = tab
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 46)
        .padding(.bottom, 2)
        .overlay(alignment: .bottom) { FadingRule() }
    }

    // MARK: - Content

    /// Everything the brief knows, gathered from the clients that already have
    /// it. Cheap enough to recompute — it is a fold over lists the views are
    /// already holding, and keeping it derived means it can never disagree with
    /// what the Health and Tasks tabs are showing.
    private var briefFacts: BriefFacts {
        let today = Calendar.current.startOfDay(for: Date())
        let open = reminders.tasks.filter { !$0.isComplete }
        return BriefFacts(
            day: dayModel.day,
            wokeAt: dayModel.wokeAt,
            signal: PlanningSignal.derive(
                recovery: whoop.snapshot?.recovery,
                sleepPerformance: whoop.snapshot?.sleepPerformance,
                sleepHours: whoop.snapshot?.sleepHours,
                strain: whoop.snapshot?.strain,
                sampleCount: whoop.week.readingsByDay.count,
                readingAgeHours: nil
            ),
            strainAdvice: StrainPosition.of(
                strain: whoop.snapshot?.strain,
                band: StrainTarget.forRecovery(whoop.snapshot?.recovery)
            ).line.replacingOccurrences(of: "- ", with: ""),
            readings: BriefFacts.Readings(
                recovery: whoop.snapshot?.recovery,
                sleepPerformance: whoop.snapshot?.sleepPerformance,
                sleepHours: whoop.snapshot?.sleepHours,
                hrvDelta: whoop.week.hrv.deltaLabel(),
                restingHeartRate: whoop.snapshot?.restingHeartRate,
                strainTarget: StrainTarget.forRecovery(whoop.snapshot?.recovery)
            ),
            events: agenda.events,
            committedMinutes: agenda.committedMinutesRemaining,
            dueToday: open.filter {
                guard let due = $0.dueDate, !$0.isOverdue else { return false }
                return Calendar.current.startOfDay(for: due) == today
            },
            overdue: open.filter(\.isOverdue),
            calendarConnected: agenda.access.isGranted,
            tasksConnected: reminders.access.isGranted
        )
    }

    @ViewBuilder private func tabContent(
        availableHeight: CGFloat,
        availableWidth: CGFloat? = nil
    ) -> some View {
        Group {
            switch selectedTab {
            case .home:
                HomeTab(state: state,
                        quickOpen: quickOpen,
                        writer: briefWriter,
                        coreStyle: coreStyle,
                        brief: briefFacts,
                        presentation: $briefPresentation,
                        availableHeight: availableHeight,
                        onAddApp: { quickOpenAppPickerVisible = true },
                        onManage: { quickOpenEditorVisible = true },
                        onPreviewFocus: { sessionPreview = .focus },
                        onPreviewBreak: { sessionPreview = .breakTime })
            case .tasks:
                TasksTab(reminders: reminders, agenda: agenda, newTask: $newFocusTask,
                         dayProgress: dayProgress, hoursLeft: hoursLeft,
                         energyTitle: energyTitle, availableHeight: availableHeight,
                         availableWidth: availableWidth ?? 1_180,
                         calendar: calendarModel(state))
            case .project:
                ProjectTab()
            case .health:
                HealthTab(state: state, whoop: whoop, health: health,
                          connections: connections, day: dayModel.day,
                          writer: healthWriter)
            case .finance:
                FinanceTab(connections: connections, plaid: plaid,
                           writer: financeWriter, day: dayModel.day)
            case .brand:
                BrandTab(connections: connections)
            case .settings:
                SettingsTab(coreStyle: $coreStyle, iconScale: $iconScale,
                            surfaceOpacity: $surfaceOpacity, surfaceBlur: $surfaceBlur,
                            connections: connections, agenda: agenda,
                            messagesAccess: messages.access,
                            onRecheck: { messages.refresh() },
                            focusExtras: state.focusExtras,
                            capabilities: capabilities,
                            focusControl: state.focusControl,
                            focusConfigured: state.focusShortcutConfigured,
                            focusSetup: state.focusSetup,
                            onRecheckFocus: { state.recheckFocusShortcut() })
            }
        }
        // Content rises slightly as it arrives, which is what makes the tabs
        // feel like one surface changing rather than six screens swapping.
        .transition(.opacity.combined(with: .offset(y: 10)))
        .id(selectedTab)
    }

    // MARK: - Derived

    private var now: Date { Date() }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: now)
        if hour < 12 { return "Good morning" }
        if hour < 18 { return "Good afternoon" }
        return "Good evening"
    }

    private var dayProgress: Double {
        min(1, max(0.04, Double(Calendar.current.component(.hour, from: now)) / 24))
    }

    private var hoursLeft: Int {
        max(0, 24 - Calendar.current.component(.hour, from: now))
    }

    private var energyTitle: String {
        let hour = Calendar.current.component(.hour, from: now)
        if hour < 12 { return "Morning setup" }
        if hour < 17 { return "Active window" }
        return "Evening reset"
    }
}

// MARK: - Navigation item

private struct NavItem: View {
    let tab: DashboardTab
    let isSelected: Bool
    let namespace: Namespace.ID
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                HStack(spacing: 7) {
                    Image(systemName: tab.icon)
                        .font(.system(size: 11, weight: .semibold))
                    Text(tab.title)
                        .font(.system(size: 12, weight: isSelected ? .semibold : .medium))
                }
                .foregroundStyle(tint)

                // The underline is one view that moves between tabs, not one
                // per tab being shown and hidden.
                ZStack {
                    Capsule().fill(Color.clear).frame(height: 2)
                    if isSelected {
                        Capsule()
                            .fill(OrionTheme.accent)
                            .frame(height: 2)
                            .matchedGeometryEffect(id: "nav.underline", in: namespace)
                            .shadow(color: OrionTheme.accent.opacity(0.7), radius: 5)
                    }
                }
            }
            .padding(.top, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering)
    }

    private var tint: Color {
        if isSelected { return OrionTheme.text }
        return hovering ? OrionTheme.textSoft : OrionTheme.textDim
    }
}

// MARK: - Tabs

enum DashboardTab: String, CaseIterable, Identifiable {
    case home, tasks, project, health, finance, brand, settings
    var id: String { rawValue }

    /// Spelled out rather than derived from `rawValue`.
    ///
    /// The case used to be called `focus` while rendering a task list, which was
    /// a leftover from when it was a scratch list that lived and died in this
    /// window. It is `tasks` now, and `session` is the actual focus session —
    /// keeping the old name would have meant two different things called focus
    /// sitting next to each other in the same enum.
    var title: String {
        switch self {
        case .home: "Home"
        case .tasks: "Tasks"
        case .project: "Project"
        case .health: "Health"
        case .finance: "Finances"
        case .brand: "Brand"
        case .settings: "Settings"
        }
    }

    /// True for a tab that is a scene rather than a document — it wants the
    /// whole window and centres in it, instead of a capped reading column.
    var fillsWindow: Bool { self == .home }

    var icon: String {
        switch self {
        case .home: "circle.hexagongrid"
        case .tasks: "checklist"
        case .project: "point.3.connected.trianglepath.dotted"
        case .health: "heart"
        case .finance: "chart.line.uptrend.xyaxis"
        case .brand: "megaphone"
        case .settings: "slider.horizontal.3"
        }
    }
}

// MARK: - Shared

/// Recovery's colour, shared by the Health tab and anything that summarises it.
func recoveryTint(_ recovery: Int?) -> Color {
    guard let recovery else { return OrionTheme.textDim }
    if recovery >= 67 { return OrionTheme.green }
    if recovery >= 34 { return OrionTheme.orange }
    return OrionTheme.red
}
