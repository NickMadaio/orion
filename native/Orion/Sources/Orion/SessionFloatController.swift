import AppKit
import Combine
import SwiftUI
import ThinkingOrbsKit

/// The focus session, minimized: a small panel that floats over every app and
/// every desktop, like Atlas's recording float, and stays when the ORION window
/// is closed. Time left, pause, music, and the way back in (2026-10-06).
///
/// 2026-10-16 UI audit #1: whether the pill is up is one pure rule,
/// `SessionFloatPolicy`, re-evaluated on every change of the minimized flag AND
/// of the session snapshot, so a session that ends (finished, abandoned,
/// cleared) takes the pill down with it. A hidden panel whose last frame was
/// "24:57" is not a live pill, but it must not be left around either.
enum SessionFloatPolicy {
    static func isVisible(minimized: Bool, hasLiveSession: Bool) -> Bool {
        minimized && hasLiveSession
    }

    /// The minimized flag must not outlive the session, or the next session
    /// would open straight into a pill.
    static func shouldClearMinimized(minimized: Bool, hasLiveSession: Bool) -> Bool {
        minimized && !hasLiveSession
    }
}

final class SessionFloatController {
    private let state: AppState
    private let onExpand: () -> Void
    private var panel: NSPanel?
    private var watch: AnyCancellable?

    init(state: AppState, onExpand: @escaping () -> Void) {
        self.state = state
        self.onExpand = onExpand
        watch = state.$sessionMinimized
            .combineLatest(state.sessionTabModel.$snapshot.map { _ in () })
            .receive(on: RunLoop.main)
            .sink { [weak self] minimized, _ in self?.update(minimized: minimized) }
    }

    private func update(minimized: Bool) {
        let live = state.sessionTabModel.hasLiveSession
        if SessionFloatPolicy.isVisible(minimized: minimized, hasLiveSession: live) { show() } else { hide() }
        if SessionFloatPolicy.shouldClearMinimized(minimized: state.sessionMinimized, hasLiveSession: live) {
            state.sessionMinimized = false
        }
    }

    private func show() {
        if panel == nil { panel = makePanel() }
        panel?.orderFrontRegardless()
    }

    private func hide() { panel?.orderOut(nil) }

    private func makePanel() -> NSPanel {
        let panel = SessionFloatPanel(contentRect: NSRect(x: 0, y: 0, width: 640, height: 74),
                            styleMask: [.nonactivatingPanel, .borderless],
                            backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        let view = SessionFloatView(hologram: state.hologram, model: state.sessionTabModel) { [weak self] in
            self?.state.sessionMinimized = false
            self?.onExpand()
        }
        let hosting = FirstClickHostingView(rootView: view)
        panel.contentView = hosting
        panel.setContentSize(hosting.fittingSize)
        // Bottom middle of the screen to start; wherever he drags it after that.
        panel.setFrameAutosaveName("OrionSessionFloatBar")
        if !panel.setFrameUsingName("OrionSessionFloatBar"), let screen = NSScreen.main {
            let v = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: v.midX - panel.frame.width / 2, y: v.minY + 28))
        }
        return panel
    }
}

/// The floating session: one long, thin bar (Nick, 2026-10-06: "I liked the
/// longer view … on the bottom middle of my screen"), with the progress ring he
/// likes, the block, his music, pause and the way back in.
struct SessionFloatView: View {
    let hologram: HologramModel
    @ObservedObject var model: SessionTabModel
    let onExpand: () -> Void

    private let cyan = Color(red: 0.36, green: 0.83, blue: 0.93)

    var body: some View {
        // Its own once-a-second redraw: the panel is not inside the dashboard.
        TimelineView(.periodic(from: .now, by: 1)) { _ in bar }
    }

    private var bar: some View {
        HStack(spacing: 16) {
            ring
            VStack(alignment: .leading, spacing: 2) {
                Text(model.focusBlockLabel.uppercased()).font(OrionTheme.mono(8, .semibold)).tracking(1.4)
                    .foregroundStyle(cyan).lineLimit(1)
                Text(model.task ?? model.headline).font(.system(size: 13, weight: .medium)).lineLimit(1)
            }
            .frame(width: 150, alignment: .leading)
            .help(model.task ?? model.headline)

            if model.audioSource != .none {
                Rectangle().fill(Color.white.opacity(0.12)).frame(width: 1, height: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.mediaTitle).font(.system(size: 12, weight: .medium)).lineLimit(1)
                    Text(model.mediaArtist).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(width: 120, alignment: .leading)
                HStack(spacing: 12) {
                    Button { model.mediaPrevious() } label: { Image(systemName: "backward.fill") }.help("Previous")
                    Button { model.mediaPlayPause() } label: { Image(systemName: model.mediaIsPlaying ? "pause.fill" : "play.fill") }
                        .help(model.mediaIsPlaying ? "Pause music" : "Play music")
                    Button { model.mediaNext() } label: { Image(systemName: "forward.fill") }.help("Next")
                }
                .font(.system(size: 11, weight: .semibold))
            }

            Rectangle().fill(Color.white.opacity(0.12)).frame(width: 1, height: 28)
            Button { model.toggleSessionPause() } label: {
                Image(systemName: model.headline == "Paused" ? "play.fill" : "pause.fill")
                    .frame(width: 26, height: 26).overlay(Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 0.5))
            }.help(model.headline == "Paused" ? "Resume session" : "Pause session")
            Button(action: onExpand) {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .frame(width: 26, height: 26).overlay(Circle().strokeBorder(cyan.opacity(0.5), lineWidth: 0.5))
            }.foregroundStyle(cyan).help("Back to the focus session")
        }
        .buttonStyle(.plain)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(.white.opacity(0.92))
        .padding(.leading, 10).padding(.trailing, 14).padding(.vertical, 8)
        // 2026-10-16 UI audit #5/#8: real alpha, never a material (it rendered
        // as an opaque grey slab). A hairline edge, no filled slab.
        .background(Capsule().fill(Color.black.opacity(0.42)))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.14), lineWidth: 0.5))
        .padding(6)
        .preferredColorScheme(.dark)
        .fixedSize()
    }

    /// The circle: time left inside a progress ring, sized for the bar.
    private var ring: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.1), lineWidth: 1.5)
            Circle().trim(from: 0, to: min(1, max(0.012, model.phaseProgress)))
                .stroke(held == nil ? cyan : Color.white.opacity(0.14), style: StrokeStyle(lineWidth: 1.5))
                .rotationEffect(.degrees(-90))
            if let held {
                Text(held == "paused" ? "paused" : "wait")
                    .font(OrionTheme.mono(8, .medium)).foregroundStyle(.white.opacity(0.62))
            } else {
                Text(remaining).font(.system(size: 11, weight: .medium, design: .rounded)).monospacedDigit()
            }
        }
        .frame(width: 46, height: 46)
        .contentShape(Circle())
        .onTapGesture { model.toggleSessionPause() }
        .help(model.headline == "Paused" ? "Resume session" : "Pause session")
    }

    private var held: String? { model.heldLabel }

    private var remaining: String {
        let total = max(0, Int(model.phaseRemainingSeconds.rounded(.down)))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}


/// A borderless panel that can take a click. Borderless panels refuse key
/// status by default, and AppKit then drops clicks on its buttons (the float's
/// pause, expand and music buttons "aren't really working", 2026-10-06).
/// Non-activating still: clicking it never pulls focus away from his work app.
final class SessionFloatPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Buttons answer the first click, even when ORION is not the frontmost app.
final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
