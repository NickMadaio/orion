import Foundation
import SwiftUI

/// The two things the Knowledge tab can show.
enum KnowledgeMode: String, CaseIterable, Identifiable {
    case knows, brain
    var id: String { rawValue }
    var title: String { self == .knows ? "ORION knows" : "Brain" }
}

/// The Brain view's state: the vault's graph, its own sky (so its camera and positions survive tab switches), the
/// selected note and the folders switched off. The vault is only ever read, and only off the main thread.
@MainActor
final class BrainStore: ObservableObject {
    @Published private(set) var graph: KnowledgeGraph = .empty
    @Published private(set) var loading = false
    @Published private(set) var loadError: String?
    @Published var selectedID: String?
    @Published var hiddenFolders: Set<String> = []
    let sky = KnowledgeSky()

    private let vault: URL?
    private let loader = BrainVaultLoader()

    /// `vault` nil is a render or a test over a fixed graph: nothing is read from disk.
    init(vault: URL? = BrainVault.vaultURL()) {
        self.vault = vault
    }

    convenience init(graph: KnowledgeGraph) {
        self.init(vault: nil)
        self.graph = graph
    }

    /// Parse the vault in the background (cached by file mtimes, so a return to the tab is nearly free).
    func load() {
        guard let vault, !loading else { return }
        loading = true
        let loader = loader
        Task { [weak self] in
            let parsed = await Task.detached(priority: .utility) { loader.load(root: vault) }.value
            guard let self else { return }
            loading = false
            loadError = FileManager.default.fileExists(atPath: vault.path) ? nil : "No vault found at \(vault.lastPathComponent)."
            if parsed != graph { graph = parsed }
        }
    }

    /// The folders present, in vault order, with how many notes each holds (ghosts count under "ghost").
    var folders: [(name: String, count: Int)] {
        let counts = Dictionary(grouping: graph.nodes.compactMap(\.group), by: { $0 }).mapValues(\.count)
        return counts.keys.sorted { (BrainVault.slot(of: $0), $0) < (BrainVault.slot(of: $1), $1) }.map { ($0, counts[$0] ?? 0) }
    }

    var noteCount: Int { graph.nodes.filter { !$0.isGhost }.count }
    var visibleIDs: Set<String> { Set(graph.nodes.filter { !hiddenFolders.contains($0.group ?? "") }.map(\.id)) }

    func toggle(folder: String) {
        hiddenFolders = hiddenFolders.contains(folder) ? hiddenFolders.subtracting([folder]) : hiddenFolders.union([folder])
    }
}
