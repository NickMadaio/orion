import SwiftUI

/// Runs the layout: animated to rest at display rate, or straight to rest under Reduce Motion (and for renders).
@MainActor
final class KnowledgeSimulation: ObservableObject {
    @Published private(set) var layout: KnowledgeLayout?
    private var timer: Timer?
    private var graph: KnowledgeGraph = .empty

    func run(_ graph: KnowledgeGraph, size: CGSize, animated: Bool) {
        guard size.width > 40, size.height > 40 else { return }
        let sameNodes = Set(graph.nodes.map(\.id)) == Set(self.graph.nodes.map(\.id))
        self.graph = graph
        if let layout, sameNodes, layout.size == size, layout.isSettled { return }
        if let layout, sameNodes, layout.size != size {
            self.layout = layout.resized(to: size)
            return
        }
        timer?.invalidate()
        guard animated else { layout = .settled(graph, size: size); return }
        layout = .initial(graph, size: size)
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func tick() {
        guard var next = layout else { return }
        // Three physics steps per frame: a settle of about three seconds, which reads as calm rather than slow.
        for _ in 0..<3 { next = next.stepped(graph) }
        layout = next
        if next.isSettled { timer?.invalidate(); timer = nil }
    }

    func stop() { timer?.invalidate(); timer = nil }
}

/// The graph itself: edges in a Canvas (cheap, hundreds of lines), nodes as views (so selection can spring and the
/// selection ring can travel between the list and the graph with `matchedGeometryEffect`).
struct KnowledgeGraphCanvas: View {
    @ObservedObject var store: KnowledgeStore
    @ObservedObject var simulation: KnowledgeSimulation
    let ring: Namespace.ID
    let ringInList: Bool
    var snapshot = false

    @Environment(\.knowledgePalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pan: CGSize = .zero
    @State private var panStart: CGSize?
    @State private var zoom: CGFloat = 1
    @State private var zoomStart: CGFloat?
    @State private var hovered: String?

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let shown = shownGraph
            ZStack {
                Color.clear.contentShape(Rectangle())
                    .onTapGesture { select(nil) }
                // A render cannot wait for onAppear or a timer: it settles the layout inline.
                if let layout = snapshot ? KnowledgeLayout.settled(store.graph, size: size) : simulation.layout {
                    edges(shown, layout: layout, size: size)
                    ForEach(shown.nodes) { node in
                        if let point = layout.positions[node.id] {
                            nodeView(node, degree: degrees[node.id] ?? 0)
                                .position(place(point, in: size))
                        }
                    }
                }
            }
            .gesture(panGesture)
            .simultaneousGesture(zoomGesture)
            .onAppear { simulation.run(store.graph, size: size, animated: !reduceMotion && !snapshot) }
            .onChange(of: size) { _, next in simulation.run(store.graph, size: next, animated: !reduceMotion && !snapshot) }
            .onChange(of: store.graph) { _, next in simulation.run(next, size: size, animated: !reduceMotion && !snapshot) }
            .overlay(alignment: .bottomTrailing) { zoomControls }
        }
        .clipped()
    }

    // MARK: What is drawn

    /// The graph as the filters leave it: hidden edges never, nodes the query excludes faded out of the layout.
    private var shownGraph: KnowledgeGraph {
        let visible = Set(store.query.visibleNodes(in: store.graph).map(\.id) + ["person:self"])
        let nodes = store.graph.nodes.filter { visible.contains($0.id) && ($0.hidden != true || store.query.showHidden) }
        let ids = Set(nodes.map(\.id))
        return KnowledgeGraph(nodes: nodes, edges: store.graph.edges.filter { $0.hidden != true && ids.contains($0.from) && ids.contains($0.to) })
    }

    private var degrees: [String: Int] { store.graph.degrees }

    private var neighbours: Set<String> {
        guard let id = store.selectedID else { return [] }
        return Set(store.graph.connections(of: id).map(\.other.id)).union([id])
    }

    private func place(_ point: CGPoint, in size: CGSize) -> CGPoint {
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        return CGPoint(x: c.x + (point.x - c.x) * zoom + pan.width, y: c.y + (point.y - c.y) * zoom + pan.height)
    }

    private func edges(_ graph: KnowledgeGraph, layout: KnowledgeLayout, size: CGSize) -> some View {
        let focus = neighbours
        let kinds = Dictionary(graph.nodes.map { ($0.id, $0.kind) }, uniquingKeysWith: { a, _ in a })
        return Canvas { context, _ in
            for edge in graph.edges {
                guard let a = layout.positions[edge.from], let b = layout.positions[edge.to] else { continue }
                let pa = place(a, in: size), pb = place(b, in: size)
                let lit = store.selectedID != nil && (edge.from == store.selectedID || edge.to == store.selectedID)
                let dimmed = store.selectedID != nil && !lit
                var path = Path()
                path.move(to: pa)
                // A slight bow, so parallel edges from him do not read as one ruled sheet.
                let mid = CGPoint(x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2)
                let bow = CGFloat(KnowledgeLayout.hash(edge.id) % 21) - 10
                let nx = -(pb.y - pa.y), ny = pb.x - pa.x
                let len = max(hypot(nx, ny), 1)
                path.addQuadCurve(to: pb, control: CGPoint(x: mid.x + nx / len * bow, y: mid.y + ny / len * bow))
                if lit {
                    let ca = palette.color(kinds[edge.from] ?? .goal), cb = palette.color(kinds[edge.to] ?? .goal)
                    context.stroke(path, with: .linearGradient(Gradient(colors: [ca.opacity(0.85), cb.opacity(0.85)]), startPoint: pa, endPoint: pb),
                                   style: StrokeStyle(lineWidth: 1.1, lineCap: .round))
                } else {
                    let dashed = edge.kind == "said-together"
                    context.stroke(path, with: .color(palette.edge.opacity(dimmed ? 0.35 : 1)),
                                   style: StrokeStyle(lineWidth: 0.6, lineCap: .round, dash: dashed ? [2, 3] : []))
                }
            }
            _ = focus
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func nodeView(_ node: KnowledgeNode, degree: Int) -> some View {
        let selected = store.selectedID == node.id
        let near = neighbours.contains(node.id)
        let faded = store.selectedID != nil && !near
        let tint = palette.color(node.kind)
        let radius = node.isSelf ? 13 : min(11, 3.5 + sqrt(Double(degree)) * 1.6)
        // Every node is named; the ones that matter now are named louder.
        let prominent = node.isSelf || selected || near || hovered == node.id || degree >= 4 || zoom > 1.35
            || !store.query.text.trimmingCharacters(in: .whitespaces).isEmpty
        let box = radius * 2 + 14
        ZStack {
            if node.isSelf {
                Circle().stroke(tint.opacity(0.28), lineWidth: 0.8).frame(width: radius * 3.4, height: radius * 3.4)
            }
            Circle().fill(tint.opacity(selected ? 0.22 : 0.07)).frame(width: radius * 2, height: radius * 2)
                .blur(radius: selected ? 6 : 0)
            Circle().strokeBorder(tint.opacity(node.hidden == true ? 0.35 : 0.9), lineWidth: node.isSelf ? 1.6 : 1.1)
                .frame(width: radius * 2, height: radius * 2)
            Circle().fill(tint).frame(width: max(2.4, radius * 0.55), height: max(2.4, radius * 0.55))
            if selected && !ringInList {
                Circle().stroke(tint, lineWidth: 1.2)
                    .frame(width: radius * 2 + 12, height: radius * 2 + 12)
                    .matchedGeometryEffect(id: "knowledge.ring", in: ring)
                    .shadow(color: tint.opacity(0.6), radius: 8)
            }
        }
        .frame(width: box, height: box)
        .scaleEffect(selected ? 1.18 : (hovered == node.id ? 1.08 : 1))
        // The label hangs below the ring so the ring, not the pair, sits on the node's point.
        .overlay(alignment: .top) {
            Text(selected || node.label.count <= 20 ? node.label : String(node.label.prefix(18)) + "…")
                .font(.system(size: node.isSelf ? 13 : (selected ? 12 : (prominent ? 10.5 : 9.5)),
                              weight: node.isSelf || selected ? .semibold : .medium, design: .rounded))
                .foregroundStyle(selected ? palette.text : (prominent ? palette.textSoft : palette.textDim))
                .lineLimit(1)
                .fixedSize()
                .shadow(color: (palette.isDark ? Color.black : Color.white).opacity(0.8), radius: 3)
                .offset(y: box - (node.isSelf ? 0 : 4))
                .allowsHitTesting(false)
        }
        .opacity(faded ? 0.28 : 1)
        .contentShape(Circle().inset(by: -6))
        .onTapGesture { select(node.id) }
        .onHover { hovered = $0 ? node.id : (hovered == node.id ? nil : hovered) }
        .animation(reduceMotion ? nil : OrionMotion.select, value: selected)
        .animation(reduceMotion ? nil : OrionMotion.hover, value: hovered)
        .animation(reduceMotion ? nil : OrionMotion.fade, value: faded)
        .accessibilityElement()
        .accessibilityLabel("\(node.kind.singular): \(node.label)")
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }

    private func select(_ id: String?) {
        if reduceMotion { store.selectedID = id; return }
        withAnimation(OrionMotion.select) { store.selectedID = id }
    }

    // MARK: Pan and zoom

    private var panGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                let start = panStart ?? pan
                panStart = start
                pan = CGSize(width: start.width + value.translation.width, height: start.height + value.translation.height)
            }
            .onEnded { _ in panStart = nil }
    }

    private var zoomGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = zoomStart ?? zoom
                zoomStart = start
                zoom = min(3, max(0.5, start * value.magnification))
            }
            .onEnded { _ in zoomStart = nil }
    }

    private var zoomControls: some View {
        HStack(spacing: 14) {
            zoomButton("minus") { zoom = max(0.5, zoom / 1.25) }
            Text("\(Int((zoom * 100).rounded()))%").font(OrionTheme.mono(9)).foregroundStyle(palette.textDim).frame(width: 34)
            zoomButton("plus") { zoom = min(3, zoom * 1.25) }
            zoomButton("scope") { pan = .zero; zoom = 1 }
        }
        .padding(.trailing, 18).padding(.bottom, 14)
    }

    private func zoomButton(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            if reduceMotion { action() } else { withAnimation(OrionMotion.select, action) }
        } label: {
            Image(systemName: symbol).font(.system(size: 10, weight: .semibold)).foregroundStyle(palette.textSoft)
                .frame(width: 18, height: 18).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
