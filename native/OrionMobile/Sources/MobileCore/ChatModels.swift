import Foundation

public struct ModelChoice: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let local: Bool
    public init(id: String, label: String, local: Bool) { self.id = id; self.label = label; self.local = local }
}

private struct ModelRolesFile: Codable {
    struct Role: Codable {
        var primary: String?
        var fallbacks: [String?]?
    }
    var roles: [String: Role]
}

public enum ChatModels {
    public static func choices(fromModelRoles data: Data) -> [ModelChoice] {
        let file: ModelRolesFile
        do { file = try JSONDecoder().decode(ModelRolesFile.self, from: data) } catch { return [] }

        let roleNames = ["reasoning", "fast", "local"]
        var seen = Set<String>()
        var result: [ModelChoice] = []

        for roleName in roleNames {
            guard let role = file.roles[roleName] else { continue }
            var candidates: [String?] = []
            if let p = role.primary { candidates.append(p) }
            if let fb = role.fallbacks { candidates.append(contentsOf: fb) }
            for candidate in candidates {
                guard let cid = candidate, !cid.isEmpty, !seen.contains(cid) else { continue }
                seen.insert(cid)
                result.append(ModelChoice(id: cid, label: friendlyLabel(for: cid), local: cid.hasPrefix("ollama/")))
            }
        }
        return result
    }

    private static func friendlyLabel(for id: String) -> String {
        guard id.hasPrefix("anthropic/") else {
            if id.hasPrefix("ollama/") {
                let name = String(id.dropFirst(7))
                return "\(name) (local)"
            }
            return id
        }
        let modelPart = String(id.dropFirst(10))
        if modelPart.hasPrefix("claude-haiku-") {
            let rest = String(modelPart.dropFirst(13))
            return formatAnthropicVersion("Haiku", rest)
        }
        if modelPart.hasPrefix("claude-sonnet-") {
            let rest = String(modelPart.dropFirst(14))
            return formatAnthropicVersion("Sonnet", rest)
        }
        return "Claude \(modelPart)"
    }

    private static func formatAnthropicVersion(_ family: String, _ rest: String) -> String {
        let parts = rest.split(separator: "-")
        // Skip trailing date-like parts (6+ digit numbers)
        let numericParts = parts.prefix(while: { $0.count < 6 })
        if numericParts.isEmpty { return "Claude \(family)" }
        let version = numericParts.joined(separator: ".")
        return "Claude \(family) \(version)"
    }
}
