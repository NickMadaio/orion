import CoreGraphics
import Foundation

/// A force-directed layout with a radial bias: Nick at the centre, each type fanned out along its own bearing,
/// so the graph reads as ten loose constellations around him rather than one hairball.
///
/// Deterministic — the starting positions come from a hash of each id, not a random seed — so the same graph opens
/// in the same shape every time, and a test can hold it to that. Value type: `stepped` returns the next layout.
///
/// 2026-10-30 polish: the first version pulled every node of a kind toward ONE shared anchor and stopped them at a
/// hard clamp. Repulsion overpowered the anchor, so the outer kinds slid until they hit the clamp and stacked into
/// two ruled columns at the canvas edges — a grid, the one thing this tab must not read as. Now each node has its
/// own home (its kind's bearing, turned by a hash of its id, at its own distance from him), the boundary is an oval
/// that pushes back harder the further a node strays past it, and a collision pass keeps labels from touching. The
/// clamp survives only as a last-resort fence.
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
        var positions: [String: CGPoint] = [:]
        for node in graph.nodes {
            if node.isSelf { positions[node.id] = centre; continue }
            // A little inside each node's own home, so the opening motion is a gentle bloom outward from him.
            let home = Self.home(of: node.id, kind: node.kind, size: size)
            positions[node.id] = CGPoint(x: centre.x + (home.x - centre.x) * 0.7, y: centre.y + (home.y - centre.y) * 0.7)
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

    /// One physics step: short-range repulsion, edge springs, a pull toward each node's own home, a soft oval wall,
    /// then collision.
    func stepped(_ graph: KnowledgeGraph) -> KnowledgeLayout {
        guard !isSettled else { return self }
        let ids = graph.nodes.map(\.id).filter { positions[$0] != nil }
        let kinds = Dictionary(graph.nodes.map { ($0.id, $0.kind) }, uniquingKeysWith: { a, _ in a })
        let k = sqrt(max(1, size.width * size.height) / CGFloat(max(ids.count, 1))) * 0.5
        // Cooling: early steps move freely, late steps only polish.
        let temperature = max(0.15, 1 - CGFloat(iteration) / CGFloat(Self.maxIterations))
        var force = Dictionary(uniqueKeysWithValues: ids.map { ($0, CGVector.zero) })
        repel(ids, k: k, into: &force)
        pullEdges(graph, k: k, into: &force)
        pullHome(ids, kinds: kinds, into: &force)

        var nextPositions = positions
        var nextVelocities = velocities
        var fastest: CGFloat = 0
        for id in ids {
            guard let p = positions[id] else { continue }
            var v = (velocities[id] ?? .zero) * 0.78 + force[id]! * (0.85 * temperature)
            let speed = sqrt(v.dx * v.dx + v.dy * v.dy)
            let cap: CGFloat = 14 * temperature + 1
            if speed > cap { v = v * (cap / speed) }
            fastest = max(fastest, min(speed, cap))
            nextPositions[id] = CGPoint(x: p.x + v.dx, y: p.y + v.dy)
            nextVelocities[id] = v
        }
        nextPositions = Self.separated(nextPositions, ids: ids, size: size)
        var next = KnowledgeLayout(positions: nextPositions, velocities: nextVelocities, size: size)
        next.iteration = iteration + 1
        next.isSettled = (iteration > 40 && fastest < Self.settleSpeed) || next.iteration >= Self.maxIterations
        return next
    }

    /// Short-ranged (cut off past 2.5k), so it spaces neighbours without inflating the whole graph against the walls.
    /// Distance is measured squashed sideways: labels are wide, so two nodes side by side need more room than two
    /// stacked ones.
    private func repel(_ ids: [String], k: CGFloat, into force: inout [String: CGVector]) {
        for (i, a) in ids.enumerated() {
            guard let pa = positions[a] else { continue }
            for b in ids[(i + 1)...] {
                guard let pb = positions[b] else { continue }
                var dx = pa.x - pb.x, dy = pa.y - pb.y
                if abs(dx) + abs(dy) < 0.01 { dx = CGFloat(Self.hash(a + b) % 7) - 3; dy = 1 }
                let ex = dx * 0.8
                let d2 = max(ex * ex + dy * dy, 25)
                guard d2 < k * k * 6.25 else { continue }
                let push = k * k / d2 * 0.03
                let v = CGVector(dx: dx * push, dy: dy * push)
                force[a]! = force[a]! + v
                force[b]! = force[b]! - v
            }
        }
    }

    /// Spokes to him are weak: they say "connected", the home says "where". Strong spokes pulled every kind onto one
    /// ring at the same radius.
    private func pullEdges(_ graph: KnowledgeGraph, k: CGFloat, into force: inout [String: CGVector]) {
        for edge in graph.edges where edge.hidden != true {
            guard let pa = positions[edge.from], let pb = positions[edge.to], force[edge.from] != nil, force[edge.to] != nil else { continue }
            let dx = pb.x - pa.x, dy = pb.y - pa.y
            let d = max(sqrt(dx * dx + dy * dy), 1)
            let touchesSelf = edge.from == "person:self" || edge.to == "person:self"
            let rest = k * (touchesSelf ? 1.8 : 1.0)
            let pull = (d - rest) * (touchesSelf ? 0.006 : 0.03)
            let v = CGVector(dx: dx / d * pull, dy: dy / d * pull)
            force[edge.from]! = force[edge.from]! + v
            force[edge.to]! = force[edge.to]! - v
        }
    }

    /// Each node toward its own home, and back inside the oval: past 96% of it, pushed in by how far past.
    private func pullHome(_ ids: [String], kinds: [String: KnowledgeNodeType], into force: inout [String: CGVector]) {
        let centre = CGPoint(x: size.width / 2, y: size.height / 2)
        let (rx, ry) = Self.radii(size)
        for id in ids {
            guard let p = positions[id], let kind = kinds[id] else { continue }
            if id == "person:self" {
                force[id]! = force[id]! + CGVector(dx: (centre.x - p.x) * 0.3, dy: (centre.y - p.y) * 0.3)
                continue
            }
            let home = Self.home(of: id, kind: kind, size: size)
            force[id]! = force[id]! + CGVector(dx: (home.x - p.x) * 0.045, dy: (home.y - p.y) * 0.045)
            let nx = (p.x - centre.x) / rx, ny = (p.y - centre.y) / ry
            let e = sqrt(nx * nx + ny * ny)
            if e > 0.96 {
                let excess = (e - 0.96) * 0.5
                force[id]! = force[id]! + CGVector(dx: -nx / e * excess * rx, dy: -ny / e * excess * ry)
            }
        }
    }

    /// Collision: two nodes closer than a label's footprint are eased apart, half each, then fenced into the canvas.
    private static func separated(_ input: [String: CGPoint], ids: [String], size: CGSize) -> [String: CGPoint] {
        var positions = input
        let footprintX: CGFloat = 92, footprintY: CGFloat = 34
        for (i, a) in ids.enumerated() {
            for b in ids[(i + 1)...] {
                guard let pa = positions[a], let pb = positions[b] else { continue }
                // He keeps a clear ring: his name is the largest label on the canvas and the one that must never be
                // overprinted, so near him the footprint grows and only the other node gives way.
                let aSelf = a == "person:self", bSelf = b == "person:self"
                let scale: CGFloat = aSelf || bSelf ? 1.6 : 1
                // Overlap measured in label units, not points: an ellipse the shape of a label.
                let fx = footprintX * scale, fy = footprintY * scale * 1.4
                let u = (pb.x - pa.x) / fx, w = (pb.y - pa.y) / (aSelf || bSelf ? fy : footprintY)
                let d = sqrt(u * u + w * w)
                guard d < 1, d > 0.0001 else { continue }
                let shift = (1 - d) * 0.25
                let sx = u / d * shift * fx, sy = w / d * shift * (aSelf || bSelf ? fy : footprintY)
                let wa: CGFloat = aSelf ? 0 : (bSelf ? 2 : 1), wb: CGFloat = bSelf ? 0 : (aSelf ? 2 : 1)
                positions[a] = CGPoint(x: pa.x - sx * wa, y: pa.y - sy * wa)
                positions[b] = CGPoint(x: pb.x + sx * wb, y: pb.y + sy * wb)
            }
        }
        // Wider at the sides: a label hangs centred under its node and must not run off the canvas.
        let inset: CGFloat = 28, insetX = Self.insetX(size)
        return positions.mapValues { p in
            CGPoint(x: min(max(p.x, insetX), size.width - insetX), y: min(max(p.y, inset), size.height - inset))
        }
    }

    // MARK: Helpers

    private static func insetX(_ size: CGSize) -> CGFloat { min(64, max(28, size.width * 0.08)) }

    /// Half-axes of the oval the graph lives in, inside the label insets.
    static func radii(_ size: CGSize) -> (CGFloat, CGFloat) {
        (max(40, size.width / 2 - insetX(size) - 18), max(40, size.height / 2 - 40))
    }

    /// Where a node wants to rest: its kind's bearing, turned a little by a hash of its id, at a distance of its own.
    /// Two nodes of one kind share a direction but never a point, so a constellation is a loose fan, not a stack.
    static func home(of id: String, kind: KnowledgeNodeType, size: CGSize) -> CGPoint {
        let centre = CGPoint(x: size.width / 2, y: size.height / 2)
        let (rx, ry) = radii(size)
        let turn = Double(hash(id) % 1000) / 1000 - 0.5
        let reach = Double(hash(id + "r") % 1000) / 1000
        let angle = bearing(of: kind) + turn * 0.62
        let r = 0.42 + 0.52 * reach
        return CGPoint(x: centre.x + CGFloat(cos(angle) * r) * rx, y: centre.y + CGFloat(sin(angle) * r) * ry)
    }

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
