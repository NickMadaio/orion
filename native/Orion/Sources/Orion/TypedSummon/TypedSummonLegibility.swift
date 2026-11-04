import Foundation

/*
 The typed summon overlay has no plate, so what is behind it decides whether it can be read. This is the pure part:
 a backdrop luminance (0 black ... 1 white, WCAG relative luminance) in, a theme out. No SwiftUI, so it is tested.

 Text: dark ink on a light backdrop, light ink on a dark one, each with a halo of the opposite tone. A feathered scrim
 of that same opposite tone sits behind the text block, as faint as it can be and still reach AA (4.5:1) against the
 backdrop it covers. The hologram is made of luminous lines, so on a light backdrop it gets a dark depth halo and a
 dark rim instead. Reduce Transparency swaps all of it for solid backings.
*/

struct TypedSummonTheme: Equatable {
    /// Dark ink (on a light backdrop) or light ink.
    let darkInk: Bool
    /// The halo around the glyphs is the opposite tone of the ink.
    var haloIsLight: Bool { darkInk }
    var textScrimIsLight: Bool { darkInk }
    /// Peak opacity of the feathered wash behind the answer (1 when solid).
    let textScrim: Double
    /// WCAG contrast of the ink against the backdrop after the scrim, at its centre.
    let textContrast: Double
    /// Dark rim and depth halo behind the hologram (light backdrops only).
    let hologramRim: Bool
    /// Peak opacity of the dark radial halo behind the hologram.
    let hologramHalo: Double
    /// Opacity of the composer's dark field.
    let composerFill: Double
    /// The composer's outer dark outline, so its rim is not lost on white.
    let composerOutline: Double
    /// Reduce Transparency: solid backings.
    let solid: Bool
}

enum TypedSummonLegibility {
    static let aa = 4.5
    /// The faintest wash that is always there, so a lucky backdrop never leaves the text bare.
    static let baseScrim = 0.84
    static let maxScrim = 0.92
    static let darkInkLuminance = luminance(red: 0.05, green: 0.06, blue: 0.09)
    static let lightInkLuminance = luminance(red: 0.97, green: 0.98, blue: 1)
    /// Scrim tones, as luminance.
    private static let darkScrimLuminance = luminance(red: 0.03, green: 0.04, blue: 0.08)
    private static let lightScrimLuminance = luminance(red: 0.98, green: 0.98, blue: 1)

    // MARK: WCAG arithmetic

    static func decode(_ value: Double) -> Double { value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4) }
    static func encode(_ linear: Double) -> Double { linear <= 0.0031308 ? linear * 12.92 : 1.055 * pow(linear, 1 / 2.4) - 0.055 }

    static func luminance(red: Double, green: Double, blue: Double) -> Double {
        0.2126 * decode(red) + 0.7152 * decode(green) + 0.0722 * decode(blue)
    }

    static func contrast(_ first: Double, _ second: Double) -> Double {
        (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    /// What `scrim` of a tone does to a backdrop. SwiftUI blends encoded values, so this does too.
    static func covered(_ backdrop: Double, by tone: Double, opacity: Double) -> Double {
        decode(encode(backdrop) * (1 - opacity) + encode(tone) * opacity)
    }

    /// Mean luminance of a BGRA8 buffer (a screen grab), nil when empty.
    static func averageLuminance(bgra: [UInt8]) -> Double? {
        let pixels = bgra.count / 4
        guard pixels > 0 else { return nil }
        var total = 0.0
        for index in 0..<pixels {
            let base = index * 4
            total += luminance(red: Double(bgra[base + 2]) / 255, green: Double(bgra[base + 1]) / 255, blue: Double(bgra[base]) / 255)
        }
        return total / Double(pixels)
    }

    // MARK: Decision

    /// `backdrop` nil means unknown: assume the worst case, where neither ink wins on its own.
    static func decide(backdrop: Double?, reduceTransparency: Bool = false) -> TypedSummonTheme {
        let luminance = min(1, max(0, backdrop ?? worstCase))
        let dark = contrast(darkInkLuminance, luminance) > contrast(lightInkLuminance, luminance)
        let ink = dark ? darkInkLuminance : lightInkLuminance
        let tone = dark ? lightScrimLuminance : darkScrimLuminance
        let light = luminance > 0.35 || dark

        if reduceTransparency {
            return TypedSummonTheme(darkInk: dark, textScrim: 1, textContrast: contrast(ink, tone), hologramRim: dark,
                                    hologramHalo: dark ? 0.9 : 0, composerFill: 1, composerOutline: dark ? 0.8 : 0, solid: true)
        }

        var scrim = baseScrim
        while scrim < maxScrim, contrast(ink, covered(luminance, by: tone, opacity: scrim)) < aa + 0.1 { scrim += 0.01 }
        let result = contrast(ink, covered(luminance, by: tone, opacity: scrim))
        return TypedSummonTheme(darkInk: dark, textScrim: scrim, textContrast: result, hologramRim: light && dark,
                                hologramHalo: dark ? min(0.88, 0.45 + luminance * 0.45) : 0,
                                composerFill: dark ? 0.88 : 0.62, composerOutline: dark ? 0.6 : 0, solid: false)
    }

    /// The backdrop luminance where white and black ink are equally (and least) readable.
    static let worstCase = 0.18
}
