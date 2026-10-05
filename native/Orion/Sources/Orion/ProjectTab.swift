import SwiftUI
import AppKit
import Combine
import UniformTypeIdentifiers

/// A saved plan is a project. Selection never launches work or changes another
/// project's state; every read and control is bound to the selected id.
struct ProjectTab: View {
    @ObservedObject var agenda: AppleCalendarSync
    @AppStorage("orion.projects.selected") private var selectedID = ""
    @StateObject private var library = ProjectLibraryModel()
    @State private var query = ""
    @State private var error: String?
    @State private var importing = false
    @State private var spin = false
    /// The project whose run view is open (see ProjectRunFocus.swift).
    @State private var focusedProjectID: String?
    /// "Run several in order" (2026-10-05): tapping a project adds it to the order.
    @State private var queueMode = false
    @State private var queueOrder: [String] = []
    @State private var queueMessage: String?
    private var inFocus: Bool { focusedProjectID != nil && focusedProjectID == selected?.id }
    private var projects: [SavedProject] { library.projects }
    private var selected: SavedProject? { projects.first { $0.id == selectedID } ?? projects.first }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if !inFocus {
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Text("Projects").font(.system(size: 22, weight: .semibold))
                    Spacer()
                    Button {
                        library.refreshNow()
                        withAnimation(.easeInOut(duration: 0.6)) { spin.toggle() }
                    } label: {
                        Image(systemName: "arrow.clockwise").font(.system(size: 14, weight: .medium))
                            .rotationEffect(.degrees(spin ? 360 : 0))
                    }
                    .buttonStyle(.plain).help("Refresh projects now (they also refresh on their own every few seconds)")
                    .accessibilityLabel("Refresh projects")
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { queueMode.toggle(); queueOrder = [] }
                    } label: {
                        Image(systemName: queueMode ? "list.number" : "list.bullet").font(.system(size: 14, weight: .medium))
                            .foregroundStyle(queueMode ? Color.indigo : .secondary)
                    }
                    .buttonStyle(.plain).help("Run several projects in order: tap them in the order you want")
                    .accessibilityLabel("Run projects in order")
                    Button(action: importPlan) { Image(systemName: "plus").font(.system(size: 15, weight: .medium)) }
                        .buttonStyle(.plain).help("Import a Markdown or JSON project plan").disabled(importing)
                        .accessibilityLabel("Import project")
                }
                TextField("Search projects", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 13))
                    .padding(10).background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(projects.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }) { project in
                            Button {
                                if queueMode {
                                    if let i = queueOrder.firstIndex(of: project.id) { queueOrder.remove(at: i) } else { queueOrder.append(project.id) }
                                } else { selectedID = project.id }
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: "folder").foregroundStyle(selected?.id == project.id ? Color.indigo : .secondary).padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 7) {
                                        Text(project.name).font(.system(size: 13, weight: .medium)).lineLimit(2)
                                        Text(project.heartbeat?.isLive == true ? "Working now" : "\(project.taskCount) planned tasks")
                                            .font(.system(size: 11)).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 0)
                                    if project.heartbeat?.isLive == true { Circle().fill(.green).frame(width: 6, height: 6).padding(.top, 5) }
                                    if queueMode, let i = queueOrder.firstIndex(of: project.id) {
                                        Text("\(i + 1)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                                            .frame(width: 20, height: 20).background(Color.indigo, in: Circle())
                                            .transition(.scale.combined(with: .opacity))
                                    }
                                }
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(selected?.id == project.id ? Color.white.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 12))
                                .contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                }.frame(height: queueMode ? 460 : 520)
                if queueMode {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(queueOrder.isEmpty ? "Tap projects in the order to run them." : "Each starts when the one before it finishes. Stopping one stops the queue.")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                        Button("Run \(queueOrder.count) in order", action: startQueue)
                            .buttonStyle(.borderedProminent).tint(.indigo).disabled(queueOrder.count < 2)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                if let line = queueMessage ?? Self.queueLine() { Text(line).font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft).lineLimit(3) }
                Spacer(minLength: 12)
                Label("Saved on this Mac", systemImage: "internaldrive").font(.system(size: 11)).foregroundStyle(.secondary)
                if let problem = error ?? library.error { Text(problem).font(.system(size: 12)).foregroundStyle(.orange) }
            }
            .padding(22).frame(width: 254)
            .background(.white.opacity(0.025))
            Rectangle().fill(.white.opacity(0.07)).frame(width: 1)
            }
            if let selected {
                ProjectWorkspace(project: selected, agenda: agenda, manualRefresh: library.manualRefreshes,
                                 focused: Binding(get: { focusedProjectID == selected.id },
                                                  set: { focusedProjectID = $0 ? selected.id : nil }))
                    .id(selected.id)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "square.stack.3d.up").font(.system(size: 36, weight: .light)).foregroundStyle(.indigo)
                    Text("A place for your next idea").font(.system(size: 24, weight: .semibold))
                    Text("Import a development plan to give ORION its next project.").font(.system(size: 14)).foregroundStyle(.secondary)
                    Button("Import plan", action: importPlan).buttonStyle(.borderedProminent).tint(.indigo)
                }.frame(maxWidth: .infinity, minHeight: 620)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(Color.white.opacity(0.92))
        .background(Color(red: 0.045, green: 0.05, blue: 0.068), in: RoundedRectangle(cornerRadius: 18))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.07), lineWidth: 1))
        .onAppear { refresh() }
        .animation(.spring(response: 0.5, dampingFraction: 0.88), value: inFocus)
    }
    private func refresh() { library.refresh() }
    private func startQueue() {
        let ids = queueOrder
        queueMessage = "Starting the queue…"
        ProjectAgentControl.execute(["start"] + ids, executable: ProjectAgentControl.repository + "/scripts/orion-project-queue") { output, failure in
            queueMessage = failure ?? output
            if failure == nil { queueMode = false; queueOrder = []; if let first = ids.first { selectedID = first } }
            refresh()
        }
    }
    /// One line about a running queue, read from the queue file the script keeps.
    static func queueLine() -> String? {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/project-agent/queue.json")
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["status"] as? String == "running",
              let items = object["items"] as? [[String: Any]] else { return nil }
        let names = items.map { item -> String in
            let name = item["name"] as? String ?? "?"
            switch item["state"] as? String {
            case "running": return "▶ \(name)"
            case "finished": return "✓ \(name)"
            default: return name
            }
        }
        return "Queue: " + names.joined(separator: " → ")
    }
    private func importPlan() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.plainText, .json, UTType(filenameExtension: "md") ?? .plainText]
        panel.allowsMultipleSelection = false; panel.canChooseDirectories = false; panel.prompt = "Add project"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            importing = true; error = nil
            ProjectAgentControl.execute(["add", url.path], executable: ProjectAgentControl.projectsExecutable) { output, failure in
                importing = false; error = failure; refresh()
                if failure == nil, let data = output?.data(using: .utf8),
                   let item = try? JSONDecoder().decode(SavedProject.self, from: data) { selectedID = item.id }
            }
        }
    }
}

struct ProjectWorkspace: View {
    let project: SavedProject
    @ObservedObject var agenda: AppleCalendarSync
    /// Bumped by the list's Refresh button: reload everything, the plan included.
    var manualRefresh = 0
    /// Whether the run view covers this project (ProjectRunFocus.swift).
    var focused: Binding<Bool> = .constant(false)
    /// The run whose view Nick swiped away, so it does not pop straight back.
    @State private var dismissedRun: String?
    @State private var state: ProjectAgentStatus.Reading = .missing
    @State private var beat: ProjectAgentHeartbeat?
    /// A primitive snapshot keeps every liveness-dependent branch in this view
    /// on the same refresh. Previously the header could retain `false` while
    /// the sidebar rendered the newly decoded heartbeat, yielding “Stopped”
    /// and “AGENT LOOP LIVE” on the same screen.
    @State private var supervisorLive = false
    @State private var activity: ProjectAgentActivity?
    @State private var launch: SavedProject.Launch?
    @State private var blocks: [ProjectPlanBlock] = []
    @State private var section = "Plan"
    @State private var steering = ""
    @State private var busy = false
    @State private var error: String?
    @State private var enabled = false
    @State private var stopRule: ProjectRunStopRule = .atTime
    @State private var stopAt = ProjectRunStopRule.defaultTime
    @State private var confirmingKill = false
    @State private var launchOptions = ProjectLaunchOptions()
    /// Remembered separately so switching the nudge off and on keeps the interval.
    @State private var nudgeInterval = 5
    @State private var preflight: ProjectPreflight?
    @State private var preflightProblem: String?
    @State private var preflightAt: Date?
    @State private var checkingPower = false
    @State private var receipt: ProjectLaunchReceipt?
    @State private var runLog = ""
    /// The last thing Nick pressed, and how far it has got. Cleared a few
    /// seconds after it is done, so the trail is news, not decoration.
    @State private var intent: ProjectIntent?
    @AppStorage("orion.projects.settingsOpen") private var settingsOpen = false
    @StateObject private var ticker = RefreshTicker(interval: 2)
    /// When plan.md last changed, so a refreshed or re-imported plan shows up.
    @State private var planStamp: Date?
    private var run: ProjectAgentStatus? { if case .available(let r) = state { return r }; return nil }
    private var live: Bool { supervisorLive }
    private var launching: Bool {
        guard let launch, ["starting", "running"].contains(launch.status), !live,
              let date = ISO8601DateFormatter.projectDate.date(from: launch.at) else { return false }
        return Date().timeIntervalSince(date) < 120
    }
    private var status: String {
        if live {
            if run?.isExterminating == true { return "Exterminating…" }
            if run?.isStopping == true { return "Stopping at task boundary…" }
            if run?.isPausing == true { return "Pausing at task boundary…" }
            return run?.status == .paused ? "Paused" : "Working"
        }
        if launching { return "Starting…" }
        if run?.status == .completed { return "Ready for your review" }
        if run?.hasOpenEscalations == true { return "Needs attention" }
        if launch?.status == "failed" { return "Could not continue" }
        return run == nil ? "Ready to start" : "Stopped"
    }
    var body: some View {
        ZStack(alignment: .top) {
        HStack(alignment: .top, spacing: 26) {
            VStack(alignment: .leading, spacing: 24) {
                header
                HStack(spacing: 6) {
                    ForEach(["Plan", "Activity", "Reviews"], id: \.self) { tab in
                        Button { section = tab } label: {
                            Text(tab).font(.system(size: 13, weight: .medium)).padding(.horizontal, 16).padding(.vertical, 8)
                                .background(section == tab ? Color.white.opacity(0.10) : .clear, in: Capsule())
                        }.buttonStyle(.plain).foregroundStyle(section == tab ? .white : .gray)
                    }
                    Spacer()
                    Button { NSWorkspace.shared.open(project.planURL) } label: { Label("Open Markdown", systemImage: "arrow.up.right") }
                        .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if section == "Plan" { planContent }
                        else if section == "Activity" { activityContent }
                        else if let run { ProjectAgentReviewNotes(run: run) }
                        else { empty("Reviews will appear here", detail: "Each completed checkpoint goes through the local reviewer before it advances.") }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.trailing, 10)
                }.frame(height: 465)
                if let run { instructionBar(run) }
                else {
                    Label("Your plan is saved. Starting creates an isolated worktree.", systemImage: "checkmark.shield")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                if let error { Text(error).font(.system(size: 12)).foregroundStyle(.orange).textSelection(.enabled) }
                if launch?.status == "failed", let detail = launch?.detail { Text(detail).font(.system(size: 12)).foregroundStyle(.orange) }
                ProjectCommandReference(projectID: project.id, revision: run?.revision)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            ProjectWorkflowSidebar(run: run, beat: beat)
                .frame(width: 320)
        }
        .padding(28)
        .opacity(focused.wrappedValue ? 0 : 1)
        .allowsHitTesting(!focused.wrappedValue)
            if focused.wrappedValue {
                runFocus.transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.5, dampingFraction: 0.88), value: focused.wrappedValue)
        .onAppear {
            launchOptions = ProjectLaunchOptions.read(projectRoot: project.root)
            if launchOptions.nudgeMinutes > 0 { nudgeInterval = launchOptions.nudgeMinutes }
            refresh(loadPlan: true)
        }
        .onChange(of: ticker.tick) { _, _ in refresh() }
        .onChange(of: manualRefresh) { _, _ in refresh(loadPlan: true) }
        .confirmationDialog("Exterminate the model call in flight?", isPresented: $confirmingKill) {
            Button("Exterminate", role: .destructive) { halt(.exterminate) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The call is abandoned now rather than waited for. Accepted work is kept; the half-done step is thrown away and the project reconciles before it continues. Stop is the gentler choice if you can wait for the current step.")
        }
    }
    // MARK: - Console

    private var pending: Bool {
        guard let intent else { return false }
        if case .recorded = intent.phase { return true }
        return intent.phase == .sending
    }
    private var mood: ProjectMood {
        ProjectMood.of(run: run, beat: beat, live: live, launching: launching, pending: pending)
    }
    /// Who is working and for how long, or why nothing is.
    private var subline: String {
        if live {
            let role = beat?.role == "reviewer" ? "Reviewer" : beat?.role == "worker" ? "Worker" : "Supervisor"
            let model = beat?.model.map { " · \($0)" } ?? ""
            let since = beat?.since.map { " · \(Self.elapsed(since: $0))" } ?? ""
            let task = run?.active.map { " — \($0.subtask?.caption ?? $0.title)" } ?? ""
            return "\(role)\(model)\(since)\(task)"
        }
        if run?.isBlocked == true { return "Waiting on you — answer the note at the bottom of this page" }
        if run?.status == .completed { return "Every task accepted and the final review passed" }
        if run == nil { return "\(project.taskCount) tasks · local worker and reviewer" }
        return "Not running · picks up exactly where it left off"
    }
    static func elapsed(since date: Date, now: Date = Date()) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
        return minutes < 1 ? "just now" : minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h \(minutes % 60) min"
    }
    private var startTitle: String {
        if launching { return "Starting…" }
        if !enabled { return "Enable & start" }
        return run == nil ? "Start project" : "Continue"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 16) {
                ProjectPulseOrb(mood: mood)
                VStack(alignment: .leading, spacing: 4) {
                    Text(status)
                        .font(OrionTheme.display(22)).foregroundStyle(mood == .idle ? OrionTheme.textSoft : mood.tint)
                        .id(status)
                        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity),
                                                removal: .move(edge: .top).combined(with: .opacity)))
                    Text(subline).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
                }
                .clipped()
                Spacer()
                if live || launching {
                    Button { dismissedRun = nil; focused.wrappedValue = true } label: {
                        Label("Watch run", systemImage: "rectangle.expand.vertical").font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.plain).foregroundStyle(OrionTheme.accent).help("Open the run view")
                }
                Button { NSWorkspace.shared.activateFileViewerSelecting([project.root]) } label: { Image(systemName: "folder") }
                    .buttonStyle(.plain).foregroundStyle(OrionTheme.textDim).help("Reveal project files and run log")
            }
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: status)

            Text(project.name).font(.system(size: 27, weight: .semibold, design: .rounded)).tracking(-0.6)
                .fixedSize(horizontal: false, vertical: true)
            if let run {
                VStack(alignment: .leading, spacing: 8) {
                    ProjectTaskStrip(run: run)
                    Text(run.progressLabel).font(OrionTheme.mono(11)).foregroundStyle(OrionTheme.textSoft)
                }
            }

            controls
            if let intent { ProjectIntentTrail(intent: intent).transition(.move(edge: .top).combined(with: .opacity)) }

            if run?.isBlocked == true {
                Label("Continue unlocks once the note at the bottom is answered: type why it is safe to go on in \"Guide this project…\", then press Resolve with note.",
                      systemImage: "exclamationmark.bubble")
                    .font(.system(size: 12)).foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let run, run.status != .completed {
                ProjectAlertSwitch(away: run.isAway, busy: busy) { away in setAlerts(away) }
            }
            if !live && !launching { runSettings }
            else if let receipt, let keepAwake = receipt.keepAwake {
                ProjectKeepAwakeInEffect(keepAwake: keepAwake, warnings: receipt.warnings ?? [])
            }
            if case .unreadable(let problem) = state { Text(problem).font(.system(size: 12)).foregroundStyle(.orange) }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: intent)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: live)
    }

    /// One obvious action, and the others beside it only when they mean something.
    @ViewBuilder private var controls: some View {
        let holding = run?.isStopping == true || run?.isPausing == true || run?.isExterminating == true || run?.status == .paused
        HStack(spacing: 10) {
            if live {
                if holding {
                    ConsoleButton(title: "Resume", symbol: "play.fill", prominent: true, working: sending(.resume)) { halt(.resume) }
                    if run?.isStopping != true {
                        ConsoleButton(title: "Stop", symbol: "stop.fill", tint: OrionTheme.text, working: sending(.stop)) { halt(.stop) }
                    }
                } else {
                    ConsoleButton(title: "Stop", symbol: "stop.fill", tint: OrionTheme.text, prominent: true, working: sending(.stop)) { halt(.stop) }
                        .help(ProjectAgentControl.explanation(.stop))
                    ConsoleButton(title: "Pause", symbol: "pause.fill", tint: OrionTheme.blue, working: sending(.pause)) { halt(.pause) }
                        .help(ProjectAgentControl.explanation(.pause))
                }
                if run?.isExterminating != true {
                    ConsoleButton(title: "Exterminate…", symbol: "xmark.octagon", tint: OrionTheme.red, working: sending(.exterminate)) {
                        confirmingKill = true
                    }
                    .help(ProjectAgentControl.explanation(.exterminate))
                }
            } else {
                ConsoleButton(title: startTitle, symbol: "play.fill", prominent: true, working: launching || sending(.start), action: start)
                    .disabled(busy || launching || run?.status == .completed || run?.isBlocked == true)
                // No separate "clear hold": Continue clears a standing pause or
                // stop itself (prepareProjectContinuation), so a second button
                // would only be a second way to do half of the same thing.
            }
            Spacer(minLength: 0)
        }
    }

    private func sending(_ kind: ProjectIntent.Kind) -> Bool {
        intent?.kind == kind && intent?.phase == .sending
    }

    /// Run length and keep-awake: set once, rarely changed, so folded away
    /// behind a line that says what they are set to.
    private var runSettings: some View {
        DisclosureGroup(isExpanded: $settingsOpen) {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Run until", selection: $stopRule) {
                    ForEach(ProjectRunStopRule.allCases) { rule in Text(rule.label).tag(rule) }
                }
                .pickerStyle(.segmented).frame(maxWidth: 320)
                if stopRule == .atTime {
                    HStack(spacing: 10) {
                        Text("Stop at").font(.system(size: 12)).foregroundStyle(.secondary)
                        DatePicker("Stop at", selection: $stopAt, in: Date().addingTimeInterval(60)...,
                                   displayedComponents: [.hourAndMinute])
                            .labelsHidden().datePickerStyle(.field)
                        if let suggestion = classDepartureSuggestion {
                            Button("Before \(suggestion.title) · \(suggestion.time.formatted(date: .omitted, time: .shortened))") {
                                stopAt = suggestion.time
                            }
                            .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(OrionTheme.accent)
                            .help("Stop 30 minutes before \(suggestion.title)")
                        }
                    }
                }
                ProjectKeepAwakeOptions(options: $launchOptions, nudgeInterval: $nudgeInterval, preflight: preflight,
                                        problem: preflightProblem, checking: checkingPower)
                if !enabled { Text("Enable & start allows local execution for your saved projects.").font(.system(size: 11)).foregroundStyle(.secondary) }
            }
            .padding(.top, 10)
            .disabled(busy)
        } label: {
            HStack(spacing: 8) {
                Text("Run settings").font(.system(size: 12, weight: .medium)).foregroundStyle(OrionTheme.textSoft)
                Text(settingsSummary).font(.system(size: 11)).foregroundStyle(OrionTheme.textDim).lineLimit(1)
                if preflight?.warnings.isEmpty == false {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(OrionTheme.orange)
                        .help(preflight?.warnings.joined(separator: "\n\n") ?? "")
                }
            }
        }
    }

    private var settingsSummary: String {
        let until = stopRule == .untilStopped ? "until you stop it" : "until \(stopAt.formatted(date: .omitted, time: .shortened))"
        let awake = !launchOptions.preventSleep ? "Mac may sleep"
            : launchOptions.keepDisplayOn ? "keeps Mac and display awake" : "keeps Mac awake"
        let nudge = launchOptions.nudgeMinutes > 0 ? " · nudge \(launchOptions.nudgeMinutes) min" : ""
        return "· \(until) · \(awake)\(nudge)"
    }

    private var planContent: some View {
        VStack(alignment: .leading, spacing: 17) {
            briefsLine
            ForEach(blocks) { block in
                if block.kind.hasPrefix("code:") {
                    DisclosureGroup(block.kind == "code:orion-task" ? "Task scope & acceptance criteria" : block.kind == "code:orion-plan" ? "Run configuration" : "Code / command reference") {
                        Text(block.text).font(.system(size: 11, design: .monospaced)).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                            .background(.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    }.font(.system(size: 12)).foregroundStyle(.secondary)
                } else if block.kind.hasPrefix("h") {
                    Text(block.text).font(.system(size: block.kind == "h1" ? 23 : block.kind == "h2" ? 19 : 15, weight: .semibold))
                        .padding(.top, block.kind == "h2" ? 12 : 2)
                } else {
                    Text((try? AttributedString(markdown: block.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(block.text))
                        .font(.system(size: 13)).lineSpacing(5).foregroundStyle(.white.opacity(0.72)).textSelection(.enabled)
                }
            }
            if blocks.isEmpty { empty("Plan unavailable", detail: "Open the project folder to inspect its saved plan.") }
        }
    }
    /*
     The briefs are what the local models actually work from for hours, so the
     Plan view says whether they are there — and which tasks would be working
     from the contract alone — rather than leaving that to a folder nobody opens.
    */
    @ViewBuilder private var briefsLine: some View {
        let briefs = project.briefs
        if briefs.common || !briefs.tasks.isEmpty {
            HStack(spacing: 10) {
                Label("Briefs: \(briefs.common ? "shared notes + " : "")\(briefs.tasks.count) of \(project.taskCount) tasks — handed to the worker and reviewer with each task",
                      systemImage: "text.book.closed")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                Spacer()
                Button { NSWorkspace.shared.open(project.briefsURL) } label: { Label("Open briefs", systemImage: "folder") }
                    .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(.secondary)
            }
        } else {
            Label("No briefs — each task's worker has only its contract to go on", systemImage: "text.book.closed")
                .font(.system(size: 12)).foregroundStyle(.orange.opacity(0.85))
        }
    }
    private var activityContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let activity {
                HStack {
                    Label(activity.note ?? activity.headline, systemImage: live ? "sparkles" : "clock.arrow.circlepath")
                        .font(.system(size: 14, weight: .medium))
                    Spacer()
                    Text(live ? "LIVE MODEL STREAM" : "LAST MODEL STREAM")
                        .font(OrionTheme.mono(8, .semibold)).tracking(0.8)
                        .foregroundStyle(live ? OrionTheme.green : OrionTheme.textDim)
                }
                if !activity.trace.isEmpty {
                    ScrollView { Text(activity.trace).font(.system(size: 12, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                        .frame(height: 150).padding(14).background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
                }
            }
            if let run {
                HStack {
                    Text("RUN LOG").font(OrionTheme.mono(9, .semibold)).tracking(1.2)
                    if live { Circle().fill(OrionTheme.green).frame(width: 6, height: 6) }
                    Spacer()
                    Button { NSWorkspace.shared.open(project.root.appendingPathComponent("run.log")) } label: {
                        Label("Open full log", systemImage: "arrow.up.right")
                    }
                    .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                ScrollView {
                    Text(runLog.isEmpty ? "Waiting for the first log entry…" : runLog)
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(.white.opacity(0.72))
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: 190).padding(14)
                .background(Color.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 12))

                Text("TASKS").font(OrionTheme.mono(9, .semibold)).tracking(1.2).foregroundStyle(.secondary)
                ForEach(run.tasks) { task in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: task.status == .accepted ? "checkmark.circle.fill" : task.status == .blocked ? "exclamationmark.circle" : "circle")
                            .foregroundStyle(task.status == .accepted ? Color.green : task.status == .blocked ? .orange : .gray)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(task.title).font(.system(size: 14, weight: .medium))
                            Text(task.subtask?.caption ?? task.status.rawValue.replacingOccurrences(of: "_", with: " ")).font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }.padding(.vertical, 8)
                }
                Text("RECENT CHECKPOINTS").font(OrionTheme.mono(9, .semibold)).tracking(1.2).foregroundStyle(.secondary)
                ForEach(run.events.suffix(20).reversed(), id: \.at) { event in
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Circle().fill(.white.opacity(0.22)).frame(width: 4, height: 4)
                        Text(event.message).font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }
            } else { empty("Work begins here", detail: "Start this project to see its current task, progress and local-model activity.") }
        }
    }
    private func instructionBar(_ run: ProjectAgentStatus) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(run.openEscalations) { item in
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.reason).font(.system(size: 12)).foregroundStyle(.orange)
                    Button("Resolve with note below") { control(.resolve, escalationID: item.id) }
                        .font(.system(size: 12)).disabled(steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                }
            }
            HStack(alignment: .bottom, spacing: 12) {
                TextField("Guide this project…", text: $steering, axis: .vertical)
                    .textFieldStyle(.plain).font(.system(size: 14)).lineLimit(1...4)
                Button { control(.steer) } label: { Image(systemName: "arrow.up").font(.system(size: 14, weight: .semibold)).frame(width: 28, height: 28) }
                    .buttonStyle(.borderedProminent).tint(.indigo)
                    .disabled(busy || steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || run.status == .completed)
                    .accessibilityLabel("Send steering instruction")
            }.padding(14).background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 14))
            Text(run.steering.last.map { ($0.applied ? "Applied: " : "Queued: ") + $0.text } ?? "Instructions are delivered at the next task boundary.")
                .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
        }
    }
    private func empty(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 18, weight: .medium)); Text(detail).font(.system(size: 13)).foregroundStyle(.secondary)
        }.padding(.vertical, 30)
    }
    private func refresh(loadPlan: Bool = false) {
        let nextState = project.state
        let nextBeat = project.heartbeat
        let nextActivity = project.activity
        let nextLaunch = project.launch
        state = nextState
        // A heartbeat write from an older supervisor was not atomic. If a poll
        // catches that tiny truncation window, retain the last valid beat and
        // let its age expire naturally instead of flashing a false stop.
        if let nextBeat { beat = nextBeat; supervisorLive = nextBeat.isLive }
        else { supervisorLive = beat?.isLive == true }
        activity = nextActivity
        launch = nextLaunch
        receipt = ProjectLaunchReceipt.read(projectRoot: project.root)
        runLog = ProjectRunLog.tail(project.root.appendingPathComponent("run.log"))
        enabled = ProjectAgentSettings.read()?.enabled == true
        advanceIntent()
        // With the display kept on, Nick is watching: open the run view for a
        // live run unless he swiped this run's view away.
        if live && launchOptions.keepDisplayOn && !focused.wrappedValue && dismissedRun != run?.runId {
            focused.wrappedValue = true
        }
        let stamp = (try? FileManager.default.attributesOfItem(atPath: project.planURL.path))?[.modificationDate] as? Date
        if loadPlan || stamp != planStamp {
            planStamp = stamp
            blocks = ProjectPlanBlock.parse((try? String(contentsOf: project.planURL, encoding: .utf8)) ?? "")
        }
        // Power and lid change under us (a charger unplugged, a display
        // attached), so re-check every half minute while a start is on offer.
        if !live && !launching && (preflightAt.map { Date().timeIntervalSince($0) > 30 } ?? true) { refreshPreflight() }
    }
    private func refreshPreflight() {
        guard !checkingPower else { return }
        checkingPower = true; preflightAt = Date()
        ProjectAgentControl.execute(["preflight"], executable: ProjectAgentControl.projectsExecutable) { output, failure in
            checkingPower = false
            if failure == nil, let data = output?.data(using: .utf8),
               let reading = try? JSONDecoder().decode(ProjectPreflight.self, from: data) {
                preflight = reading; preflightProblem = nil
            } else {
                preflight = nil
                preflightProblem = "Could not check power and lid state. Keep-awake still works; check the lid and charger yourself."
            }
        }
    }
    private var holding: Bool {
        run?.isStopping == true || run?.isPausing == true || run?.isExterminating == true || run?.status == .paused
    }
    private var runFocus: some View {
        ProjectRunFocusView(projectName: project.name, run: run, beat: beat, activity: activity, mood: mood,
                            status: status, subline: subline, live: live, holding: holding, busy: busy,
                            onPause: { halt(.pause) }, onStop: { halt(.stop) }, onResume: { halt(.resume) },
                            onDismiss: { dismissedRun = run?.runId ?? "unstarted"; focused.wrappedValue = false })
    }
    private func start() {
        // Start opens the run view straight away: the orb is the feedback.
        dismissedRun = nil; focused.wrappedValue = true
        busy = true; error = nil
        intent = ProjectIntent(kind: .start, phase: .sending, at: Date())
        var args = ["launch", project.id]
        if stopRule == .untilStopped { args.append("--until-stopped") }
        else { args += ["--until", ISO8601DateFormatter().string(from: stopAt)] }
        if !enabled { args.append("--enable") }
        args += launchOptions.launchFlags
        ProjectAgentControl.execute(args, executable: ProjectAgentControl.projectsExecutable) { _, failure in
            busy = false; error = nil
            land(.start, failure: failure)
        }
    }
    private func halt(_ command: ProjectAgentControl.Command) {
        guard let kind = ProjectIntent.Kind(rawValue: command.rawValue) else { return }
        busy = true; error = nil
        intent = ProjectIntent(kind: kind, phase: .sending, at: Date())
        ProjectAgentControl.halt(command, projectID: project.id) { failure in
            busy = false
            land(kind, failure: failure)
        }
    }
    private func setAlerts(_ away: Bool) {
        busy = true; error = nil
        ProjectAgentControl.setAlerts(away: away, projectID: project.id) { failure in
            busy = false; error = failure; refresh()
        }
    }
    /// The CLI answered: either the request is recorded, or it failed and says why.
    private func land(_ kind: ProjectIntent.Kind, failure: String?) {
        guard intent?.kind == kind else { refresh(); return }
        intent?.phase = failure.map { .failed(String($0.prefix(160))) } ?? .recorded
        refresh()
    }
    /// Called on every refresh: move a recorded request to done once the run
    /// visibly did it, and let a finished trail fade a few seconds later.
    private func advanceIntent() {
        guard let current = intent else { return }
        switch current.phase {
        case .recorded where ProjectIntent.isDone(current.kind, run: run, live: live):
            intent?.phase = .done
            let at = current.at
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { if intent?.at == at { intent = nil } }
        case .failed:
            if Date().timeIntervalSince(current.at) > 20 { intent = nil }
        default: break
        }
    }
    private func control(_ command: ProjectAgentControl.Command, escalationID: String? = nil) {
        guard let run else { return }
        busy = true; error = nil; let submitted = steering
        ProjectAgentControl.send(command, revision: run.revision, text: submitted, escalationID: escalationID, projectID: project.id) { failure in
            busy = false; error = failure
            if failure == nil && [.steer,.resolve].contains(command) && steering == submitted { steering = "" }
            refresh()
        }
    }

    private var classDepartureSuggestion: (title: String, time: Date)? {
        let words = ["class", "lecture", "seminar", "tutorial", "workshop", "lab"]
        guard let event = agenda.remaining.first(where: { item in
            !item.isAllDay && item.start > Date() && words.contains { item.title.localizedCaseInsensitiveContains($0) }
        }) else { return nil }
        let departure = event.start.addingTimeInterval(-30 * 60)
        guard departure > Date().addingTimeInterval(60) else { return nil }
        return (event.title, departure)
    }
}

enum ProjectRunStopRule: String, CaseIterable, Identifiable {
    case atTime, untilStopped
    var id: String { rawValue }
    var label: String { self == .atTime ? "At a time" : "When I stop it" }
    static var defaultTime: Date {
        let future = Date().addingTimeInterval(8 * 3600)
        return Calendar.current.date(bySetting: .minute, value: 0, of: future) ?? future
    }
}

enum ProjectRunLog {
    /// Only the tail belongs in a two-second UI refresh. The complete append-only
    /// file remains one click away, even after an overnight run grows large.
    static func tail(_ url: URL, maxBytes: UInt64 = 48_000, maxLines: Int = 160) -> String {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
        defer { try? handle.close() }
        guard let size = try? handle.seekToEnd() else { return "" }
        try? handle.seek(toOffset: size > maxBytes ? size - maxBytes : 0)
        guard let data = try? handle.readToEnd(),
              let text = String(data: data, encoding: .utf8) else { return "" }
        return text.split(separator: "\n", omittingEmptySubsequences: false)
            .suffix(maxLines).joined(separator: "\n")
    }
}
/*
 Keep-awake choices for the next start, and a read of this Mac as it is now.

 Checkboxes in one column rather than switches in panels: three small, related
 settings that read as a sentence. The preflight line and its warnings are
 worded by awake.mjs; this view only lays them out and colours them, so the
 app and the launch receipt never describe the same Mac in two ways.
*/
struct ProjectKeepAwakeOptions: View {
    @Binding var options: ProjectLaunchOptions
    @Binding var nudgeInterval: Int
    let preflight: ProjectPreflight?
    let problem: String?
    let checking: Bool

    private var nudging: Binding<Bool> {
        Binding(get: { options.nudgeMinutes > 0 }, set: { options.nudgeMinutes = $0 ? nudgeInterval : 0 })
    }
    private var interval: Binding<Int> {
        Binding(get: { nudgeInterval }, set: { nudgeInterval = $0; if options.nudgeMinutes > 0 { options.nudgeMinutes = $0 } })
    }
    /// Keep-awake off on a short idle sleep is worth saying before the start, not after.
    private var sleepsAfter: Int? {
        guard !options.preventSleep, let minutes = preflight?.idleSleepMinutes, minutes > 0 else { return nil }
        return minutes
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Keep this Mac awake while it runs", isOn: $options.preventSleep)
            VStack(alignment: .leading, spacing: 8) {
                Toggle("Keep the display on", isOn: $options.keepDisplayOn)
                HStack(spacing: 6) {
                    Toggle("Nudge activity every", isOn: nudging)
                    Stepper(value: interval, in: 1...60) { Text("\(nudgeInterval) min").monospacedDigit() }
                        .disabled(options.nudgeMinutes == 0)
                }
                if options.nudgeMinutes > 0 {
                    Text("Declares activity the way moving the mouse does, so it also wakes the display each time.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            .padding(.leading, 20)
            .disabled(!options.preventSleep)
            .opacity(options.preventSleep ? 1 : 0.45)
            preflightLines.padding(.top, 4)
        }
        .toggleStyle(.checkbox)
        .font(.system(size: 12))
    }

    @ViewBuilder private var preflightLines: some View {
        if let preflight {
            Label(preflight.summary, systemImage: preflight.warnings.isEmpty ? "checkmark.circle" : "exclamationmark.triangle")
                .font(.system(size: 12)).foregroundStyle(preflight.warnings.isEmpty ? Color.secondary : Color.orange)
            ForEach(preflight.warnings, id: \.self) { warning in
                Text(warning).font(.system(size: 11)).foregroundStyle(.orange.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            }
        } else if let problem {
            Label(problem, systemImage: "questionmark.circle").font(.system(size: 11)).foregroundStyle(.secondary)
        } else if checking {
            Label("Checking power and lid…", systemImage: "hourglass").font(.system(size: 11)).foregroundStyle(.secondary)
        }
        if let sleepsAfter {
            Text("With keep-awake off, this Mac sleeps after \(sleepsAfter) min idle and the run stalls until it wakes.")
                .font(.system(size: 11)).foregroundStyle(.orange.opacity(0.9))
        }
    }
}

/// What `serve` actually put in place for the run in progress, read from its
/// launch receipt — the choices above describe the NEXT start, not this one.
struct ProjectKeepAwakeInEffect: View {
    let keepAwake: ProjectLaunchReceipt.KeepAwake
    let warnings: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if keepAwake.preventSleep && !keepAwake.active {
                Label("Keep-awake is not holding for this run", systemImage: "exclamationmark.triangle")
                    .font(.system(size: 12)).foregroundStyle(.orange)
            } else {
                Label(keepAwake.summary, systemImage: keepAwake.preventSleep ? "cup.and.saucer" : "moon.zzz")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            ForEach(warnings, id: \.self) { warning in
                Text(warning).font(.system(size: 11)).foregroundStyle(.orange.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            }
        }
    }
}

/*
 The commands for this project with its id filled in, for the night the app is
 closed or the spelling is forgotten. Collapsed by default: a reference, not
 something to read every time. Each line is selectable on its own; there is
 deliberately no "copy all", because pasting the whole list into a terminal
 would run pause, stop and exterminate one after another.
*/
struct ProjectCommandReference: View {
    let projectID: String
    let revision: Int?

    var body: some View {
        DisclosureGroup("Commands for this project") {
            VStack(alignment: .leading, spacing: 11) {
                Text("Pause, stop, exterminate and resume need no revision. Steer and resolve take N, the revision from status"
                     + (revision.map { " (\($0) right now; it changes as the run moves)." } ?? "."))
                    .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                ForEach(ProjectAgentControl.commandReference(projectID: projectID)) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.command).font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.85)).textSelection(.enabled)
                        Text(item.what).font(.system(size: 11)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 10)
        }
        .font(.system(size: 12)).foregroundStyle(.secondary)
    }
}

private extension ISO8601DateFormatter {
    static let projectDate: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
}
