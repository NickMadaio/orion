import SwiftUI

/// Node names and the hover card, drawn last.
///
/// Labels go down in priority order — Nick, the selected node, the hovered one, the focus's neighbours, then busiest
/// first — and any that would overlap a label already drawn, or the hover card, is skipped. Quiet labels are also
/// zoom-gated: zoomed out, only the ones that matter now are named.
///
/// The hover card has no plate: the kind in tracked mono caps over a hairline that fades, the name in serif, then
/// the first two facts in soft ink. It floats beside the node on whichever side has room.
@MainActor
enum SkyLabels {
    static func draw(_ context: GraphicsContext, _ f: SkyFrame) {
        let card = cardLayout(context, f)
        var taken: [CGRect] = card.map { [$0.frame.insetBy(dx: -6, dy: -6)] } ?? []
        // A name never prints over another star either.
        let stars: [(Int, CGRect)] = f.points.indices.compactMap { i in
            guard f.sky.visible[i] else { return nil }
            let r = f.sky.radius(i) * f.scale + 1
            return (i, CGRect(x: f.points[i].x - r, y: f.points[i].y - r, width: r * 2, height: r * 2))
        }
        for i in order(f) where f.sky.visible[i] {
            drawLabel(context, f, i, taken: &taken, stars: stars)
        }
        if let card { drawCard(context, f, card) }
    }

    // MARK: Labels

    private static func order(_ f: SkyFrame) -> [Int] {
        var seen = Array(repeating: false, count: f.sky.nodes.count)
        var out: [Int] = []
        func add(_ i: Int?) { if let i, !seen[i] { seen[i] = true; out.append(i) } }
        add(f.sky.index["person:self"])
        add(f.sky.selectedID.flatMap { f.sky.index[$0] })
        add(f.sky.hovered)
        if let focus = f.sky.hovered ?? f.sky.selectedID.flatMap({ f.sky.index[$0] }) { f.sky.neighbours[focus].forEach(add) }
        f.sky.byDegree.forEach(add)
        return out
    }

    private static func drawLabel(_ context: GraphicsContext, _ f: SkyFrame, _ i: Int, taken: inout [CGRect], stars: [(Int, CGRect)]) {
        let node = f.sky.nodes[i]
        let selected = f.sky.selectedID == node.id
        let focus = f.sky.hovered ?? f.sky.selectedID.flatMap { f.sky.index[$0] }
        let near = focus.map { $0 == i || f.sky.neighbours[$0].contains(i) } ?? false
        let prominent = node.isSelf || selected || near || f.sky.degree[i] >= 4 || f.sky.camera.zoom > 1.35 || f.style.searchActive
        guard prominent || f.sky.camera.zoom >= 0.8 else { return }
        let size: CGFloat = node.isSelf ? 13 : (selected ? 12 : (prominent ? 10.5 : 9.5))
        let weight: Font.Weight = node.isSelf || selected ? .semibold : .medium
        let full = selected || f.sky.hovered == i || node.label.count <= 20
        let title = full ? node.label : String(node.label.prefix(18)) + "…"
        let key = "\(title)|\(size)|\(weight == .semibold)"
        let p = f.points[i]
        let r = f.sky.radius(i) * f.scale
        let top = p.y + (node.isSelf ? r * 1.7 : r) + 4

        // Measure from the cache when we can, so a label that will be skipped is never resolved.
        let ink = selected ? f.style.palette.text : (prominent ? f.style.palette.textSoft : f.style.palette.textDim)
        let text = Text(title).font(.system(size: size, weight: weight, design: .rounded)).foregroundColor(ink)
        var resolved: GraphicsContext.ResolvedText?
        let measured: CGSize
        if let cached = f.sky.labelSizes[key] {
            measured = cached
        } else {
            let r = context.resolve(text)
            measured = r.measure(in: CGSize(width: 400, height: 60))
            f.sky.labelSizes[key] = measured
            resolved = r
        }
        let rect = CGRect(x: p.x - measured.width / 2, y: top, width: measured.width, height: measured.height)
        let padded = rect.insetBy(dx: -3, dy: -1)
        guard !taken.contains(where: { $0.intersects(padded) }),
              !stars.contains(where: { $0.0 != i && $0.1.intersects(padded) }) else { return }
        taken.append(padded)
        var layer = context
        layer.opacity = f.sky.light[i] * f.sky.starReveal
        layer.draw(resolved ?? context.resolve(text), at: CGPoint(x: p.x, y: top), anchor: .top)
    }

    // MARK: Hover card

    struct Card {
        let frame: CGRect
        let kind: GraphicsContext.ResolvedText
        let title: GraphicsContext.ResolvedText
        let facts: [(GraphicsContext.ResolvedText, CGSize)]
        let kindHeight: CGFloat, titleHeight: CGFloat
        let tint: Color
        let leftSide: Bool
    }

    static let cardWidth: CGFloat = 230

    private static func cardLayout(_ context: GraphicsContext, _ f: SkyFrame) -> Card? {
        guard let i = f.sky.cardIndex, f.sky.card > 0.01, f.sky.visible[i] else { return nil }
        let node = f.sky.nodes[i]
        let palette = f.style.palette
        let tint = palette.color(node.kind)
        let kind = context.resolve(Text(node.kind.singular.uppercased()).font(OrionTheme.mono(9, .semibold)).tracking(2).foregroundColor(tint))
        let title = context.resolve(Text(node.label).font(.system(size: 16, weight: .medium, design: .serif)).foregroundColor(palette.text))
        let bound = CGSize(width: cardWidth, height: 120)
        let kindSize = kind.measure(in: bound), titleSize = title.measure(in: bound)
        let kindHeight = kindSize.height, titleHeight = titleSize.height
        let lines = (node.subtitle.map { [$0] } ?? []) + node.facts.prefix(2).map(\.text)
        let facts = lines.prefix(2).map { line -> (GraphicsContext.ResolvedText, CGSize) in
            let short = line.count > 90 ? String(line.prefix(88)) + "…" : line
            let text = context.resolve(Text(short).font(.system(size: 11.5)).foregroundColor(palette.textSoft))
            return (text, text.measure(in: CGSize(width: cardWidth, height: 32)))
        }
        // Left-aligned always; on the left of a node the block is as wide as its widest line, so it ends near the node.
        let width = min(cardWidth, max(150, kindSize.width, titleSize.width, facts.map(\.1.width).max() ?? 0))
        let height = kindHeight + 9 + titleHeight + facts.reduce(0) { $0 + $1.1.height + 4 } + 4
        let p = f.points[i]
        let r = f.sky.radius(i) * f.scale
        // Outward from him, where the node's threads are not: most of them run back toward the centre.
        let rightX = p.x + r + 18, leftX = p.x - r - 18 - width
        let outwardLeft = p.x < f.size.width / 2
        let leftSide = outwardLeft ? leftX >= 10 : rightX + width > f.size.width - 10
        let x = leftSide ? leftX : rightX
        let y = min(max(8, p.y - kindHeight - 6), f.size.height - height - 8)
        return Card(frame: CGRect(x: x, y: y, width: width, height: height), kind: kind, title: title, facts: facts,
                    kindHeight: kindHeight, titleHeight: titleHeight, tint: tint, leftSide: leftSide)
    }

    private static func drawCard(_ context: GraphicsContext, _ f: SkyFrame, _ card: Card) {
        var layer = context
        layer.opacity = f.sky.card
        // Arrives from the node's side by a few points as it fades in.
        layer.translateBy(x: (1 - f.sky.card) * (card.leftSide ? 6 : -6), y: 0)
        let o = card.frame.origin
        layer.draw(card.kind, at: o, anchor: .topLeading)
        let ruleY = o.y + card.kindHeight + 4
        let rule = CGRect(x: o.x, y: ruleY, width: 150, height: 0.5)
        layer.fill(Path(rule), with: .linearGradient(Gradient(colors: [card.tint.opacity(0.55), card.tint.opacity(0)]),
                                                     startPoint: CGPoint(x: rule.minX, y: ruleY), endPoint: CGPoint(x: rule.maxX, y: ruleY)))
        var y = ruleY + 5
        layer.draw(card.title, at: CGPoint(x: o.x, y: y), anchor: .topLeading)
        y += card.titleHeight + 4
        for (text, size) in card.facts {
            layer.draw(text, in: CGRect(x: o.x, y: y, width: card.frame.width, height: size.height))
            y += size.height + 4
        }
    }
}
