import Foundation

/*
 How much of the desktop shows through Orion.

 This replaced a single "tint" preference, and the reason is worth writing down
 because the old one was fixed twice without ever working.

 The old model was: blur the desktop with an NSVisualEffectView, then paint
 black over the blur, and let the slider choose how much black. Both halves of
 that are opaque in the only sense that matters. A behind-window blur does not
 show you the desktop; it shows you a smear of the desktop's average colour. So
 the slider could make the surface lighter or darker and could never make it
 see-through, which is exactly what it was asked for and exactly what it did.

 The model here is alpha, which is the thing that actually means transparent:

   • `opacity` is a real alpha on a single dark wash. At 0 the window paints
     nothing at all and the desktop is simply visible through it, sharp, with
     Orion's text floating on top. At 0.95 it is a solid dark surface.

   • `blur` is separate and OFF by default. Frosting is a look, not a way to be
     transparent, so it stops being mandatory and becomes a choice.

 Splitting them is the whole fix: one control for "how much can I see through
 this", one for "should what I see be frosted".

 The old `OrionSurfaceTint` value is deliberately NOT carried over. It measured
 tint-over-frost, which is not the same quantity as alpha — and carrying it
 would restore the near-opaque setting that prompted all of this. Everyone
 starts fresh on the new default.
*/

enum SurfaceSettings {

    /// Read through `@AppStorage` in the views, so the slider changes the
    /// surface live rather than on the next launch.
    static let opacityKey = "OrionSurfaceOpacity"
    static let blurKey = "OrionSurfaceBlur"

    /// 0 = pure glass, nothing painted. 0.95 = effectively solid.
    ///
    /// Not floored higher. "Let me see through it" is the request, and a
    /// minimum on the wash is how the last version ended up arguing with the
    /// user about what they were allowed to see.
    static let opacityRange: ClosedRange<Double> = 0...0.95

    /// Deliberately low. The whole point is that the desktop is visible; the
    /// header and navigation carry their own scrim so they stay readable
    /// without the entire window paying for it.
    static let defaultOpacity: Double = 0.30
}
