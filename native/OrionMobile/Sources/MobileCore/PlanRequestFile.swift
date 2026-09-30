import Foundation

/*
 The phone asking the Mac to plan the day (2026-09-28).

 The planner lives in the ORION app: it has Calendar and Reminders access, the
 time budgets and the saved plan with its undo. The phone link runs in a
 separate helper that has none of those, so it does not plan -- it leaves one
 request in this file, and the app picks it up within a few seconds, does the
 work, and writes the outcome back into the same file. The helper publishes
 that outcome to the phone with the rest of the Mac's state.

 One request at a time: a new one replaces the last. Both sides use this type,
 so the file's shape cannot drift between them.
*/
public enum PlanRequestFile {
    /// Requests older than this are ignored: the phone has moved on.
    public static let expiresAfter: TimeInterval = 10 * 60

    public static func url(home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> URL {
        home.appendingPathComponent(".openclaw/orion-controlled/today-plan-request.json")
    }

    public static func read(_ url: URL = url()) -> LinkSnapshot.PlanRequest? {
        guard let data = try? Data(contentsOf: url), data.count < 16_384 else { return nil }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(LinkSnapshot.PlanRequest.self, from: data)
    }

    public static func write(_ request: LinkSnapshot.PlanRequest, to url: URL = url()) throws {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601; encoder.outputFormatting = [.sortedKeys]
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(request).write(to: url, options: .atomic)
    }

    /// A waiting request the app should act on now, if there is one.
    public static func pending(at now: Date = Date(), url: URL = url()) -> LinkSnapshot.PlanRequest? {
        guard let request = read(url), request.state == .waiting,
              now.timeIntervalSince(request.at) < expiresAfter,
              LinkPlanAction(rawValue: request.action) != nil else { return nil }
        return request
    }
}
