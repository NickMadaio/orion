import CoreGraphics
import Foundation

/// The graph's arrival as one choreography (2026-11-02, wave 14), not a simulation played live.
///
/// The physics runs to rest off-screen first; this then carries every node from where it starts to that rest point
/// along a curved path on a spring, staggered from the centre outward. Only once every node has landed do the edges
/// draw in, each from its inner end outward. Nothing here integrates forces, so nothing can shake: every frame is a
/// pure function of the clock.
///
/// The same type carries a reload that added nodes: kept nodes glide from where they were, new ones bloom from him,
/// and only the new edges draw.
struct SkyEntrance {
    static let nodeDuration = 1.15
    static let maxStagger = 0.5
    static let edgeGap = 0.06
    static let edgeDuration = 0.5
    static let edgeStagger = 0.45
    /// Under-damped just enough for a ~2% overshoot: arrives, leans past, rests.
    static let springDamping = 0.78
    static let springOmega = 5.4

    let from: [CGPoint]
    let to: [CGPoint]
    let control: [CGPoint]
    let delay: [Double]
    /// Nodes that bloom from him (every node on the first appearance, only the new ones on a reload) fade in too.
    let blooms: [Bool]
    /// Each edge's start time, and whether it draws from `b` toward `a` (b is the inner end).
    let edgeStart: [Double]
    let edgeReversed: [Bool]
    /// True only for the first appearance (labels and the breath fade in with it).
    let isFirst: Bool
    private(set) var clock = 0.0

    /// - Parameters:
    ///   - to: the rest layout's points.
    ///   - from: where each node starts; nil means it blooms from `centre`.
    ///   - links: index pairs; `drawn` marks edges already on screen (they stay drawn).
    init(to: [CGPoint], from: [CGPoint?], centre: CGPoint, links: [(Int, Int)], drawn: [Bool], isFirst: Bool, ids: [String]) {
        self.to = to
        self.isFirst = isFirst
        let starts = from.map { $0 ?? centre }
        self.from = starts
        blooms = from.map { $0 == nil }
        let far = max(1, to.map { hypot($0.x - centre.x, $0.y - centre.y) }.max() ?? 1)
        control = to.indices.map { i in
            // A swirl: every path bows the same way, so the sky unfurls like a galaxy rather than bursting.
            let a = starts[i], b = to[i]
            let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
            let dx = b.x - a.x, dy = b.y - a.y
            return CGPoint(x: mid.x - dy * 0.32, y: mid.y + dx * 0.32)
        }
        delay = to.indices.map { i in
            guard from[i] == nil else { return 0 }
            let reach = Double(hypot(to[i].x - centre.x, to[i].y - centre.y) / far)
            let jitter = Double(SkyPhysics.hash(ids[i] + "in") % 1000) / 1000 * 0.06
            return 0.05 + reach * Self.maxStagger + jitter
        }
        let landed = (delay.max() ?? 0) + Self.nodeDuration + Self.edgeGap
        let order = links.indices.filter { !drawn[$0] }.sorted { lhs, rhs in
            Self.outerReach(links[lhs], to, centre) < Self.outerReach(links[rhs], to, centre)
        }
        var starts2 = Array(repeating: 0.0, count: links.count)
        for (rank, e) in order.enumerated() {
            starts2[e] = landed + Self.edgeStagger * Double(rank) / Double(max(order.count - 1, 1))
        }
        edgeStart = starts2
        edgeReversed = links.map { a, b in
            hypot(to[b].x - centre.x, to[b].y - centre.y) < hypot(to[a].x - centre.x, to[a].y - centre.y)
        }
        drawnAlready = drawn
    }

    private let drawnAlready: [Bool]

    private static func outerReach(_ link: (Int, Int), _ to: [CGPoint], _ c: CGPoint) -> CGFloat {
        max(hypot(to[link.0].x - c.x, to[link.0].y - c.y), hypot(to[link.1].x - c.x, to[link.1].y - c.y))
    }

    // MARK: Clock

    var duration: Double {
        let lastEdge = zip(edgeStart, drawnAlready).filter { !$0.1 }.map(\.0).max()
        let nodes = (delay.max() ?? 0) + Self.nodeDuration
        return max(nodes, (lastEdge ?? 0) + Self.edgeDuration)
    }

    /// When the last node has come to rest.
    var landed: Double { (delay.max() ?? 0) + Self.nodeDuration }

    var isFinished: Bool { clock >= duration }

    func advanced(by dt: Double) -> SkyEntrance {
        var next = self
        next.clock = min(duration, clock + max(0, dt))
        return next
    }

    func at(_ seconds: Double) -> SkyEntrance {
        var next = self
        next.clock = min(duration, max(0, seconds))
        return next
    }

    // MARK: Nodes

    /// 0 → 1 along the node's path, with the spring's small lean past 1, blended to exactly 1 by the end.
    func progress(_ i: Int) -> Double {
        let t = clock - delay[i]
        guard t > 0 else { return 0 }
        guard t < Self.nodeDuration else { return 1 }
        let s = Self.spring(t)
        let w = Self.smoothstep((t / Self.nodeDuration - 0.7) / 0.3)
        return s + (1 - s) * w
    }

    /// Where node `i` is now, in world points.
    func point(_ i: Int) -> CGPoint {
        let p = progress(i)
        guard p > 0 else { return from[i] }
        guard p != 1 else { return to[i] }
        return Self.bezier(from[i], control[i], to[i], p)
    }

    /// How present a node is (opacity), ramping in over its first third.
    func appear(_ i: Int) -> Double {
        guard blooms[i] else { return 1 }
        return Self.smoothstep((clock - delay[i]) / (Self.nodeDuration * 0.35))
    }

    // MARK: Edges

    /// How much of an edge is drawn, 0 → 1, eased; already-drawn edges are always 1.
    func edge(_ e: Int) -> Double {
        if drawnAlready[e] { return 1 }
        return Self.easeOut((clock - edgeStart[e]) / Self.edgeDuration)
    }

    /// Labels and other text: in once every node has landed, so collision is decided on still points.
    var labels: Double {
        guard isFirst else { return 1 }
        return Self.smoothstep((clock - landed + 0.15) / 0.4)
    }

    // MARK: Curves

    static func spring(_ t: Double) -> Double {
        let z = springDamping, w = springOmega
        let wd = w * (1 - z * z).squareRoot()
        return 1 - exp(-z * w * t) * (cos(wd * t) + z * w / wd * sin(wd * t))
    }

    static func smoothstep(_ x: Double) -> Double {
        let t = min(1, max(0, x))
        return t * t * (3 - 2 * t)
    }

    static func easeOut(_ x: Double) -> Double {
        let t = min(1, max(0, x))
        return 1 - pow(1 - t, 3)
    }

    static func bezier(_ a: CGPoint, _ c: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        let u = 1 - t
        return CGPoint(x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y)
    }
}
