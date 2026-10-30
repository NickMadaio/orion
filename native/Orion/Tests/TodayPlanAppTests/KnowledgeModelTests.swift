import XCTest
@testable import Orion

/// The Knowledge tab's model: the graph `scripts/orion-knowledge` writes, Nick's overrides on top, and the layout.
final class KnowledgeModelTests: XCTestCase {

    /// tests/fixtures/knowledge — shared with the node suite, so both implementations of the override rules are
    /// held to the same expected bytes.
    static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures/knowledge")

    private func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
        let data = try Data(contentsOf: Self.fixtures.appendingPathComponent("overrides/\(name)"))
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: Overrides — the shared fixture

    func testSharedFixtureGivesTheExpectedGraph() throws {
        let graph: KnowledgeGraph = try load("graph.json")
        let overrides: KnowledgeOverrides = try load("overrides.json")
        let expected: KnowledgeGraph = try load("expected.json")
        XCTAssertEqual(overrides.applied(to: graph), expected)
    }

    func testApplyingTwiceChangesNothing() throws {
        let graph: KnowledgeGraph = try load("graph.json")
        let overrides: KnowledgeOverrides = try load("overrides.json")
        let once = overrides.applied(to: graph)
        XCTAssertEqual(overrides.applied(to: once), once)
    }

    func testEdgeIdsMatchTheScript() {
        XCTAssertEqual(KnowledgeEdge.makeId(from: "b:x", to: "a:y", kind: "said-together"), "a:y>b:x:said-together")
        XCTAssertEqual(KnowledgeEdge.makeId(from: "b:x", to: "a:y", kind: "takes"), "b:x>a:y:takes")
    }

    func testMergeCyclesAreIgnored() {
        let graph = KnowledgeGraph(nodes: [.init(id: "a:1", type: "a", label: "1"), .init(id: "a:2", type: "a", label: "2")], edges: [])
        var overrides = KnowledgeOverrides()
        overrides.nodes["a:1"] = .init(mergeInto: "a:2")
        overrides.nodes["a:2"] = .init(mergeInto: "a:1")
        XCTAssertEqual(overrides.applied(to: graph).nodes.count, 2)
    }

    func testTheRealScriptOutputDecodes() throws {
        // A graph exactly as the script writes it, sources and override count included.
        let json = """
        {"schema":"orion.knowledge-graph.v1","generatedAt":"2026-10-30T14:00:00.000Z",
         "nodes":[{"id":"person:self","type":"person","label":"Sam","facts":[],"sources":[]}],
         "edges":[],"sources":[{"id":"user","file":"workspace/USER.md","ok":true,"items":24}],"overrides":{"applied":0}}
        """
        let graph = try JSONDecoder().decode(KnowledgeGraph.self, from: Data(json.utf8))
        XCTAssertEqual(graph.sources.first?.items, 24)
        XCTAssertEqual(graph.nodes.first?.kind, .person)
    }

    // MARK: Edits become overrides

    func testEditsAreRecordedAsOverridesAndShowImmediately() throws {
        let graph: KnowledgeGraph = try load("graph.json")
        let edits = KnowledgeOverrides()
            .renaming("habit:gym", to: "Lifting")
            .hiding("course:cs2100")
            .deleting("place:club")
            .merging("person:pri", into: "person:priya")
            .noting("habit:gym", "Mornings only.")
            .deletingEdge("person:self>course:cs2100:takes")
        let shown = edits.applied(to: graph)
        XCTAssertEqual(shown.node("habit:gym")?.label, "Lifting")
        XCTAssertEqual(shown.node("habit:gym")?.note, "Mornings only.")
        XCTAssertEqual(shown.node("course:cs2100")?.hidden, true)
        XCTAssertNil(shown.node("place:club"))
        XCTAssertNil(shown.node("person:pri"))
        XCTAssertEqual(shown.node("person:priya")?.aliases, ["Pri"])
        XCTAssertFalse(shown.edges.contains { $0.id == "person:self>course:cs2100:takes" })
        // Round trip through the file shape the script reads.
        let data = try JSONEncoder().encode(edits)
        let back = try JSONDecoder().decode(KnowledgeOverrides.self, from: data)
        XCTAssertEqual(back.applied(to: graph), shown)
    }

    func testUnhidingClearsTheFlag() throws {
        let graph: KnowledgeGraph = try load("graph.json")
        let edits = KnowledgeOverrides().hiding("course:cs2100").unhiding("course:cs2100")
        XCTAssertNil(edits.applied(to: graph).node("course:cs2100")?.hidden)
    }

    // MARK: Query

    func testSearchMatchesLabelsAliasesAndFacts() throws {
        let graph: KnowledgeOverrides = KnowledgeOverrides()
        let shown = graph.applied(to: try load("expected.json"))
        let query = KnowledgeQuery(text: "pri", types: Set(KnowledgeNodeType.allCases), showHidden: false)
        XCTAssertEqual(query.visibleNodes(in: shown).map(\.id), ["person:priya"])
        let byFact = KnowledgeQuery(text: "thursdays", types: Set(KnowledgeNodeType.allCases), showHidden: false)
        XCTAssertEqual(byFact.visibleNodes(in: shown).map(\.id), ["person:priya"])
        let hiddenOff = KnowledgeQuery(text: "", types: [.course], showHidden: false)
        XCTAssertTrue(hiddenOff.visibleNodes(in: shown).isEmpty, "a hidden node stays out unless asked for")
        let hiddenOn = KnowledgeQuery(text: "", types: [.course], showHidden: true)
        XCTAssertEqual(hiddenOn.visibleNodes(in: shown).map(\.id), ["course:cs2100"])
    }

    func testConnectionsListBothDirections() throws {
        let shown: KnowledgeGraph = try load("expected.json")
        let links = shown.connections(of: "person:priya")
        XCTAssertEqual(links.map(\.other.id), ["course:cs2100"])
        XCTAssertEqual(shown.connections(of: "habit:gym").first?.other.id, "person:self")
    }

    // MARK: Layout

    func testLayoutIsDeterministicAndSettles() {
        let graph = Self.ring(count: 30)
        let first = KnowledgeLayout.settled(graph, size: CGSize(width: 800, height: 600))
        let second = KnowledgeLayout.settled(graph, size: CGSize(width: 800, height: 600))
        XCTAssertEqual(first.positions, second.positions)
        XCTAssertTrue(first.isSettled)
        for point in first.positions.values {
            XCTAssertTrue(point.x.isFinite && point.y.isFinite)
            XCTAssertTrue((-40...840).contains(point.x) && (-40...640).contains(point.y), "off the canvas: \(point)")
        }
    }

    func testLayoutSeparatesNodes() {
        let layout = KnowledgeLayout.settled(Self.ring(count: 20), size: CGSize(width: 800, height: 600))
        let points = Array(layout.positions.values)
        for i in points.indices { for j in points.indices where j > i {
            XCTAssertGreaterThan(hypot(points[i].x - points[j].x, points[i].y - points[j].y), 14, "two nodes on top of each other")
        } }
    }

    func testSelfSitsNearTheCentre() {
        let layout = KnowledgeLayout.settled(Self.ring(count: 12), size: CGSize(width: 800, height: 600))
        let me = layout.positions["person:self"]!
        XCTAssertLessThan(hypot(me.x - 400, me.y - 300), 120)
    }

    func testAStepWithoutMotionIsTheSettledLayout() {
        let graph = Self.ring(count: 10)
        let settled = KnowledgeLayout.settled(graph, size: CGSize(width: 600, height: 400))
        let stepped = settled.stepped(graph)
        for (id, point) in settled.positions {
            XCTAssertLessThan(hypot(point.x - stepped.positions[id]!.x, point.y - stepped.positions[id]!.y), 1.5)
        }
    }

    static func ring(count: Int) -> KnowledgeGraph {
        let types = KnowledgeNodeType.allCases.filter { $0 != .person }
        var nodes = [KnowledgeNode(id: "person:self", type: "person", label: "Sam")]
        var edges: [KnowledgeEdge] = []
        for i in 0..<count {
            let type = types[i % types.count]
            let id = "\(type.rawValue):n\(i)"
            nodes.append(KnowledgeNode(id: id, type: type.rawValue, label: "Node \(i)"))
            edges.append(KnowledgeEdge(from: "person:self", to: id, kind: "knows", reason: "r"))
            if i > 0, i % 3 == 0 {
                edges.append(KnowledgeEdge(from: id, to: nodes[i].id, kind: "said-together", reason: "r"))
            }
        }
        return KnowledgeGraph(nodes: nodes, edges: edges)
    }
}
