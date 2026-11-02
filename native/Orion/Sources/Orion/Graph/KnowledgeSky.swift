import CoreGraphics
import Foundation
import SwiftUI

/// The knowledge graph's living model (2026-11-02): layout, camera, focus blends, photon pulses and the ambient clock.
///
/// A plain reference type that SwiftUI does NOT observe. The graph view's `TimelineView` calls `tick` inside its
/// Canvas closure every frame, so nothing is published per frame and no node is a view. It hangs off `KnowledgeStore`
/// (owned by the dashboard), which outlives the tab: switching tabs and back keeps positions and camera, and the
/// glide-in entrance plays only on the first appearance.
///
/// The only published state is in two tiny objects: `readout` (the zoom percentage, changed by input) and
/// `invalidator.calm` (flipped once when an un-animated sky comes to rest, so its timeline can pause).
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

    let readout = SkyReadout()
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
    private(set) var isEntering = false
    /// Measured label sizes, so a label that will be skipped is never resolved.
    var labelSizes: [String: CGSize] = [:]

    private var graph: KnowledgeGraph = .empty
    private var built = false
    private var hasAppeared = false
    private var visibleIDs: Set<String>?
    private var lastTick: Date?
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

    private func rebuild(size: CGSize, from old: SkyPhysics?) {
        var fresh = SkyPhysics(graph, size: size)
        if let old, !old.ids.isEmpty {
            fresh = fresh.restoring(from: old)
        } else if animated && !hasAppeared && !nodes.isEmpty {
            fresh = fresh.entering()
            isEntering = true
        }
        if !nodes.isEmpty { hasAppeared = true }
        physics = animated ? fresh : fresh.settled()
        if !animated { isEntering = false }
        built = true
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
        stepPhysics(dt)
        blend(dt)
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

    private func stepPhysics(_ dt: Double) {
        guard var p = physics, !p.isSettled else { return }
        if animated {
            let steps = min(4, max(1, Int((dt * SkyTuning.stepsPerSecond).rounded())))
            for _ in 0..<steps { p = p.stepped() }
        } else {
            p = p.settled()
        }
        physics = p
        if isEntering && p.alpha <= 0.1 { isEntering = false }
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
        guard ambient, animated, let p = physics, p.alpha < 0.05, dragging == nil, time >= nextPulseAt else { return }
        nextPulseAt = time + 5 + rng.unit() * 3
        let candidates = links.indices.filter { visible[links[$0].a] && visible[links[$0].b] }
        guard !candidates.isEmpty else { return }
        firePulse(link: candidates[Int(rng.unit() * Double(candidates.count)) % candidates.count])
    }

    /// Start a pulse now along one link (also how a render test pins one in flight).
    func firePulse(link: Int) {
        guard let p = physics, links.indices.contains(link) else { return }
        let a = p.point(links[link].a), b = p.point(links[link].b)
        let length = Double(hypot(b.x - a.x, b.y - a.y))
        pulses.append(Pulse(link: link, start: time, duration: min(2.2, max(1.1, length / 240))))
    }

    /// Advance the ambient clock without a display (render tests pick a phase this way).
    func advanceTime(to seconds: Double) { time = seconds }

    private var isStill: Bool {
        let settled = physics?.isSettled ?? false
        let blendsAtRest = abs(dim - (focus == nil ? 0 : 1)) < 0.002 && (card == 0 || card > 0.998)
        return settled && blendsAtRest && cameraTarget == nil && pulses.isEmpty && returnGlow == nil && dragging == nil && !isEntering
    }

    /// Something changed outside a frame (input, selection, data): make sure frames run until it settles.
    func wake() {
        needsFrames = true
        if invalidator.calm { invalidator.calm = false }
    }

    // MARK: Reveal

    /// Stars ignite as they arrive; threads fade in only once things settle.
    var starReveal: Double {
        guard isEntering, let p = physics else { return 1 }
        return min(1, (1 - p.alpha) * 3 + 0.15)
    }

    var threadReveal: Double {
        guard isEntering, let p = physics else { return 1 }
        return min(1, max(0, (0.55 - p.alpha) / 0.45))
    }
}

/// The zoom percentage under the graph: published only when the whole-number value changes, on input.
@MainActor
final class SkyReadout: ObservableObject {
    @Published private(set) var zoomPercent = 100
    func show(_ zoom: CGFloat) {
        let next = Int((zoom * 100).rounded())
        if next != zoomPercent { zoomPercent = next }
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
