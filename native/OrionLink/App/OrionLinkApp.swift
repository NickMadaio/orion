import AppKit
import LinkCore

/*
 ORION's phone link, as a background helper embedded in Orion.app
 (Contents/Library/LoginItems). It has no window and no menu: Orion.app shows
 its state, read from ~/Library/Application Support/ORION Link/status.json.

 Why a helper and not code inside Orion.app: the link needs Nick's developer
 team signature for CloudKit, and re-signing Orion.app would reset every
 permission it holds (microphone, calendars, contacts, Full Disk Access…).
 The helper carries the iCloud identity; Orion.app keeps its own.
*/
@main
final class LinkHelper: NSObject, NSApplicationDelegate {
    private var engine: LinkEngine?

    static func main() {
        let app = NSApplication.shared
        let helper = LinkHelper()
        app.delegate = helper
        app.setActivationPolicy(.prohibited)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let engine = LinkEngine()
        self.engine = engine
        engine.start()
    }
}
