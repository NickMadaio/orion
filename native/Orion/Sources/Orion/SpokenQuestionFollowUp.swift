import Foundation

/*
 An unanswered spoken question must not die (awareness spec 3.7).

 The 10:36 incident: ORION asked "what would you like to add?" through the
 speakers, opened the 6 s follow-up ear, heard nothing, and the conversation
 ended without a trace. Now a question that goes unanswered for about 20 s is
 asked once more:
   - he is at the Mac (screen unlocked and awake, and not known to be away from
     home): "Nick? ..." aloud, with the bubble kept on screen;
   - he is really away (screen locked, display asleep, or awareness says he is not
     home): the question goes to his phone.
 Keyboard and mouse idle does NOT mean away: in hands-free voice chat he talks
 without touching either. Never more than one repeat per question, and only for
 a question whose answer is needed (`needsAnswer`), not a rhetorical one.

 `SpokenQuestionFollowUp` is the pure policy (clock and idle are arguments).
 `SpokenQuestionDriver` is the thin shell around it: a wall-clock timer, injected
 so tests can fire it by hand.
*/

struct SpokenQuestionFollowUp: Equatable {
    /// Silence after the question that triggers the one repeat.
    static let deadline: TimeInterval = 20

    enum Action: Equatable {
        case none
        case repeatAloud(String)
        case sendToPhone(String)
    }

    struct Armed: Equatable {
        var text: String
        var reachID: String?
        var due: Date
        /// orion-reach already put this on his phone (channel "phone"): never send it there again.
        var onPhone: Bool = false
    }

    private(set) var armed: Armed?
    /// The question already repeated: its repeat ("Nick? ...") ends in "?" too
    /// and must not arm a second round.
    private(set) var spentText: String?

    /// Longest text still treated as a question rather than narrative. The 10-19 morning brief was 359 characters.
    static let maxQuestionLength = 200
    static let maxQuestionSentences = 3
    /// Reach kinds that are never a question, whatever they end with.
    static let narrativeKinds: Set<String> = ["info", "update", "reminder", "warning", "brief", "summary", "briefing", "narrative"]

    /// Sentences, each keeping its own terminal punctuation.
    static func sentences(_ text: String) -> [String] {
        var out: [String] = [], current = ""
        for ch in text {
            current.append(ch)
            if ".!?".contains(ch) {
                let piece = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !piece.isEmpty { out.append(piece) }
                current = ""
            }
        }
        let rest = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !rest.isEmpty { out.append(rest) }
        return out
    }

    /// A brief, summary or any long output: a statement, however it ends. Never re-spoken.
    /// Newlines do not decide this: a short list followed by "Which one?" is still a question.
    /// Length and sentence count keep briefs out.
    static func isNarrative(_ text: String) -> Bool {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.count > maxQuestionLength || sentences(clean).count > maxQuestionSentences
    }

    /// The last sentence that is a question: what is repeated, never the whole message.
    /// Works line by line first, so list items above the question are not read out with it.
    static func finalQuestion(_ text: String) -> String? {
        for line in text.split(whereSeparator: \.isNewline).reversed() {
            if let question = sentences(String(line)).last(where: { isQuestion($0) }) { return question }
        }
        return nil
    }

    /// True when the text, ignoring trailing quotes, emoji and spaces, ends in "?".
    static func isQuestion(_ text: String) -> Bool {
        let trimmed = text.unicodeScalars.reversed().drop { scalar in
            scalar.properties.isWhitespace
                || "\"'\u{201C}\u{201D}\u{2018}\u{2019})]".unicodeScalars.contains(scalar)
                || (scalar.value > 0x2000 && scalar.properties.isEmoji)
                || scalar.value == 0xFE0F || scalar.value == 0x200D
        }
        return trimmed.first == "?"
    }

    private static let conversational = try! NSRegularExpression(pattern:
        #"^(?:anything else|is there anything|does that|did that|do you follow|make sense|sound good|how(?:'s| is) that|how are you|what do you think|isn't it|right|ok(?:ay)?|you know|huh|really|no\?)"#, options: [.caseInsensitive])
    private static let needed = try! NSRegularExpression(pattern:
        #"\b(?:what would you like|what should i|what time|when (?:should|would|do)|which (?:one|day|block|class|task)|where (?:should|would)|how long|do you want me to|want me to|shall i|should i|what (?:do you want|do you need)|who should)\b"#, options: [.caseInsensitive])

    /// A question ORION is waiting on (what to add, which one, when): worth asking twice. A chatty or rhetorical one
    /// ("Anything else?", "Does that help?") is not, and an ordinary reply that merely ends in "?" is not either.
    static func needsAnswer(_ text: String) -> Bool {
        guard isQuestion(text), !isNarrative(text) else { return false }
        let sentence = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(sentence.startIndex..., in: sentence)
        // the last sentence is the one asked
        let last = sentence.split(whereSeparator: { ".!".contains($0) }).last.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? sentence
        let lastRange = NSRange(last.startIndex..., in: last)
        if conversational.firstMatch(in: last, range: lastRange) != nil { return false }
        return needed.firstMatch(in: sentence, range: range) != nil
    }

    /// Start (or restart) the clock for a question ORION just asked.
    /// Briefs, summaries and long output are refused here, so no caller can arm one.
    mutating func arm(text: String, reachID: String? = nil, onPhone: Bool = false, at now: Date) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, Self.isQuestion(clean), !Self.isNarrative(clean) else { return }
        if let spent = spentText, clean.contains(spent) { return }
        // The same question armed twice (reach, then speech) keeps its id.
        let id = (armed?.text == clean ? armed?.reachID : nil) ?? reachID
        armed = Armed(text: clean, reachID: id, due: now.addingTimeInterval(Self.deadline), onPhone: onPhone || (armed?.text == clean && armed?.onPhone == true))
    }

    /// The speech ended: the 20 s run from here, not from when it began.
    mutating func speechEnded(at now: Date) {
        guard var current = armed else { return }
        current.due = now.addingTimeInterval(Self.deadline)
        armed = current
    }

    /// Any user turn (voice or typed): the question was heard.
    mutating func answered() {
        armed = nil
        spentText = nil
    }

    /// What to do now. At most one non-`.none` result per question. `idle` is accepted for callers but never decides:
    /// away means locked, display asleep, or not home per awareness (`atHome == false`; nil is unknown, which is not away).
    mutating func tick(now: Date, idle: TimeInterval?, locked: Bool, displayAsleep: Bool = false, atHome: Bool? = nil) -> Action {
        guard let current = armed, now >= current.due else { return .none }
        armed = nil
        let question = Self.finalQuestion(current.text) ?? current.text
        spentText = question
        let away = locked || displayAsleep || atHome == false
        if away { return current.onPhone ? .none : .sendToPhone(question) }
        return .repeatAloud(question)
    }
}

/// Whether awareness.json says he is at home: true/false when its location is fresh, nil when unknown.
enum AwarenessHome {
    static func atHome(from data: Data, now: Date = Date()) -> Bool? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let location = root["location"] as? [String: Any], let state = location["state"] as? String,
              let stamp = location["at"] as? String, let at = ISO8601DateFormatter().date(from: stamp) else { return nil }
        let region = (location["source"] as? String) == "region"
        guard now.timeIntervalSince(at) <= (region ? 12 * 3600 : 20 * 60) else { return nil }
        switch state {
        case "home": return true
        case "elsewhere", "moving": return false
        case "known": return (location["placeId"] as? String) == "home"
        default: return nil
        }
    }

    static func current() -> Bool? {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/awareness.json")
        return (try? Data(contentsOf: file)).flatMap { atHome(from: $0) }
    }
}

/// Starts a one-shot timer; the returned closure cancels it.
protocol QuestionScheduler {
    func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> () -> Void
}

/// Wall-clock, so it still fires while the panel is hidden or the machine napped.
struct WallClockScheduler: QuestionScheduler {
    func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> () -> Void {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(wallDeadline: .now() + seconds)
        timer.setEventHandler { timer.cancel(); fire() }
        timer.resume()
        return { timer.cancel() }
    }
}

/// Main-thread only.
final class SpokenQuestionDriver {
    /// Waits for him to finish a sentence before repeating over him.
    static let busyRetry: TimeInterval = 3
    static let maxBusyRetries = 10

    private(set) var policy = SpokenQuestionFollowUp()
    private let scheduler: QuestionScheduler
    private let now: () -> Date
    private let idle: () -> TimeInterval?
    private let locked: () -> Bool
    private let displayAsleep: () -> Bool
    private let atHome: () -> Bool?
    private let busy: () -> Bool
    private let onRepeatAloud: (String) -> Void
    private let onSendToPhone: (String) -> Void
    private var cancel: (() -> Void)?
    private var busyRetries = 0

    init(scheduler: QuestionScheduler = WallClockScheduler(),
         now: @escaping () -> Date = Date.init,
         idle: @escaping () -> TimeInterval?,
         locked: @escaping () -> Bool,
         displayAsleep: @escaping () -> Bool = { false },
         atHome: @escaping () -> Bool? = { nil },
         busy: @escaping () -> Bool = { false },
         onRepeatAloud: @escaping (String) -> Void,
         onSendToPhone: @escaping (String) -> Void) {
        self.scheduler = scheduler; self.now = now; self.idle = idle; self.locked = locked; self.displayAsleep = displayAsleep; self.atHome = atHome; self.busy = busy
        self.onRepeatAloud = onRepeatAloud; self.onSendToPhone = onSendToPhone
    }

    func arm(text: String, reachID: String? = nil, onPhone: Bool = false) {
        policy.arm(text: text, reachID: reachID, onPhone: onPhone, at: now())
        reschedule(after: SpokenQuestionFollowUp.deadline)
    }

    func speechEnded() {
        guard policy.armed != nil else { return }
        policy.speechEnded(at: now())
        reschedule(after: SpokenQuestionFollowUp.deadline)
    }

    func answered() {
        policy.answered()
        cancel?(); cancel = nil
    }

    private func reschedule(after seconds: TimeInterval) {
        cancel?()
        busyRetries = 0
        guard policy.armed != nil else { cancel = nil; return }
        cancel = scheduler.schedule(after: seconds) { [weak self] in self?.fire() }
    }

    private func fire() {
        cancel = nil
        guard policy.armed != nil else { return }
        if busy(), busyRetries < Self.maxBusyRetries {
            busyRetries += 1
            cancel = scheduler.schedule(after: Self.busyRetry) { [weak self] in self?.fire() }
            return
        }
        switch policy.tick(now: now(), idle: idle(), locked: locked(), displayAsleep: displayAsleep(), atHome: atHome()) {
        case .none:
            // Fired a little early (clock rebased): look again at the real deadline.
            if let due = policy.armed?.due { reschedule(after: max(1, due.timeIntervalSince(now()))) }
        case .repeatAloud(let text): onRepeatAloud("Nick? " + text)
        case .sendToPhone(let text): onSendToPhone(text)
        }
    }

    /// The phone branch, by name per contract C3/C4. nil when orion-reach or node is missing.
    /// `--no-queue`: if a focus session began meanwhile, a held copy is pointless, so drop it.
    static func phoneCommand(text: String, node: String, scriptsDir: String, exists: (String) -> Bool) -> PhaseCommand? {
        let reach = scriptsDir + "/orion-reach"
        guard exists(node), exists(reach) else { return nil }
        return PhaseCommand(executable: node, arguments: [
            reach, text, "--kind", "question", "--channel", "phone", "--no-queue",
            "--ask", "{\"type\":\"voice-repeat\"}", "--why", "unanswered spoken question",
        ])
    }
}
