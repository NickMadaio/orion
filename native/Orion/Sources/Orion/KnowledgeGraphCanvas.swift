import AppKit
import SwiftUI

/// The graph itself (2026-11-02 rebuild, after Sentient's Constellation view): one `TimelineView` + `Canvas`
/// (`SkyCanvasHost`) draws every star, thread, pulse, label and the hover card. This view only routes input and owns
/// the few things SwiftUI must: the selection ring's flight from the list, the zoom glyphs, and accessibility.
///
/// The model (`KnowledgeSky`) hangs off the store, which outlives this tab, so positions, camera and the played
/// entrance survive tab switches. Input:
/// - hover lights a node's threads, fades the rest and floats its card;
/// - drag a node to move it (its neighbours follow, and it stays where dropped); drag empty space to pan;
/// - two-finger scroll pans; pinch, ⌘-scroll or a wheel zoom at the cursor; a still click selects.
struct KnowledgeGraphCanvas: View {
    @ObservedObject var store: KnowledgeStore
    let ring: Namespace.ID
    let ringInList: Bool
    var snapshot = false
    /// Renders only: the instant the snapshot is drawn.
    var snapshotDate = Date()

    @Environment(\.knowledgePalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var onScreen = false
    @State private var windowVisible = true
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    /// The SwiftUI ring is flying from the list; the Canvas takes over the ring once it lands.
    @State private var ringLanded = true
    @State private var gesture: DragMode?

    private enum DragMode: Equatable { case node(Int), pan(CGSize) }

    private var sky: KnowledgeSky { store.sky }
    private var ambient: Bool { !reduceMotion && !lowPower }
    private var searchActive: Bool { !store.query.text.trimmingCharacters(in: .whitespaces).isEmpty }

    private var style: SkyStyle {
        SkyStyle(palette: palette, showSelectionRing: !ringInList && ringLanded, searchActive: searchActive)
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                if snapshot {
                    Canvas { context, size in
                        prepareStill(size: size)
                        SkyRenderer.draw(context, sky: sky, size: size, style: style)
                    }
                } else {
                    SkyCanvasHost(sky: sky, invalidator: sky.invalidator, style: style, active: onScreen && windowVisible, ambient: ambient)
                }
                flyingRing(size)
            }
            .contentShape(Rectangle())
            .gesture(dragGesture(size))
            .onContinuousHover(coordinateSpace: .local) { phase in hover(phase, size: size) }
            .background {
                if !snapshot {
                    SkyEventCatcher(onZoom: { sky.zoom(by: $0, at: $1, size: size) },
                                    onPan: { sky.pan(by: $0, size: size) },
                                    onVisibility: { windowVisible = $0 })
                }
            }
            .overlay(alignment: .bottomTrailing) {
                SkyZoomControls(readout: sky.readout, palette: palette,
                                onZoom: { sky.glideZoom(by: $0, size: size) }, onHome: { sky.glideHome() })
            }
            .accessibilityElement(children: .contain)
            .accessibilityChildren { accessibleNodes }
        }
        .clipped()
        .onAppear(perform: appear)
        .onDisappear { onScreen = false; sky.setHovered(nil); NSCursor.arrow.set() }
        .onChange(of: store.graph) { _, next in sky.load(next, now: Date(), animated: !reduceMotion) }
        .onChange(of: store.selectedID) { _, next in sky.selectedID = next }
        .onChange(of: store.query) { _, _ in sky.setVisible(visibleIDs) }
        .onChange(of: reduceMotion) { _, _ in configureMotion() }
        .onChange(of: lowPower) { _, _ in configureMotion() }
        .onChange(of: ringInList) { _, inList in
            if inList { ringLanded = false; return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { ringLanded = true }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
    }

    // MARK: Model wiring

    /// The nodes the index's filters leave on the canvas: him always, hidden ones only when asked for.
    private var visibleIDs: Set<String> {
        let shown = Set(store.query.visibleNodes(in: store.graph).map(\.id) + ["person:self"])
        return Set(store.graph.nodes.filter { shown.contains($0.id) && ($0.hidden != true || store.query.showHidden) }.map(\.id))
    }

    private func appear() {
        onScreen = true
        configureMotion()
        sky.load(store.graph, now: Date(), animated: !reduceMotion)
        sky.setVisible(visibleIDs)
        sky.selectedID = store.selectedID
        sky.readout.show(sky.camera.zoom)
    }

    private func configureMotion() {
        sky.animated = !reduceMotion
        sky.ambient = ambient
        sky.wake()
    }

    /// A render has no onAppear and no timeline: set the sky up and bring it to rest inline.
    private func prepareStill(size: CGSize) {
        sky.ambient = false
        sky.load(store.graph, now: snapshotDate, animated: false)
        sky.setVisible(visibleIDs)
        sky.selectedID = store.selectedID
        sky.tick(snapshotDate, size: size)
    }

    // MARK: Input

    private func hover(_ phase: HoverPhase, size: CGSize) {
        let point: CGPoint? = if case .active(let p) = phase { p } else { nil }
        guard sky.hover(at: point, size: size) else { return }
        (sky.hovered == nil ? NSCursor.arrow : NSCursor.pointingHand).set()
    }

    private func dragGesture(_ size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let mode = gesture ?? sky.hitTest(value.startLocation, size: size).map(DragMode.node) ?? .pan(sky.camera.pan)
                if gesture == nil { gesture = mode }
                guard hypot(value.translation.width, value.translation.height) > 3 else { return }
                switch mode {
                case .node(let i): sky.drag(i, to: value.location, size: size)
                case .pan(let start):
                    sky.setPan(CGSize(width: start.width + value.translation.width, height: start.height + value.translation.height), size: size)
                }
            }
            .onEnded { value in
                defer { gesture = nil }
                if hypot(value.translation.width, value.translation.height) <= 3 {
                    select(sky.hitTest(value.location, size: size).map { sky.nodes[$0].id })
                } else if case .node = gesture {
                    sky.endDrag(size: size)
                }
            }
    }

    private func select(_ id: String?) {
        if reduceMotion { store.selectedID = id; return }
        withAnimation(OrionMotion.select) { store.selectedID = id }
    }

    // MARK: SwiftUI-owned marks

    /// The ring that travels from the list row to the node (`matchedGeometryEffect`). Visible only in flight; once it
    /// lands the Canvas draws the ring, so it tracks the node through pans, zooms and drags.
    @ViewBuilder private func flyingRing(_ size: CGSize) -> some View {
        if let id = store.selectedID, !ringInList, let i = sky.index[id], let p = sky.screenPoint(i, size: size) {
            let d = (sky.radius(i) * sky.starScale + 6) * 2
            Circle().stroke(palette.color(sky.nodes[i].kind), lineWidth: 1.2)
                .frame(width: d, height: d)
                .matchedGeometryEffect(id: "knowledge.ring", in: ring)
                .position(p)
                .opacity(ringLanded ? 0 : 1)
                .animation(reduceMotion ? nil : OrionMotion.hover, value: ringLanded)
                .allowsHitTesting(false)
        }
    }

    private var accessibleNodes: some View {
        ForEach(store.graph.nodes.filter { visibleIDs.contains($0.id) }) { node in
            Rectangle()
                .accessibilityLabel("\(node.kind.singular): \(node.label)")
                .accessibilityAddTraits(store.selectedID == node.id ? [.isSelected, .isButton] : .isButton)
                .accessibilityAction { select(node.id) }
        }
    }
}
