import CoreGraphics
import Foundation

/// A force-directed layout with a radial bias: Nick at the centre, each type pulled gently toward its own bearing,
/// so the graph reads as ten loose constellations around him rather than one hairball.
///
/// Deterministic — the starting positions come from a hash of each id, not a random seed — so the same graph opens
/// in the same shape every time, and a test can hold it to that. Value type: `stepped` returns the next layout.
struct KnowledgeLayout: Equatable {
    private(set) var positions: [String: CGPoint]
    private(set) var velocities: [String: CGVector]
    let size: CGSize
    private(set) var iteration = 0
    private(set) var isSettled = false

    static let maxIterations = 520
    static let settleSpeed: CGFloat = 0.22

    // MARK: Start

    static func initial(_ graph: KnowledgeGraph, size: CGSize) -> KnowledgeLayout {
        let centre = CGPoint(x: size.width / 2, y: size.height / 2)
        let radius = min(size.width, size.height) * 0.36
        var positions: [String: CGPoint] = [:]
        for node in graph.nodes {
            if node.isSelf { positions[node.id] = centre; continue }
            let jitter = Double(hash(node.id) % 1000) / 1000
            let angle = bearing(of: node.kind) + (jitter - 0.5) * 0.9
            let r = radius * (0.55 + 0.45 * Double(hash(node.id + "r") % 1000) / 1000)
            positions[node.id] = CGPoint(x: centre.x + CGFloat(cos(angle) * r) * size.width / max(size.height, 1), y: centre.y + CGFloat(sin(angle) * r))
        }
        return KnowledgeLayout(positions: positions, velocities: [:], size: size)
    }

    /// Run the simulation to rest in one go — for Reduce Motion, tests and renders.
    static func settled(_ graph: KnowledgeGraph, size: CGSize) -> KnowledgeLayout {
        var layout = initial(graph, size: size)
        while !layout.isSettled { layout = layout.stepped(graph) }
        return layout
    }

    /// Positions scaled into a new size (the window resized) without re-running the physics.
    func resized(to next: CGSize) -> KnowledgeLayout {
        guard size.width > 0, size.height > 0 else { return self }
        let sx = next.width / size.width, sy = next.height / size.height
        var copy = KnowledgeLayout(positions: positions.mapValues { CGPoint(x: $0.x * sx, y: $0.y * sy) }, velocities: [:], size: next)
        copy.isSettled = isSettled
        copy.iteration = iteration
        return copy
    }

    // MARK: Step

    func stepped(_ graph: KnowledgeGraph) -> KnowledgeLayout {
        guard !isSettled else { return self }
        let ids = graph.nodes.map(\.id).filter { positions[$0] != nil }
        let kinds = Dictionary(graph.nodes.map { ($0.id, $0.kind) }, uniquingKeysWith: { a, _ in a })
        let centre = CGPoint(x: size.width / 2, y: size.height / 2)
        let area = max(1, size.width * size.height)
        let k = sqrt(area / CGFloat(max(ids.count, 1))) * 0.62
        // Cooling: early steps move freely, late steps only polish.
        let temperature = max(0.15, 1 - CGFloat(iteration) / CGFloat(Self.maxIterations))
        var force = Dictionary(uniqueKeysWithValues: ids.map { ($0, CGVector.zero) })

        for (i, a) in ids.enumerated() {
            guard let pa = positions[a] else { continue }
            for b in ids[(i + 1)...] {
                guard let pb = positions[b] else { continue }
                var dx = pa.x - pb.x, dy = pa.y - pb.y
                if abs(dx) + abs(dy) < 0.01 { dx = CGFloat(Self.hash(a + b) % 7) - 3; dy = 1 }
                // k²/d along the unit vector, i.e. (dx, dy)·k²/d².
                // Distance is measured squashed sideways: labels are wide, so two nodes side by side need more room
                // than two stacked ones, and feel each other's push from further away.
                let ex = dx * 0.8
                let d2 = max(ex * ex + dy * dy, 25)
                let push = k * k / d2 * 0.035
                let v = CGVector(dx: dx * push, dy: dy * push)
                force[a]! = force[a]! + v
                force[b]! = force[b]! - v
            }
        }
        for edge in graph.edges where edge.hidden != true {
            guard let pa = positions[edge.from], let pb = positions[edge.to], force[edge.from] != nil, force[edge.to] != nil else { continue }
            let dx = pb.x - pa.x, dy = pb.y - pa.y
            let d = max(sqrt(dx * dx + dy * dy), 1)
            let rest = k * (edge.from == "person:self" || edge.to == "person:self" ? 1.55 : 1.0)
            let pull = (d - rest) * 0.035
            let v = CGVector(dx: dx / d * pull, dy: dy / d * pull)
            force[edge.from]! = force[edge.from]! + v
            force[edge.to]! = force[edge.to]! - v
        }
        let rx = size.width * 0.33, ry = size.height * 0.33
        for id in ids {
            guard let p = positions[id], let kind = kinds[id] else { continue }
            if id == "person:self" {
                force[id]! = force[id]! + CGVector(dx: (centre.x - p.x) * 0.3, dy: (centre.y - p.y) * 0.3)
                continue
            }
            let angle = Self.bearing(of: kind)
            let anchor = CGPoint(x: centre.x + CGFloat(cos(angle)) * rx, y: centre.y + CGFloat(sin(angle)) * ry)
            force[id]! = force[id]! + CGVector(dx: (anchor.x - p.x) * 0.03, dy: (anchor.y - p.y) * 0.03)
            force[id]! = force[id]! + CGVector(dx: (centre.x - p.x) * 0.008, dy: (centre.y - p.y) * 0.008)
        }

        var nextPositions = positions
        var nextVelocities = velocities
        var fastest: CGFloat = 0
        // Wider at the sides: a label hangs centred under its node and must not run off the canvas.
        let inset: CGFloat = 28, insetX: CGFloat = min(64, max(28, size.width * 0.08))
        for id in ids {
            guard let p = positions[id] else { continue }
            var v = (velocities[id] ?? .zero) * 0.78 + force[id]! * (0.85 * temperature)
            let speed = sqrt(v.dx * v.dx + v.dy * v.dy)
            let cap: CGFloat = 14 * temperature + 1
            if speed > cap { v = v * (cap / speed) }
            fastest = max(fastest, min(speed, cap))
            let x = min(max(p.x + v.dx, insetX), size.width - insetX)
            let y = min(max(p.y + v.dy, inset), size.height - inset)
            nextPositions[id] = CGPoint(x: x, y: y)
            nextVelocities[id] = v
        }
        var next = KnowledgeLayout(positions: nextPositions, velocities: nextVelocities, size: size)
        next.iteration = iteration + 1
        next.isSettled = (iteration > 40 && fastest < Self.settleSpeed) || next.iteration >= Self.maxIterations
        return next
    }

    // MARK: Helpers

    /// Where each type's constellation sits around him. Spread so related types are neighbours:
    /// courses beside goals, habits beside routines and health.
    static func bearing(of kind: KnowledgeNodeType) -> Double {
        let order: [KnowledgeNodeType] = [.course, .goal, .project, .app, .preference, .person, .place, .routine, .habit, .health]
        let index = Double(order.firstIndex(of: kind) ?? 0)
        return -Double.pi / 2 + index / Double(order.count) * 2 * Double.pi
    }

    /// FNV-1a: stable across launches, unlike `hashValue`.
    static func hash(_ text: String) -> UInt64 {
        text.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
    }
}

private extension CGVector {
    static func + (a: CGVector, b: CGVector) -> CGVector { CGVector(dx: a.dx + b.dx, dy: a.dy + b.dy) }
    static func - (a: CGVector, b: CGVector) -> CGVector { CGVector(dx: a.dx - b.dx, dy: a.dy - b.dy) }
    static func * (a: CGVector, s: CGFloat) -> CGVector { CGVector(dx: a.dx * s, dy: a.dy * s) }
}
