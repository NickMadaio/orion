import AppKit
import Foundation

/// Wiring. Nothing in here makes decisions — it connects the status item, the
/// panel, and the push-to-talk monitor to `AppState`, which owns the behaviour.
final class AppDelegate: NSObject, NSApplicationDelegate {

    private let state = AppState()
    private var panelController: PanelController!
    private var textWindowController: TextWindowController!
    private var menuBarController: MenuBarController!
    private var preferencesController: PreferencesWindowController!
    private let pushToTalk = PushToTalkMonitor()
    /// Owns the Sparkle updater. Constructed here, STARTED late — see
    /// `UpdateController.start`, and the launch-path note in its header.
    private let updates = UpdateController()
    private var sessionFloatController: SessionFloatController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Resolve the voice keys now, off the main thread, so pressing talk never waits on the keychain.
        Secrets.prefetch()
        panelController = PanelController(state: state)
        textWindowController = TextWindowController(state: state)
        sessionFloatController = SessionFloatController(state: state) { [weak self] in self?.textWindowController.show() }
        preferencesController = PreferencesWindowController(state: state)
        menuBarController = MenuBarController(
            state: state,
            onTogglePanel: { [weak self] in self?.togglePanel() },
            onOpenPreferences: { [weak self] in self?.preferencesController.show() }
        )
        // Left-click the menu bar: the typing surface, focused and ready.
        // Right-click still gets the menu.
        menuBarController.onToggleTextWindow = { [weak self] in
            self?.textWindowController.toggle()
        }
        menuBarController.install()

        // The iPhone link helper embedded in this bundle (PhoneLink.swift).
        PhoneLink.ensureRunning()

        // Updates. The check is deliberately not part of launching: it starts
        // half a minute in, and it asks first whether a focus session is
        // running, so neither the network nor an install can interrupt the work
        // this app exists to protect.
        // `.running` only — NOT `snapshot().isRunning`.
        //
        // `isRunning` is true for any session that has not finished, which
        // includes `waitingForReturn`: a rest phase that ended while nobody was
        // at the desk, holding until he comes back. That state is correct and it
        // can last for weeks — the first end-to-end update test found a session
        // from six days earlier still sitting in it. Gating updates on that
        // means an update that downloads, waits for a session that will never
        // end, and never arrives, with nothing on screen to say why.
        //
        // Only an actively-running phase is worth protecting from a relaunch.
        updates.isSessionRunning = { [state] in
            if case .running = state.session.snapshot().reconciliation?.status { return true }
            return false
        }
        menuBarController.onCheckForUpdates = { [weak self] in self?.updates.checkNow() }
        state.updates = updates
        updates.start()

        // The dashboard has its own large hologram. Showing a second, floating
        // copy at the same time breaks the whole "Orion is the center" idea.
        // Closing the dashboard deliberately does not restore the small one;
        // voice or push-to-talk is the next intentional activation.
        textWindowController.onShown = { [weak self] in
            self?.panelController.hide()
            self?.menuBarController.refresh(panelVisible: false)
            self?.refreshEscapeWatch()
        }

        state.onWantsPanel = { [weak self] in
            guard let self else { return }
            // When the full dashboard is already visible, its central hologram
            // is the voice surface. Do not layer the small orb over it.
            guard !self.textWindowController.isInFocus else { return }
            if !self.panelController.isVisible {
                // Wake without stealing focus: the user is mid-sentence in
                // another app and should stay there.
                self.panelController.show()
                self.menuBarController.refresh(panelVisible: true)
                self.refreshEscapeWatch()
            }
        }
        // Summoned by name. Always arrives in the configured corner on the
        // screen the user is looking at, and never takes focus — you can say
        // "Orion" mid-sentence in another app and keep typing.
        state.dashboardVisible = { [weak self] in self?.textWindowController.isInFocus ?? false }
        state.onWantsSummon = { [weak self] in
            guard let self else { return }
            guard !self.textWindowController.isInFocus else { return }
            self.panelController.summon()
            self.menuBarController.refresh(panelVisible: true)
            self.refreshEscapeWatch()
        }
        state.onSizeChanged = { [weak self] in
            self?.panelController.applySize()
        }
        // Scrolling on the orb changes the same value the slider does, so push
        // it back into state or Preferences would show a stale number.
        panelController.onSizeChangedByGesture = { [weak self] size in
            guard let self else { return }
            if self.state.orbSize != size { self.state.orbSize = size }
        }
        panelController.onHiddenByGesture = { [weak self] in
            self?.menuBarController.refresh(panelVisible: false)
            self?.refreshEscapeWatch()
        }
        state.onSpeakingChanged = { [weak self] _ in
            self?.refreshEscapeWatch()
        }

        // Note: this does NOT need to re-show the panel itself. `beginListening`
        // fires `onWantsPanel`, which brings a dismissed orb back at wherever it
        // was last dragged to -- and honouring that position is the point, so
        // summoning it to the configured corner here would be a regression.
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
        // The desktop app opens into the command center now. The separate orb
        // appears only for a later wake-word or push-to-talk activation.
        textWindowController.show()
        menuBarController.refresh(panelVisible: false)
        refreshEscapeWatch()
    }

    /// An accessory app shows no menu bar, but without a main menu the standard
    /// editing shortcuts never reach the text window's field. This restores
    /// ⌘X/⌘C/⌘V/⌘A for the composer.
    private func installEditMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = NSMenu(title: "Orion")
        appItem.submenu?.addItem(withTitle: "Quit Orion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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

    /// `orion://show/<tab>` — how ORION (or anything on this Mac) brings the
    /// dashboard up on a tab: `scripts/orion-show tasks`. Showing a tab is the
    /// whole of its power; any other orion:// link is ignored here (sign-in
    /// callbacks are handled by their own web-auth session).
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            // orion://listen — start a hands-free turn, as if he had said the wake
            // word: the Mac hologram widget's tap, a Shortcut, or a voice self-test.
            // orion://reach?id=… — ORION starting the conversation (scripts/orion-reach).
            if url.scheme == "orion", url.host == "reach",
               let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "id" })?.value,
               let entry = Self.outreach(id: id) {
                state.deliverReach(entry.text, aloud: entry.channel == "mac-voice", headphones: entry.headphones,
                                   loud: entry.loud, listen: entry.listen, reachID: id,
                                   kind: entry.kind, deliveredToPhone: entry.channel == "phone")
                continue
            }
            // orion://morning-screen — the day and the weather, full screen (scripts/orion-morning).
            if url.scheme == "orion", url.host == "morning-screen" {
                if url.query?.contains("close") == true { MorningScreen.shared.dismiss() } else { MorningScreen.shared.show() }
                continue
            }
            // orion://lights?do=on&brightness=100 — the LED strip (scripts/orion-lights).
            if url.scheme == "orion", url.host == "lights" {
                StripLight.shared.run(StripLight.commands(from: url))
                continue
            }
            if url.scheme == "orion", url.host == "listen" {
                // As a follow-up: a tap is not speech, so wait (up to the follow-up
                // grace) for him to start before timing pauses. Started as an ordinary
                // hands-free turn it ended 1.8 s in if he had not begun talking yet.
                state.beginListening(handsFree: true, followUp: true)
                continue
            }
            guard url.scheme == "orion", url.host == "show",
                  let tab = DashboardTab.named(url.pathComponents.dropFirst().first ?? "") else { continue }
            textWindowController.show()
            state.requestedTab = tab
        }
    }

    /// The outreach entry orion-reach recorded for this id.
    static func outreach(id: String) -> (text: String, channel: String, headphones: Bool, loud: Bool, listen: Bool, kind: String?)? {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/outreach.jsonl")
        // orion-reach opens the URL before it appends the line; give it a moment.
        for _ in 0..<10 {
            if let text = try? String(contentsOf: file, encoding: .utf8) {
                for line in text.split(separator: "\n").reversed() {
                    guard let row = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                          row["id"] as? String == id, let message = row["text"] as? String else { continue }
                    return (message, row["channel"] as? String ?? "mac-bubble", row["headphones"] as? Bool ?? false,
                            row["loud"] as? Bool ?? false, row["listen"] as? Bool ?? false, row["kind"] as? String)
                }
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return nil
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        textWindowController.show()
        return true
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
        refreshEscapeWatch()
    }

    /// Escape listens whenever there is something to dismiss.
    ///
    /// It used to be installed only while Orion was speaking, which meant an orb
    /// sitting idle in the corner could not be dismissed from the keyboard at
    /// all -- the only way out was the menu-bar menu, which is not where anyone
    /// looks. Driven from one place so no future path can forget it.
    private func refreshEscapeWatch() {
        // `.thinking` belongs here as much as `.speaking` does. Escape during a
        // long turn used to reach `handleEscape()` only if the panel happened to
        // be open, which meant the one moment Nick most wants a way out -- a
        // turn that has been running for a minute with no way to tell whether it
        // is working or wedged -- was the one moment the key did nothing.
        pushToTalk.setGlobalEscapeWatch(
            panelController.isVisible || state.phase == .speaking || state.phase == .thinking
                || state.phase == .listening
        )
    }

    private func handleEscape() {
        // `bargeIn()` sorts the two cases itself: it stops the voice when Orion
        // is speaking and cancels the turn when he is thinking. Both are "stop",
        // which is the only thing Escape has ever meant.
        if state.phase == .listening {
            state.finishTurnNow()
            return
        }
        if state.phase == .speaking || state.phase == .thinking {
            state.bargeIn()
            return
        }
        if panelController.isVisible {
            panelController.hide()
            menuBarController.refresh(panelVisible: false)
            refreshEscapeWatch()
        }
    }
}
