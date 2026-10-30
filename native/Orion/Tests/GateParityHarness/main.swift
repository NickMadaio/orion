// Golden generator for the exact-gate test driver (scripts/eval/gate). Compiled against the REAL
// ThinkingPolicy, OutreachContext, SchedulingMemory and LocalRoutingMode sources; reads fixture
// inputs, runs the real functions, writes what they returned. The Node port is then asserted
// against that file (scripts/eval/gate/test/parity.test.mjs).
//   gate-parity <inputs.json> <goldens.json>
import Foundation

func parseDate(_ s: String) -> Date {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)!
}
func list(_ root: [String: Any], _ key: String) -> [[String: Any]] { root[key] as? [[String: Any]] ?? [] }

guard CommandLine.arguments.count >= 3,
      let data = FileManager.default.contents(atPath: CommandLine.arguments[1]),
      let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    FileHandle.standardError.write(Data("usage: gate-parity <inputs.json> <goldens.json>\n".utf8)); exit(2)
}

var out: [String: Any] = [:]

out["thinking"] = list(root, "thinking").map { c -> [String: Any] in
    let now = parseDate(c["now"] as! String)
    let boosted = (c["boostedUntil"] as? String).map(parseDate)
    let text = c["text"] as! String
    return ["name": c["name"]!,
            "needsReasoning": ThinkingPolicy.needsReasoning(text),
            "level": ThinkingPolicy.level(for: text, model: c["model"] as? String, boostedUntil: boosted, now: now)]
}

out["scheduling"] = list(root, "scheduling").map { c -> [String: Any] in
    let mode = LocalRoutingMode(mode: c["mode"] as! String, scheduleToCloud: c["scheduleToCloud"] as? Bool ?? false)
    let rules = c["rules"] as? String
    return ["name": c["name"]!,
            "context": SchedulingMemory.context(for: c["text"] as! String, localRouting: mode, rules: { rules })]
}

out["outreach"] = list(root, "outreach").map { c -> [String: Any] in
    let rows = OutreachContext.parse(jsonl: c["jsonl"] as! String)
    let tracker = OutreachTracker()   // one tracker across the steps, as the app has one for the whole process
    let steps = (c["steps"] as! [[String: Any]]).map { s in
        tracker.prefix(rows: rows, now: parseDate(s["now"] as! String), replyTo: s["replyTo"] as? String)
    }
    return ["name": c["name"]!, "prefixes": steps]
}

out["struggled"] = list(root, "struggled").map { c -> [String: Any] in
    ["name": c["name"]!,
     "struggled": ThinkingPolicy.struggled(transcript: c["transcript"] as! String, since: parseDate(c["since"] as! String))]
}

// Optional live mode: the context for the REAL SCHEDULING.md under the live routing config. Printed, never committed.
if let live = root["liveScheduling"] as? [String], !live.isEmpty {
    out["live"] = live.map { text -> [String: Any] in
        ["text": text, "context": SchedulingMemory.context(for: text)]
    }
}

let json = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
try json.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
print("wrote \(CommandLine.arguments[2])")
