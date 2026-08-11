//
//  The break, as a small window that is hard to ignore and easy to dismiss.
//
//  This is where the plan's seventh correction lands, and it is worth restating
//  because the original brief asked for three things that cannot all be true:
//
//    "Escape always works" + "non-activating panel" + "no new permission"
//
//  A non-activating panel does not become key, so it never receives key events —
//  Escape included. Catching Escape while another app is frontmost means a
//  GLOBAL event monitor, and a global monitor for keystrokes needs Accessibility.
//  So one of the three has to give.
//
//  What ships: a visible, clickable control that always works and needs nothing;
//  PLUS global Escape when Accessibility happens to be granted, which it already
//  is for push-to-talk. When it is not granted the panel SAYS SO, in the panel,
//  rather than offering a shortcut that silently does nothing. An affordance
//  that quietly fails is worse than one that was never advertised.
//
//  Small, not full-bleed. A takeover is a Gate 10 upgrade with its own risks —
//  it has to restore focus correctly to whatever was frontmost, and getting that
//  wrong during a break every fifty minutes would be enraging. Prove the small
//  one restores focus first.
//

import AppKit
import SwiftUI
import SessionDomain

final class BreakSurface {

    private var panel: NSPanel?
    private var escapeMonitor: Any?
    private var localMonitor: Any?

    /// Who was frontmost when the panel appeared, so it can be put back.
    ///
    /// Focus restoration is the thing that makes an interruption forgivable. A
    /// break window that steals the frontmost app and does not give it back
    /// leaves Nick clicking his editor again every single break.
    private var previousApp: NSRunningApplication?

    var onDismiss: (() -> Void)?
    var onLog: ((String) -> Void)?

    /// The Gate 10 upgrade: cover the screen instead of floating over it.
    ///
    /// OPT-IN and off by default, because it is the difference between an
    /// overlay and a thing that takes your machine away every fifty minutes.
    /// It ships only now, after the small one proved it hands focus back — a
    /// takeover that leaves you clicking your editor again is intolerable at a
    /// frequency of once per block.
    ///
    /// `.screenSaver` level rather than `.mainMenu`: it covers the menu bar and
    /// the Dock, which is the point, but it deliberately does NOT capture the
    /// system. Command-Tab still works, the Force Quit dialog still works, and
    /// the button is still the way out. Orion is not allowed to be something you
    /// have to fight.
    var isFullBleed = false

    /// Whether global Escape is actually available. Read once at show time
    /// rather than cached, because the grant can change while Orion runs.
    var escapeAvailable: Bool { AXIsProcessTrusted() }

    var isVisible: Bool { panel?.isVisible ?? false }

    // MARK: Showing

    func show(prompt: String, minutesRemaining: Int) {
        if panel != nil { return update(prompt: prompt, minutesRemaining: minutesRemaining) }

        previousApp = NSWorkspace.shared.frontmostApplication

        let content = BreakSurfaceView(
            prompt: prompt,
            minutes: minutesRemaining,
            escapeWorks: escapeAvailable,
            fullBleed: isFullBleed,
            onDismiss: { [weak self] in self?.dismiss() }
        )

        let frame = isFullBleed
            ? (NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900))
            : NSRect(x: 0, y: 0, width: 420, height: 210)

        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.level = isFullBleed ? .screenSaver : .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hidesOnDeactivate = false
        // `.canJoinAllSpaces` so a break that starts while he is in another
        // Space is still visible there — otherwise the one interruption that
        // matters is the one he never sees.
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = NSHostingView(rootView: content)

        if isFullBleed {
            panel.setFrame(frame, display: true)
        } else {
            centre(panel)
        }
        panel.orderFrontRegardless()
        self.panel = panel

        installEscape()
        onLog?("[break] surface shown — \(isFullBleed ? "full screen" : "small"), "
               + "escape \(escapeAvailable ? "available" : "UNAVAILABLE")")
    }

    func update(prompt: String, minutesRemaining: Int) {
        guard let panel, let hosting = panel.contentView as? NSHostingView<BreakSurfaceView> else {
            return
        }
        hosting.rootView = BreakSurfaceView(
            prompt: prompt, minutes: minutesRemaining, escapeWorks: escapeAvailable,
            fullBleed: isFullBleed,
            onDismiss: { [weak self] in self?.dismiss() }
        )
    }

    // MARK: Dismissing

    func dismiss() {
        removeEscape()
        panel?.orderOut(nil)
        panel = nil

        // Put the frontmost app back exactly as it was. `.nonactivatingPanel`
        // means it usually never left, but "usually" is not good enough for
        // something that happens every fifty minutes.
        if let previousApp, previousApp.bundleIdentifier != Bundle.main.bundleIdentifier {
            previousApp.activate()
        }
        previousApp = nil

        onLog?("[break] surface dismissed")
        onDismiss?()
    }

    // MARK: Escape

    /// Global Escape when Accessibility allows it, local Escape always.
    ///
    /// The local monitor covers the case where the panel IS key — clicked into,
    /// or Orion frontmost. The global one covers everything else and is the half
    /// that needs the permission.
    private func installEscape() {
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return event }
            self?.dismiss()
            return nil
        }

        guard escapeAvailable else {
            onLog?("[break] Accessibility is not granted, so Escape only works when the "
                   + "break window itself is focused. The button always works.")
            return
        }

        escapeMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return }
            self?.dismiss()
        }
    }

    private func removeEscape() {
        if let escapeMonitor { NSEvent.removeMonitor(escapeMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        escapeMonitor = nil
        localMonitor = nil
    }

    private func centre(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let frame = screen.visibleFrame
        let size = panel.frame.size
        panel.setFrameOrigin(NSPoint(
            x: frame.midX - size.width / 2,
            // Slightly above centre. Dead centre sits on top of whatever is
            // being read; a little higher reads as an overlay rather than an
            // interruption of the text.
            y: frame.midY - size.height / 2 + 60
        ))
    }
}

// MARK: - The view

struct BreakSurfaceView: View {
    let prompt: String
    let minutes: Int
    let escapeWorks: Bool
    var fullBleed = false
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                Text("Break")
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(OrionTheme.text)
                Spacer()
                Text(minutes <= 1 ? "a minute left" : "\(minutes) minutes left")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textDim)
            }

            Text(prompt)
                .font(.system(size: 15))
                .foregroundStyle(OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 0)

            HStack(spacing: 14) {
                // The control that always works, whatever permissions exist.
                InlineAction(title: "Back to it", systemImage: "arrow.right") { onDismiss() }

                // Disclosed honestly. Advertising a shortcut that silently does
                // nothing is worse than never mentioning it.
                Text(escapeWorks
                     ? "or press Escape"
                     : "Escape only works while this window is focused — "
                       + "Accessibility is not granted.")
                    .font(.system(size: 11))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(fullBleed ? 80 : 24)
        .frame(maxWidth: fullBleed ? .infinity : 420,
               maxHeight: fullBleed ? .infinity : 210,
               alignment: fullBleed ? .center : .topLeading)
        .background(
            Group {
                if fullBleed {
                    // Opaque, because the point is that the work is not there to
                    // be glanced at. Not quite black: a pure black takeover
                    // reads as the screen having died.
                    OrionTheme.ink.opacity(0.985)
                } else {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(OrionTheme.ink.opacity(0.96))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .strokeBorder(OrionTheme.line, lineWidth: 1)
                        )
                }
            }
        )
    }
}
