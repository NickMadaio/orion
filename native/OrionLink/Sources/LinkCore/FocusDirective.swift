import Foundation
import MobileCore

/// What the Mac tells the phone to block, group by group (2026-11-02).
///
/// Two files in ~/.openclaw/orion-controlled feed it:
///  - focus-phone.json, rewritten every minute by orion-ontask-watch: `{at, until, block:[names], why}`, and since
///    this change also `lists:[{name, until?, why?}]`. Only trusted while it is under 90 seconds old.
///  - focus-phone-user.json, written by `orion-phone-time block/unblock`: `{lists:[{name, until, why}]}`. Each entry
///    has its own end, so it needs no freshness; an entry past its end is ignored.
/// A name the phone does not know is dropped, never widened into something bigger.
public enum FocusDirective {
    public static let groups: Set<String> = ["messaging", "feeds", "video", "games", "browsers"]
    public static let freshness: TimeInterval = 90

    public struct Result: Equatable, Sendable {
        public var names: [String]
        public var plan: [LinkSnapshot.FocusListPlan]
    }

    public static func resolve(auto: Data?, user: Data?, now: Date = Date()) -> Result? {
        var merged: [String: LinkSnapshot.FocusListPlan] = [:]
        var order: [String] = []
        func put(_ entry: LinkSnapshot.FocusListPlan) {
            guard groups.contains(entry.name) else { return }
            if merged[entry.name] == nil { order.append(entry.name) }
            merged[entry.name] = entry
        }
        var heard = false
        if let object = json(auto), let at = date(object["at"]), now.timeIntervalSince(at) < freshness {
            heard = true
            let why = object["why"] as? String
            if let lists = object["lists"] as? [[String: Any]] {
                for item in lists { if let entry = entry(item, fallbackWhy: why, now: now) { put(entry) } }
            } else {
                for name in object["block"] as? [String] ?? [] { put(.init(name: name, until: nil, why: why)) }
            }
        }
        if let object = json(user) {
            heard = true
            for item in object["lists"] as? [[String: Any]] ?? [] {
                guard let entry = entry(item, fallbackWhy: nil, now: now), entry.until != nil else { continue }
                put(entry)
            }
        }
        guard heard else { return nil }
        let plan = order.compactMap { merged[$0] }
        return Result(names: plan.map(\.name), plan: plan)
    }

    private static func entry(_ item: [String: Any], fallbackWhy: String?, now: Date) -> LinkSnapshot.FocusListPlan? {
        guard let name = item["name"] as? String else { return nil }
        let until = date(item["until"])
        if let until, until <= now { return nil }
        return .init(name: name, until: until?.timeIntervalSince1970, why: item["why"] as? String ?? fallbackWhy)
    }

    private static func json(_ data: Data?) -> [String: Any]? {
        data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }

    private static func date(_ value: Any?) -> Date? {
        guard let text = value as? String else { return nil }
        let withFraction = ISO8601DateFormatter(); withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}
