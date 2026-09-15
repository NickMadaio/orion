import Foundation

/*
 What Nick sees while a turn runs.

 His complaint, verbatim: "sometimes he times out... i cant tell if hes
 actually working and thinking and its just taking a while or if hes timing
 out. Claude and Chat both show they are thinking like orion does, but they
 show processes they are doing at that moment." A blank "Thinking…" for up to
 `RunTimeouts.agentTimeout` seconds cannot be told apart from a wedge. This is
 the fix: a small, pure, clock-injected state machine — same shape as
 `StallWatchdog` — that turns two signal sources into a short line of English,
 never a payload.

 Two signal sources, on two different clocks, and this type owns reconciling
 them:

   1. LOCAL and IMMEDIATE. `init(now:)` seeds the feed with a synthetic first
      line — `RunTimeouts.firstStatusWithin` (2s) is faster than one `openclaw
      audit` invocation can even return (measured 2.4-2.8s, see
      `RunTimeouts.measuredAuditInvocationCost`), so the first thing Nick sees
      cannot come from audit. It has to already be here.

   2. AUDIT, polled off the main thread at `RunTimeouts.auditPollInterval` and
      fed in through `ingest(_:at:)`. Refines the synthetic line into what
      actually happened, as tool actions complete.

 What audit can and cannot say, checked against the real schema
 (`packages/gateway-protocol/src/schema/audit.d.ts`) and against
 `docs/planning/v2/evals/README.md`'s own finding ("`toolName` is `exec`, and the
 command that `exec` ran is not in it"): every OpenClaw builtin tool — `bash`,
 `shell`, `exec`, `web_search`, `browser`, `grep`, `glob` — is a distinct,
 stable top-level name. But every Orion-domain action — calendar, reminders,
 mail, health — dispatches through the ONE tool `orion_task_run`, with the
 actual action name inside `arguments`, which audit deliberately never
 records. So "Checking your calendar…" is not a real, obtainable line today;
 a step through `orion_task_run` reads as the generic fallback below. That is
 also exactly the privacy property the hard rules ask for: an unknown or
 undifferentiable tool call reads as "ran a step," never as its payload.

 `ToolPhrasebook` is therefore small and honest rather than aspirational. Only
 names audit can actually distinguish get their own phrase; everything else —
 including `orion_task_run` — falls through to the generic line.

 Silence is the one thing Nick cannot read ("i cant tell if hes actually
 working... or if hes timing out"), so after `RunTimeouts.silenceBudget`
 without a new signal the feed says so, in words, rather than staying quiet in
 a way that looks identical to a healthy long answer.

 `Tests/ProgressHarness` drives this against a clock it owns, the same
 discipline as `Tests/WatchdogHarness`. Compiled directly against this file and
 `RunTimeouts.swift`, not copies.
 */

/// One audit fact, already translated out of the raw `kind`/`status`/`action`
/// triple. Never carries a tool argument, a result, or reasoning — the audit
/// schema this is parsed from does not carry them either.
enum RunSignal: Equatable {
    case toolStarted(tool: String, callId: String)
    case toolFinished(tool: String, callId: String)
    case runSucceeded
    case runFailed
    case runTimedOut
    case runCancelled
}

/// Translates the small set of tool names `openclaw audit` can actually
/// distinguish into a short phrase. See the file header for why most calls —
/// everything through `orion_task_run` — land on the generic fallback rather
/// than a domain-specific phrase.
enum ToolPhrasebook {

    private static let startedPhrase: [String: String] = [
        "bash": "Running a command…",
        "shell": "Running a command…",
        "exec": "Running a command…",
        "web_search": "Searching the web…",
        "browser": "Using the browser…",
        "grep": "Searching the files…",
        "glob": "Searching the files…",
    ]

    private static let finishedPhrase: [String: String] = [
        "bash": "Ran a command.",
        "shell": "Ran a command.",
        "exec": "Ran a command.",
        "web_search": "Searched the web.",
        "browser": "Used the browser.",
        "grep": "Searched the files.",
        "glob": "Searched the files.",
    ]

    static let genericStarted = "Working on a step…"
    static let genericFinished = "Ran a step."

    static func started(_ tool: String) -> String {
        startedPhrase[tool] ?? genericStarted
    }

    static func finished(_ tool: String) -> String {
        finishedPhrase[tool] ?? genericFinished
    }

    /// The folded form of N consecutive finishes of the same tool — "Ran a
    /// command." twice becomes "Ran two commands." rather than two identical
    /// lines. Spelled out for small counts because that is how Nick asked for
    /// it: "ran two commands", not "ran 2 commands."
    static func foldedFinished(_ tool: String, count: Int) -> String {
        let n = spelled(count)
        switch tool {
        case "bash", "shell", "exec": return "Ran \(n) commands."
        case "web_search": return "Searched the web \(n) times."
        case "browser": return "Used the browser \(n) times."
        case "grep", "glob": return "Searched the files \(n) times."
        default: return "Ran \(n) steps."
        }
    }

    private static let smallNumbers = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    ]

    private static func spelled(_ n: Int) -> String {
        if n >= 0, n < smallNumbers.count { return smallNumbers[n] }
        return String(n)
    }
}

/// Pure, clock-injected. No subprocess, no audio device, no timer — the same
/// spirit as `StallWatchdog`, and for the same reason: the behaviour this
/// exists to prove (a wedge, a silence, a fold) is easiest to get wrong under
/// real timing and impossible to reproduce on demand without one.
struct RunProgressModel {

    /// One page of `openclaw audit`, already parsed down to what this model
    /// needs: an id to de-duplicate on, and the translated signal.
    struct AuditRecord: Equatable {
        let eventId: String
        let signal: RunSignal
    }

    static let syntheticFirstLine = "Thinking…"

    private(set) var startedAt: Date
    private(set) var lines: [String]
    private(set) var isFinished = false

    /// The instant audit reported the run's terminal status — succeeded,
    /// failed, cancelled, or timed out. Distinct from `isFinished`, which this
    /// model also sets when the USER cancels locally; only the audit-reported
    /// case is a wedge candidate, because only that case says the far side is
    /// done while our side has not heard about it yet.
    private(set) var auditFinishedAt: Date?

    private var lastSignalAt: Date
    private var callReturned = false
    private var seenEventIds: Set<String> = []
    private var pendingLineIndex: [String: Int] = [:]
    private var lastFoldTool: String?
    private var lastFoldCount = 0

    init(now: Date) {
        startedAt = now
        lastSignalAt = now
        lines = [RunProgressModel.syntheticFirstLine]
    }

    // MARK: Feeding it

    /// Folds in one page of already-parsed audit records, in order, skipping
    /// any `eventId` already seen. Safe to call repeatedly with an overlapping
    /// or even identical page — the poller re-queries `--after <turn start>`
    /// every cycle rather than tracking a cursor, and this is what makes that
    /// safe.
    mutating func ingest(_ records: [AuditRecord], at now: Date) {
        guard !isFinished else { return }
        for record in records {
            guard seenEventIds.insert(record.eventId).inserted else { continue }
            apply(record.signal, at: now)
            if isFinished { return }
        }
    }

    private mutating func apply(_ signal: RunSignal, at now: Date) {
        lastSignalAt = now
        switch signal {
        case .toolStarted(let tool, let callId):
            // Starting the SAME tool again after its last instance folded is
            // the normal shape of "ran it three times" and must not break the
            // run — only a DIFFERENT tool starting or finishing in between
            // does that, so an interleaved different action is never hidden
            // inside a count.
            if tool != lastFoldTool { lastFoldTool = nil }
            lines.append(ToolPhrasebook.started(tool))
            pendingLineIndex[callId] = lines.count - 1

        case .toolFinished(let tool, let callId):
            recordFinished(tool: tool, callId: callId, at: now)

        case .runSucceeded:
            finish(auditFact: true, line: "Done.", at: now)
        case .runFailed:
            finish(auditFact: true, line: "That failed.", at: now)
        case .runTimedOut:
            finish(auditFact: true, line: "The agent's own timeout ran out.", at: now)
        case .runCancelled:
            // This arrives here only when AUDIT reports the run cancelled —
            // still an audit fact, still a valid wedge candidate if our side
            // never hears the call return. A user's OWN cancel goes through
            // `recordUserCancelled` instead, which deliberately does not set
            // `auditFinishedAt`: we already know why the call is not coming
            // back, so there is nothing to detect.
            finish(auditFact: true, line: "Cancelled.", at: now)
        }
    }

    private mutating func recordFinished(tool: String, callId: String, at now: Date) {
        let startedIndex = pendingLineIndex.removeValue(forKey: callId)
        if lastFoldTool == tool {
            // The immediately preceding completed line was the same tool with
            // nothing else in between: merge rather than repeat.
            if let startedIndex { lines.remove(at: startedIndex) }
            lastFoldCount += 1
            lines[lines.count - 1] = ToolPhrasebook.foldedFinished(tool, count: lastFoldCount)
            return
        }
        let phrase = ToolPhrasebook.finished(tool)
        if let startedIndex, startedIndex < lines.count {
            lines[startedIndex] = phrase
        } else {
            lines.append(phrase)
        }
        lastFoldTool = tool
        lastFoldCount = 1
    }

    private mutating func finish(auditFact: Bool, line: String, at now: Date) {
        isFinished = true
        if auditFact { auditFinishedAt = now }
        lines.append(line)
    }

    /// The user cancelled locally — deliberately NOT routed through `apply`,
    /// because that would set `auditFinishedAt` and make this turn a false
    /// positive for `isWedged` a few seconds later. We already know why the
    /// call is not returning; there is nothing left to detect.
    mutating func recordUserCancelled(at now: Date) {
        guard !isFinished else { return }
        isFinished = true
        lastSignalAt = now
        lines.append("Cancelled.")
    }

    /// `GatewayClient.ask` actually returned. Once true, `isWedged` can never
    /// fire again for this turn — the thing it exists to catch did not
    /// happen.
    mutating func markCallReturned(at now: Date) {
        callReturned = true
    }

    // MARK: Reading it

    /// What the feed says right now. Appends the honest silence line on the
    /// fly rather than storing it, so a caller polling this with an advancing
    /// clock sees the count go up without a separate tick call touching state.
    func visibleLines(at now: Date) -> [String] {
        guard !isFinished else { return lines }
        let quiet = now.timeIntervalSince(lastSignalAt)
        guard quiet >= RunTimeouts.silenceBudget else { return lines }
        return lines + ["Still working — nothing new for \(Int(quiet))s."]
    }

    func elapsed(at now: Date) -> TimeInterval {
        now.timeIntervalSince(startedAt)
    }

    /// The 2026-08-12 signature, via the one liveness signal `.thinking` has
    /// ever had: audit says the run is over, and the blocking call still has
    /// not handed us a reply. True only once `RunTimeouts.wedgeGraceAfterRunEnd`
    /// has passed since that audit fact, and never once `markCallReturned` has
    /// been recorded — the call coming back at all rules out a wedge for good,
    /// however late it was.
    func isWedged(at now: Date) -> Bool {
        guard !callReturned, let auditFinishedAt else { return false }
        return now.timeIntervalSince(auditFinishedAt) >= RunTimeouts.wedgeGraceAfterRunEnd
    }

    // MARK: Parsing — pure, no IO. `GatewayClient.auditSince` does the IO.

    /// Decodes one `openclaw audit --json` page against the real schema
    /// (`AuditEventSchema`: `eventId`, `kind`, `status`, `toolCallId`,
    /// `toolName`, …). Anything that does not parse is skipped rather than
    /// thrown — a malformed or unexpected record must cost this cycle's line,
    /// never the turn itself.
    static func parseAuditPage(_ json: [String: Any]) -> [AuditRecord] {
        guard let events = json["events"] as? [[String: Any]] else { return [] }
        var out: [AuditRecord] = []
        for event in events {
            guard
                let eventId = event["eventId"] as? String,
                let kind = event["kind"] as? String,
                let status = event["status"] as? String
            else { continue }

            switch kind {
            case "agent_run":
                let signal: RunSignal?
                switch status {
                case "succeeded": signal = .runSucceeded
                case "failed", "blocked", "unknown": signal = .runFailed
                case "timed_out": signal = .runTimedOut
                case "cancelled": signal = .runCancelled
                default: signal = nil // "started" — no display-worthy fact yet
                }
                if let signal { out.append(AuditRecord(eventId: eventId, signal: signal)) }

            case "tool_action":
                let tool = (event["toolName"] as? String) ?? "unknown"
                let callId = (event["toolCallId"] as? String) ?? eventId
                let signal: RunSignal
                if status == "started" {
                    signal = .toolStarted(tool: tool, callId: callId)
                } else {
                    signal = .toolFinished(tool: tool, callId: callId)
                }
                out.append(AuditRecord(eventId: eventId, signal: signal))

            default:
                continue
            }
        }
        return out
    }
}
