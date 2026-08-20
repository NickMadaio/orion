import Combine
import Foundation
import Sparkle

/*
 Updating without the ritual.

 What this replaces: build, sign, quit the app, copy a bundle into
 /Applications, launch it, then discover which permissions macOS decided to
 forget. That ritual is why improvements sat unshipped on this Mac for weeks at
 a time, and it is not a thing anyone else could ever be asked to do.

 The one rule everything here serves: AN UPDATE MUST NOT CHANGE THE APP'S
 IDENTITY. macOS binds microphone, accessibility, speech and every Keychain
 secret to the designated requirement — `identifier "com.nickmadaio.orion.app"
 and certificate leaf = H"171a72ab…"`. An update signed by anything else is a
 different application wearing the same name, and installing it silently throws
 all of that away. Sparkle enforces this itself: it refuses an update whose code
 signature does not match the running app's. `scripts/orion-identity-check`
 asserts the same thing before a release is ever published, because a refusal
 the user has to interpret is worse than a build that never shipped.

 Two Orion-specific policies live here, and neither is Sparkle's default:

 1. NOTHING ON THE LAUNCH PATH. The updater starts on a delay, well after the
    window is up. This app has already lost an afternoon to a launch path that
    waited on securityd, and an update check reaches the network — the one thing
    that can hang for thirty seconds without erroring. A dead feed must cost
    nothing at startup.

 2. NEVER INTERRUPT A FOCUS SESSION. A relaunch in the middle of a focus block
    ends the block. The whole point of the session machinery is that it is
    trustworthy while you are not looking at it, so the update waits. This is
    checked twice: before a check runs at all, and again before the relaunch.
*/

/// Main-thread-only, by the same convention the rest of this app uses: no
/// `@MainActor`, manual discipline, and every hop written down. Sparkle
/// delivers every delegate callback on the main thread, which is what makes the
/// direct reads below safe — and what makes `DispatchQueue.main.sync` inside one
/// an instant deadlock. It is spelled out because the first draft did exactly
/// that, and a deadlock in an update check is invisible until the day it matters.
final class UpdateController: NSObject, ObservableObject {

    /// Where releases are published. Overridable through UserDefaults, which is
    /// what lets `Tests/run-update-test.sh` point the whole update path at a
    /// local file:// feed and watch a real install happen end to end.
    static let defaultFeedURL = "https://raw.githubusercontent.com/ORION_OWNER/ORION_REPO/main/appcast.xml"
    static let feedOverrideKey = "orion.update.feedURL"

    /// Set by AppState so the updater can ask "is he in the middle of something".
    /// Defaults to "not busy" rather than "busy": failing closed here would mean
    /// an app that silently never updates, which is the failure nobody notices.
    var isSessionRunning: () -> Bool = { false }

    @Published private(set) var lastChecked: Date?
    @Published private(set) var status: String = "Not checked yet."
    @Published private(set) var isChecking = false

    /// What is running right now, for the Settings panel.
    let currentVersion: String
    let currentBuild: String

    private var controller: SPUStandardUpdaterController?

    var automaticallyChecks: Bool {
        get { controller?.updater.automaticallyChecksForUpdates ?? true }
        set { controller?.updater.automaticallyChecksForUpdates = newValue; objectWillChange.send() }
    }

    var feedURL: String {
        UserDefaults.standard.string(forKey: Self.feedOverrideKey) ?? Self.defaultFeedURL
    }

    override init() {
        let info = Bundle.main.infoDictionary
        currentVersion = info?["CFBundleShortVersionString"] as? String ?? "?"
        currentBuild = info?["CFBundleVersion"] as? String ?? "?"
        super.init()
    }

    /// Start the updater, deliberately late.
    ///
    /// `startingUpdater: false` at construction and an explicit start after the
    /// delay — not because construction is expensive, but because starting is
    /// what schedules the first check, and that check talks to the network.
    func start(after delay: TimeInterval = 30) {
        guard controller == nil else { return }
        let built = SPUStandardUpdaterController(startingUpdater: false,
                                                 updaterDelegate: self,
                                                 userDriverDelegate: nil)
        controller = built

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, let controller = self.controller else { return }
            controller.startUpdater()
            OrionLog.write("[update] updater started · \(self.currentVersion) "
                           + "(build \(self.currentBuild)) · feed \(self.feedURL)")
        }
    }

    /// The menu item and the Settings button. An explicit ask always checks,
    /// even when a session is running — asking IS the consent that the automatic
    /// path has to infer.
    func checkNow() {
        guard let controller else {
            status = "The updater has not started yet."
            return
        }
        isChecking = true
        status = "Checking…"
        controller.updater.checkForUpdates()
    }
}

// MARK: - Policy

extension UpdateController: SPUUpdaterDelegate {

    /// The feed, from one place, so the override works for every code path.
    func feedURLString(for updater: SPUUpdater) -> String? {
        UserDefaults.standard.string(forKey: Self.feedOverrideKey) ?? Self.defaultFeedURL
    }

    /// Automatic checks wait for the desk to be free.
    ///
    /// Returning an error rather than a bare false so the reason reaches the
    /// log instead of looking like the check silently did not happen.
    func updater(_ updater: SPUUpdater,
                 mayPerform updateCheck: SPUUpdateCheck) throws {
        guard isSessionRunning(), updateCheck == .updates else { return }
        OrionLog.write("[update] check deferred — a focus session is running")
        throw NSError(domain: "com.nickmadaio.orion.update", code: 1, userInfo: [
            NSLocalizedDescriptionKey:
                "A focus session is running. Orion will check again once it ends."
        ])
    }

    /// The last gate before the app is replaced under him.
    ///
    /// A relaunch mid-block ends the block, so the install is postponed rather
    /// than refused: Sparkle keeps the handler and Orion invokes it when the
    /// session is over, which means the update still lands — just not at the
    /// cost of the thing he was doing.
    nonisolated func updater(_ updater: SPUUpdater,
                 shouldPostponeRelaunchForUpdate item: SUAppcastItem,
                 untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        guard isSessionRunning() else { return false }

        OrionLog.write("[update] install postponed — waiting for the focus session to end")
        status = "Update ready — it will install when this session ends."
        waitForSessionEnd(then: installHandler)
        return true
    }

    /// The update has been downloaded and is waiting. Land it.
    ///
    /// Sparkle's default is to install silently ON QUIT, which is a reasonable
    /// default for an app people quit. Orion is a menu-bar assistant that starts
    /// at login and is meant to be always there — it may not be quit for weeks.
    /// The default therefore means the update downloads, waits, and never
    /// arrives, which is indistinguishable from the updater not working. That is
    /// not a guess: the first end-to-end test fetched the feed, downloaded the
    /// build, and then sat there.
    ///
    /// So Orion takes control and installs as soon as installing is not rude —
    /// which for this app means: not in the middle of a focus session. The
    /// relaunch is the same bundle at the same path, so the login item, the
    /// permissions and every stored secret carry straight over.
    func updater(_ updater: SPUUpdater,
                 willInstallUpdateOnQuit item: SUAppcastItem,
                 immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        if isSessionRunning() {
            OrionLog.write("[update] \(item.displayVersionString) ready — holding until the session ends")
            status = "Update \(item.displayVersionString) ready — installs when this session ends."
            waitForSessionEnd(then: immediateInstallHandler)
            return true
        }

        OrionLog.write("[update] installing \(item.displayVersionString) now and relaunching")
        status = "Installing \(item.displayVersionString)…"
        immediateInstallHandler()
        return true
    }

    func updater(_ updater: SPUUpdater,
                 didFinishUpdateCycleFor updateCheck: SPUUpdateCheck,
                 error: Error?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.isChecking = false
            self.lastChecked = Date()
            if let error {
                // "No update found" arrives here as an error too, and reporting
                // that as a failure would make a healthy app look broken.
                let noUpdate = (error as NSError).code == 1001
                self.status = noUpdate ? "Up to date." : error.localizedDescription
            } else {
                self.status = "Up to date."
            }
            OrionLog.write("[update] cycle finished — \(self.status)")
        }
    }
}

// MARK: - Waiting

private extension UpdateController {

    /// Poll for the end of the session, then install.
    ///
    /// A poll rather than an observer because the session's own state already
    /// arrives by polling a file, and one more timer is a far smaller thing to
    /// reason about than a subscription that has to be torn down correctly from
    /// inside a Sparkle callback.
    ///
    /// The deadline is the important part. "Wait for a good moment" is one
    /// stuck state away from "never", and an updater that quietly never updates
    /// is worse than no updater at all — nothing is broken, nothing is logged,
    /// the version simply stops moving. After six hours the update goes in
    /// regardless: by then whatever this was waiting for is not a focus block
    /// anybody is still sitting at.
    func waitForSessionEnd(then install: @escaping () -> Void) {
        let deadline = Date().addingTimeInterval(6 * 3600)
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }

            if Date() >= deadline {
                timer.invalidate()
                OrionLog.write("[update] waited six hours — installing regardless")
                install()
                return
            }

            guard !self.isSessionRunning() else { return }
            timer.invalidate()
            OrionLog.write("[update] session ended — installing now")
            install()
        }
    }
}
