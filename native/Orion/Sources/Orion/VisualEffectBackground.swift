import AppKit
import SwiftUI

/*
 The see-through surface, and the AppKit views that keep painting over it.

 Two previous attempts at this failed, and both failed for the same reason:
 SwiftUI was asked to be transparent while AppKit, underneath it, was still
 filling the same rectangle with something solid. Setting the window clear does
 not help if a view inside it draws an opaque background, and three separate
 views in this hierarchy do exactly that by default:

   1. `NSScrollView` — draws its own background, opaque, covering the entire
      content area. `.scrollContentBackground(.hidden)` is documented for List,
      Form and TextEditor. It is not a ScrollView modifier on macOS, so the
      previous fix compiled, read as correct, and changed nothing.

   2. `NSClipView` — the scroll view's document clip, which has its own
      `drawsBackground` and keeps drawing after the scroll view stops.

   3. `NSHostingView` — installs a background matching the effective colour
      scheme. `.preferredColorScheme(.dark)` on the root therefore buys a solid
      near-black fill behind everything, which is indistinguishable from the
      app simply refusing to be transparent.

 `ClearsAppKitBackgrounds` walks up from a zero-size probe and switches all
 three off. It is unglamorous and it is the piece that was missing.
*/

/// Frosted glass — the desktop, blurred. Optional, and off by default.
///
/// Worth being precise about what this is for, because treating it as the
/// transparency mechanism is what went wrong before. A behind-window blur does
/// not let you see the desktop; it samples the desktop and averages it into a
/// wash. That is a *look*. Actual see-through is alpha, which is what
/// `SurfaceSettings.opacity` controls, and it works whether this is on or off.
struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .hudWindow

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = .behindWindow
        // Without this the blur goes inert whenever the window is not key,
        // which reads as the background randomly turning solid.
        view.state = .active
        view.isEmphasized = false
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .active
    }
}

/// Switches off every opaque AppKit background between here and the window.
///
/// Mounted as a zero-size background inside the surface it needs to clear. The
/// walk runs on `viewDidMoveToWindow` — the moment the view is actually in a
/// hierarchy, which is the earliest point the ancestors exist to be found.
struct ClearsAppKitBackgrounds: NSViewRepresentable {

    func makeNSView(context: Context) -> NSView { BackgroundClearingProbe() }

    func updateNSView(_ view: NSView, context: Context) {
        // Re-run on update: SwiftUI rebuilds scroll views on some layout
        // changes, and a freshly created NSScrollView arrives opaque again.
        (view as? BackgroundClearingProbe)?.clearAncestors()
    }
}

private final class BackgroundClearingProbe: NSView {

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        clearAncestors()
    }

    /// Up to the window, then down through everything.
    ///
    /// The walk has to go both ways and it is worth being explicit about why,
    /// because doing only half of it is a fix that looks right and changes
    /// nothing. This probe lives in the root view's background, so the scroll
    /// view it needs to clear is a DESCENDANT of the root, not an ancestor —
    /// walking up from here passes it entirely. Walking up finds the hosting
    /// view; walking down from there finds the scroll views. Both are needed.
    func clearAncestors() {
        guard let window else { return }

        var node: NSView? = self
        while let current = node {
            clear(current)
            node = current.superview
        }

        if let root = window.contentView {
            clearDescendants(of: root)
        }
    }

    private func clearDescendants(of view: NSView) {
        for subview in view.subviews {
            clear(subview)
            clearDescendants(of: subview)
        }
    }

    private func clear(_ view: NSView) {
        switch view {
        case let scrollView as NSScrollView:
            scrollView.drawsBackground = false
            scrollView.backgroundColor = .clear
            scrollView.contentView.drawsBackground = false
            scrollView.contentView.backgroundColor = .clear
        case let clipView as NSClipView:
            clipView.drawsBackground = false
            clipView.backgroundColor = .clear
        default:
            // NSHostingView is not public API to match on by type, and its
            // generic parameter makes `as?` impractical anyway. The name is
            // stable, and a wrong match costs nothing: clearing a layer colour
            // on a view that paints its content in `draw` is a no-op.
            if String(describing: type(of: view)).contains("HostingView") {
                view.layer?.backgroundColor = NSColor.clear.cgColor
                view.layer?.isOpaque = false
            }
        }
    }
}

// MARK: - The surface

/// Orion's window wash: real alpha, optional frost, and the AppKit fix that
/// makes both of them visible.
///
/// One modifier rather than an inline `.background { ZStack { … } }` so there
/// is exactly one description of what the surface is, and every window that
/// wants to be see-through gets the scroll-view fix for free rather than
/// rediscovering it.
struct DashboardSurface: ViewModifier {
    let opacity: Double
    let blur: Bool

    /// The wash colour. Blue-black rather than neutral: over a photographic
    /// wallpaper a neutral grey at low alpha reads as dirt on the screen, while
    /// a cool cast reads as glass.
    private static let wash = Color(red: 0.016, green: 0.024, blue: 0.043)

    func body(content: Content) -> some View {
        content.background {
            ZStack {
                if blur { VisualEffectBackground() }
                DashboardSurface.wash.opacity(opacity)
                ClearsAppKitBackgrounds().frame(width: 0, height: 0)
            }
            .ignoresSafeArea()
        }
    }
}

extension View {
    func dashboardSurface(opacity: Double, blur: Bool) -> some View {
        modifier(DashboardSurface(opacity: opacity, blur: blur))
    }

    /// A soft vertical scrim, for the strips of chrome that must stay readable
    /// no matter what the wallpaper is doing.
    ///
    /// This is how the surface can default to genuinely transparent without
    /// making the header unreadable: the parts carrying text pay for their own
    /// legibility locally, instead of the entire window paying for it globally.
    /// That trade is the whole reason the old single tint slider felt like a
    /// choice between "see through it" and "read it".
    func chromeScrim(edge: UnitPoint = .top, strength: Double = 0.55) -> some View {
        background {
            LinearGradient(
                colors: [
                    Color.black.opacity(strength),
                    Color.black.opacity(strength * 0.35),
                    Color.black.opacity(0),
                ],
                startPoint: edge,
                endPoint: edge == .top ? .bottom : .top
            )
            .ignoresSafeArea()
        }
    }
}
