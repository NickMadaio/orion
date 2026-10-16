import Foundation

/*
 An unanswered spoken question must not die (awareness spec 3.7).

 The 10:36 incident: ORION asked "what would you like to add?" through the
 speakers, opened the 6 s follow-up ear, heard nothing, and the conversation
 ended without a trace. Now a question that goes unanswered for about 20 s is
 asked once more:
   - he is at the Mac (recent input, screen unlocked): "Nick? ..." aloud, with
     the bubble kept on screen;
   - he is idle or away: the question goes to his phone.
 Never more than one repeat per question.

 `SpokenQuestionFollowUp` is the pure policy (clock and idle are arguments).
 `SpokenQuestionDriver` is the thin shell around it: a wall-clock timer, injected
 so tests can fire it by hand.
*/

struct SpokenQuestionFollowUp: Equatable {
    /// Silence after the question that triggers the one repeat.
    static let deadline: TimeInterval = 20
    /// Idle at or past this reads as "not at the Mac".
    static let idleAway: TimeInterval = 20

    enum Action: Equatable {
        case none
        case repeatAloud(String)
        case sendToPhone(String)
    }

    struct Armed: Equatable {
        var text: String
        var reachID: String?
        var due: Date
    }

    private(set) var armed: Armed?
    /// The question already repeated: its repeat ("Nick? ...") ends in "?" too
    /// and must not arm a second round.
    private(set) var spentText: String?

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

    /// Start (or restart) the clock for a question ORION just asked.
    mutating func arm(text: String, reachID: String? = nil, at now: Date) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        if let spent = spentText, clean.contains(spent) { return }
        // The same question armed twice (reach, then speech) keeps its id.
        let id = (armed?.text == clean ? armed?.reachID : nil) ?? reachID
        armed = Armed(text: clean, reachID: id, due: now.addingTimeInterval(Self.deadline))
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

    /// What to do now. At most one non-`.none` result per question.
    mutating func tick(now: Date, idle: TimeInterval?, locked: Bool) -> Action {
        guard let current = armed, now >= current.due else { return .none }
        armed = nil
        spentText = current.text
        let atMac = !locked && (idle.map { $0 < Self.idleAway } ?? false)
        return atMac ? .repeatAloud(current.text) : .sendToPhone(current.text)
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
    private let busy: () -> Bool
    private let onRepeatAloud: (String) -> Void
    private let onSendToPhone: (String) -> Void
    private var cancel: (() -> Void)?
    private var busyRetries = 0

    init(scheduler: QuestionScheduler = WallClockScheduler(),
         now: @escaping () -> Date = Date.init,
         idle: @escaping () -> TimeInterval?,
         locked: @escaping () -> Bool,
         busy: @escaping () -> Bool = { false },
         onRepeatAloud: @escaping (String) -> Void,
         onSendToPhone: @escaping (String) -> Void) {
        self.scheduler = scheduler; self.now = now; self.idle = idle; self.locked = locked; self.busy = busy
        self.onRepeatAloud = onRepeatAloud; self.onSendToPhone = onSendToPhone
    }

    func arm(text: String, reachID: String? = nil) {
        policy.arm(text: text, reachID: reachID, at: now())
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
        switch policy.tick(now: now(), idle: idle(), locked: locked()) {
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
