import SwiftUI
import UserNotifications
import CloudKit
import Security
import CryptoKit
import MobileCore

@main
struct OrionMobileApp: App {
    @UIApplicationDelegateAdaptor(PhoneAppDelegate.self) private var delegate
    var body: some Scene { WindowGroup { PhoneRootView() } }
}

/// Push for the Mac link: CloudKit delivers a silent push when the Mac changes
/// the link zone, and a visible one when ORION asks for an approval.
final class PhoneAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // NightRoutine registers its category by replacing all of them: let it go first, then merge ours in.
        MainActor.assumeIsolated { _ = NightRoutine.shared }
        registerCheckinActions()
        MainActor.assumeIsolated {
            BackgroundRefresh.register()
            FocusLock.shared.mirror()   // the Screen Time extension reads the same choices
            // A tap on the lock-screen card or a widget runs here, in the app: redraw
            // the card at once, and let the apps go when he starts or finishes.
            IntentHooks.afterTap = { action in
                switch action {
                case .water: break
                case .started: GlanceWriter.applyCheckinAnswer("started"); FocusLock.shared.release()
                case .snooze: GlanceWriter.applyCheckinAnswer("snooze")
                case .done: GlanceWriter.applyCheckinAnswer("done"); FocusLock.shared.release()
                }
            }
        }
        // Every launch, foreground or background, brings the widgets and lock screen up to date.
        Task { @MainActor in await BackgroundRefresh.run(force: true) }
        // Relaunched in the background by a significant location change: resume listening.
        if launchOptions?[.location] != nil, PhoneSignals.shared.enabled { PhoneSignals.shared.start() }
        #if !targetEnvironment(simulator)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        application.registerForRemoteNotifications()
        #endif
        return true
    }

    static let checkinCategory = OutreachThread.checkinCategory
    static let askCategory = OutreachThread.askCategory
    static let askReplyAction = "orion.ask.reply"
    static let askLaterAction = "orion.ask.later"

    /// Bedtime nudges show even while ORION is open: that is exactly when he is on the phone.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions { [.banner, .sound, .list] }

    /// "Going to bed" and "15 more min" on a nudge; "Started", "10 more min", "Done" on a check-in.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let action = response.actionIdentifier
        let askID = Self.askID(in: response.notification.request.content.userInfo)
        // An ORION message he can answer: the inline reply goes into the thread as his message (replyTo = the ask),
        // "Not now" declines it, and a plain tap opens the thread at that message.
        if let reply = response as? UNTextInputNotificationResponse, action == Self.askReplyAction {
            await CloudLink.sendNowChat(reply.userText, replyTo: askID)
            return
        }
        if action == Self.askLaterAction { await CloudLink.sendNowChat("Not now", replyTo: askID); return }
        if action == UNNotificationDefaultActionIdentifier, let askID {
            await MainActor.run { ThreadTarget.open(askID) }
            return
        }
        await MainActor.run {
            if action == NightRoutine.bedAction { NightRoutine.shared.goingToBed() }
            else if action == NightRoutine.snoozeAction { NightRoutine.shared.snooze() }
        }
        switch action {
        case "orion.checkin.started": await CloudLink.sendNow(.checkin(action: "started")); await MainActor.run { FocusLock.shared.release() }
        case "orion.checkin.snooze": await CloudLink.sendNow(.checkin(action: "snooze"))
        case "orion.checkin.done": await CloudLink.sendNow(.checkin(action: "done")); await MainActor.run { FocusLock.shared.release() }
        default: break
        }
        if action.hasPrefix("orion.checkin.") {
            await MainActor.run { GlanceWriter.applyCheckinAnswer(String(action.dropFirst("orion.checkin.".count))) }
        }
    }

    /// The outreach id a notification carries (CloudKit puts the record's desired keys in `ck.qry.rf`).
    static func askID(in userInfo: [AnyHashable: Any]) -> String? {
        (CKNotification(fromRemoteNotificationDictionary: userInfo) as? CKQueryNotification)?.recordFields?[LinkSchema.alertAskID] as? String
    }

    /// The buttons on check-in notifications, and the text reply on asks, merged into what is registered
    /// (the bedtime category) so neither replaces the other.
    private func registerCheckinActions() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            let started = UNNotificationAction(identifier: "orion.checkin.started", title: "Started", options: [])
            let snooze = UNNotificationAction(identifier: "orion.checkin.snooze", title: "10 more min", options: [])
            let done = UNNotificationAction(identifier: "orion.checkin.done", title: "Done", options: [])
            let checkin = UNNotificationCategory(identifier: Self.checkinCategory, actions: [started, snooze, done], intentIdentifiers: [], options: [])
            let reply = UNTextInputNotificationAction(identifier: Self.askReplyAction, title: "Reply", options: [],
                                                      textInputButtonTitle: "Send", textInputPlaceholder: "gym, library, nothing...")
            let later = UNNotificationAction(identifier: Self.askLaterAction, title: "Not now", options: [])
            let ask = UNNotificationCategory(identifier: Self.askCategory, actions: [reply, later], intentIdentifiers: [], options: [])
            let ours: Set<String> = [Self.checkinCategory, Self.askCategory]
            center.setNotificationCategories(existing.filter { !ours.contains($0.identifier) }.union([checkin, ask]))
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[link] push registration failed: \(error.localizedDescription)")
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: .orionLinkChanged, object: nil)
        // An ignored check-in at level 3+: lock the apps he chose, if he turned that on.
        if let note = CKNotification(fromRemoteNotificationDictionary: userInfo) as? CKQueryNotification,
           note.recordFields?[LinkSchema.alertKind] as? String == "checkin",
           let level = note.recordFields?["level"] as? Int, level >= 3 {
            Task { @MainActor in FocusLock.shared.engage(minutes: 45) }
        }
        // Keep the widgets, the lock screen and the night check current with the app closed.
        Task { @MainActor in
            await BackgroundRefresh.run()
            completionHandler(.newData)
        }
    }
}

extension Notification.Name {
    static let orionLinkChanged = Notification.Name("orionLinkChanged")
    /// A tap on an ORION message notification: open the thread at that message.
    static let orionOpenThread = Notification.Name("orionOpenThread")
}

/// Where a tapped notification should land. Kept until the root view is up (a cold launch from the tap).
@MainActor
enum ThreadTarget {
    private(set) static var pending: String?
    static func open(_ askID: String) {
        pending = askID
        NotificationCenter.default.post(name: .orionOpenThread, object: nil, userInfo: ["askId": askID])
    }
    static func consume() -> String? { defer { pending = nil }; return pending }
}

struct PhoneRootView: View {
    @StateObject private var reader = PhoneTodayReader()
    @StateObject private var identity = PhoneDeviceIdentity()
    @StateObject private var planner = PlannerStore()
    @StateObject private var remote = RemoteStore()
    @ObservedObject private var routine = NightRoutine.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var planMode = "schedule"
    @State private var selectedItem: PlannerStore.Item?
    @State private var creatingEvent = false
    #if targetEnvironment(simulator)
    @StateObject private var pairingApproval = PairingApprovalTestBridge()
    @State private var reviewedSetup: PhoneHTTPReadSession.Bootstrap?
    @State private var setupStatus = "Review the local connection before loading a reading."
    @State private var connectionTask: Task<Void, Never>?
    @State private var rememberConnection = false
    @AppStorage("orion.rememberedLocalConnection.v1") private var rememberedConnectionData = Data()
    private var rememberedConnection: RememberedLocalConnection? {
        guard let fingerprint = identity.identifier else { return nil }
        return try? RememberedLocalConnection.decode(rememberedConnectionData, expectedFingerprint: fingerprint)
    }
    private var reviewsConnection: Bool { ProcessInfo.processInfo.arguments.contains("--review-http-session") }
    #endif
    @State private var sample: TodayPlan?
    @State private var sampleError: String?
    private let sampleNow = Date(timeIntervalSince1970: 1_788_948_000) // 2026-09-09 10:00 UTC

    /// Which tab opens. `--tab plan` (Simulator only) opens another, so a
    /// screenshot check can reach every screen without taps.
    @State private var tab: String = {
        #if targetEnvironment(simulator)
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "--tab"), index + 1 < arguments.count { return arguments[index + 1] }
        #endif
        return "today"
    }()

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { today }.tabItem { Label("Today", systemImage: "sun.max") }.tag("today")
            NavigationStack { plan }.tabItem { Label("Plan", systemImage: "calendar") }.tag("plan")
            NavigationStack { ConversationView(remote: remote) }.tabItem { Label("ORION", systemImage: "waveform") }.tag("orion")
            NavigationStack { HealthView(remote: remote) }.tabItem { Label("Health", systemImage: "heart") }.tag("health")
            NavigationStack { control }.tabItem { Label("Control", systemImage: "slider.horizontal.3") }.tag("control")
        }
        .tint(Phone.accent)
        .preferredColorScheme(.dark)
        .onReceive(NotificationCenter.default.publisher(for: .orionOpenThread)) { _ in tab = "orion" }
        .onAppear { if ThreadTarget.pending != nil { tab = "orion" } }
        .task {
            #if targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--sample") { loadSample() }
            if reviewsConnection {
                do { reviewedSetup = try PhoneHTTPReadSession.loadSetup() }
                catch { setupStatus = "Connection setup is unavailable. Start a new preview on your Mac." }
            } else if ProcessInfo.processInfo.arguments.contains("--http-session-test") {
                await PhoneHTTPReadSession.connect(identity: identity, reader: reader)
            }
            #endif
            await reader.refresh()
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            #if targetEnvironment(simulator)
            if RemoteStore.fixture {
                routine.preview(pastBedtime: ProcessInfo.processInfo.arguments.contains("--late") ? 190 : -150)
                return
            }
            #endif
            routine.log = { [weak remote] entry in remote?.log(entry) }
            PhoneSignals.shared.log = { [weak remote] entry in remote?.logQuietly(entry) }
            PhoneSignals.shared.start()
            WakeSignals.observeCharger()
            let planner = self.planner, routine = self.routine, remote = self.remote
            remote.offlineContext = OfflineContext(
                schedule: { tomorrow in
                    planner.summary(of: tomorrow ? Calendar.current.date(byAdding: .day, value: 1, to: Date())! : Date())
                },
                addReminder: { title, due in planner.addTodo(title: title, due: due) },
                log: { entry in remote.log(entry) },
                next: {
                    let now = Date()
                    if let plan = routine.plan, plan.isPastBedtime(now), !routine.inBed {
                        return "Sleep. It's \(NightPlan.clock(now)) and you get \(NightPlan.duration(plan.sleepLeft(at: now))) if you go now\(plan.reason.map { " — \($0)" } ?? "")."
                    }
                    let event = planner.nextEvent(after: now)
                    let todo = planner.todos.first { !$0.done }
                    var parts: [String] = []
                    if let todo { parts.append("Work on \(todo.title)") }
                    if let event {
                        let minutes = Int(event.start.timeIntervalSince(now) / 60)
                        parts.append("\(event.title) is at \(NightPlan.clock(event.start))" + (minutes < 90 ? " (in \(minutes) min)" : ""))
                    }
                    return parts.isEmpty ? "Nothing's planned and your list is clear — it's yours." : parts.joined(separator: ". ") + "."
                },
                tonight: {
                    guard let plan = routine.plan else { return "No plan for tonight yet." }
                    return "Bed by \(NightPlan.clock(plan.bed)), alarm \(NightPlan.clock(plan.wake))"
                        + (plan.reason.map { " for \($0)" } ?? "")
                        + ". Going to sleep now gives \(NightPlan.duration(plan.sleepLeft(at: Date())))."
                })
            await routine.refresh(planner: planner, wakeRequest: remote.snapshot?.wakeRequest)
            FocusLock.shared.releaseIfExpired()
            // Opening ORION in the morning is being up: the night lock comes off.
            FocusLock.shared.releaseNightLock()
            // Opening the phone after bedtime is being awake: it can move the alarm later.
            await routine.noteAwake(planner: planner)
            await routine.checkNightSignals(planner: planner, macLastInput: remote.snapshot?.lastInputAt)
            publishGlance()
        }
        .onChange(of: remote.snapshot?.screenGrant) { _, grant in
            guard let grant else { return }
            FocusLock.shared.grant(grant)
            remote.logQuietly(FocusLock.screenState())
        }
        .onChange(of: remote.snapshot?.wakeRequest) { _, request in
            Task { await routine.refresh(planner: planner, wakeRequest: request) }
        }
        // The widgets, lock screen and Dynamic Island follow every change to the day.
        .onChange(of: remote.snapshot) { _, _ in publishGlance() }
        .onChange(of: planner.events) { _, _ in publishGlance() }
        .onChange(of: planner.todos) { _, _ in publishGlance() }
        .onChange(of: routine.plan) { _, _ in publishGlance() }
        .onOpenURL { url in
            // orion://show/<tab> from a widget or the lock screen.
            guard url.scheme == "orion" else { return }
            if url.host == "listen" { tab = "orion"; return }
            switch url.lastPathComponent {
            case "tasks", "calendar", "plan": tab = "plan"
            case "health": tab = "health"
            case "projects", "control": tab = "control"
            case "orion", "chat": tab = "orion"
            default: tab = "today"
            }
        }
    }

    private func publishGlance() {
        #if targetEnvironment(simulator)
        if RemoteStore.fixture { return }
        #endif
        GlanceWriter.publish(planner: planner, snapshot: remote.snapshot, night: routine.plan)
    }

    #if targetEnvironment(simulator)
    private var connectionSetup: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let setup = reviewedSetup {
                SectionLabel("Connect to your Mac", tint: Phone.accent)
                Text("Review local connection").font(Phone.display(22)).foregroundStyle(Phone.text)
                Text("This Simulator can read the saved plan shared by the local service on this Mac. It cannot change your plan.")
                    .font(.system(size: 15)).foregroundStyle(Phone.soft)
                Text("Local address: 127.0.0.1:\(setup.port)")
                    .font(Phone.mono(12, .medium)).foregroundStyle(Phone.accent).accessibilityIdentifier("setupAddress")
                Text("Temporary test account · access lasts up to five minutes. No account is signed in. Disconnect from Control to clear the reading.")
                    .font(.footnote).foregroundStyle(Phone.dim)
                Toggle("Remember this connection", isOn: $rememberConnection)
                    .tint(Phone.accent)
                    .accessibilityIdentifier("rememberReadConnection")
                Text("Saves connection details only. A fresh approval is still needed to connect again.")
                    .font(.footnote).foregroundStyle(Phone.dim)
                Button("Connect and read plan") {
                    let shouldRemember = rememberConnection
                    reviewedSetup = nil
                    setupStatus = "Connecting to the local service…"
                    connectionTask = Task {
                        await PhoneHTTPReadSession.connect(identity: identity, reader: reader, reviewedSetup: setup)
                        if !Task.isCancelled {
                            await reader.refresh()
                            if !Task.isCancelled {
                                setupStatus = "Start a new preview on your Mac to connect again."
                                if shouldRemember, reader.available, let fingerprint = identity.identifier {
                                    do {
                                        let value = try RememberedLocalConnection(port: setup.port, ownerID: setup.owner,
                                            deviceID: setup.device, phoneFingerprint: fingerprint)
                                        rememberedConnectionData = try JSONEncoder().encode(value)
                                    } catch { setupStatus = "Reading loaded, but connection details could not be saved." }
                                }
                                connectionTask = nil
                            }
                        }
                    }
                }
                .buttonStyle(PhoneButtonStyle(prominent: true))
                .accessibilityIdentifier("approveReadConnection")
                Button("Not now", role: .cancel) {
                    reviewedSetup = nil
                    setupStatus = "Connection declined · no reading loaded"
                }
                .buttonStyle(PhoneButtonStyle(tint: Phone.soft))
                .accessibilityIdentifier("declineReadConnection")
            } else {
                Text(setupStatus).font(.system(size: 14)).foregroundStyle(Phone.soft).accessibilityIdentifier("setupStatus")
                if connectionTask != nil {
                    Button("Cancel connection", role: .cancel) {
                        connectionTask?.cancel(); connectionTask = nil
                        reader.disconnect()
                        setupStatus = "Connection cancelled · no reading loaded"
                    }
                    .buttonStyle(PhoneButtonStyle(tint: Phone.soft))
                    .accessibilityIdentifier("cancelReadConnection")
                }
            }
        }
    }
    #endif

    private var today: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                PhoneHeader(eyebrow: Date().formatted(.dateTime.weekday(.wide).day().month(.wide)), title: Phone.greeting())
                #if targetEnvironment(simulator)
                if RemoteStore.fixture { realToday }
                #else
                realToday
                #endif
                #if targetEnvironment(simulator)
                if !RemoteStore.fixture {
                connectionNotice
                if planner.access == .granted { todayFromPlanner }
                #if targetEnvironment(simulator)
                if reviewsConnection && (!reader.configured || connectionTask != nil) { connectionSetup }
                #endif
                if reader.configured {
                    connectedReading
                } else if planner.access == .granted {
                    // Real day shown above; the sample has nothing to add.
                } else if let sample {
                    sampleNotice
                    let now = sample.current(at: sampleNow)
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel("Now", tint: Phone.accent)
                        Text(now?.title ?? "Open time").font(Phone.display(30, .bold)).foregroundStyle(Phone.text)
                        if let now {
                            Text("Until \(time(now.start.addingTimeInterval(TimeInterval(now.minutes * 60)))) · \(now.minutes) min")
                                .font(Phone.mono(13, .medium)).foregroundStyle(Phone.soft)
                        }
                    }
                    HStack(alignment: .top, spacing: 18) {
                        let next = sample.nextCommitment(at: sampleNow)
                        PhoneStat(label: "Next commitment", value: next?.title ?? "None",
                                  detail: next.map { "at \(time($0.start))" }, tint: Phone.violet)
                        PhoneStat(label: "Free today", value: "\(sample.freeMinutes(after: sampleNow))",
                                  detail: "minutes left open", tint: Phone.green)
                    }
                    Button("Close sample", role: .cancel) { self.sample = nil }
                        .buttonStyle(PhoneButtonStyle(tint: Phone.soft))
                        .accessibilityIdentifier("closeSample")
                } else {
                    PhoneEmptyState(symbol: "sun.max", title: "Your day will appear here",
                                    detail: "Once this phone is connected to your Mac, today’s calendar, tasks and plan show up here.")
                    VStack(alignment: .leading, spacing: 10) {
                        Button { loadSample() } label: { Label("Explore a sample day", systemImage: "sparkles") }
                            .buttonStyle(PhoneButtonStyle(prominent: true))
                            .accessibilityIdentifier("openSample")
                        Text("Example data only. No account or permissions needed.").font(.footnote).foregroundStyle(Phone.dim)
                    }
                }
                if let sampleError { Text(sampleError).foregroundStyle(Phone.red) }
                }
                #endif
            }
            .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 30)
        }
        .phoneScreen()
        .navigationTitle("Today")
    }

    private var plan: some View {
        let items = planItems
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    PhoneHeader(eyebrow: planEyebrow, title: "Plan")
                    connectionNotice
                    if let context = remote.snapshot?.earlyFinish {
                        FinishEarlyButton(context: context.kind == "block" ? .block(title: context.title ?? "Current block") : context.kind == "after-class" ? .afterClass(classTitle: context.classTitle ?? "Class") : .none, onChoose: remote.finishEarly)
                    }
                    if planner.access == .granted {
                        dayBar
                        Picker("View", selection: $planMode) {
                            Text("Schedule").tag("schedule")
                            Text("To-dos").tag("todos")
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("planMode")
                        if planMode == "schedule" { planControls }
                    } else {
                        connectPlanner
                    }
                    if planMode == "todos" && planner.access == .granted {
                        TodoListView(planner: planner)
                    } else if planner.access == .granted {
                        let night = routine.markers(for: planner.day, planner: planner, snapshot: remote.snapshot)
                        DayScheduleView(items: items, day: planner.day, onSelect: { selectedItem = $0 },
                                        wake: night.wake, bed: night.bed, woke: night.woke, fellAsleep: night.fellAsleep)
                    } else if let sample {
                        sampleNotice
                        DayScheduleView(items: items, day: Calendar.current.startOfDay(for: sampleNow),
                                        timeZone: TimeZone(identifier: "Europe/London") ?? .current)
                        ForEach(sample.warnings, id: \.self) {
                            Label($0, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Phone.orange)
                        }
                    } else if reader.configured {
                        connectedReading
                    } else {
                        PhoneEmptyState(symbol: "calendar", title: "Your day, like a calendar",
                                        detail: "Connect Calendar and Reminders above to see today laid out hour by hour, with your to-dos beside it. Or try the sample day from Today.",
                                        tint: Phone.violet)
                    }
                    if let problem = planner.problem { Text(problem).font(.footnote).foregroundStyle(Phone.orange) }
                }
                .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 30)
            }
            // Re-aimed whenever what is drawn changes: on first show, after access
            // is granted, and on each day change -- not only once at launch.
            .task(id: "\(planner.access)-\(planner.day.timeIntervalSince1970)-\(planMode)") {
                try? await Task.sleep(nanoseconds: 150_000_000)
                withAnimation(.easeOut(duration: 0.35)) {
                    proxy.scrollTo(DayScheduleView.anchor(for: items, day: planner.day), anchor: .top)
                }
            }
        }
        .phoneScreen()
        .navigationTitle("Plan")
        .sheet(item: $selectedItem) { item in
            if item.editable { EventEditor(planner: planner, existing: item) } else { OrionBlockSheet(item: item) }
        }
        .sheet(isPresented: $creatingEvent) { EventEditor(planner: planner) }
    }

    /// Today, from Calendar, Reminders and ORION's plan together.
    @ViewBuilder private var todayFromPlanner: some View {
        let now = Date()
        let today = planner.schedule(orion: macPlan).filter { Calendar.current.isDateInToday($0.start) && !$0.allDay }
        let current = today.first { $0.start <= now && now < $0.end }
        let next = today.first { $0.start > now }
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(current == nil ? "Next" : "Now", tint: Phone.accent)
            if let item = current ?? next {
                Text(item.title).font(Phone.display(30, .bold)).foregroundStyle(Phone.text)
                Text(current != nil
                     ? "Until \(item.end.formatted(date: .omitted, time: .shortened)) · \(item.isOrion ? "ORION plan" : item.detail)"
                     : "At \(item.start.formatted(date: .omitted, time: .shortened)) · \(item.isOrion ? "ORION plan" : item.detail)")
                    .font(Phone.mono(13, .medium)).foregroundStyle(Phone.soft)
            } else {
                Text("Nothing else scheduled today").font(Phone.display(24)).foregroundStyle(Phone.text)
            }
        }
        let open = planner.todos.filter { !$0.done }
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("To-dos · \(open.count)", tint: Phone.green)
            ForEach(open.prefix(4)) { todo in
                Button { withAnimation(.spring(response: 0.3)) { planner.toggle(todo) } } label: {
                    HStack(spacing: 12) {
                        Circle().stroke(Phone.soft, lineWidth: 1.4).frame(width: 20, height: 20)
                        Text(todo.title).font(.system(size: 16)).foregroundStyle(Phone.text)
                        Spacer()
                        if let due = todo.due, Calendar.current.isDateInToday(due) {
                            Text(due.formatted(date: .omitted, time: .shortened)).font(Phone.mono(11, .medium))
                                .foregroundStyle(due < now ? Phone.orange : Phone.dim)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Complete \(todo.title)")
            }
            if open.isEmpty { Text("All clear.").foregroundStyle(Phone.soft) }
            Button { planMode = "todos"; tab = "plan" } label: { Label("All to-dos", systemImage: "arrow.right") }
                .buttonStyle(PhoneButtonStyle())
        }
    }

    /// ORION's accepted plan from the Mac, through the link (the Simulator's
    /// local reading remains for the old development harness).
    private var macPlan: TodayPlan? { remote.snapshot?.plan ?? reader.snapshot?.plan }

    private var planItems: [PlannerStore.Item] {
        if planner.access == .granted { return planner.schedule(orion: macPlan) }
        if let sample { return PlannerStore.Item.sample(sample) }
        return []
    }

    private var planEyebrow: String {
        if planner.access == .granted { return planner.day.formatted(.dateTime.weekday(.wide).day().month(.wide)) }
        return sample == nil ? "Your plan" : "Wednesday, 9 September · London time"
    }

    /// Previous day, today, next day, and a new event.
    private var dayBar: some View {
        HStack(spacing: 14) {
            Button { planner.show(Calendar.current.date(byAdding: .day, value: -1, to: planner.day) ?? planner.day) } label: {
                Image(systemName: "chevron.left")
            }.accessibilityLabel("Previous day")
            Button("Today") { planner.show(Date()) }
                .font(.system(size: 14, weight: .semibold))
                .disabled(Calendar.current.isDateInToday(planner.day))
            Button { planner.show(Calendar.current.date(byAdding: .day, value: 1, to: planner.day) ?? planner.day) } label: {
                Image(systemName: "chevron.right")
            }.accessibilityLabel("Next day")
            Spacer()
            Button { creatingEvent = true } label: { Label("Event", systemImage: "plus") }
                .buttonStyle(PhoneButtonStyle())
                .accessibilityIdentifier("newEvent")
        }
        .foregroundStyle(Phone.accent)
    }

    @ViewBuilder private var connectPlanner: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Calendar & Reminders", tint: Phone.accent)
            Text(planner.access == .denied
                 ? "ORION doesn’t have access to Calendar and Reminders. Turn it on in Settings › Privacy & Security."
                 : "See today hour by hour and keep your to-dos here. ORION reads and edits Apple Calendar and your \(PlannerStore.orionList) Reminders list directly, so every change also appears in Apple’s apps and on your Mac.")
                .font(.system(size: 14)).foregroundStyle(Phone.soft).fixedSize(horizontal: false, vertical: true)
            if planner.access == .notAsked {
                Button { Task { await planner.connect() } } label: { Label("Connect Calendar & Reminders", systemImage: "calendar.badge.plus") }
                    .buttonStyle(PhoneButtonStyle(prominent: true))
                    .accessibilityIdentifier("connectPlanner")
            }
        }
    }

    private var control: some View {
        ScrollView { controlContent.padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 30) }
            // Sections on the backdrop under fading labels, no row chrome: grouped
            // cards are the bubble-behind-everything look the Mac app moved away from.
            .font(.system(size: 15))
            .foregroundStyle(Phone.text)
            .phoneScreen()
            .navigationTitle("Control")
    }

    private var controlContent: some View {
        VStack(alignment: .leading, spacing: 30) {
            PhoneHeader(eyebrow: "Your Mac, from anywhere", title: "Control")
            RemoteSections(remote: remote)
            SignalsSection(signals: PhoneSignals.shared)
            PresenceSection(presence: LivePresence.shared)
            FocusLockSection(lock: FocusLock.shared)
            #if targetEnvironment(simulator)
            if RemoteStore.fixture { PhoneConnectionSection(remote: remote) } else {
            SectionLabel("This phone", tint: Phone.soft).padding(.top, 10)
            controlSection("This phone’s identity") {
                Text(identity.status).accessibilityIdentifier("deviceIdentityStatus")
                if let identifier = identity.identifier {
                    Text(identifier).font(Phone.mono(11, .medium)).foregroundStyle(Phone.soft).textSelection(.enabled)
                        .accessibilityIdentifier("deviceIdentityID")
                    Button("Verify local key") { identity.verifyLocalKey() }
                        .foregroundStyle(Phone.accent)
                        .accessibilityIdentifier("verifyDeviceKey")
                    if identity.verified {
                        Label("Local key verified · no account paired", systemImage: "checkmark.seal")
                            .foregroundStyle(Phone.green)
                            .accessibilityIdentifier("deviceKeyVerified")
                    }
                } else {
                    Button("Retry identity") { identity.load() }.foregroundStyle(Phone.accent)
                }
            }
            if ProcessInfo.processInfo.arguments.contains("--read-session-test") {
                controlSection("Device session test") {
                    Text("Disposable account · local read access only")
                    Button("Sign read-session challenge") { identity.writeTestReadSessionProof() }
                        .accessibilityIdentifier("signReadSession")
                    Text(identity.readSessionTestStatus).accessibilityIdentifier("readSessionProofStatus")
                }
            }
            if ProcessInfo.processInfo.arguments.contains("--pairing-approval-test") {
                controlSection("Pairing test") {
                    if let request = pairingApproval.request {
                        NavigationLink("Review pairing request") {
                            PairingApprovalView(request: request,
                                approve: { pairingApproval.decide(approve: true, identity: identity) },
                                reject: { pairingApproval.decide(approve: false, identity: identity) },
                                finished: pairingApproval.finished, status: pairingApproval.status)
                        }.accessibilityIdentifier("reviewPairing")
                    } else { Text(pairingApproval.status).accessibilityIdentifier("approvalLoadStatus") }
                }
                .onAppear { pairingApproval.load(identity: identity) }
            }
            if ProcessInfo.processInfo.arguments.contains("--pairing-proof-test") {
                controlSection("Disposable pairing test") {
                    Text("Test account only · no real account will be paired")
                    Button("Sign test pairing claim") { identity.writeTestPairingProof() }
                        .accessibilityIdentifier("signTestPairing")
                    Text(identity.pairingTestStatus).accessibilityIdentifier("pairingTestStatus")
                }
            }
            if !rememberedConnectionData.isEmpty {
                controlSection("Remembered connection") {
                    if let saved = rememberedConnection {
                        Text("Local preview · 127.0.0.1:\(saved.port)")
                            .accessibilityIdentifier("rememberedConnectionAddress")
                        Text("Temporary test account. Remembered details do not grant access or reconnect automatically.")
                            .font(.footnote).foregroundStyle(Phone.dim)
                    } else {
                        Text("Saved connection details cannot be verified for this phone.")
                    }
                    Button("Forget connection", role: .destructive) {
                        connectionTask?.cancel(); connectionTask = nil
                        reader.disconnect()
                        rememberedConnectionData = Data()
                        reviewedSetup = nil; rememberConnection = false
                        setupStatus = "Connection forgotten · start a new preview to connect again."
                    }.accessibilityIdentifier("forgetReadConnection")
                }
            }
            controlSection("Connection to your Mac") {
                StatusDot(text: reader.message, tint: reader.available ? Phone.green : Phone.dim)
                if reader.cancelledPendingRead {
                    Text("Pending refresh cancelled").accessibilityIdentifier("cancelledPendingRead")
                }
                if reader.configured {
                    Button("Disconnect this reading", role: .destructive) { reader.disconnect() }
                        .accessibilityIdentifier("disconnectReading")
                    Text("Clears this phone’s reading and local access token. It does not remove the device from an account.")
                        .font(.footnote).foregroundStyle(Phone.dim)
                }
                Text("Pairing with a physical iPhone is not available yet. In the Simulator, a local read-only connection can be set up for development.")
                    .font(.footnote).foregroundStyle(Phone.dim)
            }
            controlSection("Privacy") {
                Label("No account signed in", systemImage: "person.crop.circle.badge.xmark")
                Label(reader.configured ? "Local development snapshot · memory only" : "No personal records loaded", systemImage: "lock")
                Text("Sample data is temporary and clears when the app closes.").font(.footnote).foregroundStyle(Phone.dim)
            }
            controlSection("In this build") {
                Text("Today and Plan can show a sample day, or a read-only plan from your Mac in the Simulator.")
                Text("Pairing, sync, conversation, notifications and remote actions are still to come.").font(.footnote).foregroundStyle(Phone.dim)
            }
            }
            #else
            PhoneConnectionSection(remote: remote)
            #endif
        }
    }

    /// Today: what is now and next, the to-dos, and the two things logged most.
    /// The Mac's own state lives on Control; only an approval is worth interrupting for.
    @ViewBuilder private var realToday: some View {
        if let waiting = remote.snapshot?.approvals, !waiting.isEmpty {
            Button { tab = "control" } label: {
                HStack(spacing: 10) {
                    Image(systemName: "hand.raised.fill").foregroundStyle(Phone.orange)
                    Text(waiting.count == 1 ? "ORION is waiting for your approval" : "\(waiting.count) approvals waiting")
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Phone.text)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Phone.dim)
                }
                .padding(14)
                .background(Phone.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        TonightCard(routine: routine)
        if planner.access == .granted { todayFromPlanner } else { connectPlanner }
        TodayTracking(remote: remote, openHealth: { tab = "health" })
    }

    private func controlSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel(title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var connectionNotice: some View {
        HStack(spacing: 8) {
            Circle().fill(linkOnline ? Phone.green : Phone.dim).frame(width: 6, height: 6)
            Label(linkMessage, systemImage: "link")
                .labelStyle(.titleOnly)
                .font(.system(size: 13, weight: .medium)).foregroundStyle(Phone.soft)
                .accessibilityIdentifier("connectionStatus")
        }
    }
    private var linkOnline: Bool { remote.presence == .online || reader.available }
    private var linkMessage: String {
        if reader.configured { return reader.message }
        switch remote.presence {
        case .online: return "Connected to your Mac"
        case .stale: return "Your Mac is slow to respond"
        case .offline: return "Your Mac is offline · showing the last plan it sent"
        case .unknown: return remote.iCloudReady ? "Waiting to hear from your Mac" : "Connecting through iCloud…"
        }
    }

    /// Ask the ORION app on the Mac to plan, replan or undo; its answer comes back with the plan.
    @ViewBuilder private var planControls: some View {
        let today = Calendar.current.isDateInToday(planner.day)
        if today {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    let hasPlan = macPlan.map { Calendar.current.isDateInToday($0.day) } ?? false
                    Button { remote.plan(hasPlan ? .replan : .plan) } label: {
                        Label(hasPlan ? "Replan from now" : "Plan my day", systemImage: hasPlan ? "arrow.clockwise" : "sparkles")
                    }
                    .buttonStyle(PhoneButtonStyle(prominent: !hasPlan))
                    .disabled(remote.planStatus?.working == true)
                    .accessibilityIdentifier("planMyDay")
                    if hasPlan {
                        Button { remote.plan(.undo) } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                            .buttonStyle(PhoneButtonStyle(tint: Phone.soft))
                            .disabled(remote.planStatus?.working == true)
                    }
                }
                if let status = remote.planStatus {
                    HStack(spacing: 8) {
                        if status.working { PhoneThinkingDots() }
                        Text(status.text).font(.system(size: 13))
                            .foregroundStyle(status.failed ? Phone.orange : status.working ? Phone.soft : Phone.green)
                    }
                } else if macPlan == nil {
                    Text("ORION fits your to-dos into the gaps between events, keeps free time free, and never moves your calendar.")
                        .font(.system(size: 13)).foregroundStyle(Phone.dim).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var connectedReading: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                SectionLabel("From your Mac", tint: Phone.accent)
                Button { Task { await reader.refresh() } } label: {
                    Label(reader.loading ? "Refreshing…" : "Refresh reading", systemImage: "arrow.clockwise")
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(PhoneButtonStyle())
                .disabled(reader.loading).accessibilityIdentifier("refreshReading")
            }
            TimelineView(.periodic(from: .now, by: 10)) { context in
                VStack(alignment: .leading, spacing: 14) {
                    if let snapshot = reader.snapshot {
                        let current = reader.available && snapshot.isCurrent(at: context.date)
                        StatusDot(text: current ? "Recent plan reading" : "Stale plan reading · refresh sources on your Mac",
                                  tint: current ? Phone.green : Phone.orange, identifier: "readingFreshness")
                        Text("Revision \(snapshot.revision)").font(Phone.mono(11, .medium)).foregroundStyle(Phone.dim)
                            .accessibilityIdentifier("readingRevision")
                        if let plan = snapshot.plan {
                            Text(plan.reason).font(Phone.display(20)).foregroundStyle(Phone.text)
                                .accessibilityIdentifier("readingReason")
                            Text("Plan created \(plan.generatedAt.formatted(date: .abbreviated, time: .shortened))")
                                .font(.footnote).foregroundStyle(Phone.dim)
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(plan.blocks.enumerated()), id: \.element.id) { index, block in
                                    TimelineRow(time: time(block.start, zone: plan.timeZone), title: block.title,
                                                detail: "\(block.minutes) minutes · \(kindName(block.kind))", tint: tint(block.kind),
                                                isLast: index == plan.blocks.count - 1)
                                }
                            }
                        } else { Text("No accepted plan in this snapshot").foregroundStyle(Phone.soft) }
                    } else { Text("No verified reading loaded").foregroundStyle(Phone.soft) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private var sampleNotice: some View {
        Label("SAMPLE DATA · Not your real day", systemImage: "sparkles")
            .font(Phone.mono(10)).tracking(1.2).foregroundStyle(Phone.orange)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .overlay(Capsule().stroke(Phone.orange.opacity(0.5), lineWidth: 1))
            .accessibilityIdentifier("sampleNotice")
    }
    private func tint(_ kind: TodayPlanBlock.Kind) -> Color {
        switch kind {
        case .commitment: return Phone.violet
        case .task: return Phone.accent
        case .transition: return Phone.dim
        case .free: return Phone.green
        }
    }
    private func kindName(_ kind: TodayPlanBlock.Kind) -> String {
        switch kind {
        case .commitment: return "commitment"
        case .task: return "focus"
        case .transition: return "transition"
        case .free: return "open time"
        }
    }
    private func time(_ date: Date, zone: String = "Europe/London") -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: zone) ?? TimeZone(identifier: "Europe/London")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
    private func loadSample() {
        do {
            sample = try TodayPlanScheduler.propose(
                now: sampleNow, timeZone: "Europe/London", preferences: TodayPlanPreferences(),
                tasks: [TodayPlanTask(id: "example-reading", title: "Read for tomorrow’s seminar", minutes: 45, priority: 2),
                        TodayPlanTask(id: "example-outline", title: "Outline a project idea", minutes: 30, priority: 1)],
                commitments: [TodayPlanCommitment(id: "example-seminar", title: "Afternoon seminar", start: sampleNow.addingTimeInterval(4 * 3600), end: sampleNow.addingTimeInterval(5 * 3600))],
                reason: "Example day for exploring the phone app", sourceFingerprint: "phone-sample-v1")
            sampleError = nil
        } catch { sampleError = "The sample could not be loaded." }
    }
}
