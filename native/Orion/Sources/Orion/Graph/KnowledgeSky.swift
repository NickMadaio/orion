import CoreGraphics
import Foundation
import SwiftUI

/// The knowledge graph's living model (2026-11-02): layout, camera, focus blends, photon pulses and the ambient clock.
///
/// Wave 14: nothing on screen is ever the physics settling live. The layout runs to rest off-screen and the arrival
/// is a choreography (`SkyEntrance`); the physics steps on a fixed 120 Hz clock only while his hand drags a node. At
/// rest the only motion is intentional: a slow per-node drift of under two points, twinkle and his breath.
///
/// A plain reference type that SwiftUI does NOT observe. The graph view's `TimelineView` calls `tick` inside its
/// Canvas closure every frame, so nothing is published per frame and no node is a view. It hangs off `KnowledgeStore`
/// (owned by the dashboard), which outlives the tab: switching tabs and back keeps positions and camera, and the
/// glide-in entrance plays only on the first appearance.
///
/// The only published state is `invalidator.calm`, flipped when the sky comes to rest so its timeline can slow (or,
/// with idle life off, pause).
@MainActor
final class KnowledgeSky {
    struct Link {
        let a: Int, b: Int
        let dashed: Bool
        /// A slight sideways bow, so parallel edges from him do not read as one ruled sheet.
        let bow: CGFloat
    }

    struct Pulse {
        let link: Int
        let start: Double
        let duration: Double
    }

    let invalidator = SkyInvalidator()

    var physics: SkyPhysics?
    private(set) var nodes: [KnowledgeNode] = []
    private(set) var index: [String: Int] = [:]
    private(set) var links: [Link] = []
    private(set) var neighbours: [[Int]] = []
    private(set) var linksOf: [[Int]] = []
    private(set) var degree: [Int] = []
    /// Label priority after the focused ones: busiest first.
    private(set) var byDegree: [Int] = []
    private(set) var twinklePhase: [Double] = []
    private(set) var twinkleSpeed: [Double] = []
    private(set) var recent: [Bool] = []
    private(set) var visible: [Bool] = []

    var camera = SkyCamera()
    var cameraTarget: SkyCamera?
    /// Seconds of ambient time. Advances only while ambient motion runs, so a pause resumes from the same phase.
    private(set) var time = 0.0
    /// Frame-to-frame motion (physics, blends) is on; off under Reduce Motion, where everything snaps to rest.
    var animated = true
    /// Idle life (twinkle, breath, pulses, shimmer) is on; off under Reduce Motion and Low Power Mode.
    var ambient = true

    var selectedID: String? {
        didSet {
            guard oldValue != selectedID else { return }
            // The return glow: the node he just let go of keeps an ignite that decays over about 2.6 s.
            if let old = oldValue, let i = index[old], selectedID == nil, animated { returnGlow = (i, 1) }
            wake()
        }
    }
    private(set) var hovered: Int?
    func setHovered(_ i: Int?) { hovered = i; wake() }
    var dragging: Int?

    private(set) var light: [Double] = []
    private(set) var ignite: [Double] = []
    private(set) var dim = 0.0
    private(set) var card = 0.0
    private(set) var cardIndex: Int?
    private(set) var returnGlow: (index: Int, level: Double)?
    private(set) var pulses: [Pulse] = []
    private(set) var needsFrames = true
    /// The arrival in flight (first appearance, or a reload that added nodes); nil at rest.
    private(set) var entrance: SkyEntrance?
    /// Only the first appearance counts as entering (labels and the breath wait for it).
    var isEntering: Bool { entrance?.isFirst == true }
    /// How much of the ambient drift is on: eases in after the entrance and out when idle life stops.
    private(set) var driftLevel = 0.0
    /// Measured label sizes, so a label that will be skipped is never resolved.
    var labelSizes: [String: CGSize] = [:]

    private var graph: KnowledgeGraph = .empty
    private var built = false
    private var hasAppeared = false
    private var visibleIDs: Set<String>?
    private var lastTick: Date?
    /// Unspent time for the fixed-step physics clock.
    private var accumulator = 0.0
    private var nextPulseAt = 4.0
    private var rng = SkyRandom(seed: 0x5EED_0815)

    // MARK: Load

    /// Take a (new) graph. Positions carry over by id; the entrance plays only the first time nodes appear.
    func load(_ next: KnowledgeGraph, now: Date, animated: Bool) {
        self.animated = animated
        guard next != graph || !built else { return }
        graph = next
        nodes = next.nodes
        index = Dictionary(nodes.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
        buildLinks(next)
        twinklePhase = nodes.map { Double(SkyPhysics.hash($0.id + "t") % 6283) / 1000 }
        twinkleSpeed = nodes.map { 0.7 + Double(SkyPhysics.hash($0.id + "s") % 900) / 1000 }
        recent = SkyRecency.flags(nodes, now: now)
        light = Array(repeating: 1, count: nodes.count)
        ignite = Array(repeating: 0, count: links.count)
        pulses = []
        hovered = nil; cardIndex = nil; card = 0; returnGlow = nil
        applyVisibility()
        if let old = physics { rebuild(size: old.size, from: old) } else { built = false }
        wake()
    }

    /// Which nodes the index's filters leave on the canvas; nil shows all.
    func setVisible(_ ids: Set<String>?) {
        guard ids != visibleIDs else { return }
        visibleIDs = ids
        applyVisibility()
        wake()
    }

    private func applyVisibility() {
        visible = nodes.map { visibleIDs?.contains($0.id) ?? true }
    }

    private func buildLinks(_ graph: KnowledgeGraph) {
        links = graph.edges.compactMap { edge in
            guard edge.hidden != true, let a = index[edge.from], let b = index[edge.to], a != b else { return nil }
            return Link(a: a, b: b, dashed: edge.kind == "said-together", bow: CGFloat(SkyPhysics.hash(edge.id) % 21) - 10)
        }
        var nb = Array(repeating: [Int](), count: nodes.count), lo = nb
        for (e, link) in links.enumerated() {
            nb[link.a].append(link.b); nb[link.b].append(link.a)
            lo[link.a].append(e); lo[link.b].append(e)
        }
        neighbours = nb
        linksOf = lo
        degree = graph.nodes.map { graph.degrees[$0.id] ?? 0 }
        byDegree = nodes.indices.sorted { (degree[$0], $1) > (degree[$1], $0) }
    }

    /// A new layout for the current graph. Whatever moves is choreographed: the rest layout is computed here at once,
    /// and `entrance` carries nodes to it.
    private func rebuild(size: CGSize, from old: SkyPhysics?) {
        let fresh = SkyPhysics(graph, size: size)
        built = true
        entrance = nil
        accumulator = 0
        if let old, !old.ids.isEmpty {
            let restored = fresh.restoring(from: old)
            let kept = Set(old.ids)
            let added = fresh.ids.contains { !kept.contains($0) }
            guard added else { physics = restored; return }
            // Kept nodes hold still while the new ones find room; then the hold is released.
            let keptMask = fresh.ids.map { kept.contains($0) }
            let ownAnchors = restored.anchored
            let rest = restored.anchoring(zip(keptMask, ownAnchors).map { $0 || $1 }).settled().anchoring(ownAnchors)
            physics = rest
            if animated {
                let from = fresh.ids.indices.map { kept.contains(fresh.ids[$0]) ? restored.point($0) : nil }
                let drawn = links.map { kept.contains(fresh.ids[$0.a]) && kept.contains(fresh.ids[$0.b]) }
                entrance = makeEntrance(rest, from: from, drawn: drawn, isFirst: false)
            }
            return
        }
        let rest = fresh.settled()
        physics = rest
        if animated && !hasAppeared && !nodes.isEmpty {
            entrance = makeEntrance(rest, from: Array(repeating: nil, count: rest.ids.count),
                                    drawn: Array(repeating: false, count: links.count), isFirst: true)
            driftLevel = 0
        }
        if !nodes.isEmpty { hasAppeared = true }
    }

    private func makeEntrance(_ rest: SkyPhysics, from: [CGPoint?], drawn: [Bool], isFirst: Bool) -> SkyEntrance {
        let centre = rest.selfIndex.map { rest.point($0) } ?? CGPoint(x: rest.size.width / 2, y: rest.size.height / 2)
        return SkyEntrance(to: rest.ids.indices.map { rest.point($0) }, from: from, centre: centre,
                           links: links.map { ($0.a, $0.b) }, drawn: drawn, isFirst: isFirst, ids: rest.ids)
    }

    // MARK: Frame

    /// One frame: called from the Canvas closure with the timeline's date.
    func tick(_ now: Date, size: CGSize) {
        guard size.width > 40, size.height > 40 else { return }
        if !built || physics == nil { rebuild(size: size, from: physics) }
        if let p = physics, p.size != size { physics = p.resized(to: size) }
        let dt = lastTick.map { min(max(now.timeIntervalSince($0), 0), 0.05) } ?? 1.0 / 60
        lastTick = now
        if ambient && animated { time += dt }
        advanceEntrance(dt)
        stepPhysics(dt)
        blend(dt)
        easeDrift(dt)
        firePulses()
        let still = isStill
        if needsFrames && still {
            needsFrames = false
            // Not during the render pass: publishing from inside a view update is undefined.
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.needsFrames else { return }
                if !self.invalidator.calm { self.invalidator.calm = true }
            }
        } else if !still {
            needsFrames = true
        }
    }

    /// The choreography's clock. A slow frame slows it rather than skipping ahead, so no node ever jumps.
    private func advanceEntrance(_ dt: Double) {
        guard let e = entrance else { return }
        let next = e.advanced(by: animated ? min(dt, 1.0 / 30) : e.duration)
        entrance = next.isFinished ? nil : next
    }

    /// Fixed-step integration: the same 1/120 s step whatever the display does, with the remainder carried to the
    /// next frame. Variable steps were half the old shiver.
    private func stepPhysics(_ dt: Double) {
        guard var p = physics, !p.isSettled else { accumulator = 0; return }
        guard animated else { physics = p.settled(); return }
        let h = 1 / SkyTuning.stepsPerSecond
        accumulator = min(accumulator + dt, h * 8)
        while accumulator >= h && !p.isSettled {
            p = p.stepped()
            accumulator -= h
        }
        if p.isSettled { accumulator = 0 }
        physics = p
    }

    private func easeDrift(_ dt: Double) {
        let target: Double = ambient && animated && entrance == nil && dragging == nil ? 1 : 0
        guard animated else { driftLevel = 0; return }
        let stepTo = dt / 1.6
        driftLevel = target > driftLevel ? min(target, driftLevel + stepTo) : max(target, driftLevel - stepTo)
    }

    // MARK: Points

    /// Where node `i` stands without drift: on its entrance path, or at its layout point. Label collision reads this,
    /// so drift can never flip a label on and off.
    func restPoint(_ i: Int) -> CGPoint {
        if let e = entrance, e.to.indices.contains(i) { return e.point(i) }
        return physics?.point(i) ?? .zero
    }

    /// Where node `i` is drawn: its rest point plus the slow ambient drift.
    func displayPoint(_ i: Int) -> CGPoint {
        let p = restPoint(i)
        guard driftLevel > 0, twinklePhase.indices.contains(i), i != dragging else { return p }
        let d = drift(i)
        return CGPoint(x: p.x + d.dx, y: p.y + d.dy)
    }

    /// A slow Lissajous of at most 1.8 points, each node on its own 13–21 s periods: alive, never restless.
    func drift(_ i: Int) -> CGVector {
        let amp = (nodes[i].isSelf ? 0.8 : 1.8) * driftLevel
        let px = 13 + twinkleSpeed[i] * 5, py = 16 + twinkleSpeed[i] * 3
        return CGVector(dx: amp * sin(2 * .pi * time / px + twinklePhase[i]),
                        dy: amp * cos(2 * .pi * time / py + twinklePhase[i] * 1.7))
    }

    // MARK: Entrance reveal

    /// How present node `i` is (1 at rest).
    func appear(_ i: Int) -> Double { entrance.map { $0.appear(i) } ?? 1 }

    /// How much of edge `e` is drawn (1 at rest). Edges draw only after their nodes have landed.
    func edgeReveal(_ e: Int) -> Double { entrance.map { $0.edge(e) } ?? 1 }

    /// Labels and the breath: in once every node has landed.
    var labelReveal: Double { entrance.map(\.labels) ?? 1 }

    /// Land every node at once (a drag that starts mid-arrival).
    func finishEntrance() {
        entrance = nil
        wake()
    }

    /// Jump the choreography to a moment (render tests pick phases this way).
    func setEntranceClock(_ seconds: Double) {
        guard let e = entrance else { return }
        entrance = e.at(seconds)
    }

    private var focus: Int? { hovered ?? selectedID.flatMap { index[$0] } }

    /// Focus eases per frame (no `withAnimation`): neighbours to 0.75, everything else dims by 62%.
    private func blend(_ dt: Double) {
        let t = animated ? 1 - exp(-dt * 12) : 1
        let f = focus
        let near = f.map { Set(neighbours[$0]) } ?? []
        for i in light.indices {
            let target = f == nil ? 1 : (i == f ? 1 : (near.contains(i) ? 0.75 : 0.38))
            light[i] += (target - light[i]) * t
        }
        for e in ignite.indices {
            let target: Double = f.map { links[e].a == $0 || links[e].b == $0 } == true ? 1 : 0
            ignite[e] += (target - ignite[e]) * t
        }
        dim += ((f == nil ? 0 : 1) - dim) * t
        let showCard = hovered != nil && dragging == nil
        if showCard { cardIndex = hovered }
        card += ((showCard ? 1 : 0) - card) * (animated ? 1 - exp(-dt * 14) : 1)
        if card < 0.01 && !showCard { card = 0; cardIndex = nil }
        if let glow = returnGlow {
            let level = glow.level - dt / 2.6
            returnGlow = level > 0 && animated ? (glow.index, level) : nil
        }
        if let target = cameraTarget {
            camera = animated ? camera.moved(toward: target, by: CGFloat(1 - exp(-dt * 10))) : target
            if camera.isNear(target) { camera = target; cameraTarget = nil }
        }
    }

    /// Every 5 to 8 s, only once the sky is calm, one visible edge fires a short trail of light.
    private func firePulses() {
        pulses.removeAll { time - $0.start > $0.duration }
        guard ambient, animated, entrance == nil, let p = physics, p.isSettled, dragging == nil, time >= nextPulseAt else { return }
        nextPulseAt = time + 5 + rng.unit() * 3
        let candidates = links.indices.filter { visible[links[$0].a] && visible[links[$0].b] }
        guard !candidates.isEmpty else { return }
        firePulse(link: candidates[Int(rng.unit() * Double(candidates.count)) % candidates.count])
    }

    /// Start a pulse now along one link (also how a render test pins one in flight).
    func firePulse(link: Int) {
        guard physics != nil, links.indices.contains(link) else { return }
        let a = restPoint(links[link].a), b = restPoint(links[link].b)
        let length = Double(hypot(b.x - a.x, b.y - a.y))
        pulses.append(Pulse(link: link, start: time, duration: min(2.2, max(1.1, length / 240))))
    }

    /// Advance the ambient clock without a display (render tests pick a phase this way).
    func advanceTime(to seconds: Double) { time = seconds }

    private var isStill: Bool {
        let settled = physics?.isSettled ?? false
        let blendsAtRest = abs(dim - (focus == nil ? 0 : 1)) < 0.002 && (card == 0 || card > 0.998)
        let driftAtRest = driftLevel == 0 || driftLevel == 1
        return settled && blendsAtRest && driftAtRest && cameraTarget == nil && pulses.isEmpty && returnGlow == nil && dragging == nil && entrance == nil
    }

    /// Something changed outside a frame (input, selection, data): make sure frames run until it settles.
    func wake() {
        needsFrames = true
        if invalidator.calm { invalidator.calm = false }
    }
}

/// Lets an un-animated sky (Reduce Motion, Low Power) stop its timeline when nothing is moving.
@MainActor
final class SkyInvalidator: ObservableObject {
    @Published var calm = false
}

/// SplitMix64: a deterministic stream for pulse timing, so a run can be reproduced.
struct SkyRandom {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func unit() -> Double {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return Double((z ^ (z >> 31)) >> 11) / Double(1 << 53)
    }
}
