import Foundation

/*
 The hologram's colours, as a value (wave 13). Nick: "just like we have the black hole as a second hologram option,
 can you make our current one in blue? make sure its a good blue thats easily visible."

 The shell (HologramModel) and the orb painter (OrionThinkingHologram) both read one of these, so the same geometry
 draws gold or blue without a second copy of either. Gold is the original and stays the default, so the phone and
 every existing caller look exactly as before.

 Depth comes from the ramp, not the hue: `deep` is the limb, `hot` the front face, `core` the white-hot centre.
 The blue keeps that shape: a pale ice core, an electric azure face, and a deep cobalt limb that still reads on
 near-black (tests hold the contrast).
*/

public struct HoloRGB: Equatable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double

    public init(r: Double, g: Double, b: Double) {
        self.r = r; self.g = g; self.b = b
    }

    /// WCAG relative luminance of this sRGB colour (0–255 channels), 0 = black, 1 = white.
    public var relativeLuminance: Double {
        func linear(_ channel: Double) -> Double {
            let c = min(1, max(0, channel / 255))
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }

    /// WCAG contrast ratio against `other`, 1…21.
    public func contrast(against other: HoloRGB) -> Double {
        let (a, b) = (relativeLuminance, other.relativeLuminance)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}

public struct HoloPalette: Equatable, Sendable {
    public let core: HoloRGB
    public let hot: HoloRGB
    public let mid: HoloRGB
    public let deep: HoloRGB
    /// State tints the shell leans toward: listening, thinking (unbatched geometry only), error.
    public let cool: HoloRGB
    public let thinking: HoloRGB
    public let alarm: HoloRGB
    /// The orb's filament and dot colour at rest, and the brighter one while listening.
    public let orbRest: HoloRGB
    public let orbListening: HoloRGB

    /// Warm gold, matching the Age of Ultron projection: a white-hot core falling off through amber to a deep ember
    /// at the limb. The original; unchanged.
    public static let gold = HoloPalette(
        core: HoloRGB(r: 255, g: 246, b: 214), hot: HoloRGB(r: 255, g: 208, b: 112),
        mid: HoloRGB(r: 255, g: 158, b: 38), deep: HoloRGB(r: 214, g: 104, b: 12),
        cool: HoloRGB(r: 120, g: 176, b: 255), thinking: HoloRGB(r: 192, g: 116, b: 255),
        alarm: HoloRGB(r: 255, g: 92, b: 64),
        orbRest: HoloRGB(r: 255, g: 176, b: 69), orbListening: HoloRGB(r: 255, g: 207, b: 110))

    /// Electric azure: an ice-white core, a bright azure face and a cobalt limb. Listening leans cyan and thinking
    /// leans periwinkle, so the states still read without leaving blue.
    public static let blue = HoloPalette(
        core: HoloRGB(r: 232, g: 248, b: 255), hot: HoloRGB(r: 140, g: 212, b: 255),
        mid: HoloRGB(r: 70, g: 165, b: 255), deep: HoloRGB(r: 52, g: 124, b: 255),
        cool: HoloRGB(r: 96, g: 232, b: 255), thinking: HoloRGB(r: 150, g: 160, b: 255),
        alarm: HoloRGB(r: 255, g: 92, b: 64),
        orbRest: HoloRGB(r: 100, g: 196, b: 255), orbListening: HoloRGB(r: 156, g: 224, b: 255))

    /// The orb painter's single hue for a state.
    public func orbAccent(state: OrbState, isError: Bool) -> HoloRGB {
        if isError { return HoloRGB(r: 255, g: 56, b: 51) }
        return state == .listening ? orbListening : orbRest
    }
}
