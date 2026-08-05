import AppKit

/// The status-bar presence. Orion has no Dock icon and no main window, so this
/// menu is the only always-available surface — it carries the panel toggle, the
/// two reachability readouts, and the escape hatches.
final class MenuBarController: NSObject, NSMenuDelegate {

    private let state: AppState
    private let onTogglePanel: () -> Void
    private let onOpenPreferences: () -> Void

    private var statusItem: NSStatusItem?
    private let menu = NSMenu()

    private let toggleItem = NSMenuItem(title: "Show Orion", action: nil, keyEquivalent: "o")
    private let gatewayItem = NSMenuItem(title: "Gateway: checking…", action: nil, keyEquivalent: "")
    private let voiceItem = NSMenuItem(title: "Voice: checking…", action: nil, keyEquivalent: "")
    private let talkItem = NSMenuItem(title: "Push-to-talk: checking…", action: nil, keyEquivalent: "")
    /// The providers that are ACTUALLY serving, not the ones configured.
    private let providerItem = NSMenuItem(title: "Providers: checking…", action: nil, keyEquivalent: "")
    /// Hands-free listening. A checkbox rather than a status readout: this is
    /// the one setting a person changes situationally — on at the desk, off in
    /// a meeting — and burying it in Preferences would mean it is never used.
    private let wakeItem = NSMenuItem(title: "Listen for “Orion”", action: nil, keyEquivalent: "")

    /// Left-click on the status item. Set by `AppDelegate`.
    var onToggleTextWindow: (() -> Void)?

    init(state: AppState,
         onTogglePanel: @escaping () -> Void,
         onOpenPreferences: @escaping () -> Void) {
        self.state = state
        self.onTogglePanel = onTogglePanel
        self.onOpenPreferences = onOpenPreferences
        super.init()
    }

    func install() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = MenuBarController.statusImage()
        item.button?.toolTip = "Orion"

        menu.delegate = self
        // We drive enablement by hand; auto-enabling would fight the
        // "Push-to-talk" row, which is only actionable when it is broken.
        menu.autoenablesItems = false

        toggleItem.target = self
        toggleItem.action = #selector(togglePanel)
        menu.addItem(toggleItem)

        menu.addItem(.separator())

        gatewayItem.isEnabled = false
        voiceItem.isEnabled = false
        menu.addItem(gatewayItem)
        menu.addItem(voiceItem)
        providerItem.isEnabled = false
        menu.addItem(providerItem)

        talkItem.target = self
        talkItem.action = #selector(fixPushToTalk)
        menu.addItem(talkItem)

        menu.addItem(.separator())

        wakeItem.target = self
        wakeItem.action = #selector(toggleWakeWord)
        menu.addItem(wakeItem)

        menu.addItem(.separator())

        let preferences = NSMenuItem(title: "Preferences…", action: #selector(openPreferences), keyEquivalent: ",")
        preferences.target = self
        menu.addItem(preferences)

        let quit = NSMenuItem(title: "Quit Orion", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        // Deliberately NOT `item.menu = menu`.
        //
        // Assigning a menu makes every click open it, which costs the most
        // valuable target on the screen: one click on the menu bar should put a
        // caret in front of you, not present a list of things to read. So the
        // button gets an action instead, and the menu is attached only for the
        // instant a right-click needs it (see `statusClicked`).
        item.button?.target = self
        item.button?.action = #selector(statusClicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        statusItem = item
        refresh()
    }

    /// Left-click opens the text window; right-click (or control-click, which
    /// is the same gesture on a trackpad) opens the menu.
    @objc private func statusClicked() {
        let event = NSApp.currentEvent
        let wantsMenu = event.map { ev in
            ev.type == .rightMouseUp || ev.modifierFlags.contains(.control)
        } ?? false

        guard let item = statusItem else { return }

        if wantsMenu {
            // The documented way to show a status menu on demand: attach it,
            // re-send the click so AppKit positions and tracks it correctly,
            // then detach so the next left-click reaches our action again.
            item.menu = menu
            item.button?.performClick(nil)
            item.menu = nil
        } else {
            onToggleTextWindow?()
        }
    }

    // MARK: Menu

    func menuWillOpen(_ menu: NSMenu) {
        state.refreshStatus()
        state.refreshPermissions()
        refresh()
    }

    func refresh(panelVisible: Bool? = nil) {
        if let panelVisible {
            toggleItem.title = panelVisible ? "Hide Orion" : "Show Orion"
        }
        gatewayItem.title = state.gatewayUp
            ? "Gateway: up on port \(GatewayClient.port())"
            : "Gateway: not reachable on port \(GatewayClient.port())"
        voiceItem.title = state.voiceUp
            ? "Voice: warm daemon connected"
            : "Voice: daemon not running (built-in voice will be used)"
        providerItem.title = "Providers: \(state.voiceSummary)"
        if state.accessibilityTrusted {
            talkItem.title = "Push-to-talk: Right Option ready"
            talkItem.isEnabled = false
        } else {
            talkItem.title = "Push-to-talk: grant Accessibility…"
            talkItem.isEnabled = true
        }
        wakeItem.state = state.wakeWordEnabled ? .on : .off
        // Say the cost out loud, where the switch is. Hands-free means the
        // microphone session stays open, and on Bluetooth headphones an open
        // microphone is what forces the headset audio profile — the thing that
        // makes music sound thin. Better to read that here than to rediscover
        // it as a mystery a week from now.
        wakeItem.toolTip = state.wakeWordEnabled
            ? "Orion is holding the microphone open. On Bluetooth headphones this can lower playback quality."
            : "Wake on hearing your name. Holds the microphone open, which can lower Bluetooth playback quality."
    }

    // MARK: Actions

    @objc private func togglePanel() {
        onTogglePanel()
    }

    @objc private func fixPushToTalk() {
        state.requestAccessibility()
    }

    /// `AppState` may refuse — no microphone permission, no on-device
    /// recogniser — and it says so by setting the flag back to false. Reading
    /// the flag again rather than the click is what keeps the checkmark honest.
    @objc private func toggleWakeWord() {
        state.wakeWordEnabled.toggle()
        refresh()
    }

    @objc private func openPreferences() {
        onOpenPreferences()
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    // MARK: Icon

    /// SF Symbol when the system has one, otherwise a hand-drawn ring — the app
    /// should never launch with a blank slot in the menu bar.
    private static func statusImage() -> NSImage {
        if let symbol = NSImage(systemSymbolName: "circle.hexagongrid.fill",
                                accessibilityDescription: "Orion") {
            symbol.isTemplate = true
            return symbol
        }
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
            let outer = NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2))
            outer.lineWidth = 1.3
            NSColor.labelColor.setStroke()
            outer.stroke()
            let core = NSBezierPath(ovalIn: rect.insetBy(dx: 6, dy: 6))
            NSColor.labelColor.setFill()
            core.fill()
            return true
        }
        image.isTemplate = true
        return image
    }
}
