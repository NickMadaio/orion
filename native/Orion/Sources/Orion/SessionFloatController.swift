import AppKit
import Combine
import SwiftUI
import ThinkingOrbsKit

/// The focus session, minimized: a small panel that floats over every app and
/// every desktop, like Atlas's recording float, and stays when the ORION window
/// is closed. Time left, pause, music, and the way back in (2026-10-06).
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
        if minimized && state.sessionTabModel.isActiveFocus { show() } else { hide() }
        if !state.sessionTabModel.isActiveFocus && state.sessionMinimized { state.sessionMinimized = false }
    }

    private func show() {
        if panel == nil { panel = makePanel() }
        panel?.orderFrontRegardless()
    }

    private func hide() { panel?.orderOut(nil) }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 160),
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
        panel.isReleasedWhenClosed = false
        let view = SessionFloatView(hologram: state.hologram, model: state.sessionTabModel) { [weak self] in
            self?.state.sessionMinimized = false
            self?.onExpand()
        }
        let hosting = NSHostingView(rootView: view)
        panel.contentView = hosting
        panel.setContentSize(hosting.fittingSize)
        panel.setFrameAutosaveName("OrionSessionFloat")
        if !panel.setFrameUsingName("OrionSessionFloat"), let screen = NSScreen.main {
            let v = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: v.maxX - 440, y: v.maxY - 140))
        }
        return panel
    }
}

/// The floating session: the circle timer he likes, the block, pause and the
/// way back in, and his music.
struct SessionFloatView: View {
    let hologram: HologramModel
    @ObservedObject var model: SessionTabModel
    let onExpand: () -> Void

    var body: some View {
        // Its own once-a-second redraw: the panel is not inside the dashboard,
        // whose re-renders drive the full session screen's clock.
        TimelineView(.periodic(from: .now, by: 1)) { _ in content }
    }

    private var content: some View {
        HStack(spacing: 14) {
            FocusTimerDial(diameter: 118, progress: min(1, max(0.012, model.phaseProgress)),
                           remaining: remaining, phase: model.focusBlockLabel)
                .frame(width: 118, height: 118)
                .contentShape(Circle())
                .onTapGesture { model.toggleSessionPause() }
                .help(model.headline == "Paused" ? "Resume session" : "Pause session")
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    HologramView(model: hologram).frame(width: 22, height: 22).clipShape(Circle())
                    Text(model.headline.uppercased()).font(OrionTheme.mono(8, .semibold)).tracking(1.6)
                        .foregroundStyle(Color(red: 0.36, green: 0.83, blue: 0.93))
                    Spacer(minLength: 6)
                    Button { model.toggleSessionPause() } label: {
                        Image(systemName: model.headline == "Paused" ? "play.fill" : "pause.fill")
                    }.help(model.headline == "Paused" ? "Resume" : "Pause")
                    Button(action: onExpand) { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                        .help("Back to the focus session")
                }
                if model.audioSource != .none {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(model.mediaTitle).font(.system(size: 12, weight: .medium)).lineLimit(1)
                        Text(model.mediaArtist).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    HStack(spacing: 18) {
                        Button { model.mediaPrevious() } label: { Image(systemName: "backward.fill") }.help("Previous")
                        Button { model.mediaPlayPause() } label: { Image(systemName: model.mediaIsPlaying ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 20)) }
                            .help(model.mediaIsPlaying ? "Pause music" : "Play music")
                        Button { model.mediaNext() } label: { Image(systemName: "forward.fill") }.help("Next")
                    }
                } else {
                    Text("No music playing").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white.opacity(0.9))
            .frame(width: 190, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
        .padding(8)
        .preferredColorScheme(.dark)
        .fixedSize()
    }

    private var remaining: String {
        let total = max(0, Int(model.phaseRemainingSeconds.rounded(.down)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
