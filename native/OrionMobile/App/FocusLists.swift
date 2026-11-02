import SwiftUI
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
        if let plan {
            let current = Set(plan.compactMap { AppList(rawValue: $0.name)?.rawValue })
            for gone in Set(defaults?.stringArray(forKey: prefix + "remote") ?? []).subtracting(current) { defaults?.removeObject(forKey: prefix + "until." + gone) }
            for entry in plan {
                if let list = AppList(rawValue: entry.name), let until = entry.until, until > stamp { defaults?.set(until, forKey: prefix + "until." + list.rawValue) }
            }
            defaults?.set(plan.filter { ($0.until ?? 0) > stamp }.compactMap { AppList(rawValue: $0.name)?.rawValue }.sorted(), forKey: prefix + "remote")
        }
        let local = AppList.allCases.filter { (defaults?.double(forKey: prefix + "until." + $0.rawValue) ?? 0) > stamp }
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
        for list in AppList.allCases { defaults?.removeObject(forKey: prefix + "until." + list.rawValue) }
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
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PhoneHeader(eyebrow: "Focus", title: "App lists")
                ForEach(AppList.allCases) { list in
                    Button { active = list; picking = true } label: {
                        HStack(spacing: 12) {
                            Image(systemName: list.symbol).foregroundStyle(Phone.accent).frame(width: 28)
                            Text(list.title).foregroundStyle(Phone.text)
                            Spacer()
                            Text(lists.isEmpty(list) ? "Pick apps" : "\(lists.selection(for: list).applicationTokens.count) apps").foregroundStyle(Phone.dim)
                            if lists.blocked.contains(list) { Image(systemName: "lock.fill").foregroundStyle(Phone.violet).accessibilityLabel("Blocked") }
                        }.padding(.vertical, 12).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    Rectangle().fill(Phone.hairline).frame(height: 1)
                }
                Text("ORION sees only these list names, never which apps you choose.").font(.system(size: 13)).foregroundStyle(Phone.dim)
            }.padding(22)
        }
        .familyActivityPicker(isPresented: $picking, selection: Binding(get: { lists.selection(for: active) }, set: { lists.set($0, for: active) }))
        .phoneScreen().navigationTitle("App lists")
    }
}
