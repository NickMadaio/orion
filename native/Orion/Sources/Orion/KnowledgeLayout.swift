import CoreGraphics
import Foundation

/// A force-directed layout with a radial bias: Nick at the centre, each type fanned out along its own bearing,
/// so the graph reads as ten loose constellations around him rather than one hairball.
///
/// Deterministic — the starting positions come from a hash of each id, not a random seed — so the same graph opens
/// in the same shape every time, and a test can hold it to that. Value type: `stepped` returns the next layout.
///
/// 2026-10-30 polish: each node has its own home (its kind's bearing, turned by a hash of its id, at its own distance
/// from him), the boundary is an oval that pushes back harder the further a node strays past it, and a collision pass
/// keeps labels from touching. The clamp survives only as a last-resort fence.
///
/// 2026-11-02: the physics moved to `SkyPhysics` (flat index arrays, stepped inside the graph's Canvas by
/// `KnowledgeSky`). This is the id-keyed view of it, for tests and anything that wants positions by id.
struct KnowledgeLayout: Equatable {
    let physics: SkyPhysics

    var size: CGSize { physics.size }
    var isSettled: Bool { physics.isSettled }
    var iteration: Int { physics.steps }

    var positions: [String: CGPoint] {
        Dictionary(physics.ids.indices.map { (physics.ids[$0], physics.point($0)) }, uniquingKeysWith: { a, _ in a })
    }

    static let maxIterations = SkyTuning.maxSteps
    static let settleSpeed = CGFloat(SkyTuning.settleSpeed)

    static func initial(_ graph: KnowledgeGraph, size: CGSize) -> KnowledgeLayout {
        KnowledgeLayout(physics: SkyPhysics(graph, size: size))
    }

    /// Run the simulation to rest in one go — for Reduce Motion, tests and renders.
    static func settled(_ graph: KnowledgeGraph, size: CGSize) -> KnowledgeLayout {
        KnowledgeLayout(physics: SkyPhysics(graph, size: size).settled())
    }

    func resized(to next: CGSize) -> KnowledgeLayout { KnowledgeLayout(physics: physics.resized(to: next)) }

    /// One physics step. The graph is fixed at construction; the argument is kept for the old call shape.
    func stepped(_ graph: KnowledgeGraph) -> KnowledgeLayout { KnowledgeLayout(physics: physics.stepped()) }

    static func home(of id: String, kind: KnowledgeNodeType, size: CGSize) -> CGPoint { SkyPhysics.home(of: id, kind: kind, size: size) }
    static func bearing(of kind: KnowledgeNodeType) -> Double { SkyPhysics.bearing(of: kind) }
    static func radii(_ size: CGSize) -> (CGFloat, CGFloat) {
        let (rx, ry) = SkyPhysics.radii(size)
        return (CGFloat(rx), CGFloat(ry))
    }
    static func hash(_ text: String) -> UInt64 { SkyPhysics.hash(text) }
}
