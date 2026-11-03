import SwiftUI

/*
 The priority arrangement (wave 17, third pass): a wide, short band of cards high on the page so the hologram
 below stays clear. Nick: "make the bubbles higher, and make them wider so that they can be shorter ... without
 covering the hologram so much." Pure, so it is tested.
 Rank 0 is the sun: centred, widest, level, top of the band. Ranks 1 and 2 flank it in the same band. Ranks 3 and
 4 drop one step to the outer left and right, under ranks 1 and 2 but shifted outward, clear of the hologram.
 Symmetric about the sun's vertical axis. If the cluster is taller than its room it shrinks (cards re-wrap)
 before anything could overlap. Nothing moves on its own.
*/
enum HomePriorityPlan {
    /// Of the base card width, by rank.
    static let scales: [CGFloat] = [1.3, 1.0, 1.0, 0.85, 0.85]
    /// Degrees. The sun is level; the pairs mirror each other.
    static let tilts: [Double] = [0, -0.5, 0.5, -0.4, 0.4]
    /// Rim and title brightness, by rank.
    static let dims: [Double] = [1, 0.95, 0.95, 0.9, 0.9]
    /// Clear space between neighbours, wider than a tilt can swing a corner.
    static let gap: CGFloat = 22
    static let maxBase: CGFloat = 310
    /// Below this base width the cluster cannot stay readable side by side: stack by priority.
    static let minBase: CGFloat = 190
    /// The narrowest a card can be before its own content (pill, a long word) pokes out of it.
    static let minCardWidth: CGFloat = 220
    static let maxCount = 5
    /// How far below the sun's middle the flanking cards sit.
    static let sideDrop: CGFloat = 8
    /// How far ranks 3 and 4 sit outside the cards above them.
    static let outerShift: CGFloat = 90

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
            return (0..<count).map { min(width, 440) * (scale($0) / scales[0] + 0.1) * shrink }
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
                defer { y += heights[rank] + 24 }
                return CGRect(x: axis - widths[rank] / 2, y: y, width: widths[rank], height: heights[rank])
            }
        }
        var f = [CGRect](repeating: .zero, count: count)
        f[0] = CGRect(x: axis - widths[0] / 2, y: 0, width: widths[0], height: heights[0])
        if count >= 2 {
            f[1] = CGRect(x: f[0].minX - gap - widths[1], y: f[0].midY - heights[1] / 2 + sideDrop, width: widths[1], height: heights[1])
        }
        if count >= 3 {
            f[2] = CGRect(x: f[0].maxX + gap, y: f[0].midY - heights[2] / 2 + sideDrop, width: widths[2], height: heights[2])
        }
        let bandBottom = f.prefix(min(count, 3)).map(\.maxY).max() ?? 0
        let lowerY = bandBottom + gap
        if count >= 4 {
            f[3] = CGRect(x: max(0, f[1].minX - outerShift), y: lowerY, width: widths[3], height: heights[3])
        }
        if count >= 5 {
            f[4] = CGRect(x: min(width - widths[4], f[2].maxX + outerShift - widths[4]), y: lowerY, width: widths[4], height: heights[4])
        }
        let top = f.map(\.minY).min() ?? 0
        return top == 0 ? f : f.map { $0.offsetBy(dx: 0, dy: -top) }
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
