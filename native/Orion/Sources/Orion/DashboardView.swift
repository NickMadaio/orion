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
    @StateObject private var connections = ConnectionsModel()
    @StateObject private var whoop = WhoopClient()
    @StateObject private var health = HealthLog()
    @StateObject private var plaid = PlaidClient()

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

            ScrollView {
                tabContent
                    .padding(.horizontal, 46)
                    .padding(.top, 26)
                    .padding(.bottom, 60)
                    .frame(maxWidth: 1180, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
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
        // Prompts for Reminders access the first time, then keeps the list live
        // off EKEventStoreChanged.
        reminders.start()
        agenda.start()
        whoop.start()
        health.start()
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

    private func stop() {
        reminders.stop()
        agenda.stop()
        whoop.stop()
        health.stop()
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
            StatChip(icon: "drop.fill", value: "\(state.hydrationBottles)", tint: OrionTheme.blue)
            hairline
            StatChip(icon: "pills.fill", value: "\(state.supplementsLogged)", tint: OrionTheme.violet)
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

    @ViewBuilder private var tabContent: some View {
        Group {
            switch selectedTab {
            case .home:
                HomeTab(state: state,
                        quickOpen: quickOpen,
                        coreStyle: coreStyle,
                        onAddApp: { quickOpenAppPickerVisible = true },
                        onManage: { quickOpenEditorVisible = true })
            case .focus:
                TasksTab(reminders: reminders, agenda: agenda, newTask: $newFocusTask,
                         dayProgress: dayProgress, hoursLeft: hoursLeft, energyTitle: energyTitle)
            case .health:
                HealthTab(state: state, whoop: whoop, health: health, connections: connections)
            case .finance:
                FinanceTab(connections: connections, plaid: plaid)
            case .brand:
                BrandTab(connections: connections)
            case .settings:
                SettingsTab(coreStyle: $coreStyle, iconScale: $iconScale,
                            surfaceOpacity: $surfaceOpacity, surfaceBlur: $surfaceBlur,
                            connections: connections)
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
        case .home: "circle.hexagongrid"
        case .focus: "checklist"
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
