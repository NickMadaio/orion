import CoreGraphics
import Foundation

/// The numbers that make the graph glide rather than spring (2026-11-02, after Sentient's Constellation view: ideas
/// and constants only, no code). Heavy damping and a speed cap mean nodes arrive and stop; heat (`alpha`) decays per
/// step so a fresh layout settles in about three seconds and a drag only warms it briefly.
enum SkyTuning {
    static let damping = 0.80
    static let maxSpeed = 14.0
    static let alphaDecay = 0.99
    /// Forces never cool below this: late steps still polish, as the old linear temperature did.
    static let alphaFloor = 0.15
    static let settledAlpha = 0.03
    static let settleSpeed = 0.22
    /// Below this heat the sky is at rest whatever is still twitching (an over-full canvas can never fully satisfy
    /// every label footprint).
    static let restAlpha = 0.005
    /// Dragging a node warms the sky to this, so its neighbours follow it and then come to rest.
    static let dragAlpha = 0.35
    static let maxSteps = 900
    /// Physics steps per second, whatever the display rate.
    static let stepsPerSecond = 120.0
}

/// The force layout as index arrays: Nick pinned at the centre, every other node pulled toward its own home along its
/// kind's bearing, short-range repulsion, edge springs (weak across kinds, so bridges do not yank constellations
/// together), a soft oval wall, then a collision pass that keeps labels apart.
///
/// A value type over flat `[Double]` arrays: one step for 200 nodes is a few hundred microseconds, and nothing here is
/// observed by SwiftUI. `KnowledgeSky` owns one and steps it inside the Canvas closure.
struct SkyPhysics: Equatable {
    struct Spring: Equatable {
        let a: Int, b: Int
        let rest: Double, pull: Double
    }

    let ids: [String]
    let kinds: [KnowledgeNodeType]
    let springs: [Spring]
    let selfIndex: Int?
    private(set) var size: CGSize
    private(set) var x: [Double], y: [Double]
    private(set) var vx: [Double], vy: [Double]
    private(set) var homeX: [Double], homeY: [Double]
    /// Nodes he dropped somewhere: their home is where he left them.
    private(set) var anchored: [Bool]
    private(set) var alpha = 1.0
    private(set) var steps = 0
    private(set) var isSettled = false
    /// While nodes glide in from beyond the rim, the canvas fence is off (it would snap them to the edge).
    private(set) var entering = false
    /// The node under his cursor while dragging: moved by the hand, not the forces.
    var pinned: Int?
    private let k: Double
    /// Label footprints shrink when the oval cannot hold them all (about 200 nodes in a small window), so collision
    /// has a solution; the renderer's label pass then skips whatever would still overlap.
    private let crowding: Double

    // MARK: Build

    init(_ graph: KnowledgeGraph, size: CGSize) {
        ids = graph.nodes.map(\.id)
        kinds = graph.nodes.map(\.kind)
        selfIndex = ids.firstIndex(of: "person:self")
        self.size = size
        let index = Dictionary(ids.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        k = sqrt(max(1, Double(size.width * size.height)) / Double(max(ids.count, 1))) * 0.5
        springs = Self.springs(graph, index: index, kinds: kinds, k: k)
        let (rx0, ry0) = Self.radii(size)
        let room = Double.pi * rx0 * ry0 * 0.55, need = Double(max(ids.count, 1)) * 92 * 34 * Double.pi / 4
        crowding = min(1, (room / need).squareRoot())
        let homes = ids.indices.map { Self.home(of: graph.nodes[$0].id, kind: graph.nodes[$0].kind, size: size) }
        homeX = homes.map { Double($0.x) }
        homeY = homes.map { Double($0.y) }
        anchored = Array(repeating: false, count: ids.count)
        let centre = (Double(size.width) / 2, Double(size.height) / 2)
        // A little inside each home, so a plain start is a gentle bloom outward from him.
        let me = selfIndex
        x = ids.indices.map { $0 == me ? centre.0 : centre.0 + (homes[$0].x - centre.0) * 0.7 }
        y = ids.indices.map { $0 == me ? centre.1 : centre.1 + (homes[$0].y - centre.1) * 0.7 }
        vx = Array(repeating: 0, count: ids.count)
        vy = Array(repeating: 0, count: ids.count)
    }

    private static func springs(_ graph: KnowledgeGraph, index: [String: Int], kinds: [KnowledgeNodeType], k: Double) -> [Spring] {
        graph.edges.compactMap { edge in
            guard edge.hidden != true, let a = index[edge.from], let b = index[edge.to], a != b else { return nil }
            // Spokes to him are weak: they say "connected", the home says "where".
            if edge.from == "person:self" || edge.to == "person:self" { return Spring(a: a, b: b, rest: k * 1.8, pull: 0.006) }
            if kinds[a] == kinds[b] { return Spring(a: a, b: b, rest: k, pull: 0.03) }
            return Spring(a: a, b: b, rest: k * 1.5, pull: 0.012)
        }
    }

    /// The first appearance: every node starts beyond the oval on its own bearing and glides in under the speed cap.
    func entering(seed: (String) -> UInt64 = SkyPhysics.hash) -> SkyPhysics {
        var next = self
        let (rx, ry) = Self.radii(size)
        let cx = Double(size.width) / 2, cy = Double(size.height) / 2
        for i in ids.indices where i != selfIndex {
            let dx = homeX[i] - cx, dy = homeY[i] - cy
            let len = max(hypot(dx / rx, dy / ry), 0.001)
            let reach = 1.95 + 0.85 * Double(seed(ids[i] + "rim") % 1000) / 1000
            next.x[i] = cx + dx / len * reach
            next.y[i] = cy + dy / len * reach
        }
        next.entering = true
        next.alpha = 1
        next.isSettled = false
        next.steps = 0
        return next
    }

    /// Positions carried over from an earlier layout by id, so a reload never replays the entrance.
    func restoring(from earlier: SkyPhysics) -> SkyPhysics {
        var next = self
        let old = Dictionary(earlier.ids.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        let sx = Double(size.width / max(earlier.size.width, 1)), sy = Double(size.height / max(earlier.size.height, 1))
        var added = false
        for i in ids.indices {
            guard let j = old[ids[i]] else { added = true; continue }
            next.x[i] = earlier.x[j] * sx
            next.y[i] = earlier.y[j] * sy
            if earlier.anchored[j] {
                next.anchored[i] = true
                next.homeX[i] = earlier.homeX[j] * sx
                next.homeY[i] = earlier.homeY[j] * sy
            }
        }
        // Same nodes: already at rest. New ones: a short, warm settle from their homes' inner bloom.
        next.alpha = added ? 0.3 : 0
        next.isSettled = !added && earlier.isSettled
        return next
    }

    /// Positions scaled into a new size (the window resized) without re-running the physics.
    func resized(to next: CGSize) -> SkyPhysics {
        guard size.width > 0, size.height > 0, next != size else { return self }
        let sx = Double(next.width / size.width), sy = Double(next.height / size.height)
        var copy = self
        copy.size = next
        copy.x = x.map { $0 * sx }
        copy.y = y.map { $0 * sy }
        for i in ids.indices {
            if anchored[i] {
                copy.homeX[i] = homeX[i] * sx
                copy.homeY[i] = homeY[i] * sy
            } else {
                let home = Self.home(of: ids[i], kind: kinds[i], size: next)
                copy.homeX[i] = Double(home.x)
                copy.homeY[i] = Double(home.y)
            }
        }
        return copy
    }

    // MARK: Hand

    func point(_ i: Int) -> CGPoint { CGPoint(x: x[i], y: y[i]) }

    /// Move a node with the hand and warm the sky so its neighbours follow.
    func dragging(_ i: Int, to p: CGPoint, reheat: Bool) -> SkyPhysics {
        var next = self
        next.pinned = i
        next.x[i] = Double(p.x); next.y[i] = Double(p.y)
        next.vx[i] = 0; next.vy[i] = 0
        if reheat {
            next.alpha = max(alpha, SkyTuning.dragAlpha)
            next.isSettled = false
            next.steps = min(steps, SkyTuning.maxSteps / 2)
        }
        return next
    }

    /// Let go: the node stays where he left it.
    func dropped(_ i: Int) -> SkyPhysics {
        var next = self
        next.pinned = nil
        next.anchored[i] = true
        next.homeX[i] = x[i]; next.homeY[i] = y[i]
        return next
    }

    // MARK: Step

    /// Run to rest in one go — Reduce Motion, tests and renders.
    func settled() -> SkyPhysics {
        var next = self
        while !next.isSettled { next = next.stepped() }
        return next
    }

    func stepped() -> SkyPhysics {
        guard !isSettled else { return self }
        var next = self
        next.step()
        return next
    }

    private mutating func step() {
        let n = ids.count
        // Forces cool all the way down with the heat, so the sky truly comes to rest instead of crawling.
        let heat = max(0.002, alpha)
        var fx = Array(repeating: 0.0, count: n), fy = Array(repeating: 0.0, count: n)
        repel(&fx, &fy)
        pullSprings(&fx, &fy)
        pullHome(&fx, &fy)
        let cap = SkyTuning.maxSpeed * heat + 0.5
        // Late steps still polish at the floor gain, which then tapers away below heat 0.1.
        let gain = 0.85 * max(heat, SkyTuning.alphaFloor * min(1, heat * 10))
        let beforeX = x, beforeY = y
        for i in 0..<n where i != pinned && !anchored[i] {
            var ux = vx[i] * SkyTuning.damping + fx[i] * gain
            var uy = vy[i] * SkyTuning.damping + fy[i] * gain
            let speed = (ux * ux + uy * uy).squareRoot()
            if speed > cap { ux *= cap / speed; uy *= cap / speed }
            vx[i] = ux; vy[i] = uy
            x[i] += ux; y[i] += uy
        }
        separate()
        if !entering { fence() }
        var moved = 0.0
        for i in 0..<n { moved = max(moved, abs(x[i] - beforeX[i]) + abs(y[i] - beforeY[i])) }
        steps += 1
        alpha *= SkyTuning.alphaDecay
        if entering && alpha < 0.3 { entering = false }
        let calm = (alpha < SkyTuning.settledAlpha && moved < SkyTuning.settleSpeed) || alpha < SkyTuning.restAlpha
        isSettled = pinned == nil && (calm || steps >= SkyTuning.maxSteps)
    }

    /// Short-ranged (cut off past 2.5k), measured squashed sideways because labels are wide.
    private func repel(_ fx: inout [Double], _ fy: inout [Double]) {
        let n = ids.count
        let cutoff = k * k * 6.25, strength = k * k * 0.03
        x.withUnsafeBufferPointer { px in y.withUnsafeBufferPointer { py in
            fx.withUnsafeMutableBufferPointer { ax in fy.withUnsafeMutableBufferPointer { ay in
                for i in 0..<n {
                    let xi = px[i], yi = py[i]
                    var j = i + 1
                    while j < n {
                        var dx = xi - px[j], dy = yi - py[j]
                        if abs(dx) + abs(dy) < 0.01 { dx = Double((i * 7 + j * 3) % 7) - 3; dy = 1 }
                        let ex = dx * 0.8
                        let d2 = max(ex * ex + dy * dy, 25)
                        if d2 < cutoff {
                            let push = strength / d2
                            ax[i] += dx * push; ay[i] += dy * push
                            ax[j] -= dx * push; ay[j] -= dy * push
                        }
                        j += 1
                    }
                }
            } }
        } }
    }

    private func pullSprings(_ fx: inout [Double], _ fy: inout [Double]) {
        for s in springs {
            let dx = x[s.b] - x[s.a], dy = y[s.b] - y[s.a]
            let d = max((dx * dx + dy * dy).squareRoot(), 1)
            let pull = (d - s.rest) * s.pull
            fx[s.a] += dx / d * pull; fy[s.a] += dy / d * pull
            fx[s.b] -= dx / d * pull; fy[s.b] -= dy / d * pull
        }
    }

    /// Each node toward its own home, and back inside the oval: past 96% of it, pushed in by how far past.
    private func pullHome(_ fx: inout [Double], _ fy: inout [Double]) {
        let cx = Double(size.width) / 2, cy = Double(size.height) / 2
        let (rx, ry) = Self.radii(size)
        for i in ids.indices {
            if i == selfIndex && !anchored[i] {
                fx[i] += (cx - x[i]) * 0.3; fy[i] += (cy - y[i]) * 0.3
                continue
            }
            fx[i] += (homeX[i] - x[i]) * 0.045; fy[i] += (homeY[i] - y[i]) * 0.045
            let nx = (x[i] - cx) / rx, ny = (y[i] - cy) / ry
            let e = (nx * nx + ny * ny).squareRoot()
            if e > 0.96 {
                let excess = (e - 0.96) * 0.5
                fx[i] -= nx / e * excess * rx; fy[i] -= ny / e * excess * ry
            }
        }
    }

    /// Two nodes closer than a label's footprint are eased apart, half each. He keeps a clear ring: near him the
    /// footprint grows and only the other node gives way. A held or dropped node does not give way either.
    private mutating func separate() {
        let n = ids.count
        let footX = 92.0 * crowding, footY = 34.0 * crowding
        let me = selfIndex ?? -1, held = pinned ?? -1
        let fixed = anchored
        x.withUnsafeMutableBufferPointer { px in y.withUnsafeMutableBufferPointer { py in
            for i in 0..<n {
                var j = i + 1
                while j < n {
                    let near = i == me || j == me
                    let fx = near ? footX * 1.6 : footX, fy = near ? footY * 2.24 : footY
                    let u = (px[j] - px[i]) / fx, w = (py[j] - py[i]) / fy
                    let d2 = u * u + w * w
                    if d2 < 1, d2 > 1e-8 {
                        let d = d2.squareRoot()
                        let shift = (1 - d) * 0.25
                        let sx = u / d * shift * fx, sy = w / d * shift * fy
                        let fi = i == me || i == held || fixed[i], fj = j == me || j == held || fixed[j]
                        if fi && fj { j += 1; continue }
                        let wi = fi ? 0.0 : (fj ? 2.0 : 1.0), wj = fj ? 0.0 : (fi ? 2.0 : 1.0)
                        px[i] -= sx * wi; py[i] -= sy * wi
                        px[j] += sx * wj; py[j] += sy * wj
                    }
                    j += 1
                }
            }
        } }
    }

    /// The last-resort fence: wider at the sides, where a label hangs centred under its node.
    private mutating func fence() {
        let inset = 28.0, insetX = Double(Self.insetX(size))
        let w = Double(size.width), h = Double(size.height)
        for i in ids.indices where i != pinned {
            x[i] = min(max(x[i], insetX), w - insetX)
            y[i] = min(max(y[i], inset), h - inset)
        }
    }

    // MARK: Geometry shared with the renderer

    static func insetX(_ size: CGSize) -> CGFloat { min(64, max(28, size.width * 0.08)) }

    /// Half-axes of the oval the graph lives in, inside the label insets.
    static func radii(_ size: CGSize) -> (Double, Double) {
        (Double(max(40, size.width / 2 - insetX(size) - 18)), Double(max(40, size.height / 2 - 40)))
    }

    /// Where a node wants to rest: its kind's bearing, turned a little by a hash of its id, at a distance of its own.
    static func home(of id: String, kind: KnowledgeNodeType, size: CGSize) -> CGPoint {
        let (rx, ry) = radii(size)
        let turn = Double(hash(id) % 1000) / 1000 - 0.5
        let reach = Double(hash(id + "r") % 1000) / 1000
        let angle = bearing(of: kind) + turn * 0.62
        let r = 0.42 + 0.52 * reach
        return CGPoint(x: Double(size.width) / 2 + cos(angle) * r * rx, y: Double(size.height) / 2 + sin(angle) * r * ry)
    }

    /// Where each type's constellation sits around him: courses beside goals, habits beside routines and health.
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
