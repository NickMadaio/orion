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

        talkItem.target = self
        talkItem.action = #selector(fixPushToTalk)
        menu.addItem(talkItem)

        menu.addItem(.separator())

        let preferences = NSMenuItem(title: "Preferences…", action: #selector(openPreferences), keyEquivalent: ",")
        preferences.target = self
        menu.addItem(preferences)

        let quit = NSMenuItem(title: "Quit Orion", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        item.menu = menu
        statusItem = item
        refresh()
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
        if state.accessibilityTrusted {
            talkItem.title = "Push-to-talk: Right Option ready"
            talkItem.isEnabled = false
        } else {
            talkItem.title = "Push-to-talk: grant Accessibility…"
            talkItem.isEnabled = true
        }
    }

    // MARK: Actions

    @objc private func togglePanel() {
        onTogglePanel()
    }

    @objc private func fixPushToTalk() {
        state.requestAccessibility()
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
