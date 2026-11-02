import OrionViews
import SwiftUI

/*
 Tab changes (wave 12, review #6). A page arrives with SoftReveal, nudged 24 pt in the direction of travel
 (moving right in the nav slides in from the right), and grows from the nav item that was clicked: its scale is
 anchored at that item's x along the top edge. Under Reduce Motion it is a plain fade.
*/

enum PageTravel {
    static let distance: CGFloat = 24

    /// True when `to` sits after `from` in the nav, i.e. travel is to the right.
    static func isForward(from: DashboardTab, to: DashboardTab) -> Bool {
        index(of: to) >= index(of: from)
    }

    static func index(of tab: DashboardTab) -> Int { DashboardTab.allCases.firstIndex(of: tab) ?? 0 }

    /// The anchor a page grows from, given the nav item's centre as a fraction (0…1) of the nav's width.
    static func anchor(centerFraction: CGFloat?) -> UnitPoint {
        UnitPoint(x: min(1, max(0, centerFraction ?? 0.5)), y: 0)
    }
}

/// How a page looks at `progress` (0 just arrived, 1 settled).
struct PageArrivalEffect: ViewModifier {
    var progress: Double
    var forward: Bool
    var anchor: UnitPoint
    var reduceMotion: Bool

    func body(content: Content) -> some View {
        let remaining = 1 - min(1, max(0, progress))
        content
            .modifier(SoftRevealEffect(progress: progress, reduceMotion: reduceMotion, anchor: anchor, rise: 8, blur: 6))
            .offset(x: reduceMotion ? 0 : (forward ? 1 : -1) * PageTravel.distance * remaining)
    }
}

extension AnyTransition {
    /// The tab-change transition. The removal side is a quick fade: its direction would be one render stale.
    static func orionPage(forward: Bool, anchor: UnitPoint, reduceMotion: Bool) -> AnyTransition {
        .asymmetric(
            insertion: .modifier(active: PageArrivalEffect(progress: 0, forward: forward, anchor: anchor, reduceMotion: reduceMotion),
                                 identity: PageArrivalEffect(progress: 1, forward: forward, anchor: anchor, reduceMotion: reduceMotion)),
            removal: .opacity.animation(.easeOut(duration: 0.12)))
    }
}
