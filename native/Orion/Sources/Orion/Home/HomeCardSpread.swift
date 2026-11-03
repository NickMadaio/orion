import OrionViews
import SwiftUI

/*
 The card spread: a few cards laid down by hand rather than snapped to a grid. Each slot has a small fixed tilt
 (within ±1.5°), its own width and a nudge up or down, and a short second row sits half a column over, like
 bricks. Deterministic, so the same cards land in the same places on every render and nothing jumps on refresh.

 (FinanceTab still uses this brick spread; Home's own cards use HomePriorityLayout.)

 The cards deal in on the shared schedule (ViewMotion.dealDelay), each with SoftReveal.
*/

enum HomeSpreadGeometry {
    struct Slot: Equatable {
        let row: Int
        let column: Int
        /// Of the column's width.
        let widthFactor: CGFloat
        /// Degrees.
        let rotation: Double
        let xOffset: CGFloat
        let yOffset: CGFloat
    }

    // Hand-tuned; read across as slot 0…5.
    private static let rotations: [Double] = [-1.2, 0.8, -0.5, 0.9, -0.7, 1.1]
    private static let widths: [CGFloat] = [0.96, 1.0, 0.93, 0.98, 1.0, 0.94]
    private static let xNudges: [CGFloat] = [14, 0, -10, -8, 6, 12]
    private static let yNudges: [CGFloat] = [26, 0, 12, 0, 18, -4]

    /// One column for one card; two over two for four; otherwise three across when there is room.
    static func columns(count: Int, width: CGFloat) -> Int {
        if count <= 1 || width < 640 { return 1 }
        if count == 2 || count == 4 || width < 1_060 { return 2 }
        return 3
    }

    static func slots(count: Int, columns: Int) -> [Slot] {
        let columns = max(1, columns)
        return (0..<max(0, count)).map { index in
            let pattern = index % rotations.count
            return Slot(row: index / columns, column: index % columns, widthFactor: widths[pattern], rotation: rotations[pattern],
                        xOffset: xNudges[pattern], yOffset: yNudges[pattern])
        }
    }
}

/// Places the cards: each row as tall as its tallest card, cards sized to their slot's width, the short last row
/// shifted half a column so it never reads as a gap in a grid.
struct HomeSpreadLayout: Layout {
    var columnGap: CGFloat = 34
    var rowGap: CGFloat = 40

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 1_100
        let frames = place(width: width, subviews: subviews)
        let height = frames.map(\.maxY).max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, frame) in zip(subviews, place(width: bounds.width, subviews: subviews)) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                          proposal: ProposedViewSize(width: frame.width, height: frame.height))
        }
    }

    private func place(width: CGFloat, subviews: Subviews) -> [CGRect] {
        let columns = HomeSpreadGeometry.columns(count: subviews.count, width: width)
        let slots = HomeSpreadGeometry.slots(count: subviews.count, columns: columns)
        let columnWidth = (width - columnGap * CGFloat(columns - 1)) / CGFloat(columns)
        let sizes = zip(subviews, slots).map { subview, slot -> CGSize in
            let cardWidth = columnWidth * slot.widthFactor
            return CGSize(width: cardWidth, height: subview.sizeThatFits(ProposedViewSize(width: cardWidth, height: nil)).height)
        }
        let rows = (slots.map(\.row).max() ?? -1) + 1
        var frames: [CGRect] = []
        var top: CGFloat = 0
        for row in 0..<rows {
            let members = slots.indices.filter { slots[$0].row == row }
            let rowHeight = members.map { sizes[$0].height + max(0, slots[$0].yOffset) }.max() ?? 0
            // A short row sits between the columns above it.
            let shift = CGFloat(columns - members.count) * (columnWidth + columnGap) / 2
            for index in members {
                let slot = slots[index], size = sizes[index]
                let x = shift + CGFloat(slot.column) * (columnWidth + columnGap) + (columnWidth - size.width) / 2 + slot.xOffset
                frames.append(CGRect(x: max(0, min(width - size.width, x)), y: top + max(0, slot.yOffset), width: size.width, height: size.height))
            }
            top += rowHeight + rowGap
        }
        return frames
    }
}

/// The spread itself, or the calm line when there is nothing to say. Cards arrive in priority order: the first is
/// the sun: the centre, largest card (HomePriorityPlan). A reorder or a resize moves them on a spring; Reduce Motion cross-fades.
struct HomeCardSpread: View {
    let cards: [HomeCard]
    /// The room under the greeting and above the glance row; the cluster shrinks to fit it.
    var maxHeight: CGFloat?
    let onAction: (HomeCardAction) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if cards.isEmpty {
            Text("Nothing needs you right now.")
                .font(OrionTheme.serif(22))
                .foregroundStyle(OrionTheme.textSoft)
                .frame(maxWidth: .infinity, minHeight: 220)
                .softReveal(delay: 0.2)
        } else {
            let shown = Array(cards.prefix(HomePriorityPlan.maxCount))
            HomePriorityLayout(maxHeight: maxHeight) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { rank, card in
                    HomeCardView(card: card, rank: rank, onAction: onAction)
                        .rotationEffect(.degrees(HomePriorityPlan.tilt(rank)))
                        .deal(order: rank, rise: 22)
                        .anchorPreference(key: HomeSunBoundsKey.self, value: .bounds) { rank == 0 ? $0 : nil }
                }
            }
            .animation(reduceMotion ? .easeInOut(duration: 0.2) : Self.reorder, value: shown.map(\.id))
        }
    }

    static let reorder = Animation.spring(response: 0.6, dampingFraction: 0.78)
}
