import AppKit
import SwiftUI

/// Shield is deliberately a surface, not an input capture. It covers the
/// current screen and asks for a return to work, but Command-Tab still works,
/// its button always works, and Escape works locally plus globally whenever
/// Orion already has Accessibility permission.
final class FocusShieldSurface {
    private var panel: NSPanel?
    private var localMonitor: Any?
    private var globalMonitor: Any?
    private var restoreBundleID: String?

    var onReleaseGuard: (() -> Void)?
    var onLog: ((String) -> Void)?

    func show(reason: String, restoreBundleID: String?) {
        self.restoreBundleID = restoreBundleID
        if let panel {
            update(panel: panel, reason: reason)
            panel.orderFrontRegardless()
            return
        }

        let frame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .screenSaver
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = NSHostingView(rootView: content(reason: reason))
        panel.setFrame(frame, display: true)
        panel.orderFrontRegardless()
        self.panel = panel
        installEscape()
        onLog?("[focus] Shield visible — Escape \(AXIsProcessTrusted() ? "global" : "local")")
    }

    func dismiss(restoreWork: Bool = true) {
        guard panel != nil else { return }
        removeEscape()
        panel?.orderOut(nil)
        panel = nil
        if restoreWork { restore() }
        restoreBundleID = nil
        onLog?("[focus] Shield dismissed")
    }

    private func update(panel: NSPanel, reason: String) {
        (panel.contentView as? NSHostingView<FocusShieldView>)?.rootView = content(reason: reason)
    }

    private func content(reason: String) -> FocusShieldView {
        FocusShieldView(
            reason: reason,
            globalEscape: AXIsProcessTrusted(),
            onReturn: { [weak self] in self?.dismiss() },
            onRelease: { [weak self] in
                self?.dismiss()
                self?.onReleaseGuard?()
            }
        )
    }

    private func restore() {
        guard let restoreBundleID,
              let app = NSRunningApplication.runningApplications(
                withBundleIdentifier: restoreBundleID
              ).first else { return }
        app.activate(options: [.activateAllWindows])
    }

    private func installEscape() {
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return event }
            self?.dismiss()
            return nil
        }
        guard AXIsProcessTrusted() else { return }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.dismiss() }
        }
    }

    private func removeEscape() {
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        localMonitor = nil
        globalMonitor = nil
    }
}

private struct FocusShieldView: View {
    let reason: String
    let globalEscape: Bool
    let onReturn: () -> Void
    let onRelease: () -> Void

    var body: some View {
        ZStack {
            Color(red: 0.005, green: 0.012, blue: 0.022).opacity(0.965)
            RadialGradient(colors: [OrionTheme.accent.opacity(0.12), .clear],
                           center: .center, startRadius: 10, endRadius: 540)

            VStack(spacing: 23) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 44, weight: .ultraLight))
                    .foregroundStyle(OrionTheme.accent)
                    .shadow(color: OrionTheme.accent.opacity(0.55), radius: 18)

                Text("FOCUS SHIELD")
                    .font(OrionTheme.mono(14, .semibold))
                    .tracking(6)
                    .foregroundStyle(OrionTheme.accent)

                Text(reason)
                    .font(.system(size: 28, weight: .light))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(OrionTheme.text)
                    .frame(maxWidth: 620)

                HStack(spacing: 12) {
                    Button("RETURN TO WORK", action: onReturn)
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                        .tint(OrionTheme.accent)

                    Button("RELEASE GUARD", action: onRelease)
                        .buttonStyle(.bordered)
                }

                Text(globalEscape ? "Press Escape at any time" : "Click Return to work; global Escape needs Accessibility access")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
        .ignoresSafeArea()
    }
}
