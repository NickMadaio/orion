import SwiftUI

/// The drawer follows the finger. One `progress` (0 closed ... 1 open) drives the
/// drawer offset, the dim over the chat and the chat's own small parallax. A drag
/// from the left edge opens it, a horizontal drag anywhere closes it; on release
/// the projected end decides (so a quick flick commits) and a spring finishes.
/// A new drag takes over a settling one where it is.
struct PhoneDrawerHost<Content: View, Drawer: View>: View {
    @Binding var open: Bool
    @ViewBuilder let content: () -> Content
    @ViewBuilder let drawer: () -> Drawer
    @State private var progress: CGFloat
    @State private var dragging = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let width: CGFloat = 300
    private let edge: CGFloat = 24
    /// How far the chat slides with the drawer, as a share of the drawer's width.
    private let parallax: CGFloat = 0.22

    init(open: Binding<Bool>, @ViewBuilder content: @escaping () -> Content, @ViewBuilder drawer: @escaping () -> Drawer) {
        _open = open
        self.content = content
        self.drawer = drawer
        var start: CGFloat = open.wrappedValue ? 1 : 0
        #if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--drawer-half") { start = 0.5 }   // design review only
        #endif
        _progress = State(initialValue: start)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            content()
                .offset(x: progress * width * parallax)
                .allowsHitTesting(progress < 0.01)
            Color.black.opacity(0.45 * progress).ignoresSafeArea()
                .offset(x: progress * width * parallax)
                .allowsHitTesting(progress > 0.01).onTapGesture { settle(to: false) }
            drawer().frame(width: width)
                .offset(x: -(1 - progress) * (width + 2))
                .allowsHitTesting(progress > 0.01)
        }
        .simultaneousGesture(drag)
        .onChange(of: open) { _, now in if !dragging { glide(to: now ? 1 : 0) } }
        .sensoryFeedback(.impact(weight: .light), trigger: open)
    }

    private var base: CGFloat { open ? 1 : 0 }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                if !dragging {
                    // Claim the gesture only for a horizontal drag that starts at the edge, or on an open drawer.
                    guard open || value.startLocation.x < edge, abs(value.translation.width) > abs(value.translation.height) else { return }
                    dragging = true
                }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { progress = clamp(base + value.translation.width / width) }
            }
            .onEnded { value in
                guard dragging else { return }
                dragging = false
                settle(to: clamp(base + value.predictedEndTranslation.width / width) > 0.5)
            }
    }

    private func settle(to target: Bool) {
        glide(to: target ? 1 : 0)
        if open != target { open = target }
    }

    private func glide(to target: CGFloat) {
        withAnimation(PhoneMotion.spring(PhoneMotion.drawer, reduce: reduceMotion)) { progress = target }
    }

    private func clamp(_ value: CGFloat) -> CGFloat { min(1, max(0, value)) }
}
