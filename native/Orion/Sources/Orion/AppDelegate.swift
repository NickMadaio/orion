import AppKit
import Foundation

/// Wiring. Nothing in here makes decisions — it connects the status item, the
/// panel, and the push-to-talk monitor to `AppState`, which owns the behaviour.
final class AppDelegate: NSObject, NSApplicationDelegate {

    private let state = AppState()
    private var panelController: PanelController!
    private var menuBarController: MenuBarController!
    private var preferencesController: PreferencesWindowController!
    private let pushToTalk = PushToTalkMonitor()

    func applicationDidFinishLaunching(_ notification: Notification) {
        panelController = PanelController(state: state)
        preferencesController = PreferencesWindowController(state: state)
        menuBarController = MenuBarController(
            state: state,
            onTogglePanel: { [weak self] in self?.togglePanel() },
            onOpenPreferences: { [weak self] in self?.preferencesController.show() }
        )
        menuBarController.install()

        state.onWantsPanel = { [weak self] in
            guard let self else { return }
            if !self.panelController.isVisible {
                // Wake without stealing focus: the user is mid-sentence in
                // another app and should stay there.
                self.panelController.show(makeKey: false)
                self.menuBarController.refresh(panelVisible: true)
            }
        }
        state.onSpeakingChanged = { [weak self] speaking in
            self?.pushToTalk.setGlobalEscapeWatch(speaking)
        }

        pushToTalk.onPressed = { [weak self] in self?.state.beginListening() }
        pushToTalk.onReleased = { [weak self] in self?.state.endListening() }
        pushToTalk.onEscape = { [weak self] in self?.handleEscape() }
        pushToTalk.start()

        state.start()

        // Accessibility cannot be granted from inside the app, so ask once at
        // first launch and let the panel banner carry it from there.
        if !Permissions.accessibilityTrusted {
            Permissions.promptForAccessibility()
        }

        installEditMenu()
        panelController.show()
        menuBarController.refresh(panelVisible: true)
    }

    /// An accessory app shows no menu bar, but without a main menu the standard
    /// editing shortcuts never reach the panel's text field. This restores
    /// ⌘X/⌘C/⌘V/⌘A for the composer.
    private func installEditMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = NSMenu()
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        // String selectors: these are responder-chain actions with no single
        // unambiguous Swift declaration to point #selector at.
        edit.addItem(withTitle: "Cut", action: Selector("cut:"), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: Selector("copy:"), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: Selector("paste:"), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: Selector("selectAll:"), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        NSApp.mainMenu = main
    }

    func applicationWillTerminate(_ notification: Notification) {
        pushToTalk.stop()
        state.shutDown()
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    // MARK: Actions

    private func togglePanel() {
        panelController.toggle()
        menuBarController.refresh(panelVisible: panelController.isVisible)
    }

    private func handleEscape() {
        if state.phase == .speaking {
            state.bargeIn()
            return
        }
        if panelController.isVisible {
            panelController.hide()
            menuBarController.refresh(panelVisible: false)
        }
    }
}
