import Foundation

/*
 The models Ollama has, read live, and how a project's choice resolves against them.

 Nothing here names a model. `orion-projects models` asks Ollama (/api/tags, plus a cached /api/show for
 capabilities) every time, so a model pulled this afternoon is in the list the next time the view opens.
*/

struct ProjectModelInfo: Decodable, Equatable, Identifiable {
    let name: String
    let sizeBytes: Double
    let capabilities: [String]
    var id: String { name }

    /// "4.7 GB", from decimal bytes the way `ollama list` prints it.
    var sizeLabel: String? {
        guard sizeBytes > 0 else { return nil }
        let gigabytes = sizeBytes / 1_000_000_000
        return gigabytes >= 1 ? String(format: "%.1f GB", gigabytes) : String(format: "%.0f MB", sizeBytes / 1_000_000)
    }
    /// The capability words worth a badge.
    var badges: [String] { ["vision", "tools"].filter(capabilities.contains) }
}

struct ProjectModelCatalog: Decodable, Equatable {
    let models: [ProjectModelInfo]
    /// The global role models: what "Default" means.
    let defaults: [String: String]

    static let empty = ProjectModelCatalog(models: [], defaults: [:])

    static func parse(_ data: Data) -> ProjectModelCatalog? { try? JSONDecoder().decode(Self.self, from: data) }

    static func load(completion: @escaping (ProjectModelCatalog?) -> Void) {
        ProjectAgentControl.execute(["models"], executable: ProjectAgentControl.projectsExecutable) { output, _ in
            completion(output.flatMap { $0.data(using: .utf8) }.flatMap(parse))
        }
    }

    func info(_ name: String) -> ProjectModelInfo? { models.first { $0.name == name } }
}

/// Where a role's model comes from for one project.
struct ProjectModelResolution: Equatable {
    enum Source: Equatable { case defaulted, chosen, missing }
    let source: Source
    /// The model the run will actually use.
    let effective: String?
    /// The model the project asked for, when it asked for one.
    let chosen: String?

    /// `installed == nil` means Ollama could not be asked: the choice is trusted rather than flagged.
    static func resolve(chosen: String?, defaultModel: String?, installed: [String]?) -> Self {
        guard let chosen, !chosen.isEmpty else { return Self(source: .defaulted, effective: defaultModel, chosen: nil) }
        if let installed, !installed.contains(chosen) { return Self(source: .missing, effective: defaultModel, chosen: chosen) }
        return Self(source: .chosen, effective: chosen, chosen: chosen)
    }
}

/// Reads the catalog when a view opens and on demand, and writes a project's choice through the CLI.
@MainActor
final class ProjectModelStore: ObservableObject {
    @Published private(set) var catalog: ProjectModelCatalog?
    @Published private(set) var refreshing = false
    @Published private(set) var models: [String: String]
    @Published private(set) var error: String?
    private(set) var projectID: String

    init(projectID: String = "", models: [String: String] = [:], catalog: ProjectModelCatalog? = nil) {
        self.projectID = projectID; self.models = models; self.catalog = catalog
    }

    /// Point the store at a project (the workspace is reused as the selection changes) and look again.
    func bind(_ id: String) {
        if id != projectID { projectID = id; models = ProjectModelStore.readRecord(id) ?? [:] }
        refresh()
    }

    func refresh() {
        guard !refreshing, !projectID.isEmpty else { return }
        refreshing = true
        ProjectModelCatalog.load { [weak self] loaded in
            Task { @MainActor in
                guard let self else { return }
                self.refreshing = false
                if let loaded { self.catalog = loaded; self.error = nil }
                else { self.error = "Could not read the model list. Is Ollama running?" }
            }
        }
        if let record = ProjectModelStore.readRecord(projectID) { models = record }
    }

    func resolution(role: String) -> ProjectModelResolution {
        ProjectModelResolution.resolve(chosen: models[role], defaultModel: catalog?.defaults[role],
                                       installed: catalog.map { $0.models.map(\.name) })
    }

    /// `nil` returns the role to the global default.
    func choose(role: String, model: String?) {
        let previous = models
        var next = models
        if let model { next[role] = model } else { next.removeValue(forKey: role) }
        models = next
        ProjectAgentControl.execute(["set-model", projectID, role, model ?? "default"], executable: ProjectAgentControl.projectsExecutable) { [weak self] _, failure in
            Task { @MainActor in
                guard let self else { return }
                if let failure { self.models = previous; self.error = failure } else { self.error = nil }
            }
        }
    }

    nonisolated static func readRecord(_ id: String) -> [String: String]? {
        let url = SavedProject.home.appendingPathComponent(id).appendingPathComponent("project.json")
        struct Record: Decodable { let models: [String: String]? }
        guard let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(Record.self, from: data) else { return nil }
        return record.models ?? [:]
    }
}
