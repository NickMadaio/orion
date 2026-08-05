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
            Divider().overlay(Color.white.opacity(0.08))

            ScrollView { tabContent.padding(22) }
            Divider().overlay(Color.white.opacity(0.08))
            tabBar
        }
        .background(
            LinearGradient(
                colors: [Color.black.opacity(0.76), Color(red: 0.01, green: 0.035, blue: 0.075, opacity: 0.68)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .preferredColorScheme(.dark)
        .onAppear { composerFocused = true }
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

            FocusSurface(state: state, newTask: $newFocusTask, cyan: cyan)
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
            hero
        case .focus:
            VStack(spacing: 18) {
                SectionHero(title: "Focus", subtitle: "Turn your day into a short, defensible plan.", icon: "target", color: amber)
                HStack(alignment: .top, spacing: 18) {
                    DashboardCard(title: "TODAY'S FOCUS", icon: "checklist") {
                        FocusSurface(state: state, newTask: $newFocusTask, cyan: cyan)
                    }.frame(maxWidth: .infinity)
                    DashboardCard(title: "QUICK CAPTURE", icon: "square.and.pencil") {
                        Text("Use the Orion command bar to capture a task, thought, or reminder in plain language.")
                            .font(.system(size: 14)).foregroundStyle(.white.opacity(0.67))
                        composer
                    }.frame(maxWidth: .infinity)
                }
            }
        case .health:
            VStack(spacing: 18) {
                SectionHero(title: "Health", subtitle: "Simple local tracking now; wearable data only after a real connection.", icon: "heart.fill", color: teal)
                DashboardCard(title: "TODAY", icon: "heart.text.square") {
                    HStack(spacing: 14) {
                        MetricTile(title: "HYDRATION", value: "\(state.hydrationBottles)", suffix: " bottles", color: cyan, actionTitle: "+ Bottle", action: state.logHydration, secondaryActionTitle: "−", secondaryAction: state.removeHydration)
                        MetricTile(title: "WORKOUT", value: state.workoutLogged ? "Done" : "—", suffix: " today", color: teal, actionTitle: state.workoutLogged ? "Undo" : "Log workout", action: state.toggleWorkoutLogged)
                        MetricTile(title: "SUPPLEMENTS", value: "\(state.supplementsLogged)", suffix: " logged", color: amber, actionTitle: "+ Log", action: state.logSupplement)
                    }
                }
            }
        case .finance:
            VStack(spacing: 18) {
                SectionHero(title: "Finances", subtitle: "A read-only financial overview belongs here when you choose a real provider.", icon: "dollarsign.circle", color: amber)
                DashboardCard(title: "CONNECTION STATUS", icon: "lock.shield") {
                    Text("No financial account is connected yet.")
                        .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white.opacity(0.86))
                    Text("When you decide to use a provider, Orion should show balances and subscriptions read-only—never store your bank password.")
                        .font(.system(size: 13)).foregroundStyle(.white.opacity(0.53))
                }
            }
        case .brand:
            VStack(spacing: 18) {
                SectionHero(title: "Brand", subtitle: "Capture content ideas and keep the publishing rhythm visible.", icon: "megaphone.fill", color: cyan)
                HStack(alignment: .top, spacing: 18) {
                    DashboardCard(title: "CONTENT CAPTURE", icon: "lightbulb") {
                        Text("Tell Orion an idea in your own words and it can capture or structure it.")
                            .font(.system(size: 14)).foregroundStyle(.white.opacity(0.65))
                        composer
                    }.frame(maxWidth: .infinity)
                    DashboardCard(title: "METRICS", icon: "chart.line.uptrend.xyaxis") {
                        Text("No platform metrics connected yet.")
                            .font(.system(size: 16, weight: .medium)).foregroundStyle(.white.opacity(0.82))
                        Text("This will become the place for live posting cadence and creator metrics once the data source is selected.")
                            .font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    }.frame(maxWidth: .infinity)
                }
            }
        case .settings:
            VStack(spacing: 18) {
                SectionHero(title: "Settings", subtitle: "Tune Orion’s surface without adding controls to Home.", icon: "gearshape.fill", color: cyan)
                DashboardCard(title: "ORION CORE", icon: "sparkles") {
                    Picker("Visual", selection: $coreStyle) {
                        Text("Original Orion").tag("original")
                        Text("Black Hole").tag("blackHole")
                    }
                    .pickerStyle(.segmented)
                    Text("The floating voice hologram always stays Original Orion; this changes the dashboard centerpiece only.")
                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.48))
                }
                DashboardCard(title: "QUICK OPEN", icon: "circle.grid.3x3.fill") {
                    HStack {
                        Text("Icon size").font(.system(size: 14, weight: .medium)).foregroundStyle(.white.opacity(0.78))
                        Spacer()
                        Text("\(Int(iconScale * 100))%")
                            .font(.system(size: 12, design: .monospaced)).foregroundStyle(cyan)
                    }
                    Slider(value: $iconScale, in: 0.72...1.45, step: 0.05)
                        .tint(cyan)
                    Text("Use Customize on Home to place the icons; this changes their scale without moving them.")
                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.48))
                }
            }
        }
    }

    private var tabBar: some View {
        HStack(spacing: 7) {
            ForEach(DashboardTab.allCases) { tab in
                Button { selectedTab = tab } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon).font(.system(size: 14, weight: .semibold))
                        Text(tab.title).font(.system(size: 10, weight: .semibold))
                    }
                    .frame(width: 88, height: 46)
                    .foregroundStyle(selectedTab == tab ? cyan : .white.opacity(0.45))
                    .background(RoundedRectangle(cornerRadius: 11).fill(selectedTab == tab ? cyan.opacity(0.1) : .clear))
                    // SwiftUI otherwise uses only the icon and label glyphs as
                    // the hit region in this custom button style. The whole
                    // illuminated tab is deliberately one large target.
                    .contentShape(RoundedRectangle(cornerRadius: 11))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity)
        .background(Color.black.opacity(0.23))
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

private enum DashboardTab: String, CaseIterable, Identifiable {
    case home, focus, health, finance, brand, settings
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var icon: String {
        switch self {
        case .home: "house.fill"; case .focus: "target"; case .health: "heart.fill"; case .finance: "dollarsign.circle"; case .brand: "megaphone.fill"; case .settings: "gearshape.fill"
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

private struct FocusSurface: View {
    @ObservedObject var state: AppState
    @Binding var newTask: String
    let cyan: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("TODAY'S FOCUS", systemImage: "target")
                    .font(.system(size: 10, weight: .semibold)).tracking(1.5).foregroundStyle(.white.opacity(0.52))
                Spacer()
                Text("\(state.focusTasks.filter(\.isComplete).count)/\(state.focusTasks.count)")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(cyan)
            }
            if state.focusTasks.isEmpty {
                Text("Add the one thing that matters next.").font(.system(size: 12)).foregroundStyle(.white.opacity(0.43))
            } else {
                ForEach(state.focusTasks) { task in
                    HStack(spacing: 9) {
                        Button { state.toggleFocusTask(task.id) } label: {
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
                        Button { state.removeFocusTask(task.id) } label: {
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
    private func addTask() { state.addFocusTask(newTask); newTask = "" }
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
