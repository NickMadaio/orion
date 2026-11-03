import SwiftUI

/*
 The priority-driven arrangement (wave 17), pure so it is tested. Rank 0 is the top priority: it sits in the
 middle, the widest card, nearly level. Ranks 1, 2, 3, 4 fan out left, right, far left, far right, each a step
 narrower, dimmer and a little lower. Widths are chosen so the whole row fits the available width with a gap that
 also covers the small tilts, so cards never overlap or clip. Everything is indexed by rank (the card's index in
 the priority-ordered list); `screenOrder` says where each rank lands left to right.
*/
enum HomePriorityPlan {
    /// Of the base card width, by rank.
    static let scales: [CGFloat] = [1.25, 1.0, 0.9, 0.82, 0.76]
    /// How far each rank hangs below the centre card.
    static let drops: [CGFloat] = [0, 24, 30, 52, 58]
    /// Degrees. The centre card is nearly level.
    static let tilts: [Double] = [-0.2, -0.9, 0.8, -0.6, 0.7]
    /// Rim and title brightness, by rank.
    static let dims: [Double] = [1, 0.96, 0.93, 0.90, 0.87]
    /// Clear space between neighbours: wider than a 1° tilt can swing a card's corner.
    static let gap: CGFloat = 18
    static let maxBase: CGFloat = 300
    /// Below this base width five cards cannot stay readable side by side: stack them instead.
    static let minBase: CGFloat = 176
    static let maxCount = 5

    static func scale(_ rank: Int) -> CGFloat { scales[min(max(rank, 0), scales.count - 1)] }
    static func drop(_ rank: Int) -> CGFloat { drops[min(max(rank, 0), drops.count - 1)] }
    static func tilt(_ rank: Int) -> Double { tilts[min(max(rank, 0), tilts.count - 1)] }
    static func dim(_ rank: Int) -> Double { dims[min(max(rank, 0), dims.count - 1)] }

    /// Ranks, left to right. Two cards read in priority order; three or more put rank 0 in the middle, rank 1 on
    /// its left, rank 2 on its right, rank 3 far left, rank 4 far right.
    static func screenOrder(count: Int) -> [Int] {
        let count = min(max(count, 0), maxCount)
        if count == 2 { return [0, 1] }
        var order: [Int] = []
        for rank in 0..<count {
            if rank == 0 { order = [0] } else if rank % 2 == 1 { order.insert(rank, at: 0) } else { order.append(rank) }
        }
        return order
    }

    private static func base(count: Int, width: CGFloat) -> CGFloat {
        let ranks = Array(0..<min(max(count, 0), maxCount))
        let total = ranks.reduce(0) { $0 + scale($1) }
        let gaps = gap * CGFloat(max(0, ranks.count - 1))
        return min(maxBase, (width - gaps) / max(total, 1))
    }

    static func isStacked(count: Int, width: CGFloat) -> Bool { count > 1 && base(count: count, width: width) < minBase }

    /// Card widths by rank.
    static func widths(count: Int, width: CGFloat) -> [CGFloat] {
        let count = min(max(count, 0), maxCount)
        if isStacked(count: count, width: width) {
            return (0..<count).map { min(width, 420) * min(1, scale($0) / scales[0] + 0.1) }
        }
        let b = base(count: count, width: width)
        return (0..<count).map { b * scale($0) }
    }

    /// Frames by rank, in the spread's own coordinates (origin top left, `width` wide).
    static func frames(widths: [CGFloat], heights: [CGFloat], width: CGFloat) -> [CGRect] {
        let count = min(widths.count, heights.count)
        if isStacked(count: count, width: width) {
            var y: CGFloat = 0
            return (0..<count).map { rank in
                defer { y += heights[rank] + 28 }
                return CGRect(x: (width - widths[rank]) / 2, y: y, width: widths[rank], height: heights[rank])
            }
        }
        let order = screenOrder(count: count)
        let used = order.reduce(0) { $0 + widths[$1] } + gap * CGFloat(max(0, order.count - 1))
        var x = max(0, (width - used) / 2)
        var frames = [CGRect](repeating: .zero, count: count)
        for rank in order {
            frames[rank] = CGRect(x: x, y: drop(rank), width: widths[rank], height: heights[rank])
            x += widths[rank] + gap
        }
        return frames
    }
}

/// Places the priority-ordered cards by HomePriorityPlan.
struct HomePriorityLayout: Layout {
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
        let widths = HomePriorityPlan.widths(count: subviews.count, width: width)
        let heights = zip(subviews, widths).map { $0.sizeThatFits(ProposedViewSize(width: $1, height: nil)).height }
        return HomePriorityPlan.frames(widths: widths, heights: heights, width: width)
    }
}
