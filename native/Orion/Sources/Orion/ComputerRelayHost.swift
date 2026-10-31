import ComputerRelay
import Foundation

/// Runs the computer relay inside Orion.app (2026-10-31).
///
/// The gateway's node process has no Accessibility grant; this app does. The plugin queues
/// signed screen requests in ~/.openclaw/orion-controlled/computer-relay/, and RelayService
/// runs each allowlisted one through orion-mac-bridge spawned as THIS app's child, so macOS
/// checks Accessibility against Orion.app. The heartbeat tells the plugin the relay is up and
/// whether this app is actually trusted, so its errors can say which one is missing.
final class ComputerRelayHost {
    static let shared = ComputerRelayHost()

    private var service: RelayService?
    private var heartbeat: DispatchSourceTimer?
    private let heartbeatQueue = DispatchQueue(label: "orion.computer-relay.heartbeat")

    func start() {
        guard service == nil else { return }
        let controlled = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".openclaw/orion-controlled")
        let relay = RelayService(
            directory: controlled.appendingPathComponent("computer-relay"),
            keyURL: controlled.appendingPathComponent("computer-relay.key"),
            bridge: { ProcessBridgeRunner.locate().map { ProcessBridgeRunner(binary: $0) } },
            log: { OrionLog.write($0) })
        do {
            try relay.start()
        } catch {
            OrionLog.write("computer-relay: not started: \(error)")
            return
        }
        service = relay
        let timer = DispatchSource.makeTimerSource(queue: heartbeatQueue)
        timer.schedule(deadline: .now(), repeating: .seconds(5))
        timer.setEventHandler { relay.writeHeartbeat(accessibility: Permissions.accessibilityTrusted) }
        timer.resume()
        heartbeat = timer
        OrionLog.write("computer-relay: watching \(relay.directory.path)")
    }
}
