import Combine
import SwiftUI
import MobileCore

/*
 Remote access: the Mac, from anywhere. See the Mac, control agent runs, approve
 ORION's requests, run things on the Mac, and message ORION.

 LIVE since 2026-09-28: `RemoteStore` reads the Mac's snapshot and sends
 commands through `CloudLink` (CloudKit, Nick's private database). Every command
 is text in orion-remote's grammar, and the Mac runs it through the same gate as
 Discord. Nothing here is sample data: if the Mac has never published, the
 screen says so rather than showing a made-up Mac.
*/
@MainActor
final class RemoteStore: ObservableObject {
    @Published private(set) var snapshot: LinkSnapshot?
    @Published private(set) var problem: String?
    @Published private(set) var conversation: [CloudLink.Message] = []
    /// The latest answer to a Control button, shown in place.
    @Published var notice: String?
    @Published private(set) var now = Date()
    @Published private(set) var iCloudReady = false

    let link = CloudLink()
    private var watchers: Set<AnyCancellable> = []
    private var clock: Timer?
    private var answeredControl: Set<String> = []

    init() {
        // Presence ages even when nothing new arrives.
        let clock = Timer(timeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.now = Date(); await self?.flushOutbox() }
        }
        RunLoop.main.add(clock, forMode: .common)
        self.clock = clock
        #if targetEnvironment(simulator)
        if Self.fixture { loadFixture(); return }
        #endif
        link.$snapshot.receive(on: RunLoop.main).sink { [weak self] value in
            guard let self else { return }
            self.snapshot = value
            // The widgets and lock screen follow the Mac even when no screen is showing.
            if !Self.fixture { GlanceWriter.publish(snapshot: value) }
            self.reconcile(self.link.messages)
            self.syncOfflineConversation()
            if let asked = self.planAsked, let request = value?.planRequest, request.at >= asked.at.addingTimeInterval(-5),
               request.state == .done || request.state == .failed { self.planAsked = nil }
        }.store(in: &watchers)
        link.$problem.receive(on: RunLoop.main).sink { [weak self] in self?.problem = $0 }.store(in: &watchers)
        link.$iCloudReady.receive(on: RunLoop.main).sink { [weak self] in self?.iCloudReady = $0 }.store(in: &watchers)
        link.$messages.receive(on: RunLoop.main).sink { [weak self] messages in self?.absorb(messages) }.store(in: &watchers)
        #if !targetEnvironment(simulator)
        link.start()
        #endif
    }

    /// Simulator only: `--link-fixture` renders the real screens with a
    /// realistic Mac and conversation, for design review. Never on a device.
    static var fixture: Bool {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("--link-fixture")
        #else
        return false
        #endif
    }

    #if targetEnvironment(simulator)
    private func loadFixture() {
        iCloudReady = true
        let now = Date()
        let day: (Int, Int?, Int?, Double?, Double?) -> LinkSnapshot.HealthDay = { back, recovery, hrv, sleep, strain in
            let date = Calendar.current.date(byAdding: .day, value: -back, to: now)!
            let key = date.formatted(.iso8601.year().month().day())
            return .init(date: key, recovery: recovery, hrv: hrv, restingHeartRate: 49, sleepHours: sleep, sleepPerformance: 72, strain: strain)
        }
        snapshot = LinkSnapshot(
            generatedAt: now.addingTimeInterval(-12),
            mac: .init(name: "Nick’s MacBook Pro", battery: 81, charging: true, diskFreeGB: 214, uptimeHours: 31,
                       runningApps: ["Orion", "Safari", "Xcode", "Messages"], locked: false),
            runs: [.init(id: "project-f9a2", project: "Attention engine and ops tools", status: .working, live: true, role: "worker",
                         model: "qwen3.6:27b", activeTask: "Durable attention queue", step: "3/5 · write the tests",
                         accepted: 11, total: 30, percent: 36, minutesOnTask: 7)],
            approvals: [.init(id: "A-7F3K", action: "terminal_run", summary: "terminal_run — command: ls ~/Projects",
                              context: "List the project folders", expiresAt: now.addingTimeInterval(540))],
            running: [],
            attention: .init(generatedAt: now, interrupt: [.init(id: "c1", title: "Seminar starts in 20 min", source: "calendar", reason: "score")],
                             today: [.init(id: "w1", title: "Still waiting on Prof. Hale: feedback on the draft", source: "waiting", reason: "low_score")],
                             note: nil),
            health: [day(6, 58, 120, 6.9, 11.2), day(5, 71, 131, 7.4, 14.0), day(4, 44, 98, 6.1, 16.3), day(3, 66, 118, 7.0, 9.8),
                     day(2, 80, 142, 8.1, 12.5), day(1, 76, 139, 7.6, 15.2), day(0, 84, 156, 7.5, 18.1)],
            tracking: .init(day: "today", waterBottles: 4, waterGoal: 9, calories: 1_240, calorieGoal: 2_200, protein: 86, proteinGoal: 150,
                            meals: [.init(id: "f1", title: "Greek yoghurt and berries", meal: "Breakfast", calories: 380, protein: 28),
                                    .init(id: "f2", title: "Chicken rice bowl", meal: "Lunch", calories: 860, protein: 58)],
                            supplements: [.init(id: "s1", name: "Creatine", dose: "5 g", timeOfDay: "morning", taken: true),
                                          .init(id: "s2", name: "Magnesium", dose: "200 mg", timeOfDay: "evening", taken: false)],
                            recentFoods: [.init(id: "r1", title: "Protein shake", meal: "Snack", calories: 220, protein: 40),
                                          .init(id: "r2", title: "Chicken rice bowl", meal: "Lunch", calories: 860, protein: 58)]),
            plan: Self.fixturePlan(now),
            planRequest: .init(id: "p1", action: "plan", state: .done, message: "3 tasks placed · 150 min kept free", at: now.addingTimeInterval(-300)))
        conversation = [
            .init(id: "m1", text: "What does my day look like?", sentAt: now.addingTimeInterval(-600), kind: .chat, status: .done,
                  reply: "Seminar at 2pm, then nothing booked until your 6pm run. You have about three free hours this afternoon — the best block is 3 to 5.", repliedAt: now.addingTimeInterval(-594)),
            .init(id: "m2", text: "How is the agent run going?", sentAt: now.addingTimeInterval(-60), kind: .chat, status: .running),
        ]
    }
    #endif

    #if targetEnvironment(simulator)
    private static func fixturePlan(_ now: Date) -> TodayPlan? {
        let day = Calendar.current.startOfDay(for: now)
        let at = { (hour: Double) in day.addingTimeInterval(hour * 3600) }
        return try? TodayPlanScheduler.propose(
            now: max(now, at(8)), timeZone: TimeZone.current.identifier, preferences: TodayPlanPreferences(),
            tasks: [TodayPlanTask(id: "t1", title: "Essay outline", minutes: 60, priority: 1),
                    TodayPlanTask(id: "t2", title: "Reply to Prof. Hale", minutes: 20, priority: 2),
                    TodayPlanTask(id: "t3", title: "Gym", minutes: 60, priority: 3)],
            commitments: [TodayPlanCommitment(id: "c1", title: "Seminar", start: at(14), end: at(15.5))],
            reason: "Fixture", sourceFingerprint: "fixture")
    }
    #endif

    private func absorb(_ messages: [CloudLink.Message]) {
        cloudConversation = messages.filter { $0.kind == .chat }
        rebuildConversation()
        reconcile(messages)
        // Surface each control reply once, the first time it arrives.
        let fresh = messages.filter { $0.kind == .control && $0.reply != nil && !answeredControl.contains($0.id) }
        for message in fresh { answeredControl.insert(message.id) }
        if let latest = fresh.last(where: { Date().timeIntervalSince($0.sentAt) < 120 }), let reply = latest.reply {
            notice = reply
        }
    }

    var presence: MacPresence { snapshot?.presence(at: now) ?? .unknown }

    /// A Control button: a command in orion-remote's grammar.
    func control(_ text: String, saying: String) {
        notice = saying
        Task { if await link.send(text, kind: .control) == nil { notice = link.problem ?? "Could not send that." } }
    }

    // MARK: - With the Mac off

    /// Set by the app: what the on-phone ORION can reach (calendar, reminders, tonight).
    var offlineContext: OfflineContext?
    private var cloudConversation: [CloudLink.Message] = []
    @Published private(set) var localConversation: [CloudLink.Message] = LocalChat.load()
    private var offlineBrain: AnyObject?

    /// Talk to the Mac only when it is actually answering.
    var macReachable: Bool { presence == .online }

    private func rebuildConversation() {
        conversation = (cloudConversation + localConversation).sorted { $0.sentAt < $1.sentAt }.suffix(200).map { $0 }
    }

    /// Answer on the phone with the on-device model. Returns false when this
    /// phone can't, so the message goes to the Mac and waits for it instead.
    private func answerOnPhone(_ text: String, id: String) -> Bool {
        guard #available(iOS 26.0, *), let context = offlineContext, OfflineBrain.available else { return false }
        let brain = (offlineBrain as? OfflineBrain) ?? OfflineBrain(context: context)
        offlineBrain = brain
        var message = CloudLink.Message(id: id, text: text, sentAt: Date(), kind: .chat, status: .running)
        localConversation.append(message)
        rebuildConversation()
        Task {
            let reply = await brain.answer(text)
            message.status = .done
            message.reply = reply
            message.repliedAt = Date()
            if let index = localConversation.firstIndex(where: { $0.id == id }) { localConversation[index] = message }
            LocalChat.save(localConversation)
            rebuildConversation()
        }
        return true
    }

    /// Once the Mac answers again, the conversation it missed goes into its memory
    /// journal, one exchange per note (the phone's structured events, reconciled
    /// into ORION's Markdown on the Mac).
    private func syncOfflineConversation() {
        guard macReachable else { return }
        var synced = Set(UserDefaults.standard.stringArray(forKey: "orion.localChat.synced") ?? [])
        let formatter = ISO8601DateFormatter()
        for message in localConversation where message.status == .done && !synced.contains(message.id) {
            let text = "Offline on the phone — Nick: \(message.text) / ORION (phone): \(message.reply ?? "")"
            logQuietly(.note(text: String(text.prefix(1100)), at: formatter.string(from: message.sentAt)))
            synced.insert(message.id)
        }
        UserDefaults.standard.set(Array(synced.suffix(200)), forKey: "orion.localChat.synced")
    }

    // MARK: - Tracking outbox

    /// Entries iCloud could not take (no signal): kept on the phone and sent
    /// when it can, rather than lost.
    private var outbox: [String: String] = (UserDefaults.standard.dictionary(forKey: "orion.outbox.v1") as? [String: String]) ?? [:] {
        didSet { UserDefaults.standard.set(outbox, forKey: "orion.outbox.v1") }
    }
    private var flushing = false

    func flushOutbox() async {
        guard !outbox.isEmpty, iCloudReady, !flushing else { return }
        flushing = true
        defer { flushing = false }
        for (id, text) in outbox where await link.send(text, kind: .log, id: id) != nil {
            outbox[id] = nil
        }
    }

    /// A message to ORION, from the conversation tab.
    /// `sent` gets the message's id at once, so voice mode knows which reply to read.
    func say(_ text: String, sent: ((String) -> Void)? = nil) {
        let id = UUID().uuidString
        #if targetEnvironment(simulator)
        if Self.fixture { sent?(id); return }
        #endif
        // Mac not answering: the phone answers, and says it is the phone.
        if !macReachable && answerOnPhone(text, id: "local-" + id) {
            sent?("local-" + id)
            return
        }
        sent?(id)
        Task {
            // The lock state goes first, so ORION knows it before reading "unlock my apps".
            if let state = try? FocusLock.screenState().validated().encoded() { _ = await link.send(state, kind: .log) }
            await link.send(text, kind: .chat, id: id)
        }
    }

    func decide(_ approval: LinkSnapshot.Approval, approve: Bool) {
        control(approve ? LinkCommand.approve(approval.id) : LinkCommand.deny(approval.id),
                saying: approve ? "Approving \(approval.id)…" : "Refusing \(approval.id)…")
    }

    func agent(_ action: LinkCommand.AgentAction, _ run: LinkSnapshot.Run) {
        control(LinkCommand.agent(action, project: run.id), saying: "\(action.rawValue.capitalized) sent for \(run.project)…")
    }

    // MARK: - Tracking

    /// Entries sent but not yet in a snapshot from the Mac. Applied on top of
    /// the Mac's numbers so a tap shows at once, and dropped as soon as the Mac
    /// has either counted them or refused them.
    @Published private(set) var pending: [(id: String, entry: LinkLog, sentAt: Date)] = []
    /// The Mac's answer to the last entry that failed, shown where it was logged.
    @Published var trackingProblem: String?

    /// Today's tracking as the Mac reported it, plus anything still on its way.
    var tracking: LinkSnapshot.Tracking? {
        guard var value = snapshot?.tracking else { return nil }
        for item in pending {
            switch item.entry {
            case .water(let delta): value.waterBottles = max(0, value.waterBottles + delta)
            case let .meal(title, meal, calories, protein, _, _):
                value.meals.append(.init(id: "pending-\(item.id)", title: title, meal: meal, calories: calories, protein: protein))
                value.calories += calories; value.protein += protein
            case .removeMeal(let id):
                if let gone = value.meals.first(where: { $0.id == id }) {
                    value.calories -= gone.calories; value.protein -= gone.protein
                    value.meals.removeAll { $0.id == id }
                }
            case let .supplement(id, taken):
                if let index = value.supplements.firstIndex(where: { $0.id == id }) { value.supplements[index].taken = taken }
            case .sleep, .signal, .screen, .checkin, .note:
                break
            }
        }
        return value
    }

    func log(_ entry: LinkLog) {
        guard let encoded = try? entry.validated().encoded() else { trackingProblem = "That entry isn't valid."; return }
        let id = UUID().uuidString
        pending.append((id, entry, Date()))
        trackingProblem = nil
        #if targetEnvironment(simulator)
        if Self.fixture { return }
        #endif
        Task {
            if await link.send(encoded, kind: .log, id: id) == nil {
                // Offline: keep it (and keep showing it) until iCloud takes it.
                outbox[id] = encoded
            }
        }
    }

    /// Background samples: sent (or kept in the outbox), never shown as pending.
    func logQuietly(_ entry: LinkLog) {
        guard let encoded = try? entry.validated().encoded() else { return }
        #if targetEnvironment(simulator)
        if Self.fixture { return }
        #endif
        let id = UUID().uuidString
        Task { if await link.send(encoded, kind: .log, id: id) == nil { outbox[id] = encoded } }
    }

    private func reconcile(_ messages: [CloudLink.Message]) {
        guard !pending.isEmpty else { return }
        let byID = Dictionary(uniqueKeysWithValues: messages.map { ($0.id, $0) })
        let published = snapshot?.generatedAt ?? .distantPast
        pending.removeAll { item in
            guard let message = byID[item.id] else { return false }
            if message.status == .failed { trackingProblem = message.reply; return true }
            return message.status == .done && (message.repliedAt ?? .distantFuture) <= published
        }
    }

    // MARK: - The day plan

    /// The plan request in flight from this phone, until the Mac reports on it.
    @Published private(set) var planAsked: (action: LinkPlanAction, at: Date)?

    func plan(_ action: LinkPlanAction) {
        planAsked = (action, Date())
        #if targetEnvironment(simulator)
        if Self.fixture { return }
        #endif
        Task {
            if await link.send(action.rawValue, kind: .plan) == nil {
                planAsked = nil
                notice = link.problem ?? "Could not reach your Mac."
            }
        }
    }

    /// What to say about planning right now: asked, working, done or failed.
    var planStatus: (text: String, working: Bool, failed: Bool)? {
        let request = snapshot?.planRequest
        if let asked = planAsked, (request == nil || request!.at < asked.at.addingTimeInterval(-5)) {
            return (presence == .online ? "Asking your Mac…" : "Waiting for your Mac to come online…", true, false)
        }
        guard let request, now.timeIntervalSince(request.at) < 15 * 60 else { return nil }
        switch request.state {
        case .waiting: return ("Your Mac will plan as soon as ORION is open…", true, false)
        case .working: return ("ORION is planning your day…", true, false)
        case .done: return (request.message ?? "Planned.", false, false)
        case .failed: return (request.message ?? "Your Mac couldn't make a plan.", false, true)
        }
    }
}

/// The on-phone conversation, kept on the phone (it never reached the Mac).
enum LocalChat {
    struct Stored: Codable { let id, text: String; let sentAt: Date; let reply: String?; let repliedAt: Date? }
    static let key = "orion.localChat.v1"
    static func load() -> [CloudLink.Message] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let stored = try? JSONDecoder().decode([Stored].self, from: data) else { return [] }
        return stored.map { CloudLink.Message(id: $0.id, text: $0.text, sentAt: $0.sentAt, kind: .chat,
                                              status: $0.reply == nil ? .failed : .done, reply: $0.reply ?? "Interrupted.", repliedAt: $0.repliedAt) }
    }
    static func save(_ messages: [CloudLink.Message]) {
        let stored = messages.suffix(60).map { Stored(id: $0.id, text: $0.text, sentAt: $0.sentAt, reply: $0.reply, repliedAt: $0.repliedAt) }
        UserDefaults.standard.set(try? JSONEncoder().encode(Array(stored)), forKey: key)
    }
}

// MARK: - The screen's sections

struct RemoteSections: View {
    @ObservedObject var remote: RemoteStore
    @State private var message = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            if let problem = remote.problem {
                Label(problem, systemImage: "exclamationmark.icloud").font(.system(size: 13)).foregroundStyle(Phone.orange)
            }
            if let notice = remote.notice {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "laptopcomputer").foregroundStyle(Phone.accent)
                    Text(notice).font(.system(size: 13)).foregroundStyle(Phone.soft)
                    Spacer(minLength: 0)
                    Button { withAnimation { remote.notice = nil } } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)) }
                        .buttonStyle(.plain).foregroundStyle(Phone.dim).accessibilityLabel("Dismiss")
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            // What ORION is waiting on comes before anything to look at.
            if let approvals = remote.snapshot?.approvals, !approvals.isEmpty { approvalsSection(approvals) }
            macSection
            if let snapshot = remote.snapshot {
                runsSection(snapshot.runs)
                if !snapshot.running.isEmpty { runningSection(snapshot.running) }
                if let attention = snapshot.attention { attentionSection(attention) }
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: remote.notice)
    }

    // MARK: Mac

    private var macSection: some View {
        let presence = remote.presence
        let tint: Color = presence == .online ? Phone.green : presence == .stale ? Phone.orange : Phone.dim
        return VStack(alignment: .leading, spacing: 16) {
            SectionLabel("Your Mac", tint: Phone.accent)
            HStack(spacing: 16) {
                PhoneRing(symbol: "laptopcomputer", tint: tint, size: 58, live: presence == .online)
                VStack(alignment: .leading, spacing: 4) {
                    Text(remote.snapshot?.mac.name ?? "Your Mac").font(Phone.display(20)).foregroundStyle(Phone.text)
                    StatusDot(text: presenceLine(presence), tint: tint)
                }
            }
            if let mac = remote.snapshot?.mac {
                if mac.locked {
                    Label("ORION is locked. Only stop and cancel commands will run.", systemImage: "lock.fill")
                        .font(.system(size: 13)).foregroundStyle(Phone.orange)
                }
                HStack(alignment: .top, spacing: 18) {
                    PhoneStat(label: "Battery", value: mac.battery.map { "\($0)%" } ?? "—",
                              detail: mac.charging.map { $0 ? "charging" : "on battery" },
                              tint: (mac.battery ?? 100) < 20 ? Phone.orange : Phone.text)
                    PhoneStat(label: "Disk free", value: mac.diskFreeGB.map { "\($0) GB" } ?? "—")
                    PhoneStat(label: "Up", value: mac.uptimeHours.map { "\($0) h" } ?? "—")
                }
                if !mac.runningApps.isEmpty {
                    Text("Running: \(mac.runningApps.prefix(8).joined(separator: " · "))").font(.system(size: 13)).foregroundStyle(Phone.soft)
                }
                HStack(spacing: 10) {
                    Button("Check the Mac") { remote.control(LinkCommand.deviceStatus, saying: "Asking the Mac…") }
                    Button("Open apps") { remote.control(LinkCommand.runningApps, saying: "Asking the Mac…") }
                }
                .buttonStyle(PhoneButtonStyle(tint: Phone.accent))
            } else if presence == .unknown {
                Text("Your Mac hasn’t reported in yet. Make sure ORION is open on your Mac and both devices use the same Apple ID.")
                    .font(.system(size: 14)).foregroundStyle(Phone.soft)
            }
        }
    }

    private func presenceLine(_ presence: MacPresence) -> String {
        guard let seen = remote.snapshot?.generatedAt else { return "Never connected" }
        let ago = seen.formatted(.relative(presentation: .named))
        switch presence {
        case .online: return "Online · updated \(ago)"
        case .stale: return "Not responding · last heard \(ago)"
        case .offline: return "Offline · last heard \(ago)"
        case .unknown: return "Unknown · last heard \(ago)"
        }
    }

    // MARK: Approvals

    private func approvalsSection(_ approvals: [LinkSnapshot.Approval]) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionLabel(approvals.count == 1 ? "Needs your approval" : "\(approvals.count) need your approval", tint: Phone.orange)
            ForEach(approvals) { approval in
                VStack(alignment: .leading, spacing: 8) {
                    Text(approval.summary.isEmpty ? approval.action : approval.summary)
                        .font(.system(size: 15, weight: .semibold, design: approval.action == "terminal_run" ? .monospaced : .default))
                        .foregroundStyle(Phone.text).textSelection(.enabled)
                    if !approval.context.isEmpty {
                        Text("ORION says: \(approval.context)").font(.system(size: 13)).foregroundStyle(Phone.soft)
                    }
                    Text("\(approval.id) · expires \(approval.expiresAt.formatted(.relative(presentation: .named)))")
                        .font(Phone.mono(11, .medium)).foregroundStyle(Phone.dim)
                    HStack(spacing: 10) {
                        Button { remote.decide(approval, approve: true) } label: { Label("Approve", systemImage: "checkmark") }
                            .buttonStyle(PhoneButtonStyle(tint: Phone.green, prominent: true))
                        Button { remote.decide(approval, approve: false) } label: { Label("Deny", systemImage: "xmark") }
                            .buttonStyle(PhoneButtonStyle(tint: Phone.red))
                    }
                }
            }
        }
    }

    // MARK: Agent runs

    private func runsSection(_ runs: [LinkSnapshot.Run]) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionLabel("Agent runs", tint: Phone.violet)
            if runs.isEmpty {
                Text("No projects on the Mac yet.").font(.system(size: 14)).foregroundStyle(Phone.soft)
            }
            ForEach(runs) { run in
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 14) {
                        PhoneRing(symbol: symbol(run.status), tint: tint(run.status), size: 46, live: run.status == .working)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(run.project).font(.system(size: 16, weight: .semibold)).foregroundStyle(Phone.text)
                            Text(runLine(run)).font(Phone.mono(11, .medium)).foregroundStyle(Phone.soft)
                        }
                        Spacer(minLength: 0)
                        Text("\(run.percent)%").font(.system(size: 22, weight: .light, design: .rounded)).foregroundStyle(Phone.text)
                    }
                    if let task = run.activeTask {
                        Text(run.step.map { "\(task) — \($0)" } ?? task).font(.system(size: 14)).foregroundStyle(Phone.soft)
                    }
                    ProgressStrip(done: run.accepted, total: run.total)
                    Text("\(run.accepted) of \(run.total) tasks accepted\(run.deferred > 0 ? " · \(run.deferred) deferred" : "")")
                        .font(Phone.mono(11, .medium)).foregroundStyle(Phone.dim)
                    HStack(spacing: 10) {
                        if run.live && run.status == .working {
                            Button { remote.agent(.stop, run) } label: { Label("Stop", systemImage: "stop.fill") }
                                .buttonStyle(PhoneButtonStyle(tint: Phone.text, prominent: true))
                            Button { remote.agent(.pause, run) } label: { Label("Pause", systemImage: "pause.fill") }
                                .buttonStyle(PhoneButtonStyle(tint: Phone.accent))
                        } else if run.status == .paused || (run.status == .stopped && run.accepted < run.total) {
                            Button { remote.agent(.resume, run) } label: { Label("Resume", systemImage: "play.fill") }
                                .buttonStyle(PhoneButtonStyle(prominent: true))
                        }
                    }
                }
            }
        }
    }

    private func runLine(_ run: LinkSnapshot.Run) -> String {
        var parts = [label(run.status)]
        if let role = run.role { parts.append(role.capitalized) }
        if let minutes = run.minutesOnTask { parts.append("\(minutes) min on this task") }
        return parts.joined(separator: " · ")
    }
    private func label(_ status: LinkSnapshot.Run.Status) -> String {
        switch status {
        case .working: return "Working"
        case .paused: return "Paused"
        case .stopped: return "Stopped"
        case .needsYou: return "Needs you"
        case .complete: return "Complete"
        }
    }
    private func symbol(_ status: LinkSnapshot.Run.Status) -> String {
        switch status {
        case .working: return "hammer"
        case .needsYou: return "exclamationmark"
        case .complete: return "checkmark"
        default: return "pause"
        }
    }
    private func tint(_ status: LinkSnapshot.Run.Status) -> Color {
        switch status {
        case .working: return Phone.accent
        case .needsYou: return Phone.orange
        case .complete: return Phone.green
        default: return Phone.dim
        }
    }

    // MARK: Running actions

    private func runningSection(_ running: [LinkSnapshot.RunningAction]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Running on the Mac", tint: Phone.accent)
            ForEach(running) { action in
                HStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(action.title).font(.system(size: 14, design: .monospaced)).foregroundStyle(Phone.text).lineLimit(2)
                        Text(action.actions.joined(separator: ", ")).font(.system(size: 12)).foregroundStyle(Phone.dim)
                    }
                    Spacer()
                    Button("Stop") { remote.control(LinkCommand.cancelAction(action.id), saying: "Asking the Mac to stop it…") }
                        .buttonStyle(.plain).font(.system(size: 14, weight: .semibold)).foregroundStyle(Phone.red)
                }
            }
        }
    }

    // MARK: Attention

    private func attentionSection(_ attention: LinkSnapshot.Attention) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("For your attention", tint: Phone.green)
            ForEach(attention.interrupt) { row in
                Label(row.title, systemImage: "bell.fill").font(.system(size: 15, weight: .medium)).foregroundStyle(Phone.text)
            }
            ForEach(attention.today) { row in
                Label(row.title, systemImage: "tray").font(.system(size: 14)).foregroundStyle(Phone.soft)
            }
            if let note = attention.note { Text(note).font(.system(size: 13)).foregroundStyle(Phone.dim) }
        }
    }

}

/// Done over total, as segments: the Mac's task strip in miniature.
struct ProgressStrip: View {
    let done: Int
    let total: Int
    var body: some View {
        HStack(spacing: total > 24 ? 1.5 : 3) {
            ForEach(0..<max(total, 1), id: \.self) { index in
                Capsule().fill(index < done ? Phone.green : Color.white.opacity(0.12)).frame(height: 5)
            }
        }
        .accessibilityLabel("\(done) of \(total) done")
    }
}
