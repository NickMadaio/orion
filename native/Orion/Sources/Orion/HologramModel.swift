import Foundation
import SwiftUI

/*
 ORION — holographic core, ported from `orion/interface/hologram.js`.

 A rotating spherical shell of radial filaments, latitude arcs, orbital
 great-circles and drifting chips, drawn additively so overlapping geometry
 blooms the way a projected hologram does. The web original used Canvas 2D on
 purpose (no CDN, no WebGL context loss); this port uses SwiftUI `Canvas` for
 the same reason — it is in the OS, it cannot fail to load, and it degrades
 predictably.

 The shell is built ONCE as unit-sphere geometry, then each frame is rotated
 and projected. The draw path allocates only the handful of gradients it needs
 for the core, the wash and the streak; the ~2000 per-element strokes reuse a
 precomputed colour ramp and set `context.opacity` instead of minting a new
 `Color` per element.

 States: idle | listening | thinking | speaking | error
 Drive it with `setState(_:)` and `setLevel(_:)` from the mic / playback taps.
 */

// MARK: - Palette

/// Warm gold, matching the Age of Ultron projection: a white-hot core falling
/// off through amber to a deep ember at the limb.
struct HoloRGB {
    var r: Double
    var g: Double
    var b: Double
}

enum HoloPalette {
    static let core = HoloRGB(r: 255, g: 246, b: 214)
    static let hot = HoloRGB(r: 255, g: 208, b: 112)
    static let mid = HoloRGB(r: 255, g: 158, b: 38)
    static let deep = HoloRGB(r: 214, g: 104, b: 12)
    static let cool = HoloRGB(r: 120, g: 176, b: 255) // listening tint
    static let alarm = HoloRGB(r: 255, g: 92, b: 64)
}

let tau = Double.pi * 2

@inline(__always)
func holoLerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

@inline(__always)
func holoClamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    v < lo ? lo : (v > hi ? hi : v)
}

func holoMix(_ a: HoloRGB, _ b: HoloRGB, _ t: Double) -> HoloRGB {
    HoloRGB(r: holoLerp(a.r, b.r, t), g: holoLerp(a.g, b.g, t), b: holoLerp(a.b, b.b, t))
}

func holoColor(_ c: HoloRGB, _ opacity: Double) -> Color {
    Color(.sRGB,
          red: holoClamp(c.r / 255, 0, 1),
          green: holoClamp(c.g / 255, 0, 1),
          blue: holoClamp(c.b / 255, 0, 1),
          opacity: holoClamp(opacity, 0, 1))
}

// MARK: - States and quality

enum HologramState: String {
    case idle
    case listening
    case thinking
    case speaking
    case error
}

/// `automatic` starts at the faithful element counts and steps down only if the
/// measured frame interval says it cannot hold them. Fidelity first, degrade on
/// evidence.
enum HologramQuality: String, CaseIterable, Identifiable {
    case automatic
    case high
    case balanced

    var id: String { rawValue }

    var label: String {
        switch self {
        case .automatic: return "Automatic"
        case .high: return "High (full detail)"
        case .balanced: return "Balanced (half detail)"
        }
    }
}

// MARK: - Geometry

/// Fibonacci sphere: even angular coverage without the pole clustering you get
/// from naive lat/lon sampling. The reference image has no visible pole seam.
@inline(__always)
func fibonacciPoint(_ i: Int, _ n: Int) -> (x: Double, y: Double, z: Double) {
    let denom = Double(max(1, n - 1))
    let y = 1 - (Double(i) / denom) * 2
    let radius = max(0, 1 - y * y).squareRoot()
    let theta = Double(i) * 2.399963229728653 // golden angle
    return (cos(theta) * radius, y, sin(theta) * radius)
}

private struct Filament {
    var x: Double, y: Double, z: Double
    var inner: Double, outer: Double
    var width: Double
    var phase: Double
    var speed: Double
    var bright: Double
}

private struct LatitudeArc {
    var y: Double
    var r: Double
    var start: Double
    var sweep: Double
    var radius: Double
    var width: Double
    var phase: Double
    var drift: Double
}

private struct Chip {
    var x: Double, y: Double, z: Double
    var radius: Double
    var w: Double
    var h: Double
    var phase: Double
    var speed: Double
}

private struct Orbit {
    var tiltX: Double
    var tiltZ: Double
    var radius: Double
    var width: Double
    var speed: Double
    var alpha: Double
}

private struct Mote {
    var x: Double, y: Double, z: Double
    var radius: Double
    var size: Double
    var phase: Double
    var speed: Double
}

private struct Projected {
    var x: Double
    var y: Double
    var z: Double
    var persp: Double
}

/// Deterministic PRNG so the shell looks identical on every launch. The web
/// original used `Math.random`; a fixed seed is strictly nicer here because the
/// silhouette becomes part of Orion's identity rather than a lottery.
private struct SeededRandom {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func nextBits() -> UInt64 {
        state = state &+ 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func unit() -> Double {
        Double(nextBits() >> 11) * (1.0 / 9_007_199_254_740_992.0)
    }

    mutating func range(_ a: Double, _ b: Double) -> Double {
        a + unit() * (b - a)
    }
}

// MARK: - Model

/// Plain reference type on purpose: it is mutated ~60x a second and is read
/// from inside the `Canvas` draw closure, which `TimelineView(.animation)`
/// already re-runs every frame. Publishing it would make SwiftUI invalidate the
/// whole panel for values only the canvas cares about.
///
/// Everything on this class is touched from the main thread only.
final class HologramModel {

    // Live state -----------------------------------------------------------

    private(set) var state: HologramState = .idle
    private(set) var autoDowngraded = false

    var quality: HologramQuality = .automatic

    private var level: Double = 0   // instantaneous audio level, 0..1
    private var smooth: Double = 0  // smoothed level
    private var energy: Double = 0  // slow-moving envelope, drives global bloom
    private var spin: Double = 0
    private var time: Double = 0
    private var stateT: Double = 0  // 0..1 transition progress into current state
    private var tint: Double = 0    // 0 = gold, 1 = state tint
    private var pulse: Double = 0   // one-shot ripple, fired by ping()

    private var lastTick: Double = 0
    private var frameSamples = 0
    private var frameAccum: Double = 0

    // Geometry (built once) -------------------------------------------------

    private var filaments: [Filament] = []
    private var arcs: [LatitudeArc] = []
    private var chips: [Chip] = []
    private var motes: [Mote] = []
    private let orbits: [Orbit] = [
        Orbit(tiltX: 0.42, tiltZ: -0.18, radius: 1.14, width: 1.5, speed: 0.10, alpha: 0.55),
        Orbit(tiltX: -0.62, tiltZ: 0.35, radius: 0.99, width: 1.0, speed: -0.07, alpha: 0.38),
        Orbit(tiltX: 1.25, tiltZ: 0.10, radius: 1.06, width: 0.8, speed: 0.13, alpha: 0.26)
    ]
    private let orbitSteps = 200

    // Frame-local projection parameters, refreshed in draw().
    private var cx: Double = 0
    private var cy: Double = 0
    private var baseR: Double = 1

    // Colour ramp, rebuilt only when the tint moves.
    private static let rampSteps = 48
    private var rampShading: [GraphicsContext.Shading] = []
    private var rampTint: Double = -1
    private var rampState: HologramState = .idle
    private var hotShading: GraphicsContext.Shading = .color(holoColor(HoloPalette.hot, 1))

    init() {
        build()
        rebuildRamp(force: true)
    }

    // MARK: Build

    private func build() {
        // "ORIONHOL" as bytes — an arbitrary but stable seed.
        var rng = SeededRandom(seed: 0x4F52_494F_4E48_4F4C)

        // Radial filaments: the dominant texture of the reference image.
        let filamentCount = 1500
        filaments.reserveCapacity(filamentCount)
        for i in 0..<filamentCount {
            let p = fibonacciPoint(i, filamentCount)
            // Most filaments hug the shell; a minority spike out, which is what
            // gives the silhouette its ragged, growing-outward feel.
            let spike = rng.unit() < 0.14
            filaments.append(Filament(
                x: p.x, y: p.y, z: p.z,
                inner: spike ? rng.range(0.55, 0.74) : rng.range(0.78, 0.93),
                outer: spike ? rng.range(1.04, 1.22) : rng.range(0.97, 1.03),
                width: spike ? rng.range(0.9, 1.7) : rng.range(0.35, 0.95),
                // Per-filament phase so the shimmer never looks synchronised.
                phase: rng.range(0, tau),
                speed: rng.range(0.6, 2.1),
                bright: rng.range(0.35, 1)
            ))
        }

        // Latitude arcs — partial, broken rings. Full circles read as a
        // wireframe globe; broken ones read as a scan.
        let arcCount = 46
        arcs.reserveCapacity(arcCount)
        for i in 0..<arcCount {
            let y = cos((Double(i) + 0.5) / Double(arcCount) * Double.pi)
            arcs.append(LatitudeArc(
                y: y,
                r: max(0, 1 - y * y).squareRoot(),
                start: rng.range(0, tau),
                sweep: rng.range(0.5, 2.6),
                radius: rng.range(0.88, 1.0),
                width: rng.range(0.3, 0.9),
                phase: rng.range(0, tau),
                drift: rng.range(-0.25, 0.25)
            ))
        }

        // Chips: the little rectangular circuit fragments over the shell.
        let chipCount = 260
        chips.reserveCapacity(chipCount)
        for i in 0..<chipCount {
            let p = fibonacciPoint((i * 7 + 3) % chipCount, chipCount)
            chips.append(Chip(
                x: p.x, y: p.y, z: p.z,
                radius: rng.range(0.9, 1.06),
                w: rng.range(1.5, 6),
                h: rng.range(0.8, 2.4),
                phase: rng.range(0, tau),
                speed: rng.range(0.4, 1.6)
            ))
        }

        // Motes drifting in the volume around the shell.
        let moteCount = 150
        motes.reserveCapacity(moteCount)
        for i in 0..<moteCount {
            let p = fibonacciPoint(i, moteCount)
            motes.append(Mote(
                x: p.x, y: p.y, z: p.z,
                radius: rng.range(1.05, 1.5),
                size: rng.range(0.4, 1.5),
                phase: rng.range(0, tau),
                speed: rng.range(0.2, 0.9)
            ))
        }
    }

    // MARK: Inputs

    func setState(_ name: HologramState) {
        guard name != state else { return }
        state = name
        stateT = 0
        ping()
    }

    func setLevel(_ v: Double) {
        level = holoClamp(v, 0, 1)
    }

    /// One-shot outward ripple — fired on state changes and on wake.
    func ping() {
        pulse = 1
    }

    // MARK: Frame

    /// Element stride. Subsampling a golden-angle sequence keeps the coverage
    /// quasi-uniform (y stays linear, theta stays an irrational rotation), so a
    /// stride of 2 thins the shell without opening a seam.
    private var elementStride: Int {
        switch quality {
        case .high: return 1
        case .balanced: return 2
        case .automatic: return autoDowngraded ? 2 : 1
        }
    }

    func tick(_ now: Date) {
        let t = now.timeIntervalSinceReferenceDate
        if lastTick == 0 { lastTick = t }
        let dt = holoClamp(t - lastTick, 0, 0.05)
        lastTick = t
        update(dt)
        measure(dt)
    }

    /// If `automatic` and we are sustaining worse than ~50fps after warmup,
    /// step down once. Never steps back up: flapping detail is worse than a
    /// slightly sparser shell.
    private func measure(_ dt: Double) {
        guard quality == .automatic, !autoDowngraded, dt > 0 else { return }
        frameSamples += 1
        guard frameSamples > 120 else { return } // ignore launch hitches
        frameAccum += dt
        let counted = frameSamples - 120
        if counted >= 180 {
            if frameAccum / Double(counted) > 0.020 { autoDowngraded = true }
            frameAccum = 0
            frameSamples = 120
        }
    }

    private func update(_ dt: Double) {
        time += dt
        stateT = min(1, stateT + dt * 2.5)
        pulse = max(0, pulse - dt * 1.4)

        // Attack fast, release slow: speech transients should snap the core
        // bright and then fall away, rather than flicker.
        let k = level > smooth ? 18.0 : 5.0
        smooth += (level - smooth) * min(1, dt * k)
        energy += (smooth - energy) * min(1, dt * 2.2)

        let spinRate: Double
        switch state {
        case .idle: spinRate = 0.055
        case .listening: spinRate = 0.10
        case .thinking: spinRate = 0.34
        case .speaking: spinRate = 0.15
        case .error: spinRate = 0.02
        }
        spin += dt * (spinRate + smooth * 0.22)

        let tintTarget: Double = (state == .listening || state == .error) ? 1 : 0
        tint += (tintTarget - tint) * min(1, dt * 4)
    }

    // MARK: Projection

    /// Rotate a unit-sphere point by the current spin (Y) and a fixed tilt (X),
    /// then project. Returns screen x/y, depth in -1..1, and a scale factor.
    @inline(__always)
    private func project(_ px: Double, _ py: Double, _ pz: Double, _ radius: Double) -> Projected {
        let s = sin(spin)
        let c = cos(spin)
        let x = px * c + pz * s
        let z = -px * s + pz * c

        // Fixed tilt so we never look straight down the equator.
        let tilt = 0.34
        let st = sin(tilt)
        let ct = cos(tilt)
        let y2 = py * ct - z * st
        let z2 = py * st + z * ct

        // Mild perspective: front geometry reads larger, which sells the volume.
        let persp = 1 / (1 - z2 * 0.16)
        let r = baseR * radius
        return Projected(x: cx + x * r * persp, y: cy + y2 * r * persp, z: z2, persp: persp)
    }

    // MARK: Colour ramp

    private func rampIndex(_ depth: Double) -> Int {
        let t = holoClamp((depth + 1) / 2, 0, 1)
        let i = Int(t * Double(HologramModel.rampSteps - 1) + 0.5)
        return min(max(i, 0), HologramModel.rampSteps - 1)
    }

    /// Limb is deeper/cooler, front face is hot. `depth` is -1 (back) .. 1 (front).
    private func rampColor(_ depth: Double) -> HoloRGB {
        let t = holoClamp((depth + 1) / 2, 0, 1)
        var c = holoMix(HoloPalette.deep, HoloPalette.hot, pow(t, 0.8))
        if tint > 0.001 {
            let alt = state == .error ? HoloPalette.alarm : HoloPalette.cool
            c = holoMix(c, alt, tint * 0.7)
        }
        return c
    }

    private func rebuildRamp(force: Bool) {
        if !force && abs(tint - rampTint) < 0.004 && state == rampState { return }
        rampTint = tint
        rampState = state
        if rampShading.count != HologramModel.rampSteps {
            rampShading = []
            rampShading.reserveCapacity(HologramModel.rampSteps)
            for i in 0..<HologramModel.rampSteps {
                let depth = (Double(i) / Double(HologramModel.rampSteps - 1)) * 2 - 1
                rampShading.append(.color(holoColor(rampColor(depth), 1)))
            }
            return
        }
        for i in 0..<HologramModel.rampSteps {
            let depth = (Double(i) / Double(HologramModel.rampSteps - 1)) * 2 - 1
            rampShading[i] = .color(holoColor(rampColor(depth), 1))
        }
    }

    // MARK: Draw

    func draw(_ ctx: inout GraphicsContext, size: CGSize) {
        let w = max(1, size.width)
        let h = max(1, size.height)
        cx = Double(w) / 2
        cy = Double(h) / 2
        baseR = Double(min(w, h)) * 0.36

        rebuildRamp(force: false)

        let bloom = 0.55 + energy * 0.85 + pulse * 0.4

        // Ambient wash behind the shell, in normal blend so it stays a wash.
        ctx.blendMode = .normal
        ctx.opacity = 1
        let ambient = Gradient(stops: [
            .init(color: holoColor(HoloPalette.mid, 0.10 * bloom), location: 0),
            .init(color: holoColor(HoloPalette.deep, 0.045 * bloom), location: 0.45),
            .init(color: .clear, location: 1)
        ])
        ctx.fill(
            Path(CGRect(origin: .zero, size: CGSize(width: w, height: h))),
            with: .radialGradient(ambient,
                                  center: CGPoint(x: cx, y: cy),
                                  startRadius: 0,
                                  endRadius: CGFloat(baseR * 2.4))
        )

        // Additive from here on, so overlapping geometry blooms.
        ctx.blendMode = .plusLighter

        // Two passes with the core between them. That single ordering choice is
        // what makes it read as a volume instead of a flat disc.
        drawShell(&ctx, side: -1)
        drawCore(&ctx, bloom: bloom)
        drawShell(&ctx, side: 1)
        drawStreak(&ctx, bloom: bloom)

        ctx.opacity = 1
        ctx.blendMode = .normal
    }

    private func drawShell(_ ctx: inout GraphicsContext, side: Int) {
        let t = time
        let front = side > 0
        let breathe = 1 + sin(t * 0.6) * 0.012 + energy * 0.075 + pulse * 0.05
        let backDim = front ? 1.0 : 0.34
        let step = elementStride

        // --- radial filaments -------------------------------------------
        var i = 0
        while i < filaments.count {
            let f = filaments[i]
            i += step
            let mid = project(f.x, f.y, f.z, 1)
            if (mid.z > 0) != front { continue }

            // Each filament breathes on its own phase; the pulse pushes outward.
            let wob = 1 + sin(t * f.speed + f.phase) * 0.035 + pulse * 0.09
            let a = project(f.x, f.y, f.z, f.inner * breathe * wob)
            let b = project(f.x, f.y, f.z, f.outer * breathe * wob)

            let depth = mid.z
            let flick = 0.72 + 0.28 * sin(t * f.speed * 1.7 + f.phase)
            let alpha = holoClamp(
                f.bright * flick * (0.30 + 0.55 * ((depth + 1) / 2)) * backDim * (0.6 + energy * 0.7),
                0, 1
            )
            if alpha < 0.012 { continue }

            var path = Path()
            path.move(to: CGPoint(x: a.x, y: a.y))
            path.addLine(to: CGPoint(x: b.x, y: b.y))
            ctx.opacity = alpha
            ctx.stroke(path,
                       with: rampShading[rampIndex(depth)],
                       style: StrokeStyle(lineWidth: CGFloat(f.width * mid.persp), lineCap: .round))
        }

        // --- latitude arcs ------------------------------------------------
        let steps = 26
        let arcShading = rampShading[rampIndex(Double(side) * 0.5)]
        var ai = 0
        while ai < arcs.count {
            let arc = arcs[ai]
            ai += step
            let start = arc.start + t * arc.drift
            let radius = arc.radius * breathe
            let shimmer = 0.5 + 0.5 * sin(t * 0.9 + arc.phase)

            var path = Path()
            var drawn = 0
            var prevOK = false
            for s in 0...steps {
                let ang = start + (arc.sweep * Double(s)) / Double(steps)
                let p = project(cos(ang) * arc.r, arc.y, sin(ang) * arc.r, radius)
                if (p.z > 0) != front {
                    prevOK = false
                    continue
                }
                let point = CGPoint(x: p.x, y: p.y)
                if prevOK { path.addLine(to: point) } else { path.move(to: point) }
                prevOK = true
                drawn += 1
            }
            if drawn == 0 { continue }

            let alpha = holoClamp((0.16 + shimmer * 0.24) * backDim * (0.7 + energy * 0.5), 0, 1)
            ctx.opacity = alpha
            ctx.stroke(path, with: arcShading, style: StrokeStyle(lineWidth: CGFloat(arc.width), lineCap: .round))
        }

        // --- chips ---------------------------------------------------------
        var ci = 0
        while ci < chips.count {
            let chip = chips[ci]
            ci += step
            let p = project(chip.x, chip.y, chip.z, chip.radius * breathe)
            if (p.z > 0) != front { continue }

            let wave = 0.5 + 0.5 * sin(t * chip.speed + chip.phase)
            let blink = 0.35 + 0.65 * (wave * wave)
            let alpha = holoClamp(blink * (0.30 + 0.45 * ((p.z + 1) / 2)) * backDim, 0, 1)
            if alpha < 0.02 { continue }

            let cw = chip.w * p.persp
            let ch = chip.h * p.persp
            ctx.opacity = alpha
            ctx.fill(
                Path(CGRect(x: p.x - cw / 2, y: p.y - ch / 2, width: cw, height: ch)),
                with: rampShading[rampIndex(p.z)]
            )
        }

        // --- orbital great-circles -----------------------------------------
        let orbitShading = rampShading[rampIndex(Double(side) * 0.7)]
        for orb in orbits {
            let ang0 = t * orb.speed
            var path = Path()
            var prevOK = false
            var drawn = 0
            let cx1 = cos(orb.tiltX)
            let sx1 = sin(orb.tiltX)
            let cz1 = cos(orb.tiltZ + ang0)
            let sz1 = sin(orb.tiltZ + ang0)
            for s in 0...orbitSteps {
                let a = (Double(s) / Double(orbitSteps)) * tau
                // Circle in XZ, then tilted into place.
                let px = cos(a)
                let pz = sin(a)
                let y1 = -pz * sx1
                let z1 = pz * cx1
                let x2 = px * cz1 - y1 * sz1
                let y2 = px * sz1 + y1 * cz1

                let p = project(x2, y2, z1, orb.radius * breathe)
                if (p.z > 0) != front {
                    prevOK = false
                    continue
                }
                let point = CGPoint(x: p.x, y: p.y)
                if prevOK { path.addLine(to: point) } else { path.move(to: point) }
                prevOK = true
                drawn += 1
            }
            if drawn == 0 { continue }
            ctx.opacity = holoClamp(orb.alpha * backDim * (0.6 + energy * 0.6), 0, 1)
            ctx.stroke(path, with: orbitShading, style: StrokeStyle(lineWidth: CGFloat(orb.width), lineCap: .round))
        }

        // --- motes -----------------------------------------------------------
        var mi = 0
        while mi < motes.count {
            let m = motes[mi]
            mi += step
            let drift = 1 + sin(t * m.speed + m.phase) * 0.05
            let p = project(m.x, m.y, m.z, m.radius * drift * breathe)
            if (p.z > 0) != front { continue }
            let alpha = holoClamp((0.10 + 0.30 * abs(sin(t * m.speed * 0.7 + m.phase))) * backDim, 0, 1)
            let s = m.size * p.persp
            ctx.opacity = alpha
            ctx.fill(Path(CGRect(x: p.x, y: p.y, width: s, height: s)), with: hotShading)
        }
    }

    private func drawCore(_ ctx: inout GraphicsContext, bloom: Double) {
        let r = baseR * (0.30 + energy * 0.13 + pulse * 0.07)
        let hot = tint > 0.01
            ? holoMix(HoloPalette.core, state == .error ? HoloPalette.alarm : HoloPalette.cool, tint * 0.5)
            : HoloPalette.core

        let gradient = Gradient(stops: [
            .init(color: holoColor(hot, 0.95 * bloom), location: 0),
            .init(color: holoColor(HoloPalette.hot, 0.55 * bloom), location: 0.18),
            .init(color: holoColor(HoloPalette.mid, 0.20 * bloom), location: 0.48),
            .init(color: .clear, location: 1)
        ])
        ctx.opacity = 1
        ctx.fill(
            Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)),
            with: .radialGradient(gradient,
                                  center: CGPoint(x: cx, y: cy),
                                  startRadius: 0,
                                  endRadius: CGFloat(r))
        )
    }

    /// Anamorphic lens streak through the core — the horizontal flare that reads
    /// instantly as "projected light" rather than "drawn circle".
    private func drawStreak(_ ctx: inout GraphicsContext, bloom: Double) {
        let len = baseR * (1.5 + energy * 0.7)
        let thick = 1.5 + energy * 3.5

        let gradient = Gradient(stops: [
            .init(color: .clear, location: 0),
            .init(color: holoColor(HoloPalette.mid, 0.10 * bloom), location: 0.34),
            .init(color: holoColor(HoloPalette.core, 0.42 * bloom), location: 0.5),
            .init(color: holoColor(HoloPalette.mid, 0.10 * bloom), location: 0.66),
            .init(color: .clear, location: 1)
        ])
        ctx.opacity = 1
        ctx.fill(
            Path(CGRect(x: cx - len, y: cy - thick / 2, width: len * 2, height: thick)),
            with: .linearGradient(gradient,
                                  startPoint: CGPoint(x: cx - len, y: cy),
                                  endPoint: CGPoint(x: cx + len, y: cy))
        )
    }
}
