import SwiftUI
import DeviceActivity
import FamilyControls
import ManagedSettings
import MobileCore
import UserNotifications

enum AppList: String, CaseIterable, Identifiable {
    case messaging, feeds, video, games, browsers
    var id: String { rawValue }
    var symbol: String {
        switch self { case .messaging: "bubble.left.and.bubble.right.fill"; case .feeds: "rectangle.stack.fill"; case .video: "play.rectangle.fill"; case .games: "gamecontroller.fill"; case .browsers: "safari.fill" }
    }
    /// What Nick calls it. The stored value stays "feeds" so saved picks and the Mac's directive keep working.
    var title: String { self == .feeds ? "Social" : rawValue.capitalized }
}
@MainActor final class FocusLists: ObservableObject {
    static let shared = FocusLists()
    @Published private(set) var selections: [AppList: FamilyActivitySelection] = [:]
    @Published private(set) var blocked: Set<AppList> = []
    private let defaults = UserDefaults(suiteName: "group.com.nickmadaio.orion")
    private let store = ManagedSettingsStore(named: .init("orion.focus.lists"))
    private let prefix = "orion.focuslists."
    init() {
        for list in AppList.allCases {
            if let data = defaults?.data(forKey: prefix + list.rawValue), let selection = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) { selections[list] = selection }
        }
        blocked = Set((defaults?.stringArray(forKey: prefix + "blocked") ?? []).compactMap(AppList.init(rawValue:)))
        applyShields()
    }
    func selection(for list: AppList) -> FamilyActivitySelection { selections[list] ?? FamilyActivitySelection() }
    func set(_ selection: FamilyActivitySelection, for list: AppList) {
        guard let data = try? PropertyListEncoder().encode(selection) else { return }
        defaults?.set(data, forKey: prefix + list.rawValue); selections[list] = selection; applyShields()
    }
    func block(_ lists: Set<AppList>) {
        blocked = lists; defaults?.set(lists.map(\.rawValue).sorted(), forKey: prefix + "blocked"); applyShields()
    }
    /// `plan` is the Mac's per-group directive: each group keeps its own end, and a group the Mac used to hold but no
    /// longer lists comes off by itself while the others stay. nil = no fresh directive: leave groups to their ends.
    func applyRemote(_ names: [String], plan: [LinkSnapshot.FocusListPlan]? = nil, now: Date = Date()) {
        guard defaults?.bool(forKey: "orion.focuslock.enabled") == true,
              (defaults?.double(forKey: "orion.screen.graceUntil") ?? 0) <= now.timeIntervalSince1970 else { unblockAll(); return }
        let stamp = now.timeIntervalSince1970
        // The Mac's holds live under `remoteUntil.<group>`, apart from the phone's own night/threshold locks (`until.<group>`):
        // a group the Mac stops listing loses only the Mac's hold.
        if let plan {
            let previous = Dictionary(uniqueKeysWithValues: AppList.allCases.compactMap { list -> (String, Double)? in
                let value = defaults?.double(forKey: prefix + "remoteUntil." + list.rawValue) ?? 0
                return value > 0 ? (list.rawValue, value) : nil
            })
            let next = RemoteFocusUntils.reconcile(previous: previous, plan: plan.filter { AppList(rawValue: $0.name) != nil }, now: stamp)
            for list in AppList.allCases {
                if let until = next[list.rawValue] { defaults?.set(until, forKey: prefix + "remoteUntil." + list.rawValue) }
                else { defaults?.removeObject(forKey: prefix + "remoteUntil." + list.rawValue) }
            }
        }
        let local = AppList.allCases.filter {
            RemoteFocusUntils.isHeld(local: defaults?.double(forKey: prefix + "until." + $0.rawValue) ?? 0,
                                     remote: defaults?.double(forKey: prefix + "remoteUntil." + $0.rawValue) ?? 0, now: stamp)
        }
        let wanted = Set(local).union(names.compactMap(AppList.init(rawValue:))).union((plan ?? []).compactMap { AppList(rawValue: $0.name) })
        block(wanted)
        askForPicks(wanted, now: now)
    }
    /// A group ORION wants shut but Nick never picked apps for: shield nothing (never the whole phone), say so once a day.
    private func askForPicks(_ wanted: Set<AppList>, now: Date) {
        let empty = wanted.filter { isEmpty($0) }
        defaults?.set(empty.map(\.rawValue).sorted(), forKey: prefix + "needsPick")
        for list in empty {
            let key = prefix + "pickAsked." + list.rawValue
            if let last = defaults?.double(forKey: key), last > 0, Calendar.current.isDate(Date(timeIntervalSince1970: last), inSameDayAs: now) { continue }
            defaults?.set(now.timeIntervalSince1970, forKey: key)
            let content = UNMutableNotificationContent()
            content.title = "ORION"
            content.body = "Pick apps for \(list.title) in ORION so I can block them when you need it."
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "orion.focuslists.pick.\(list.rawValue)", content: content, trigger: nil))
        }
    }
    func unblockAll() {
        for list in AppList.allCases {
            defaults?.removeObject(forKey: prefix + "until." + list.rawValue)
            defaults?.removeObject(forKey: prefix + "remoteUntil." + list.rawValue)
        }
        block([])
    }
    func isEmpty(_ list: AppList) -> Bool {
        let value = selection(for: list)
        return value.applicationTokens.isEmpty && value.categoryTokens.isEmpty && value.webDomainTokens.isEmpty
    }
    private func applyShields() {
        let chosen = blocked.map { selection(for: $0) }
        let apps = chosen.reduce(into: Set<ApplicationToken>()) { $0.formUnion($1.applicationTokens) }
        let categories = chosen.reduce(into: Set<ActivityCategoryToken>()) { $0.formUnion($1.categoryTokens) }
        let domains = chosen.reduce(into: Set<WebDomainToken>()) { $0.formUnion($1.webDomainTokens) }
        store.shield.applications = apps.isEmpty ? nil : apps
        store.shield.applicationCategories = categories.isEmpty ? nil : .specific(categories)
        store.shield.webDomains = domains.isEmpty ? nil : domains
        store.shield.webDomainCategories = categories.isEmpty ? nil : .specific(categories)
    }
}
struct FocusListsView: View {
    @ObservedObject var lists: FocusLists = .shared
    @State private var active: AppList = .messaging
    @State private var picking = false
    /// Focus sessions shield these groups. With none picked nothing can be shielded, so say so here, loudly.
    private var pickPrompt: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("PICK YOUR FOCUS APPS").font(Phone.mono(10, .semibold)).tracking(2.2).foregroundStyle(Phone.orange)
            Text("Choose apps for Social, Video, Games, Messaging and Browsers below. Until you do, a focus session can't shield anything on this phone.")
                .font(.system(size: 14)).foregroundStyle(Phone.soft).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Phone.orange.opacity(0.55), lineWidth: 0.9))
        .accessibilityIdentifier("pickFocusApps")
    }

    private var allowScreenTime: some View {
        Button("Allow Screen Time so ORION can shield apps") { Task { _ = await FocusLock.shared.authorize() } }
            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Phone.accent)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PhoneHeader(eyebrow: "Focus", title: "App lists", tint: Phone.orange)
                if AppList.allCases.allSatisfy({ lists.isEmpty($0) }) { pickPrompt }
                if AuthorizationCenter.shared.authorizationStatus != .approved { allowScreenTime }
                ForEach(AppList.allCases) { list in
                    Button { active = list; picking = true } label: {
                        HStack(spacing: 12) {
                            Image(systemName: list.symbol).font(.system(size: 18, weight: .light)).foregroundStyle(Phone.accent).frame(width: 28)
                            Text(list.title).foregroundStyle(Phone.text)
                            Spacer()
                            Text(lists.isEmpty(list) ? "Pick apps" : "\(lists.selection(for: list).applicationTokens.count) apps").foregroundStyle(Phone.dim)
                            if lists.blocked.contains(list) { Image(systemName: "lock.fill").foregroundStyle(Phone.orange).accessibilityLabel("Blocked") }
                        }.padding(.vertical, 12).frame(minHeight: 56).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    Rectangle().fill(LinearGradient(colors: [Phone.hairline, .clear], startPoint: .leading, endPoint: .trailing)).frame(height: 1)
                }
                Text("ORION sees only these list names, never which apps you choose.").font(.system(size: 13)).foregroundStyle(Phone.dim)
            }.padding(22)
        }
        .familyActivityPicker(isPresented: $picking, selection: Binding(get: { lists.selection(for: active) }, set: { lists.set($0, for: active) }))
        .phoneScreen().navigationTitle("App lists")
    }
}


/// The shield a Mac focus session puts on the phone (wave 19). Apart from the usage and night shields: its own store,
/// so lifting it never touches theirs. Driven only by the snapshot's FocusSession through PhoneFocus.shield, applied
/// when a snapshot arrives (foreground, push, background refresh) and lifted by a DeviceActivity interval that ends at
/// the phase's end, which runs in the Screen Time extension even if ORION is closed.
@MainActor final class FocusSessionShield: ObservableObject {
    static let shared = FocusSessionShield()
    enum Status: Equatable {
        case off
        case shielding([String])
        case needPicks
        case notAuthorized
        case paused(Date)
    }
    @Published private(set) var status: Status = .off
    static let activity = DeviceActivityName("focussession")
    private let store = ManagedSettingsStore(named: .init("orion.focus.session"))
    private let defaults = UserDefaults(suiteName: "group.com.nickmadaio.orion")

    var pausedUntil: Date? {
        let t = defaults?.double(forKey: "orion.focus.session.pausedUntil") ?? 0
        return t > Date().timeIntervalSince1970 ? Date(timeIntervalSince1970: t) : nil
    }

    func sync(_ session: LinkSnapshot.FocusSession?, now: Date = Date()) {
        let picked = Set(AppList.allCases.filter { !FocusLists.shared.isEmpty($0) }.map(\.rawValue))
        let plan = PhoneFocus.shield(session, picked: picked, now: now)
        if let session, let until = pausedUntil, defaults?.string(forKey: "orion.focus.session.pausedFor") == session.sessionId, plan != .lift {
            lift(); status = .paused(until); return
        }
        switch plan {
        case .lift:
            lift()
        case .needPicks:
            lift(); status = .needPicks
            if let session { askForPicks(session) }
        case .shield(let names, _):
            guard let session, let end = session.endsAt else { lift(); return }
            guard AuthorizationCenter.shared.authorizationStatus == .approved else { lift(); status = .notAuthorized; return }
            let lists = names.compactMap(AppList.init(rawValue:))
            let chosen = lists.map { FocusLists.shared.selection(for: $0) }
            let apps = chosen.reduce(into: Set<ApplicationToken>()) { $0.formUnion($1.applicationTokens) }
            let categories = chosen.reduce(into: Set<ActivityCategoryToken>()) { $0.formUnion($1.categoryTokens) }
            let domains = chosen.reduce(into: Set<WebDomainToken>()) { $0.formUnion($1.webDomainTokens) }
            store.shield.applications = apps.isEmpty ? nil : apps
            store.shield.applicationCategories = categories.isEmpty ? nil : .specific(categories)
            store.shield.webDomains = domains.isEmpty ? nil : domains
            store.shield.webDomainCategories = categories.isEmpty ? nil : .specific(categories)
            status = .shielding(lists.map(\.title))
            persist(session, lists: names)
            monitor(session: session, end: end, now: now, apps: apps, categories: categories, domains: domains)
        }
    }

    /// "I need an app": the shield opens for a few minutes. It goes back on at the next snapshot or tick after that.
    func pause(minutes: Int, session: LinkSnapshot.FocusSession, now: Date = Date()) {
        let until = now.addingTimeInterval(Double(minutes * 60))
        defaults?.set(until.timeIntervalSince1970, forKey: "orion.focus.session.pausedUntil")
        defaults?.set(session.sessionId, forKey: "orion.focus.session.pausedFor")
        lift(); status = .paused(until)
    }

    func lift() {
        store.clearAllSettings()
        if status != .off { status = .off }
        defaults?.removeObject(forKey: "orion.focus.session")
        if defaults?.string(forKey: "orion.focus.session.monitored") != nil {
            DeviceActivityCenter().stopMonitoring([Self.activity])
            defaults?.removeObject(forKey: "orion.focus.session.monitored")
        }
    }

    /// For the extension and diagnostics: what the shield is for.
    private func persist(_ session: LinkSnapshot.FocusSession, lists: [String]) {
        let object: [String: Any] = ["id": session.sessionId, "task": session.task, "lists": lists,
                                     "endsAt": session.endsAt?.timeIntervalSince1970 ?? 0]
        if let data = try? JSONSerialization.data(withJSONObject: object) { defaults?.set(data, forKey: "orion.focus.session") }
    }

    /// An interval that ends with the phase lifts the shield in the Screen Time extension (ScreenMonitor.intervalDidEnd), and
    /// a one-minute use event over the picked apps reports a pickup. DeviceActivity intervals are at least 15 minutes, so a
    /// shorter phase starts its window earlier; ending at `end` is what matters.
    private func monitor(session: LinkSnapshot.FocusSession, end: Date, now: Date, apps: Set<ApplicationToken>,
                         categories: Set<ActivityCategoryToken>, domains: Set<WebDomainToken>) {
        let key = "\(session.sessionId)|\(Int(end.timeIntervalSince1970))"
        guard defaults?.string(forKey: "orion.focus.session.monitored") != key else { return }
        let calendar = Calendar.current
        let parts: (Date) -> DateComponents = { calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: $0) }
        let start = min(now, end.addingTimeInterval(-15 * 60))
        let center = DeviceActivityCenter()
        center.stopMonitoring([Self.activity])
        let events: [DeviceActivityEvent.Name: DeviceActivityEvent] = apps.isEmpty && categories.isEmpty && domains.isEmpty ? [:] :
            [.init("use1"): DeviceActivityEvent(applications: apps, categories: categories, webDomains: domains, threshold: DateComponents(minute: 1))]
        do {
            try center.startMonitoring(Self.activity, during: DeviceActivitySchedule(intervalStart: parts(start), intervalEnd: parts(end), repeats: false), events: events)
            defaults?.set(key, forKey: "orion.focus.session.monitored")
        } catch {
            // Without the monitor the app still lifts the shield at the end on its next tick; say nothing to Nick.
            defaults?.removeObject(forKey: "orion.focus.session.monitored")
        }
    }

    private func askForPicks(_ session: LinkSnapshot.FocusSession) {
        guard defaults?.string(forKey: "orion.focus.session.askedFor") != session.sessionId else { return }
        defaults?.set(session.sessionId, forKey: "orion.focus.session.askedFor")
        let content = UNMutableNotificationContent()
        content.title = "ORION"
        content.body = "Focus is on. Pick your focus apps in More › Focus lists and I'll shield them next time."
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "orion.focus.session.pick", content: content, trigger: nil))
    }

    /// The line Home shows under the pills.
    func line(for mode: PhoneFocus.Mode) -> (text: String, needsAction: Bool)? {
        switch status {
        case .needPicks: return ("PICK YOUR FOCUS APPS", true)
        case .notAuthorized: return ("ALLOW SCREEN TIME TO SHIELD APPS", true)
        case .shielding(let titles): return ("SHIELDING " + titles.joined(separator: " · ").uppercased(), false)
        case .paused: return ("APPS OPEN FOR A FEW MINUTES", false)
        case .off: return mode == .breakTime ? ("BREAK · YOUR APPS ARE OPEN", false) : nil
        }
    }
}
