import CoreGraphics
import XCTest
@testable import Orion

/// Wave 17: the hub layout. He links to one hub per kind present, every thing links to exactly one hub, the old
/// direct links from him are gone, and the real cross-links between things survive.
@MainActor
final class KnowledgeHubGraphTests: XCTestCase {
    private func sample() throws -> KnowledgeGraph {
        try JSONDecoder().decode(KnowledgeGraph.self, from: Data(contentsOf: KnowledgeModelTests.fixtures.appendingPathComponent("sample-graph.json")))
    }

    func testNoDirectLinksFromHimToThings() throws {
        let hubbed = KnowledgeHubGraph.build(try sample())
        let hubIDs = Set(hubbed.nodes.filter(\.isHub).map(\.id))
        for edge in hubbed.edges where edge.from == "person:self" || edge.to == "person:self" {
            let other = edge.from == "person:self" ? edge.to : edge.from
            XCTAssertTrue(hubIDs.contains(other), "\(edge.id) still reaches a thing directly")
        }
    }

    func testOneHubPerKindPresentAndHeLinksToEach() throws {
        let graph = try sample()
        let hubbed = KnowledgeHubGraph.build(graph)
        let kinds = Set(graph.nodes.filter { !$0.isSelf }.map(\.kind))
        XCTAssertEqual(Set(hubbed.nodes.filter(\.isHub).map(\.id)), Set(kinds.map(KnowledgeHubGraph.hubID)))
        let fromHim = hubbed.edges.filter { $0.from == "person:self" }.map(\.to)
        XCTAssertEqual(Set(fromHim), Set(kinds.map(KnowledgeHubGraph.hubID)))
        XCTAssertEqual(fromHim.count, kinds.count, "exactly one link to each hub")
    }

    func testEveryThingHasExactlyOneHubEdge() throws {
        let graph = try sample()
        let hubbed = KnowledgeHubGraph.build(graph)
        for thing in graph.nodes where !thing.isSelf {
            let hubEdges = hubbed.edges.filter { $0.kind == KnowledgeHubGraph.edgeKind && $0.to == thing.id }
            XCTAssertEqual(hubEdges.map(\.from), [KnowledgeHubGraph.hubID(of: thing)], "\(thing.id)")
        }
    }

    func testCrossLinksBetweenThingsAreKept() throws {
        let graph = try sample()
        let hubbed = KnowledgeHubGraph.build(graph)
        let cross = graph.edges.filter { $0.from != "person:self" && $0.to != "person:self" }
        XCTAssertFalse(cross.isEmpty)
        XCTAssertTrue(cross.allSatisfy { hubbed.edges.contains($0) })
        let sky = KnowledgeSky()
        sky.load(hubbed, now: Date(), animated: false)
        let faint = sky.links.filter(\.faint).count
        XCTAssertEqual(faint, cross.count, "cross-links draw faint at rest")
    }

    func testTheRealGraphIsUntouchedAndHubsCarryTheCount() throws {
        let graph = try sample()
        let before = graph
        let hubbed = KnowledgeHubGraph.build(graph)
        XCTAssertEqual(graph, before)
        let places = hubbed.nodes.first { $0.id == "hub:place" }
        XCTAssertEqual(places?.badge, graph.nodes.filter { $0.kind == .place && !$0.isSelf }.count)
        XCTAssertEqual(places?.label, "Places")
    }

    func testHubsRingAroundHimAndThingsClusterAroundTheirHub() throws {
        let hubbed = KnowledgeHubGraph.build(try sample())
        let size = CGSize(width: 1000, height: 700)
        let rest = SkyPhysics(hubbed, size: size).settled()
        let at = { (id: String) in rest.point(rest.ids.firstIndex(of: id)!) }
        let me = at("person:self")
        for hub in hubbed.nodes.filter(\.isHub) {
            let h = at(hub.id)
            XCTAssertGreaterThan(hypot(h.x - me.x, h.y - me.y), 60, "\(hub.id) clear of him")
            let members = hubbed.edges.filter { $0.from == hub.id }.map { at($0.to) }
            let meanDistance = members.map { hypot($0.x - h.x, $0.y - h.y) }.reduce(0, +) / Double(max(members.count, 1))
            let toHim = hypot(h.x - me.x, h.y - me.y)
            XCTAssertLessThan(meanDistance, max(toHim * 1.6, 220), "\(hub.id): its things stay near it")
        }
    }

    func testAHubSelectionLightsItsClusterAndDimsTheRest() throws {
        let sky = KnowledgeSky()
        sky.load(KnowledgeHubGraph.build(try sample()), now: Date(), animated: false)
        sky.ambient = false
        sky.selectedID = "hub:habit"
        for f in 0..<30 { sky.tick(Date().addingTimeInterval(Double(f) / 60), size: CGSize(width: 900, height: 640)) }
        let member = sky.index["habit:gym"]!, stranger = sky.index["place:campus"] ?? sky.index["hub:place"]!
        XCTAssertGreaterThan(sky.light[member], 0.7)
        XCTAssertLessThan(sky.light[stranger], 0.5)
    }

    func testHidingAKindIsTheCanvasFilterOfItsHubAndThings() throws {
        let store = KnowledgeStore(graph: try sample())
        store.query.types = [.place]
        let visible = store.query.visibleNodes(in: store.graph).map(\.id)
        XCTAssertTrue(visible.allSatisfy { $0.hasPrefix("place:") })
    }
}
