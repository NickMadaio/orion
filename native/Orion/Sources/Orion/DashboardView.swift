import AppKit
import OrionViews
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

    init(state: AppState, onDismiss: @escaping () -> Void) {
        self.state = state
        self.onDismiss = onDismiss
        self._reminders = ObservedObject(wrappedValue: state.todoSync)
    }

    // `-orion.initialTab project` on launch opens that tab: how a screenshot
    // check reaches a tab without synthetic clicks. Never persisted.
    @State private var selectedTab: DashboardTab =
        UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)["orion.initialTab"]
            .flatMap { $0 as? String }.flatMap(DashboardTab.init(rawValue:)) ?? .home
    /// Which way the last tab change travelled, and where the nav items sit, so the new page can slide in from
    /// that side and grow out of the item that was clicked (Motion/PageTransition.swift).
    @State private var travelForward = true
    @State private var navCenters: [DashboardTab: CGFloat] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// What the new Home reads beyond the brief (Home/HomeSignalsReader.swift), refreshed with the brief clock.
    @State private var homeSignals = HomeSignals()
    /// The task list lives in Apple Reminders, not in AppState — see
    /// AppleRemindersSync for why a task Orion can only show on this Mac is a
    /// worse to-do list than the one already on your phone.
    /// Owned by AppState: the session float's to-do dropdown reads the same one.
    @ObservedObject private var reminders: AppleRemindersSync
    @StateObject private var agenda = AppleCalendarSync()
    @StateObject private var todayPlan = TodayPlanModel()
    /// Plan requests from the phone, and plan changes saved by it, every few seconds.
    @StateObject private var phoneTicker = RefreshTicker(interval: 3)
    @State private var phonePlans = PhonePlanRequests()
    @State private var lifeWatch = LifeWatch()
    @State private var glanceExport = GlanceExport()
    /// The Knowledge tab's graph and his edits to it (KnowledgeStore.swift).
    @StateObject private var knowledge = KnowledgeStore()

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
    @AppStorage("orion.dashboard.coreStyle") private var coreStyle = "thinkingOrion"
    @AppStorage("orion.quickOpen.iconScale") private var iconScale = 1.0

    @State private var briefClock = BriefClock(now: Date())
    // 2026-10-16 UI audit #3: this was a Timer.publish stored on the View struct,
    // re-created (and so restarted) on every parent render. RefreshTicker is
    // owned by SwiftUI across renders; see ProjectRefresh.swift.
    @StateObject private var briefTicker = RefreshTicker(interval: 30)

    var body: some View {
        VStack(spacing: 0) {
            // Header and navigation carry their own scrim, so they stay
            // readable over any wallpaper while the body of the window stays
            // as transparent as the slider says it is. That local trade is
            // what lets the default be genuinely see-through.
            navigation
                .chromeScrim(edge: .top, strength: 0.5)

            // Two content shapes, because the tabs are two different kinds of
            // thing. The reading tabs are documents: a column capped at a
            // comfortable measure and set against the left margin, so the eye
            // does not have to travel the width of a 6K display to find the
            // next line. Home is a scene — greeting, card spread, composer —
            // so it takes the whole window and lays out against its height:
            // the composer sits at the bottom, not under the last card.
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
                        //
                        // Wave 14: and the Plan page does not scroll as a page. It is handed exactly the
                        // viewport (minus its 26 + 18 padding) and its two columns scroll on their own; with
                        // bounce based on size below, the outer ScrollView has nothing to move.
                        tabContent(availableHeight: max(0, proxy.size.height - 44),
                                   availableWidth: max(0, proxy.size.width - 92))
                            .padding(.horizontal, 46)
                            .padding(.top, 26)
                            .padding(.bottom, 18)
                            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
                    } else if selectedTab == .project || selectedTab == .knowledge {
                        // Projects is a workspace: the workflow graph owns the
                        // right third, so the document-column cap would leave
                        // exactly the space it needs sitting blank.
                        tabContent(availableHeight: proxy.size.height - 70,
                                   availableWidth: max(0, proxy.size.width - 64))
                            .padding(.horizontal, 32)
                            .padding(.top, 18)
                            .padding(.bottom, 52)
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
                .scrollBounceBehavior(selectedTab == .tasks ? .basedOnSize : .automatic, axes: .vertical)
            }
        }
        .onChange(of: state.sessionTabModel.hasLiveSession) { _, live in if !live { state.sessionMinimized = false } }
        .overlay {
            if (state.sessionTabModel.isActiveFocus && !state.sessionMinimized) || sessionPreview == .focus {
                FocusSessionHome(
                    hologram: state.hologram,
                    model: state.sessionTabModel,
                    isPreview: sessionPreview == .focus,
                    onExitPreview: sessionPreview == .focus ? { sessionPreview = nil } : nil,
                    onDismiss: onDismiss,
                    onMinimize: sessionPreview == .focus ? nil : { withAnimation(OrionMotion.resolved(OrionMotion.page, reduceMotion: reduceMotion)) { state.sessionMinimized = true } }
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
        .onReceive(briefTicker.$tick.dropFirst()) { _ in
            let instant = Date()
            let previous = briefClock
            let current = BriefClock(now: instant)
            briefClock = current
            dayModel.refresh()
            state.refreshEarlyContext()
            if current.needsSourceRefresh(after: previous) {
                agenda.refresh(); reminders.refresh(); refreshPlanSources()
            }
            // Clear a paragraph when a deadline passes or remaining time changes.
            // Clock-only drift does not warrant another model request.
            loadBrief(allowGeneration: current.needsSourceRefresh(after: previous) || previous.hour != current.hour)
            refreshHomeSignals()
        }
        // Back from a conversation: the question it answered should leave Home now, not on the next tick.
        .onChange(of: state.chatMode) { _, chatting in if !chatting { refreshHomeSignals() } }
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
        .onChange(of: agenda.windowEvents) { _, _ in loadBrief() }
        .onChange(of: agenda.lastError) { _, _ in loadBrief() }
        .onChange(of: agenda.lastSyncedAt) { _, _ in refreshPlanSources(); loadBrief() }
        .onChange(of: reminders.lastSyncedAt) { _, _ in refreshPlanSources(); loadBrief() }
        .onChange(of: agenda.access) { _, _ in refreshPlanSources(); loadBrief() }
        .onChange(of: reminders.access) { _, _ in refreshPlanSources(); loadBrief() }
        .onChange(of: reminders.lastError) { _, _ in refreshPlanSources(); loadBrief() }
        .onChange(of: reminders.tasks) { _, _ in refreshPlanSources(); loadBrief() }
        .onChange(of: state.requestedTab) { _, tab in
            guard let tab else { return }
            select(tab)
            state.requestedTab = nil
        }
        .onReceive(phoneTicker.$tick) { _ in
            phonePlans.check(model: todayPlan, agenda: agenda, reminders: reminders)
            lifeWatch.tick()
            glanceExport.tick()
        }
        // Phase 52: what ORION is waiting on you for, and what it is running.
        .overlay(alignment: .topTrailing) { ApprovalsOverlay().padding(.top, 80).padding(.trailing, 22) }
        .dashboardSurface(opacity: surfaceOpacity, blur: surfaceBlur)
        // Idle animation below this point pauses when the window is hidden or covered (Motion/AmbientClock).
        .ambientPauseRules()
        .preferredColorScheme(.dark)
        .onAppear(perform: start)
        .onDisappear(perform: stop)
    }

    // MARK: - Lifecycle

    private func refreshPlanSources() { todayPlan.refresh(agenda: agenda, reminders: reminders) }

    /// A handful of small file reads; off the main thread so a slow disk never stalls a frame.
    private func refreshHomeSignals() {
        DispatchQueue.global(qos: .utility).async {
            let next = HomeSignalsReader.load()
            DispatchQueue.main.async { if next != homeSignals { homeSignals = next } }
        }
    }

    private func start() {
        briefClock = BriefClock(now: Date())
        dayModel.refresh()
        todayPlan.load()
        refreshPlanSources()
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
        refreshHomeSignals()

        // Prompts for Reminders access the first time, then keeps the list live
        // off EKEventStoreChanged.
        reminders.acquire("dashboard")
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
    private func loadBrief(allowGeneration: Bool = true) {
        let facts = briefFacts
        briefWriter.load(key: facts.narrativeKey, style: .selectionJSON) {
            allowGeneration && !facts.narrative.highlights.isEmpty ? facts.prompt() : nil
        }
    }

    private func stop() {
        // Shared with the session float and the pop-out: this only drops the
        // dashboard's claim; the sync stops when nothing at all is showing it.
        reminders.release("dashboard")
        agenda.stop()
        whoop.stop()
        health.stop()
        messages.stop()
    }

    // MARK: - Header

    /// The wordmark, a few quiet links and a gear (DashboardNav.swift), replacing the eight-tab row and the status
    /// strip. What used to be the strip survives only as a capsule that appears when something is wrong.
    private var navigation: some View {
        DashboardHeader(selected: selectedTab,
                        issues: HomeStatus.issues(gatewayUp: state.gatewayUp, overdue: reminders.overdueCount,
                                                  phoneLinkAlive: homeSignals.phoneLinkAlive),
                        onSelect: { select($0) },
                        onPreviewFocus: { sessionPreview = .focus },
                        onPreviewBreak: { sessionPreview = .breakTime },
                        onDismiss: onDismiss)
            .onPreferenceChange(NavCentersKey.self) { navCenters = $0 }
    }

    /// Every tab change goes through here, so the direction of travel is set in the same transaction as the
    /// change itself and the incoming page reads it.
    private func select(_ tab: DashboardTab) {
        guard tab != selectedTab else { return }
        travelForward = PageTravel.isForward(from: selectedTab, to: tab)
        OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) { selectedTab = tab }
    }

    // MARK: - Content

    /// Everything the brief knows, gathered from the clients that already have
    /// it. Cheap enough to recompute — it is a fold over lists the views are
    /// already holding, and keeping it derived means it can never disagree with
    /// what the Health and Tasks tabs are showing.
    private var briefFacts: BriefFacts {
        let clock = briefClock
        let calendarCurrent = agenda.access.isGranted && agenda.lastError == nil
            && clock.calendarReadingIsCurrent(readAt: agenda.lastSyncedAt,
                                               interval: agenda.loadedInterval, zone: agenda.loadedTimeZone)
        let tasksCurrent = reminders.access.isGranted && reminders.lastError == nil
            && clock.readingIsFresh(reminders.lastSyncedAt)
        let events = calendarCurrent ? clock.eventsToday(agenda.windowEvents) : []
        return BriefFacts(
            day: dayModel.day,
            clock: clock,
            wokeAt: dayModel.wokeAt,
            signal: PlanningSignal.derive(
                recovery: whoop.snapshot?.recovery,
                sleepPerformance: whoop.snapshot?.sleepPerformance,
                sleepHours: whoop.snapshot?.sleepHours,
                strain: whoop.snapshot?.strain,
                sampleCount: whoop.week.readingsByDay.count,
                readingAgeHours: whoop.snapshot?.briefReadingAgeHours(at: clock.now)
            ),
            healthHighlights: whoop.snapshot?.briefHighlights(clock: clock) ?? [],
            readings: BriefFacts.Readings(
                recovery: whoop.snapshot?.recovery,
                sleepPerformance: whoop.snapshot?.sleepPerformance,
                sleepHours: whoop.snapshot?.sleepHours,
                hrvDelta: whoop.week.hrv.deltaLabel(),
                restingHeartRate: whoop.snapshot?.restingHeartRate,
                strainTarget: StrainTarget.forRecovery(whoop.snapshot?.recovery)
            ),
            events: events,
            committedMinutes: clock.remainingMinutes(events),
            dueToday: tasksCurrent ? clock.dueToday(reminders.tasks) : [],
            overdue: tasksCurrent ? clock.overdue(reminders.tasks) : [],
            openTaskCount: tasksCurrent ? reminders.openCount : nil,
            calendarConnected: calendarCurrent,
            tasksConnected: tasksCurrent
        )
    }

    @ViewBuilder private func tabContent(
        availableHeight: CGFloat,
        availableWidth: CGFloat? = nil
    ) -> some View {
        // A ZStack, so the page leaving and the page arriving overlap in depth instead of stacking vertically
        // inside the scroll view while the transition runs.
        ZStack(alignment: .topLeading) {
        Group {
            switch selectedTab {
            case .home:
                HomeTab(state: state,
                        session: state.sessionTabModel,
                        writer: briefWriter,
                        brief: briefFacts,
                        signals: homeSignals,
                        presentation: $briefPresentation,
                        availableHeight: availableHeight,
                        onOpenTab: { select($0) },
                        onMarkDone: { reminders.setComplete($0, true) })
            case .tasks:
                TasksTab(state: state, reminders: reminders, agenda: agenda,
                         dayProgress: dayProgress, hoursLeft: hoursLeft,
                         energyTitle: energyTitle, availableHeight: availableHeight,
                         availableWidth: availableWidth ?? 1_180,
                         calendar: calendarModel(state),
                         todayPlan: todayPlan,
                         refreshPlanSources: { agenda.refresh(); reminders.refresh(); refreshPlanSources() },
                         onOpenChat: { state.chatMode = true; select(.home) })
            case .project:
                ProjectTab(agenda: agenda)
            case .knowledge:
                // WAVE 12 / U1 HAND-OVER: the graph's state (simulation, pan, zoom) moves to an app-level
                // object; inject it here, e.g. `.environmentObject(graphState)`, once U1's change lands.
                // This tab is no longer rebuilt through `.id(selectedTab)`, so anything held outside the
                // view (not in its @State) now survives a tab switch.
                KnowledgeView(store: knowledge, availableHeight: availableHeight)
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
                            state: state,
                            focusExtras: state.focusExtras,
                            capabilities: capabilities,
                            focusControl: state.focusControl,
                            focusConfigured: state.focusShortcutConfigured,
                            focusSetup: state.focusSetup,
                            onRecheckFocus: { state.recheckFocusShortcut() })
            }
        }
        // A page arrives with SoftReveal, slid 24 pt in the direction of travel and grown from the nav item that
        // opened it. Not `.id(selectedTab)` any more: forcing a new identity rebuilt the tab on every switch
        // and threw away whatever it held. The switch above already swaps branches, which is all the
        // transition needs.
        .transition(.orionPage(forward: travelForward,
                               anchor: PageTravel.anchor(centerFraction: navCenters[selectedTab]),
                               reduceMotion: reduceMotion))
        }
    }

    // MARK: - Derived

    private var now: Date { Date() }

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

// MARK: - Tabs

enum DashboardTab: String, CaseIterable, Identifiable {
    case home, tasks, project, knowledge, health, finance, brand, settings
    var id: String { rawValue }

    /// The tab a person or ORION means by a word: "plan" and "calendar" are on
    /// Tasks, "projects" is Project, "finances" is Finance.
    static func named(_ word: String) -> DashboardTab? {
        switch word.lowercased() {
        case "home": return .home
        case "tasks", "task", "plan", "calendar", "schedule", "todo", "todos": return .tasks
        case "project", "projects": return .project
        case "knowledge", "memory", "graph": return .knowledge
        case "health": return .health
        case "finance", "finances", "money": return .finance
        case "brand": return .brand
        case "settings", "preferences": return .settings
        default: return nil
        }
    }

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
        case .tasks: "Plan"
        case .project: "Projects"
        case .knowledge: "Knowledge"
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
        case .knowledge: "circle.hexagonpath"
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
