import Foundation

/*
 Reads what the new Home needs from the controlled directory, beyond BriefFacts. Every source is a file a script
 already writes; nothing here is new state:
   · outreach.jsonl + inbound-turns.jsonl — a question ORION asked (a row with an `ask`) that no turn has followed;
   · knowledge-graph.json — how many facts ORION holds about him, and the name on his own node. Read as plain JSON
     rather than through KnowledgeStore, so the Knowledge rebuild (wave 12 U1) can change that model freely;
   · morning-view.json — the morning's "leave by", when it was written today;
   · night.json — bedtime and tomorrow's alarm, through NightMarkers (the same rule the alarm uses).
 A missing or malformed file is "nothing to say", never an error on screen.
*/

struct KnowledgeSummary: Equatable {
    let factCount: Int
    let selfName: String?
}

enum HomeSignalsReader {
    // MARK: Pure parsing

    static func pendingQuestion(outreach: String, inboundTurns: String, now: Date,
                                window: TimeInterval = HomeCardBuilder.questionWindow) -> PendingQuestion? {
        let asks = OutreachContext.parse(jsonl: outreach).filter { !$0.held && $0.ask != nil && $0.at <= now.addingTimeInterval(60) }
        guard let latest = asks.max(by: { $0.at < $1.at }), now.timeIntervalSince(latest.at) <= window else { return nil }
        // Any turn of his after it counts as the reply: the inbound log carries no reply-to, and guessing it was
        // about something else would leave an answered question on screen.
        if let lastTurn = lastTurn(inboundTurns), lastTurn >= latest.at { return nil }
        return PendingQuestion(id: latest.id, text: latest.text, at: latest.at)
    }

    static func lastTurn(_ jsonl: String) -> Date? {
        jsonl.split(separator: "\n").compactMap { line -> Date? in
            guard let row = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let stamp = row["at"] as? String else { return nil }
            return WakeAlarmPlan.parseISO(stamp)
        }.max()
    }

    static func knowledge(_ data: Data) -> KnowledgeSummary? {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let nodes = root["nodes"] as? [[String: Any]] else { return nil }
        let facts = nodes.reduce(0) { $0 + (($1["facts"] as? [Any])?.count ?? 0) }
        let selfNode = nodes.first { ($0["id"] as? String) == "person:self" }
        return KnowledgeSummary(factCount: facts, selfName: selfNode?["label"] as? String)
    }

    /// The morning view's "leave by" ("2:45", no AM/PM), as a time today. Only from a view written today. Times
    /// before 7 are read as afternoon: nobody leaves for class at 2:45 in the morning.
    static func leaveBy(morningView data: Data, now: Date, calendar: Calendar) -> Date? {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let stamp = root["generatedAt"] as? String, let written = WakeAlarmPlan.parseISO(stamp),
              calendar.isDate(written, inSameDayAs: now),
              let text = root["leaveBy"] as? String else { return nil }
        let pm = text.uppercased().contains("PM")
        let digits = text.uppercased().replacingOccurrences(of: "AM", with: "").replacingOccurrences(of: "PM", with: "")
            .trimmingCharacters(in: .whitespaces).split(separator: ":").compactMap { Int($0) }
        guard digits.count == 2, (0..<24).contains(digits[0]), (0..<60).contains(digits[1]) else { return nil }
        var hour = digits[0]
        if (pm && hour < 12) || (!text.uppercased().contains("AM") && hour < 7) { hour += 12 }
        return calendar.date(bySettingHour: hour, minute: digits[1], second: 0, of: now)
    }

    // MARK: Live

    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled")
    }

    /// Everything above, read from disk now. Cheap: the two logs are read from their tail.
    static func load(now: Date = Date(), calendar: Calendar = .current, from directory: URL = directory) -> HomeSignals {
        let file = { (name: String) in directory.appendingPathComponent(name) }
        let knowledge = (try? Data(contentsOf: file("knowledge-graph.json"))).flatMap(knowledge)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        var signals = HomeSignals()
        signals.question = pendingQuestion(outreach: tail(file("outreach.jsonl")), inboundTurns: tail(file("inbound-turns.jsonl"), bytes: 4_096), now: now)
        signals.leaveBy = (try? Data(contentsOf: file("morning-view.json"))).flatMap { leaveBy(morningView: $0, now: now, calendar: calendar) }
        signals.bedtime = NightMarkers.load(for: now, from: file("night.json"), calendar: calendar)?.bed
        signals.nextWake = NightMarkers.load(for: tomorrow, from: file("night.json"), calendar: calendar)?.wake
        signals.knowledgeCount = knowledge?.factCount
        signals.selfName = knowledge?.selfName
        signals.phoneLinkAlive = PhoneLinkStatus.read()?.alive(now: now)
        return signals
    }

    /// The last `bytes` of a file as text, starting at a line boundary.
    static func tail(_ url: URL, bytes: Int = 65_536) -> String {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        let start = size > UInt64(bytes) ? size - UInt64(bytes) : 0
        try? handle.seek(toOffset: start)
        let text = String(decoding: handle.readDataToEndOfFile(), as: UTF8.self)
        guard start > 0, let newline = text.firstIndex(of: "\n") else { return text }
        return String(text[text.index(after: newline)...])
    }
}

/// The one small status capsule in the header: shown only when something is wrong.
enum HomeStatus {
    struct Issue: Equatable {
        let text: String
        let severe: Bool
    }

    static func issues(gatewayUp: Bool, overdue: Int, phoneLinkAlive: Bool?) -> [Issue] {
        var issues: [Issue] = []
        if !gatewayUp { issues.append(Issue(text: "GATEWAY DOWN", severe: true)) }
        if overdue > 0 { issues.append(Issue(text: "\(overdue) OVERDUE", severe: false)) }
        if phoneLinkAlive == false { issues.append(Issue(text: "PHONE LINK OFFLINE", severe: false)) }
        return issues
    }
}
