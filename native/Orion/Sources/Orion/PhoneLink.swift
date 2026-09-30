import AppKit
import Combine
import ServiceManagement
import SwiftUI

/*
 The iPhone link, as ORION shows and runs it (2026-09-28).

 The link itself is the ORION Link helper embedded at
 Contents/Library/LoginItems/ORION Link.app (native/OrionLink). It carries
 Nick's developer-team signature for CloudKit, so Orion.app keeps its own
 signature and every permission it holds. Orion registers the helper as a
 login item, starts it if it is not running, and shows its state here, read
 from the status file the helper writes every few seconds.
*/
enum PhoneLink {
    static let helperID = "com.nickmadaio.orion.link"
    static var helperURL: URL {
        Bundle.main.bundleURL.appendingPathComponent("Contents/Library/LoginItems/ORION Link.app")
    }
    static var embedded: Bool { FileManager.default.fileExists(atPath: helperURL.path) }
    static var service: SMAppService { .loginItem(identifier: helperID) }

    /// Called at launch: keep the helper registered and running.
    static func ensureRunning() {
        guard embedded else { return }
        if service.status != .enabled { try? service.register() }
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: helperID)
        // An update replaces the helper on disk but not the process: a helper
        // launched before its binary changed is still the old code. Restart it.
        let built = (try? helperURL.appendingPathComponent("Contents/MacOS")
            .resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? nil
        if let built, running.contains(where: { (($0.launchDate ?? processStart($0.processIdentifier)) ?? .distantFuture) < built }) {
            restart(); return
        }
        guard running.isEmpty else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        NSWorkspace.shared.openApplication(at: helperURL, configuration: configuration) { _, _ in }
    }

    /// When a process started, from the kernel: NSRunningApplication leaves
    /// `launchDate` nil for a helper that was not launched through LaunchServices.
    static func processStart(_ pid: pid_t) -> Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&name, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000)
    }

    static func restart() {
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: helperID) { app.terminate() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { ensureRunning() }
    }
}

struct PhoneLinkStatus: Decodable, Equatable {
    let status: String
    let problem: String?
    let lastPublished: String?
    let commandsHandled: Int
    let lastCommand: String?
    let writtenAt: String

    static var url: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ORION Link/status.json")
    }
    static func read() -> PhoneLinkStatus? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(PhoneLinkStatus.self, from: data)
    }

    private static let iso = ISO8601DateFormatter()
    var published: Date? { lastPublished.flatMap(Self.iso.date(from:)) }
    var written: Date? { Self.iso.date(from: writtenAt) }
    /// The helper writes every few seconds; a quiet file means it is not running.
    func alive(now: Date = Date()) -> Bool { written.map { now.timeIntervalSince($0) < 30 } ?? false }
}

@MainActor
final class PhoneLinkModel: ObservableObject {
    @Published private(set) var status = PhoneLinkStatus.read()
    @Published private(set) var running = false
    let ticker = RefreshTicker(interval: 3)
    private var watch: Any?

    init() {
        refresh()
        watch = ticker.$tick.sink { [weak self] _ in self?.refresh() }
    }

    func refresh() {
        let next = PhoneLinkStatus.read()
        if next != status { status = next }
        let isRunning = !NSRunningApplication.runningApplications(withBundleIdentifier: PhoneLink.helperID).isEmpty
        if isRunning != running { running = isRunning }
    }
}

struct PhoneLinkView: View {
    @StateObject private var model = PhoneLinkModel()

    private var healthy: Bool {
        guard let status = model.status else { return false }
        return model.running && status.alive() && status.problem == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Circle().fill(healthy ? OrionTheme.green : OrionTheme.orange).frame(width: 7, height: 7)
                Text(headline).font(.system(size: 13, weight: .semibold)).foregroundStyle(OrionTheme.text)
                Spacer()
            }
            if let problem = model.status?.problem, model.running {
                Text(problem).font(.system(size: 11)).foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let published = model.status?.published {
                Text("Last sent to your iPhone \(published.formatted(.relative(presentation: .named)))")
                    .font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft)
            }
            if let status = model.status, status.commandsHandled > 0 {
                Text("\(status.commandsHandled) command(s) from your phone this session\(status.lastCommand.map { " · last: \($0.prefix(40))" } ?? "")")
                    .font(.system(size: 11)).foregroundStyle(OrionTheme.textDim)
            }
            HStack(spacing: 14) {
                Button(model.running ? "Restart link" : "Start link") { PhoneLink.restart() }
                    .buttonStyle(.plain).font(.system(size: 12, weight: .medium)).foregroundStyle(OrionTheme.accent)
                    .disabled(!PhoneLink.embedded)
            }
            Text("Your iPhone and this Mac talk through your private iCloud. Same Apple ID on both is the only pairing.")
                .font(.system(size: 11)).foregroundStyle(OrionTheme.textDim).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var headline: String {
        if !PhoneLink.embedded { return "Not included in this build" }
        if !model.running { return "Not running" }
        guard let status = model.status, status.alive() else { return "Starting…" }
        if status.problem != nil { return "Having trouble" }
        return "Connected to your iPhone"
    }
}
