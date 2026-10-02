import SwiftUI
import FamilyControls
import ManagedSettings

enum AppList: String, CaseIterable, Identifiable {
    case messaging, feeds, video, games
    var id: String { rawValue }
    var symbol: String {
        switch self { case .messaging: "bubble.left.and.bubble.right.fill"; case .feeds: "rectangle.stack.fill"; case .video: "play.rectangle.fill"; case .games: "gamecontroller.fill" }
    }
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
    func unblockAll() { block([]) }
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
                            Text(list.rawValue.capitalized).foregroundStyle(Phone.text)
                            Spacer()
                            Text(lists.isEmpty(list) ? "Not set" : "\(lists.selection(for: list).applicationTokens.count) apps").foregroundStyle(Phone.dim)
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
