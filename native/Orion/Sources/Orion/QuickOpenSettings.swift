import AppKit
import SwiftUI

/// A small, personal action deck. It is intentionally local and editable: a
/// shortcut can launch a Mac app, open a website, or open a folder/file, but it
/// never runs arbitrary shell commands.
final class QuickOpenSettings: ObservableObject {
    struct Item: Identifiable, Codable, Equatable {
        var id = UUID()
        var name: String
        var icon: String
        var destination: String
        /// Normalized position in Orion's orbital field. Missing values keep
        /// older saved actions on the hand-tuned default constellation.
        var orbitX: Double? = nil
        var orbitY: Double? = nil
    }

    struct InstalledApp: Identifiable {
        let url: URL
        let name: String
        let bundleIdentifier: String?
        var id: String { url.path }
    }

    @Published var items: [Item] { didSet { save() } }
    private static let storageKey = "orion.quickOpen.items.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.storageKey),
           let stored = try? JSONDecoder().decode([Item].self, from: data),
           !stored.isEmpty {
            items = stored
            addSuggestedItemsIfMissing()
        } else {
            items = [
                Item(name: "Mail", icon: "✉", destination: "https://mail.google.com"),
                Item(name: "Calendar", icon: "▣", destination: "https://calendar.google.com"),
                Item(name: "Notes", icon: "✎", destination: "app://com.apple.Notes"),
                Item(name: "Reminders", icon: "✓", destination: "app://com.apple.reminders"),
                Item(name: "Discord", icon: "◉", destination: "app://com.hnc.Discord"),
                Item(name: "Files", icon: "⌂", destination: "file://~"),
            ]
            addSuggestedItemsIfMissing()
        }
    }

    func addWebsite() {
        items.append(Item(name: "New action", icon: "✦", destination: "https://"))
    }

    func remove(at offsets: IndexSet) { items.remove(atOffsets: offsets) }
    func remove(id: UUID) { items.removeAll { $0.id == id } }

    func move(_ id: UUID, toX x: Double, y: Double) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].orbitX = min(0.94, max(0.06, x))
        items[index].orbitY = min(0.91, max(0.11, y))
    }

    /// Uses the normal macOS application chooser instead of requiring users to
    /// learn bundle identifiers.  The destination still stores the stable
    /// identifier when available, so app updates and moves keep working.
    func chooseApplication(replacing id: UUID? = nil) {
        let panel = NSOpenPanel()
        panel.title = "Choose an app for Quick Open"
        panel.prompt = "Use this app"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedFileTypes = ["app"]
        panel.directoryURL = URL(fileURLWithPath: "/Applications", isDirectory: true)

        guard panel.runModal() == .OK, let url = panel.url else { return }
        let name = url.deletingPathExtension().lastPathComponent
        let destination: String
        if let bundle = Bundle(url: url)?.bundleIdentifier {
            destination = "app://\(bundle)"
        } else {
            destination = url.path
        }
        let newItem = Item(name: name, icon: "✦", destination: destination)
        if let id, let index = items.firstIndex(where: { $0.id == id }) {
            items[index] = newItem
        } else {
            items.append(newItem)
        }
    }

    func installedApplications() -> [InstalledApp] {
        let directories = [
            "/Applications",
            "/System/Applications",
            NSHomeDirectory() + "/Applications",
        ]
        let apps = directories.flatMap { directory in
            (try? FileManager.default.contentsOfDirectory(
                at: URL(fileURLWithPath: directory, isDirectory: true),
                includingPropertiesForKeys: nil
            )) ?? []
        }
        return apps
            .filter { $0.pathExtension == "app" }
            .map { url in
                InstalledApp(
                    url: url,
                    name: url.deletingPathExtension().lastPathComponent,
                    bundleIdentifier: Bundle(url: url)?.bundleIdentifier
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func addApplication(_ app: InstalledApp, replacing id: UUID? = nil) {
        let destination = app.bundleIdentifier.map { "app://\($0)" } ?? app.url.path
        let newItem = Item(name: app.name, icon: "✦", destination: destination)
        if let id, let index = items.firstIndex(where: { $0.id == id }) {
            items[index] = newItem
        } else {
            items.append(newItem)
        }
    }

    func open(_ item: Item) {
        let value = item.destination.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("app://") {
            let bundleID = String(value.dropFirst("app://".count))
            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                NSWorkspace.shared.open(url)
            }
            return
        }
        if value == "file://~" {
            NSWorkspace.shared.open(URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true))
            return
        }
        if value.hasPrefix("/") {
            NSWorkspace.shared.open(URL(fileURLWithPath: value))
            return
        }
        if let url = URL(string: value), let scheme = url.scheme, !scheme.isEmpty {
            NSWorkspace.shared.open(url)
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(items) else { return }
        UserDefaults.standard.set(data, forKey: Self.storageKey)
    }

    private func addSuggestedItemsIfMissing() {
        let suggestions = [
            Item(name: "Messages", icon: "◌", destination: "app://com.apple.MobileSMS"),
            Item(name: "FaceTime", icon: "◉", destination: "app://com.apple.FaceTime"),
            Item(name: "Music", icon: "♫", destination: "app://com.apple.Music"),
            Item(name: "Safari", icon: "◍", destination: "app://com.apple.Safari"),
            Item(name: "ChatGPT", icon: "✦", destination: "https://chatgpt.com"),
            Item(name: "Claude", icon: "✺", destination: "https://claude.ai"),
            Item(name: "Steam", icon: "◈", destination: "app://com.valvesoftware.steam"),
            Item(name: "Roblox", icon: "R", destination: "app://com.roblox.Roblox"),
            Item(name: "Opera Air", icon: "O", destination: "app://com.operasoftware.OperaAir"),
        ]
        let existingDestinations = Set(items.map(\.destination))
        let available = suggestions.filter { suggestion in
            if suggestion.destination.hasPrefix("app://") {
                let bundleID = String(suggestion.destination.dropFirst("app://".count))
                return NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) != nil
            }
            return true
        }
        items.append(contentsOf: available.filter { !existingDestinations.contains($0.destination) })
    }
}

struct QuickOpenEditor: View {
    @ObservedObject var settings: QuickOpenSettings
    @Environment(\.dismiss) private var dismiss
    @State private var appPickerVisible = false
    @State private var replacingAppID: UUID?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Customize Quick Open").font(.system(size: 21, weight: .bold, design: .rounded))
                    Text("Choose an app directly, or add a website. Every action can be removed here.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(22)

            List {
                ForEach($settings.items) { $item in
                    HStack(spacing: 10) {
                        TextField("✦", text: $item.icon)
                            .textFieldStyle(.roundedBorder).frame(width: 48)
                        TextField("Name", text: $item.name)
                            .textFieldStyle(.roundedBorder).frame(width: 120)
                        TextField("Website address or local path", text: $item.destination)
                            .textFieldStyle(.roundedBorder)
                        if item.destination.hasPrefix("app://") || item.destination.hasSuffix(".app") {
                            Button("Change app") {
                                replacingAppID = item.id
                                appPickerVisible = true
                            }
                                .buttonStyle(.bordered)
                        }
                        Button(role: .destructive) { settings.remove(id: item.id) } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .help("Remove action")
                    }
                    .padding(.vertical, 3)
                }
                .onDelete(perform: settings.remove)
            }
            .listStyle(.inset)

            HStack {
                Menu {
                    Button(action: settings.addWebsite) { Label("Website", systemImage: "globe") }
                    Button(action: {
                        replacingAppID = nil
                        appPickerVisible = true
                    }) { Label("App…", systemImage: "app") }
                } label: {
                    Label("Add action", systemImage: "plus")
                }
                Spacer()
                Text("Apps use their real icon automatically.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }
            .padding(18)
        }
        .frame(minWidth: 720, minHeight: 430)
        .sheet(isPresented: $appPickerVisible) {
            QuickOpenAppPicker(settings: settings) { app in
                settings.addApplication(app, replacing: replacingAppID)
                appPickerVisible = false
            }
        }
    }
}

struct QuickOpenAppPicker: View {
    @ObservedObject var settings: QuickOpenSettings
    var onChoose: (QuickOpenSettings.InstalledApp) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var apps: [QuickOpenSettings.InstalledApp] {
        let all = settings.installedApplications()
        guard !search.isEmpty else { return all }
        return all.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Choose an app").font(.system(size: 21, weight: .bold, design: .rounded))
                    Text("Pick once — Orion saves the right app target automatically.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Cancel") { dismiss() }
            }
            .padding(22)

            TextField("Search installed apps", text: $search)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 22)
                .padding(.bottom, 12)

            List(apps) { app in
                Button {
                    onChoose(app)
                } label: {
                    HStack(spacing: 12) {
                        Image(nsImage: NSWorkspace.shared.icon(forFile: app.url.path))
                            .resizable().scaledToFit().frame(width: 30, height: 30)
                        Text(app.name).foregroundStyle(.primary)
                        Spacer()
                        Image(systemName: "plus.circle").foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .listStyle(.inset)
        }
        .frame(width: 540, height: 560)
    }
}
