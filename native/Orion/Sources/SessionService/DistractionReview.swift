//
//  Closing distractions by reasoning, with a floor underneath the reasoning.
//
//  The old design asked Nick to maintain a list of quittable apps. He refused
//  twice, and he was right to: "it should be an open ended question he reasons,
//  not a multiple choice." So the question is open ended — but the answer is
//  only ever allowed to NARROW a set that a pure, tested policy has already
//  decided is safe.
//
//  Read in order, this is what happens at session start:
//
//    1. Gather facts about every running app (RunningApps).
//    2. DistractionFloor.screen removes everything that could lose work, is
//       part of macOS, is in use, or whose state could not be read. This is
//       mechanical and the model never sees the removed apps.
//    3. What survives is described to a model along with the session's stated
//       task, and it answers the only question a list cannot: is this app part
//       of what he is doing right now?
//    4. Every app the model names is screened AGAIN — from freshly gathered
//       facts, because minutes can pass and a document can be dirtied in them —
//       and only then asked politely to quit.
//
//  Nothing in step 3 can undo step 2. A model that returns every app on the
//  machine, or hallucinates bundle identifiers, or is replaced tomorrow by a
//  worse one, still cannot close an editor with unsaved work: it is not in the
//  set it was given, and it would be refused at step 4 anyway.
//
//  When anything is missing — no model, no answer, unparseable answer — nothing
//  is closed and the log says why. An app left open is a forgivable failure.
//

import Foundation
import SessionDomain

// MARK: - Did this session just start, or did Orion just restart?

public enum SessionFreshness {

    /// True only for a session that genuinely began moments ago.
    ///
    /// The distinction exists for one thing, and it is the destructive one.
    /// Orion restarts — a rebuild, a crash, a login — and a live session comes
    /// back with it, which replays "the session is starting". Turning Focus back
    /// on there is harmless. Closing his apps AGAIN, an hour into the block and
    /// after he deliberately reopened one, is Orion overruling a decision he
    /// made after the fact.
    ///
    /// No `started` event at all reads as NOT fresh, so an unreadable session
    /// closes nothing.
    public static func startedJustNow(events: [LifecycleEvent]?, now: Date,
                                      within: TimeInterval = 120) -> Bool {
        guard let started = events?.first(where: {
            if case .started = $0.kind { return true }
            return false
        }) else { return false }
        let age = now.timeIntervalSince(started.at)
        return age >= 0 && age <= within
    }
}

// MARK: - The reasoner

/// Whatever does the thinking. A protocol rather than a concrete model because
/// the model is the part most likely to be swapped, and because a test needs to
/// answer instantly and identically every time.
public protocol DistractionReasoning: AnyObject {
    /// Blocking. Callers run it off the main thread.
    func answer(_ prompt: String) throws -> String
}

// MARK: - One decision

public struct DistractionDecision: Equatable, Sendable {
    public enum Source: String, Equatable, Sendable {
        /// The mechanical floor refused it. Reasoning was never consulted.
        case floor
        /// The model was asked and said so.
        case reasoning
        /// The model did not mention it, so it was kept. Silence is never
        /// permission.
        case unmentioned
    }

    public let bundleID: String
    public let name: String
    public let close: Bool
    public let reason: String
    public let source: Source

    public init(bundleID: String, name: String, close: Bool,
                reason: String, source: Source) {
        self.bundleID = bundleID
        self.name = name
        self.close = close
        self.reason = reason
        self.source = source
    }

    /// The audit line. Nick has to be able to read back what was closed and why,
    /// and equally what survived and why.
    public var logLine: String {
        "\(close ? "close" : "keep") \(name) — \(reason)"
    }
}

public struct DistractionReview: Equatable, Sendable {
    public let decisions: [DistractionDecision]
    /// Non-nil when the reasoning step could not happen. Not an error state —
    /// it means nothing gets closed, which is the safe outcome.
    public let unavailable: String?

    public var toClose: [DistractionDecision] { decisions.filter(\.close) }
}

// MARK: - Asking the question

public enum DistractionPrompt {

    /// Bounded so a machine with sixty apps open cannot produce a prompt that
    /// times out the model.
    public static let maxApps = 25

    public static func build(task: String, apps: [AppFacts]) -> String {
        let stated = task.trimmingCharacters(in: .whitespacesAndNewlines)
        let described = apps.prefix(maxApps).map(describe).joined(separator: "\n")

        return """
        A focus session is starting on a Mac. Decide which of these apps to close.

        What the person said they are working on this session:
        \(stated.isEmpty ? "(they did not say)" : "\"\(stated)\"")

        Every app below has already been checked and has nothing unsaved, is not \
        the app they are using, and is safe to quit. The only question left is \
        whether it is plausibly part of that task.

        \(described)

        Rules:
        - Close an app only if it is clearly unrelated to the stated task.
        - If the task is vague, empty, or you are unsure about an app, keep it.
        - A communication app may be part of the task; do not assume it is not.
        - Keep anything that could plausibly be a tool for the work.

        Answer with JSON and nothing else: an array of objects, one per app you \
        were shown, each with "bundle" (the identifier exactly as given), "close" \
        (true or false) and "reason" (under 12 words, addressed to the person).

        Example: [{"bundle":"com.apple.Music","close":true,"reason":"a music player, not part of writing"}]
        """
    }

    static func describe(_ app: AppFacts) -> String {
        var notes: [String] = []
        switch app.readableWindows {
        case .some(0): notes.append("no windows open")
        case .some(let count): notes.append("\(count) window\(count == 1 ? "" : "s")")
        case .none: notes.append("window count unknown")
        }
        if app.isHidden { notes.append("hidden") }
        if let since = app.secondsSinceLastActive {
            notes.append("last used \(Int(since / 60)) min ago")
        } else {
            notes.append("not switched to since this session's setup began")
        }
        if let since = app.secondsSinceLaunch {
            notes.append("running \(Int(since / 60)) min")
        }
        notes.append(app.editsDocuments ? "can edit documents" : "does not edit documents")
        return "- \(app.name) [\(app.bundleID)]: \(notes.joined(separator: ", "))"
    }

    /// Tolerant on purpose. A small model wraps JSON in prose, in a code fence,
    /// or writes `"close": "true"`. None of that should turn into "close
    /// everything" or into a crash — anything unreadable simply is not a
    /// decision to close, because the default everywhere here is to keep.
    public static func parse(_ raw: String, known: [AppFacts]) -> [DistractionDecision] {
        let byID = Dictionary(known.map { ($0.bundleID, $0) }, uniquingKeysWith: { first, _ in first })
        guard let start = raw.firstIndex(of: "["),
              let end = raw.lastIndex(of: "]"), start < end else { return [] }
        let slice = String(raw[start...end])
        guard let data = slice.data(using: .utf8),
              let items = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }

        var decisions: [DistractionDecision] = []
        var seen = Set<String>()
        for item in items {
            guard let object = item as? [String: Any] else { continue }
            let identifier = (object["bundle"] as? String)
                ?? (object["bundleID"] as? String)
                ?? (object["bundle_id"] as? String)
                ?? ""
            // A bundle id the model invented refers to nothing that can be
            // quit, so it is dropped rather than guessed at.
            guard let app = byID[identifier.trimmingCharacters(in: .whitespaces)],
                  seen.insert(app.bundleID).inserted else { continue }

            let close = truthy(object["close"]) ?? false
            let reason = (object["reason"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            decisions.append(DistractionDecision(
                bundleID: app.bundleID, name: app.name, close: close,
                reason: reason.isEmpty ? (close ? "not part of this task" : "kept") : reason,
                source: .reasoning
            ))
        }
        return decisions
    }

    private static func truthy(_ value: Any?) -> Bool? {
        if let flag = value as? Bool { return flag }
        if let number = value as? NSNumber { return number.boolValue }
        if let text = value as? String {
            switch text.lowercased().trimmingCharacters(in: .whitespaces) {
            case "true", "yes", "1", "close": return true
            case "false", "no", "0", "keep": return false
            default: return nil
            }
        }
        return nil
    }
}

// MARK: - The whole pass

public final class DistractionCloser {

    private let apps: RunningAppsReading
    private let quittable: QuittableApps
    private let reasoner: DistractionReasoning?
    private let clock: () -> Date

    public var onLog: ((String) -> Void)?

    public init(apps: RunningAppsReading = RunningApps(),
                quittable: QuittableApps,
                reasoner: DistractionReasoning?,
                clock: @escaping () -> Date = { Date() }) {
        self.apps = apps
        self.quittable = quittable
        self.reasoner = reasoner
        self.clock = clock
    }

    /// Decide, without doing anything. Every running app comes back with a
    /// verdict and a reason, including the ones that were never a candidate.
    public func review(task: String) -> DistractionReview {
        let facts = apps.facts(now: clock())
        let (eligible, blocked) = DistractionFloor.partition(facts)

        let refusals = blocked.map {
            DistractionDecision(bundleID: $0.0.bundleID, name: $0.0.name, close: false,
                                reason: $0.1, source: .floor)
        }

        guard !eligible.isEmpty else {
            return DistractionReview(decisions: refusals, unavailable: nil)
        }
        guard let reasoner else {
            return DistractionReview(
                decisions: refusals + kept(eligible, because: "nothing was available to reason with"),
                unavailable: "no reasoning is configured, so nothing was closed"
            )
        }

        let answer: String
        do {
            answer = try reasoner.answer(DistractionPrompt.build(task: task, apps: eligible))
        } catch {
            return DistractionReview(
                decisions: refusals + kept(eligible, because: "the reasoning step did not answer"),
                unavailable: "could not reason about the running apps: \(error.localizedDescription)"
            )
        }

        let reasoned = DistractionPrompt.parse(answer, known: eligible)
        guard !reasoned.isEmpty else {
            return DistractionReview(
                decisions: refusals + kept(eligible, because: "the reasoning step was not readable"),
                unavailable: "the answer about which apps to close could not be read, so nothing was closed"
            )
        }

        // Anything not mentioned is kept. Silence is not permission.
        let mentioned = Set(reasoned.map(\.bundleID))
        let silent = eligible.filter { !mentioned.contains($0.bundleID) }.map {
            DistractionDecision(bundleID: $0.bundleID, name: $0.name, close: false,
                                reason: "not mentioned, so left alone", source: .unmentioned)
        }
        return DistractionReview(decisions: refusals + reasoned + silent, unavailable: nil)
    }

    /// Decide and act.
    ///
    /// The second screening is not belt and braces, it is the point: `review`
    /// may have run seconds or minutes ago, and `quit` re-reads the app's
    /// document state at the moment it is about to be asked to close.
    @discardableResult
    public func closeDistractions(task: String) -> [QuitOutcome] {
        let review = review(task: task)
        log(review)

        return review.toClose.map { decision in
            let outcome = quittable.quit(bundleID: decision.bundleID, name: decision.name,
                                         authorizedBy: .reviewed(reason: decision.reason))
            onLog?("[distractions] \(decision.name): \(outcome.message)")
            return outcome
        }
    }

    /// The audit trail, written so it can actually be read.
    ///
    /// Every decision individually would be ninety lines a session on this Mac,
    /// eighty of them saying "Dock is part of macOS" — which is not an audit
    /// trail, it is a place an interesting line goes to hide. So: everything
    /// that reached the reasoning gets its own line, so does anything held back
    /// because of WORK (unsaved or unreadable), and the rest is counted.
    private func log(_ review: DistractionReview) {
        var summarised: [String: Int] = [:]
        for decision in review.decisions {
            let aboutWork = decision.source == .floor
                && (decision.reason.contains("unsaved") || decision.reason.contains("could not read"))
            if decision.source == .floor && !aboutWork {
                summarised[decision.reason, default: 0] += 1
                continue
            }
            onLog?("[distractions] \(decision.logLine)")
        }
        if !summarised.isEmpty {
            let counted = summarised.sorted { $0.value > $1.value }
                .map { "\($0.value) × \($0.key)" }
                .joined(separator: "; ")
            onLog?("[distractions] never considered — \(counted)")
        }
        if let unavailable = review.unavailable {
            onLog?("[distractions] \(unavailable)")
        }
    }

    private func kept(_ apps: [AppFacts], because reason: String) -> [DistractionDecision] {
        apps.map {
            DistractionDecision(bundleID: $0.bundleID, name: $0.name, close: false,
                                reason: reason, source: .unmentioned)
        }
    }
}
