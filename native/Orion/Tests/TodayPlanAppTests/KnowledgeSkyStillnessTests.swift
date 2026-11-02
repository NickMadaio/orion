import CoreGraphics
import XCTest
@testable import Orion

/// Wave 14: the graph must never shake. The physics comes fully to rest and stays there, steps on a fixed clock,
/// the entrance is a choreography whose threads wait for their nodes, and a resting sky moves only by its drift.
@MainActor
final class KnowledgeSkyStillnessTests: XCTestCase {
    private let size = CGSize(width: 900, height: 640)

    // MARK: Physics at rest

    func testAfterSettlingEveryNodeIsStillAndStaysStill() {
        var physics = SkyPhysics(KnowledgeSkyTests.big(count: 199), size: CGSize(width: 1100, height: 760)).entering()
        for _ in 0..<SkyTuning.maxSteps { physics = physics.stepped() }
        XCTAssertTrue(physics.isSettled)
        XCTAssertEqual(physics.topSpeed, 0, accuracy: 1e-9, "at rest means no velocity at all")
        let frozen = physics.ids.indices.map(physics.point)
        for _ in 0..<600 {
            physics = physics.stepped()
            XCTAssertEqual(physics.topSpeed, 0, accuracy: 1e-9)
        }
        XCTAssertEqual(physics.ids.indices.map(physics.point), frozen, "not one point moves after rest")
    }

    func testADroppedNodeLetsTheSkyComeBackToRest() {
        var physics = SkyPhysics(KnowledgeSkyTests.chain(), size: size).settled()
        let a = physics.ids.firstIndex(of: "goal:a")!
        physics = physics.dragging(a, to: CGPoint(x: 120, y: 120), reheat: true)
        for _ in 0..<20 { physics = physics.stepped() }
        physics = physics.dropped(a)
        for _ in 0..<SkyTuning.maxSteps { physics = physics.stepped() }
        XCTAssertTrue(physics.isSettled)
        XCTAssertEqual(physics.topSpeed, 0, accuracy: 1e-9)
    }

    func testPhysicsStepsOnAFixedClockWhateverTheFrameRate() {
        func steps(frameRate: Double) -> Int {
            let sky = KnowledgeSky()
            sky.load(KnowledgeSkyTests.chain(), now: KnowledgeSkyTests.now, animated: true)
            KnowledgeSkyTests.run(sky, frames: 300, size: size)
            let a = sky.index["goal:a"]!
            let start = sky.physics!.steps
            let grab = sky.camera.screen(sky.restPoint(a), in: size)
            var t = 10.0
            sky.tick(KnowledgeSkyTests.now.addingTimeInterval(t), size: size)
            let base = sky.physics!.steps
            // Half a second of held drag at this frame rate (held, so the sky cannot settle mid-count).
            for f in 1...Int(frameRate / 2) {
                sky.drag(a, to: CGPoint(x: grab.x + CGFloat(f), y: grab.y), size: size)
                t += 1 / frameRate
                sky.tick(KnowledgeSkyTests.now.addingTimeInterval(t), size: size)
            }
            _ = start
            return sky.physics!.steps - base
        }
        let at30 = steps(frameRate: 30), at120 = steps(frameRate: 120), at60 = steps(frameRate: 60)
        XCTAssertEqual(at30, 60, accuracy: 1)
        XCTAssertEqual(at60, 60, accuracy: 1)
        XCTAssertEqual(at120, 60, accuracy: 1)
    }

    // MARK: Entrance

    func testTheEntranceGlidesSmoothlyAndThreadsWaitForTheirNodes() {
        let sky = KnowledgeSky()
        sky.load(KnowledgeModelTests.ring(count: 30), now: KnowledgeSkyTests.now, animated: true)
        sky.tick(KnowledgeSkyTests.now, size: size)
        XCTAssertTrue(sky.isEntering)
        let entrance = sky.entrance!
        var last = sky.nodes.indices.map(sky.restPoint)
        var frame = 1
        while sky.entrance != nil && frame < 1000 {
            sky.tick(KnowledgeSkyTests.now.addingTimeInterval(Double(frame) / 60), size: size)
            let now = sky.nodes.indices.map(sky.restPoint)
            let jump = zip(now, last).map { hypot($0.x - $1.x, $0.y - $1.y) }.max() ?? 0
            XCTAssertLessThan(jump, 40, "frame \(frame): a node jumped \(jump) pt")
            if let e = sky.entrance, e.clock < e.landed {
                XCTAssertTrue(sky.links.indices.allSatisfy { sky.edgeReveal($0) == 0 }, "no thread draws while nodes move")
            }
            last = now
            frame += 1
        }
        XCTAssertNil(sky.entrance, "the entrance finishes")
        XCTAssertLessThan(Double(frame) / 60, entrance.duration + 0.2)
        for i in sky.nodes.indices { XCTAssertEqual(sky.restPoint(i), sky.physics!.point(i), "lands exactly on the layout") }
        XCTAssertTrue(sky.links.indices.allSatisfy { sky.edgeReveal($0) == 1 })
    }

    func testTheSpringArrivesExactlyWithoutAJump() {
        XCTAssertEqual(SkyEntrance.spring(0), 0, accuracy: 1e-9)
        let peak = stride(from: 0.0, to: SkyEntrance.nodeDuration, by: 0.005).map(SkyEntrance.spring).max()!
        XCTAssertGreaterThan(peak, 1.0, "a small lean past the mark")
        XCTAssertLessThan(peak, 1.05)
    }

    // MARK: Rest

    func testARestingSkyMovesOnlyByItsDrift() {
        let sky = KnowledgeSky()
        sky.load(KnowledgeModelTests.ring(count: 30), now: KnowledgeSkyTests.now, animated: true)
        sky.ambient = true
        KnowledgeSkyTests.run(sky, frames: 600, size: size)
        XCTAssertNil(sky.entrance)
        let rest0 = sky.nodes.indices.map(sky.restPoint), shown0 = sky.nodes.indices.map(sky.displayPoint)
        KnowledgeSkyTests.run(sky, frames: 60, size: size, from: 10)
        let rest1 = sky.nodes.indices.map(sky.restPoint), shown1 = sky.nodes.indices.map(sky.displayPoint)
        XCTAssertEqual(rest1, rest0, "one second later the layout is identical")
        let moved = zip(shown0, shown1).map { hypot($0.x - $1.x, $0.y - $1.y) }
        XCTAssertLessThanOrEqual(moved.max() ?? 0, 3.6, "drift stays under two points each way")
        XCTAssertGreaterThan(moved.max() ?? 0, 0, "the drift is alive")
    }

    func testReduceMotionHasNoDriftAndNoEntrance() {
        let sky = KnowledgeSky()
        sky.load(KnowledgeModelTests.ring(count: 12), now: KnowledgeSkyTests.now, animated: false)
        sky.ambient = false
        KnowledgeSkyTests.run(sky, frames: 120, size: size)
        XCTAssertNil(sky.entrance)
        XCTAssertEqual(sky.nodes.indices.map(sky.displayPoint), sky.nodes.indices.map(sky.restPoint))
    }

    /// The first appearance settles the layout off-screen before choreographing it; for 200 nodes that must stay a
    /// brief, one-off cost.
    func testSettlingTwoHundredNodesUpFrontIsQuick() {
        let graph = KnowledgeSkyTests.big(count: 199)
        let start = DispatchTime.now().uptimeNanoseconds
        let rest = SkyPhysics(graph, size: CGSize(width: 1100, height: 760)).settled()
        let ms = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        XCTAssertTrue(rest.isSettled)
        XCTAssertLessThan(ms, 1500, "settled 200 nodes in \(ms) ms over \(rest.steps) steps")
        print("settle-200: \(Int(ms)) ms, \(rest.steps) steps")
    }
}
