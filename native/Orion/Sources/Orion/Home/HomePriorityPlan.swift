import SwiftUI

/*
 The priority arrangement as a small solar system (wave 17, second pass). Nick: "the highest priority item is like
 the sun and the others orbit (not moving nor are they far) ... one left one right and then one below".
 Pure, so it is tested. Rank 0 is the sun: centred, widest, level. Ranks 1 and 2 sit close on its left and right,
 a touch below its middle; rank 3 sits directly under it; with a fifth card, ranks 3 and 4 share the space under it,
 mirrored. Always symmetric about the sun's vertical axis. If the cluster is taller than the room it has, the whole
 thing is scaled down (cards re-wrap) before anything could overlap. Nothing moves on its own.
*/
enum HomePriorityPlan {
    /// Of the base card width, by rank.
    static let scales: [CGFloat] = [1.25, 0.85, 0.85, 0.8, 0.8]
    /// Degrees. The sun is level; the pairs mirror each other.
    static let tilts: [Double] = [0, -0.6, 0.6, -0.4, 0.4]
    /// Rim and title brightness, by rank.
    static let dims: [Double] = [1, 0.95, 0.95, 0.9, 0.9]
    /// Clear space between neighbours, wider than a tilt can swing a corner.
    static let gap: CGFloat = 24
    static let maxBase: CGFloat = 280
    /// Below this base width the cluster cannot stay readable side by side: stack by priority.
    static let minBase: CGFloat = 176
    /// The narrowest a card can be before its own content (pill, a long word) pokes out of it.
    static let minCardWidth: CGFloat = 176
    static let maxCount = 5
    /// How far below the sun's middle the side cards sit.
    static let sideDrop: CGFloat = 16
    /// Two cards: the second under the sun (true) or beside it (false).
    static var twoBelow = true

    static func scale(_ rank: Int) -> CGFloat { scales[min(max(rank, 0), scales.count - 1)] }
    static func tilt(_ rank: Int) -> Double { tilts[min(max(rank, 0), tilts.count - 1)] }
    static func dim(_ rank: Int) -> Double { dims[min(max(rank, 0), dims.count - 1)] }

    private static var rowScale: CGFloat { scales[0] + scales[1] + scales[2] }

    /// The base card width for a spread this wide; `shrink` (0...1) is the fit-to-height factor.
    static func base(width: CGFloat, shrink: CGFloat = 1) -> CGFloat {
        min(maxBase, (width - 2 * gap) / rowScale) * shrink
    }

    static func isStacked(count: Int, width: CGFloat) -> Bool { count > 1 && base(width: width) < minBase }

    static func widths(count: Int, width: CGFloat, shrink: CGFloat = 1) -> [CGFloat] {
        let count = min(max(count, 0), maxCount)
        if isStacked(count: count, width: width) {
            return (0..<count).map { min(width, 420) * (scale($0) / scales[0] + 0.1) * shrink }
        }
        return (0..<count).map { base(width: width, shrink: shrink) * scale($0) }
    }

    /// Frames by rank in the spread's coordinates (origin top left), `width` wide. Symmetric about width / 2.
    static func frames(widths: [CGFloat], heights: [CGFloat], width: CGFloat) -> [CGRect] {
        let count = min(widths.count, heights.count)
        guard count > 0 else { return [] }
        let axis = width / 2
        if isStacked(count: count, width: width) {
            var y: CGFloat = 0
            return (0..<count).map { rank in
                defer { y += heights[rank] + 28 }
                return CGRect(x: axis - widths[rank] / 2, y: y, width: widths[rank], height: heights[rank])
            }
        }
        var f = [CGRect](repeating: .zero, count: count)
        f[0] = CGRect(x: axis - widths[0] / 2, y: 0, width: widths[0], height: heights[0])
        if count == 2 {
            if twoBelow {
                f[1] = CGRect(x: axis - widths[1] / 2, y: heights[0] + gap, width: widths[1], height: heights[1])
            } else {
                f[1] = CGRect(x: f[0].maxX + gap, y: sideY(heights[1], sun: f[0]), width: widths[1], height: heights[1])
            }
            return normalised(f, centred: twoBelow, axis: axis)
        }
        if count >= 2 {
            f[1] = CGRect(x: f[0].minX - gap - widths[1], y: sideY(heights[1], sun: f[0]), width: widths[1], height: heights[1])
        }
        if count >= 3 {
            f[2] = CGRect(x: f[0].maxX + gap, y: sideY(heights[2], sun: f[0]), width: widths[2], height: heights[2])
        }
        if count >= 4 {
            let single = count == 4
            let x3 = single ? axis - widths[3] / 2 : axis - gap / 2 - widths[3]
            var y = f[0].maxY + gap
            // Clear the side cards when the lower row reaches out beneath them.
            let sides = f[1...2].filter { $0 != .zero }
            let lowerSpan = single ? (x3, x3 + widths[3]) : (x3, axis + gap / 2 + (count == 5 ? widths[4] : 0))
            for side in sides where side.maxX > lowerSpan.0 - gap && side.minX < lowerSpan.1 + gap { y = max(y, side.maxY + gap) }
            f[3] = CGRect(x: x3, y: y, width: widths[3], height: heights[3])
            if count == 5 { f[4] = CGRect(x: axis + gap / 2, y: y, width: widths[4], height: heights[4]) }
        }
        return normalised(f, centred: true, axis: axis)
    }

    private static func sideY(_ height: CGFloat, sun: CGRect) -> CGFloat { sun.midY - height / 2 + sideDrop }

    /// Shifts everything so the topmost card starts at y = 0 (a tall side card can poke above the sun).
    private static func normalised(_ frames: [CGRect], centred: Bool, axis: CGFloat) -> [CGRect] {
        var out = frames
        let top = frames.map(\.minY).min() ?? 0
        if top != 0 { out = frames.map { $0.offsetBy(dx: 0, dy: -top) } }
        if !centred, let first = out.first, let last = out.last, out.count == 2 {
            let shift = axis - (first.minX + last.maxX) / 2
            out = out.map { $0.offsetBy(dx: shift, dy: 0) }
        }
        return out
    }

    /// Frames by rank, shrunk until the cluster fits `maxHeight` (when given). `heightAt` is how tall rank `r`
    /// comes out at a width; text re-wraps as cards narrow, so this iterates rather than scaling once.
    static func fitted(count: Int, width: CGFloat, maxHeight: CGFloat?, heightAt: (Int, CGFloat) -> CGFloat) -> [CGRect] {
        // Never narrower than the smallest card's content: past that the cluster overflows its room rather than overlap.
        let floor = min(1, minCardWidth / (base(width: width) * (scales.min() ?? 1)))
        var shrink: CGFloat = 1
        var result: [CGRect] = []
        for _ in 0..<12 {
            let w = widths(count: count, width: width, shrink: shrink)
            result = frames(widths: w, heights: w.enumerated().map { heightAt($0.offset, $0.element) }, width: width)
            let height = result.map(\.maxY).max() ?? 0
            guard let maxHeight, height > maxHeight, shrink > floor else { break }
            shrink = max(floor, shrink * max(0.82, maxHeight / height))
        }
        return result
    }
}

/// The sun card's bounds, reported up so the hologram can sit behind it.
struct HomeSunBoundsKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) { value = value ?? nextValue() }
}

/// Places the priority-ordered cards by HomePriorityPlan.
struct HomePriorityLayout: Layout {
    /// The room the cluster has under the greeting and above the glance row; nil means unconstrained.
    var maxHeight: CGFloat?

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 1_100
        return CGSize(width: width, height: place(width: width, subviews: subviews).map(\.maxY).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, frame) in zip(subviews, place(width: bounds.width, subviews: subviews)) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                          proposal: ProposedViewSize(width: frame.width, height: frame.height))
        }
    }

    private func place(width: CGFloat, subviews: Subviews) -> [CGRect] {
        HomePriorityPlan.fitted(count: subviews.count, width: width, maxHeight: maxHeight) { rank, cardWidth in
            subviews[rank].sizeThatFits(ProposedViewSize(width: cardWidth, height: nil)).height
        }
    }
}
