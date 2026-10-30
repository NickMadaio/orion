import Foundation

/// The graph `scripts/orion-knowledge` writes to `~/.openclaw/orion-controlled/knowledge-graph.json`.
/// Field names are the script's; optional fields are omitted from the JSON when absent, and decode as nil.
struct KnowledgeGraph: Codable, Equatable {
    var schema: String = "orion.knowledge-graph.v1"
    var generatedAt: String?
    var nodes: [KnowledgeNode]
    var edges: [KnowledgeEdge]
    var sources: [KnowledgeSourceRow] = []

    init(nodes: [KnowledgeNode], edges: [KnowledgeEdge], sources: [KnowledgeSourceRow] = [], generatedAt: String? = nil) {
        self.nodes = nodes
        self.edges = edges
        self.sources = sources
        self.generatedAt = generatedAt
    }

    private enum CodingKeys: String, CodingKey { case schema, generatedAt, nodes, edges, sources }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decodeIfPresent(String.self, forKey: .schema) ?? "orion.knowledge-graph.v1"
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
        nodes = try c.decodeIfPresent([KnowledgeNode].self, forKey: .nodes) ?? []
        edges = try c.decodeIfPresent([KnowledgeEdge].self, forKey: .edges) ?? []
        sources = try c.decodeIfPresent([KnowledgeSourceRow].self, forKey: .sources) ?? []
    }

    static let empty = KnowledgeGraph(nodes: [], edges: [])

    func node(_ id: String) -> KnowledgeNode? { nodes.first { $0.id == id } }

    /// Every edge touching `id`, with the node at its other end, strongest kinds first.
    func connections(of id: String) -> [KnowledgeConnection] {
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return edges.compactMap { edge -> KnowledgeConnection? in
            guard edge.from == id || edge.to == id else { return nil }
            guard let other = byId[edge.from == id ? edge.to : edge.from] else { return nil }
            return KnowledgeConnection(edge: edge, other: other)
        }
        .sorted { ($0.edge.kind == "said-together" ? 1 : 0, $0.other.label) < ($1.edge.kind == "said-together" ? 1 : 0, $1.other.label) }
    }

    /// How many edges touch each node — the node's size on the canvas.
    var degrees: [String: Int] {
        edges.reduce(into: [String: Int]()) { counts, edge in
            counts[edge.from, default: 0] += 1
            counts[edge.to, default: 0] += 1
        }
    }
}

struct KnowledgeConnection: Equatable, Identifiable {
    let edge: KnowledgeEdge
    let other: KnowledgeNode
    var id: String { edge.id }
}

/// File plus line or date — where a fact came from. Paths are relative to `~/.openclaw`.
struct KnowledgeCitation: Codable, Equatable, Hashable {
    var file: String
    var line: Int?
    var date: String?

    /// "USER.md:21", "2026-10-20.md:5", "places.json".
    var short: String {
        let name = file.split(separator: "/").last.map(String.init) ?? file
        if let line { return "\(name):\(line)" }
        if let date, !name.contains(date) { return "\(name) · \(date)" }
        return name
    }
}

struct KnowledgeFact: Codable, Equatable, Hashable {
    var text: String
    var source: KnowledgeCitation?
}

struct KnowledgeNode: Codable, Equatable, Identifiable, Hashable {
    var id: String
    var type: String
    var label: String
    var subtitle: String?
    var aliases: [String]?
    var facts: [KnowledgeFact] = []
    var sources: [KnowledgeCitation] = []
    var hidden: Bool?
    var note: String?

    init(id: String, type: String, label: String, subtitle: String? = nil, aliases: [String]? = nil,
         facts: [KnowledgeFact] = [], sources: [KnowledgeCitation] = [], hidden: Bool? = nil, note: String? = nil) {
        self.id = id; self.type = type; self.label = label; self.subtitle = subtitle; self.aliases = aliases
        self.facts = facts; self.sources = sources; self.hidden = hidden; self.note = note
    }

    private enum CodingKeys: String, CodingKey { case id, type, label, subtitle, aliases, facts, sources, hidden, note }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "goal"
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? id
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle)
        aliases = try c.decodeIfPresent([String].self, forKey: .aliases)
        facts = try c.decodeIfPresent([KnowledgeFact].self, forKey: .facts) ?? []
        sources = try c.decodeIfPresent([KnowledgeCitation].self, forKey: .sources) ?? []
        hidden = try c.decodeIfPresent(Bool.self, forKey: .hidden)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }

    var kind: KnowledgeNodeType { KnowledgeNodeType(rawValue: type) ?? .goal }
    var isSelf: Bool { id == "person:self" }
}

struct KnowledgeEdge: Codable, Equatable, Identifiable, Hashable {
    var id: String
    var from: String
    var to: String
    var kind: String
    var reason: String
    var source: KnowledgeCitation?
    var hidden: Bool?
    var note: String?

    init(from: String, to: String, kind: String, reason: String, source: KnowledgeCitation? = nil) {
        self.id = KnowledgeEdge.makeId(from: from, to: to, kind: kind)
        self.from = from; self.to = to; self.kind = kind; self.reason = reason; self.source = source
    }

    /// Kinds whose direction means nothing. Must match `SYMMETRIC` in scripts/lib/knowledge/overrides.mjs.
    static let symmetricKinds: Set<String> = ["said-together"]

    static func makeId(from: String, to: String, kind: String) -> String {
        let (a, b) = symmetricKinds.contains(kind) && to < from ? (to, from) : (from, to)
        return "\(a)>\(b):\(kind)"
    }
}

struct KnowledgeSourceRow: Codable, Equatable, Hashable {
    var id: String
    var file: String
    var ok: Bool
    var items: Int?
    var note: String?
}

/// The ten things a node can be. Order is the legend's order.
enum KnowledgeNodeType: String, CaseIterable, Identifiable {
    case person, place, course, project, routine, habit, app, health, preference, goal
    var id: String { rawValue }

    var title: String {
        switch self {
        case .person: "People"
        case .place: "Places"
        case .course: "Courses"
        case .project: "Projects"
        case .routine: "Routines"
        case .habit: "Habits"
        case .app: "Apps"
        case .health: "Health"
        case .preference: "Preferences"
        case .goal: "Goals"
        }
    }

    var singular: String { rawValue }
}
