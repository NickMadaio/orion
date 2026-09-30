import Foundation

struct SavedProject: Decodable, Identifiable, Equatable {
    let version: Int
    let id: String
    let name: String
    let createdAt: String
    let planFile: String
    let taskCount: Int
    static let home = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".openclaw/orion-controlled/project-agent/projects")
    var root: URL { Self.home.appendingPathComponent(id) }
    var planURL: URL { root.appendingPathComponent(planFile) }
    /// `plan.briefs/` beside the snapshot: the reference each task's worker and
    /// reviewer are handed with its contract (scripts/lib/agentic/plan.mjs).
    var briefsURL: URL { root.appendingPathComponent((planFile as NSString).deletingPathExtension + ".briefs") }
    /// Task ids that have their own brief, and whether a shared common.md exists.
    var briefs: (common: Bool, tasks: [String]) { Self.briefs(at: briefsURL) }
    static func briefs(at directory: URL) -> (common: Bool, tasks: [String]) {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        let markdown = names.filter { $0.hasSuffix(".md") && !$0.hasPrefix(".") }.map { String($0.dropLast(3)) }
        return (markdown.contains("common"), markdown.filter { $0 != "common" }.sorted())
    }
    var state: ProjectAgentStatus.Reading { ProjectAgentStatus.read(url: root.appendingPathComponent("state.json")) }
    var heartbeat: ProjectAgentHeartbeat? { ProjectAgentHeartbeat.read(url: root.appendingPathComponent("heartbeat.json")) }
    var activity: ProjectAgentActivity? { ProjectAgentActivity.read(url: root.appendingPathComponent("activity.json")) }
    var launch: Launch? {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("launch.json")) else { return nil }
        return try? JSONDecoder().decode(Launch.self, from: data)
    }
    struct Launch: Decodable { let status: String; let detail: String; let at: String }
    static func readAll(at home: URL = home) -> (projects: [SavedProject], error: String?) {
        guard FileManager.default.fileExists(atPath: home.path) else { return ([], nil) }
        do {
            let urls = try FileManager.default.contentsOfDirectory(at: home, includingPropertiesForKeys: [.isSymbolicLinkKey])
            var result: [SavedProject] = []; var invalid = 0
            // Only directories are projects: Finder's .DS_Store used to count as
            // an unreadable project and show a permanent error.
            for url in urls where !url.lastPathComponent.hasPrefix(".") {
                do {
                    guard try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw CocoaError(.fileReadCorruptFile) }
                    let project = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url.appendingPathComponent("project.json")))
                    guard project.version == 1, project.id == url.lastPathComponent,
                          project.id.range(of: "^[a-z0-9][a-z0-9-]{1,63}$", options: .regularExpression) != nil,
                          ["plan.md", "plan.json"].contains(project.planFile), !project.name.isEmpty,
                          project.taskCount > 0 else { throw CocoaError(.fileReadCorruptFile) }
                    result.append(project)
                } catch { invalid += 1 }
            }
            return (result.sorted { $0.createdAt > $1.createdAt }, invalid == 0 ? nil : "\(invalid) project record(s) could not be read.")
        } catch { return ([], "The project library could not be read.") }
    }
}

/// Small display parser. Task JSON remains inspectable, but never dominates the
/// readable plan. This parser renders only; the Node contract parser authorizes.
struct ProjectPlanBlock: Identifiable {
    let id: Int
    let kind: String
    let text: String
    static func parse(_ markdown: String) -> [Self] {
        var result: [Self] = []; var buffer: [String] = []; var code = false; var language = ""
        func append(_ kind: String, _ text: String) {
            if !text.isEmpty { result.append(Self(id: result.count, kind: kind, text: text)) }
        }
        func flush() { append(code ? "code:\(language)" : "text", buffer.joined(separator: "\n")); buffer = [] }
        for line in markdown.components(separatedBy: .newlines) {
            if line.hasPrefix("```") {
                flush(); code.toggle(); language = code ? String(line.dropFirst(3)) : ""; continue
            }
            if !code && line.hasPrefix("#") {
                flush(); let count = line.prefix { $0 == "#" }.count
                append("h\(count)", line.dropFirst(count).trimmingCharacters(in: .whitespaces))
            } else if !code && line.isEmpty { flush() }
            else { buffer.append(line) }
        }
        flush(); return result
    }
}
