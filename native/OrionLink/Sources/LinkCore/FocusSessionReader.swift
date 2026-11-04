import Foundation
import MobileCore
#if canImport(Darwin)
import Darwin
#endif

/// The running focus session, for the phone (wave 19). The Mac app owns the session engine and answers `status` on
/// ~/.openclaw/orion-session.sock; Link only reads that reply (never the engine's state file, never a second engine) and
/// the allowed apps the activity contract publishes. A "finish" or "pause" the phone sends goes back through the same
/// socket as the engine's own commands, so the Mac's clock stays the only clock.
public enum FocusSessionReader {
    /// A newer-than-this activity.json speaks for the session; an older one is not trusted.
    public static let activityFreshness: TimeInterval = 120
    /// A phone tap older than this is dropped: a late "Done early" must never end a later session.
    public static let actionFreshness: TimeInterval = 120
    static let jitter: TimeInterval = 5

    public static var socketURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-session.sock")
    }

    public static func parse(status: Data, allowed: [String]?, previous: LinkSnapshot.FocusSession?, now: Date) -> LinkSnapshot.FocusSession? {
        guard let object = (try? JSONSerialization.jsonObject(with: status)) as? [String: Any],
              object["ok"] as? Bool != false,
              let state = object["status"] as? String, state == "running" || state == "paused",
              let id = object["sessionId"] as? String, let task = object["task"] as? String else { return nil }
        let remaining = (object["remainingSeconds"] as? Double).map { max(0, $0) }
        let served = (object["servedSeconds"] as? Double).map { max(0, $0) }
        let total: Double? = served.flatMap { s in remaining.map { s + $0 } }
        let block = object["blockNumber"] as? Int, blocks = object["totalBlocks"] as? Int
        let allowedList = allowed.map { $0.filter { PhoneFocus.groups.contains($0) } }
        if state == "paused" {
            // A paused reply names no phase: it is still the one the session was in.
            let phase = previous?.sessionId == id ? previous?.phase ?? "focus" : "focus"
            return .init(sessionId: id, task: task, phase: phase, status: "paused", endsAt: nil, phaseSeconds: total,
                         remainingSeconds: remaining, block: block, blocks: blocks, allowed: allowedList)
        }
        let phase = (object["phase"] as? String) == "rest" ? "break" : "focus"
        var end = remaining.map { now.addingTimeInterval($0) }
        // The end is the same moment however many times it is read: hold the old one against sub-5-second drift so the
        // snapshot does not change (and republish) on every tick.
        if let held = previous, held.sessionId == id, held.phase == phase, let old = held.endsAt, let new = end,
           abs(old.timeIntervalSince(new)) < jitter { end = old }
        return .init(sessionId: id, task: task, phase: phase, status: "running", endsAt: end, phaseSeconds: total,
                     remainingSeconds: nil, block: block, blocks: blocks, allowed: allowedList)
    }

    /// Phone app groups the session's allowed Mac apps stand for. nil = nothing known (stale or no focus block), [] = known, none.
    public static func allowedGroups(activity: Data?, now: Date) -> [String]? {
        guard let object = (try? JSONSerialization.jsonObject(with: activity ?? Data())) as? [String: Any],
              let at = date(object["at"]), now.timeIntervalSince(at) < activityFreshness,
              let focus = object["focus"] as? [String: Any], focus["active"] as? Bool == true else { return nil }
        let apps = focus["allowedApps"] as? [String] ?? []
        let groups = Set(apps.compactMap { groupByBundle[$0] })
        return PhoneFocus.groups.filter(groups.contains)
    }

    /// Mac bundle ids and the phone group that app stands for: the browser allowed on the Mac frees the phone's browsers.
    static let groupByBundle: [String: String] = [
        "com.apple.Safari": "browsers", "com.google.Chrome": "browsers", "company.thebrowser.Browser": "browsers",
        "com.brave.Browser": "browsers", "com.microsoft.edgemac": "browsers", "org.mozilla.firefox": "browsers",
        "com.apple.MobileSMS": "messaging", "net.whatsapp.WhatsApp": "messaging", "com.hnc.Discord": "messaging",
        "com.tinyspeck.slackmacgap": "messaging", "ru.keepcoder.Telegram": "messaging", "com.apple.FaceTime": "messaging",
        "com.apple.TV": "video", "com.apple.Music": "video", "tv.plex.desktop": "video",
    ]

    /// The engine command a phone action means, or nil when it must not run: a report (pickup, need-app), another
    /// session's tap, no session at all, or a tap that arrived late. "Break now" is a pause: the engine has no
    /// break-from-focus command, and a paused session lifts the phone's shield.
    public static func wireOp(action: String, session: String?, current: String?, age: TimeInterval) -> String? {
        guard ["finish", "pause", "resume"].contains(action), let current, age <= actionFreshness, age > -60 else { return nil }
        if let session, session != current { return nil }
        return action
    }

    public static func request(op: String, id: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: ["op": op, "requestId": id], options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    private static func date(_ value: Any?) -> Date? {
        guard let text = value as? String else { return nil }
        let withFraction = ISO8601DateFormatter(); withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }

    // MARK: Socket

    /// One request line, one reply, with a short timeout either way. nil when the app is not running.
    public static func send(_ line: String, to url: URL = socketURL, timeout: TimeInterval = 2) -> Data? {
        #if canImport(Darwin)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let path = url.path
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard path.utf8.count < capacity else { return nil }
        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { _ = strcpy($0, path) }
        }
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard connected == 0 else { return nil }
        let payload = Array((line + "\n").utf8)
        guard write(fd, payload, payload.count) == payload.count else { return nil }
        var reply = Data(); var chunk = [UInt8](repeating: 0, count: 4096)
        while reply.count < 64 * 1024 {
            let got = read(fd, &chunk, chunk.count)
            if got <= 0 { break }
            reply.append(contentsOf: chunk[0..<got])
            if chunk[got - 1] == 0x0A { break }
        }
        return reply.isEmpty ? nil : reply
        #else
        return nil
        #endif
    }

    /// The session as the engine reports it right now.
    public static func current(previous: LinkSnapshot.FocusSession?, activity: Data?, now: Date = Date()) -> LinkSnapshot.FocusSession? {
        guard let reply = send(#"{"op":"status"}"#) else { return nil }
        return parse(status: reply, allowed: allowedGroups(activity: activity, now: now), previous: previous, now: now)
    }
}
