import AppKit
import Foundation

// Only the state source is a test double. The menu, timer and expiry projection
// below compile from production files. No status item or visible window opens.
final class AppState {
    var gatewayHealth = GatewayHealthSnapshot(availability: .ready, checkedAt: Date())
    var gatewayAvailability: GatewayAvailability { gatewayHealth.current() }
    var voiceUp = false
    var voiceSummary = "test"
    var accessibilityTrusted = false
    var wakeWordEnabled = false
    func refreshStatus() {}
    func refreshPermissions() {}
    func requestAccessibility() {}
}
let app = NSApplication.shared
let state = AppState()
let controller = MenuBarController(state: state, onTogglePanel: {}, onOpenPreferences: {})
let menu = NSMenu()
let item = Mirror(reflecting: controller).descendant("gatewayItem") as! NSMenuItem
func tick(_ mode: RunLoop.Mode) {
    let end = Date().addingTimeInterval(1.2)
    while Date() < end { RunLoop.main.run(mode: mode, before: end) }
}
func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
    guard condition() else { print("FAIL menu: \(name)"); exit(1) }
    print("PASS menu: \(name)")
}
controller.menuWillOpen(menu)
expect(item.title == GatewayAvailability.ready.title, "fresh observation shown")
state.gatewayHealth = GatewayHealthSnapshot(availability: .ready, checkedAt: Date().addingTimeInterval(-21))
tick(.eventTracking)
expect(item.title == GatewayAvailability.stale.title, "open menu expires green in tracking mode")
state.gatewayHealth = GatewayHealthSnapshot(availability: .unavailable, checkedAt: Date())
tick(.eventTracking)
expect(item.title == GatewayAvailability.unavailable.title, "async failure updates open menu")
state.gatewayHealth = GatewayHealthSnapshot(availability: .ready, checkedAt: Date())
tick(.eventTracking)
expect(item.title == GatewayAvailability.ready.title, "async recovery updates open menu")
controller.menuDidClose(menu)
state.gatewayHealth = GatewayHealthSnapshot(availability: .unavailable, checkedAt: Date())
tick(.default)
expect(item.title == GatewayAvailability.ready.title, "closing menu stops timer")
