import CoreGraphics
import XCTest
@testable import Orion

/// The living graph's model (2026-11-02): physics speed, the entrance that plays once, recency with its bulk guard,
/// the camera that zooms at the cursor, and a drag that pulls neighbours along.
@MainActor
final class KnowledgeSkyTests: XCTestCase {
    private let size = CGSize(width: 900, height: 640)

    // MARK: Speed

    /// One physics step for about 200 nodes must leave room for drawing inside a 60 fps frame.
    func testOneStepForTwoHundredNodesIsUnderFourMilliseconds() {
        let graph = Self.big(count: 199)
        var physics = SkyPhysics(graph, size: CGSize(width: 1100, height: 760)).entering()
        // Warm up, then time hot steps (an entrance, the most expensive moment).
        for _ in 0..<3 { physics = physics.stepped() }
        var samples: [Double] = []
        for _ in 0..<40 {
            let start = DispatchTime.now().uptimeNanoseconds
            physics = physics.stepped()
            samples.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
        }
        let median = samples.sorted()[samples.count / 2]
        XCTAssertFalse(physics.isSettled, "the timed steps must be hot ones")
        XCTAssertLessThan(median, 4.0, "median step \(median) ms for 200 nodes")
    }

    // MARK: Entrance and restore

    func testTheEntranceStartsBeyondTheRimAndSettlesInside() {
        let graph = KnowledgeModelTests.ring(count: 30)
        let start = SkyPhysics(graph, size: size).entering()
        let (rx, ry) = SkyPhysics.radii(size)
        for i in start.ids.indices where start.ids[i] != "person:self" {
            let e = hypot((Double(start.point(i).x) - 450) / rx, (Double(start.point(i).y) - 320) / ry)
            XCTAssertGreaterThan(e, 1.9, "\(start.ids[i]) should start beyond the oval")
        }
        let rest = start.settled()
        for i in rest.ids.indices {
            let p = rest.point(i)
            XCTAssertTrue((0...size.width).contains(p.x) && (0...size.height).contains(p.y), "off the canvas: \(p)")
        }
        XCTAssertLessThan(rest.steps, SkyTuning.maxSteps, "settles on its own, not at the step cap")
    }

    func testReloadingTheSameGraphNeverReplaysTheEntrance() {
        let sky = KnowledgeSky()
        let graph = KnowledgeModelTests.ring(count: 20)
        sky.load(graph, now: Self.now, animated: true)
        Self.run(sky, frames: 600, size: size)
        let before = sky.physics!.point(3)
        XCTAssertTrue(sky.physics!.isSettled)
        sky.load(graph, now: Self.now, animated: true)
        sky.tick(Self.now.addingTimeInterval(20), size: size)
        XCTAssertEqual(sky.physics!.point(3), before, "same graph: positions restored, nothing replays")
        XCTAssertFalse(sky.isEntering)
    }

    func testAnAddedNodeJoinsWithoutAnEntrance() {
        let sky = KnowledgeSky()
        var graph = KnowledgeModelTests.ring(count: 12)
        sky.load(graph, now: Self.now, animated: true)
        Self.run(sky, frames: 600, size: size)
        let kept = sky.physics!.point(1)
        graph.nodes.append(KnowledgeNode(id: "place:new", type: "place", label: "New place"))
        sky.load(graph, now: Self.now, animated: true)
        sky.tick(Self.now.addingTimeInterval(20), size: size)
        XCTAssertFalse(sky.isEntering)
        XCTAssertLessThan(hypot(sky.physics!.point(1).x - kept.x, sky.physics!.point(1).y - kept.y), 30)
    }

    func testReduceMotionLaysOutAtRestOnTheFirstFrame() {
        let sky = KnowledgeSky()
        sky.load(KnowledgeModelTests.ring(count: 20), now: Self.now, animated: false)
        sky.tick(Self.now, size: size)
        XCTAssertTrue(sky.physics!.isSettled)
        XCTAssertFalse(sky.needsFrames, "a static layout asks for no further frames")
    }

    // MARK: Recency

    func testFactsFromTheLastThirtySixHoursShimmer() {
        let nodes = [
            Self.node("a", date: "2026-11-02"), Self.node("b", date: "2026-10-20"), Self.node("c", date: nil),
            Self.node("d", date: "2026-10-01"), Self.node("e", date: "2026-10-02"), Self.node("f", date: "2026-10-03"),
            Self.node("g", date: "2026-10-04"), Self.node("h", date: "2026-10-05"), Self.node("i", date: "2026-11-01"),
            Self.node("j", date: "2026-10-31"),
        ]
        XCTAssertEqual(SkyRecency.flags(nodes, now: Self.now), [true, false, false, false, false, false, false, false, true, false])
    }

    func testABulkRebuildShimmersNothing() {
        let nodes = (0..<10).map { Self.node("n\($0)", date: $0 < 4 ? "2026-11-02" : "2026-10-01") }
        XCTAssertEqual(SkyRecency.flags(nodes, now: Self.now), Array(repeating: false, count: 10), "40% new reads as a rebuild")
    }

    func testUndatedGraphsDegradeToNoShimmer() {
        let graph = KnowledgeModelTests.ring(count: 8)
        XCTAssertFalse(SkyRecency.flags(graph.nodes, now: Self.now).contains(true))
    }

    // MARK: Camera

    func testZoomKeepsThePointUnderTheCursorStill() {
        let camera = SkyCamera()
        let cursor = CGPoint(x: 700, y: 180)
        let world = camera.world(cursor, in: size)
        let zoomed = camera.zoomed(by: 1.8, at: cursor, in: size)
        let back = zoomed.screen(world, in: size)
        XCTAssertEqual(back.x, cursor.x, accuracy: 0.01)
        XCTAssertEqual(back.y, cursor.y, accuracy: 0.01)
        XCTAssertEqual(zoomed.zoom, 1.8, accuracy: 0.001)
        XCTAssertEqual(camera.zoomed(by: 50, at: cursor, in: size).zoom, SkyCamera.zoomRange.upperBound)
    }

    func testPanIsClampedSoTheGraphCannotBeLost() {
        let camera = SkyCamera().panned(by: CGSize(width: 50_000, height: -50_000), in: size)
        XCTAssertLessThanOrEqual(abs(camera.pan.width), size.width)
        XCTAssertLessThanOrEqual(abs(camera.pan.height), size.height)
    }

    // MARK: Hand

    func testDraggingANodePullsItsNeighboursAndItStaysWhereDropped() {
        let sky = KnowledgeSky()
        let graph = Self.chain()
        sky.load(graph, now: Self.now, animated: true)
        Self.run(sky, frames: 600, size: size)
        let a = sky.index["goal:a"]!, b = sky.index["goal:b"]!
        let bBefore = sky.physics!.point(b)
        let grab = sky.camera.screen(sky.physics!.point(a), in: size)
        XCTAssertEqual(sky.hitTest(grab, size: size), a)
        let target = CGPoint(x: grab.x + 140, y: grab.y + 90)
        sky.drag(a, to: target, size: size)
        XCTAssertTrue(sky.needsFrames, "a drag warms the sky")
        Self.run(sky, frames: 30, size: size, from: 20)
        sky.endDrag(size: size)
        Self.run(sky, frames: 600, size: size, from: 21)
        let bAfter = sky.physics!.point(b)
        XCTAssertGreaterThan(hypot(bAfter.x - bBefore.x, bAfter.y - bBefore.y), 4, "its neighbour followed")
        let dropped = sky.camera.screen(sky.physics!.point(a), in: size)
        XCTAssertLessThan(hypot(dropped.x - target.x, dropped.y - target.y), 6, "it stays where he left it")
    }

    func testHoverFindsTheNearestNodeWithinReach() {
        let sky = KnowledgeSky()
        sky.load(KnowledgeModelTests.ring(count: 10), now: Self.now, animated: false)
        sky.tick(Self.now, size: size)
        let me = sky.index["person:self"]!
        let p = sky.camera.screen(sky.physics!.point(me), in: size)
        XCTAssertEqual(sky.hitTest(CGPoint(x: p.x + 9, y: p.y - 6), size: size), me)
        XCTAssertNil(sky.hitTest(CGPoint(x: 2, y: 2), size: size))
        XCTAssertTrue(sky.hover(at: p, size: size))
        XCTAssertFalse(sky.hover(at: p, size: size), "same node: no change, no redraw")
    }

    // MARK: Fixtures

    static let now: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 11; c.day = 2; c.hour = 14
        return Calendar.current.date(from: c)!
    }()

    static func run(_ sky: KnowledgeSky, frames: Int, size: CGSize, from second: Double = 0) {
        for f in 0..<frames { sky.tick(now.addingTimeInterval(second + Double(f) / 60), size: size) }
    }

    static func node(_ id: String, date: String?) -> KnowledgeNode {
        let source = date.map { KnowledgeCitation(file: "memory/\($0).md", line: 1, date: $0) }
        return KnowledgeNode(id: "goal:\(id)", type: "goal", label: id, facts: [KnowledgeFact(text: "x", source: source)])
    }

    static func chain() -> KnowledgeGraph {
        let nodes = [KnowledgeNode(id: "person:self", type: "person", label: "Sam"),
                     KnowledgeNode(id: "goal:a", type: "goal", label: "A"),
                     KnowledgeNode(id: "goal:b", type: "goal", label: "B"),
                     KnowledgeNode(id: "course:c", type: "course", label: "C")]
        let edges = [KnowledgeEdge(from: "person:self", to: "goal:a", kind: "has", reason: "r"),
                     KnowledgeEdge(from: "goal:a", to: "goal:b", kind: "part-of", reason: "r"),
                     KnowledgeEdge(from: "person:self", to: "course:c", kind: "takes", reason: "r")]
        return KnowledgeGraph(nodes: nodes, edges: edges)
    }

    /// About 200 nodes, a self spoke each and a sprinkling of cross links: the size the renderer is budgeted for.
    static func big(count: Int) -> KnowledgeGraph {
        let types = KnowledgeNodeType.allCases.filter { $0 != .person }
        var nodes = [KnowledgeNode(id: "person:self", type: "person", label: "Sam")]
        var edges: [KnowledgeEdge] = []
        for i in 0..<count {
            let type = types[i % types.count]
            let id = "\(type.rawValue):n\(i)"
            nodes.append(KnowledgeNode(id: id, type: type.rawValue, label: "Node number \(i)"))
            edges.append(KnowledgeEdge(from: "person:self", to: id, kind: "knows", reason: "r"))
            if i >= 10 { edges.append(KnowledgeEdge(from: id, to: nodes[i - 9].id, kind: "said-together", reason: "r")) }
        }
        return KnowledgeGraph(nodes: nodes, edges: edges)
    }
}
