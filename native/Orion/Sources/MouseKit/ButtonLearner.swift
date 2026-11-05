import Foundation

/// What the tap saw while listening for a new button.
public enum LearnInput: Equatable {
    case button(Int)   // a mouse button (3...31) or a key button (113...120)
    case cancel        // Esc

    /// A key press: Esc cancels, F13...F20 is a key button, anything else (typing keys, chords) is not for the learner.
    public static func from(keyCode: Int64, hasModifiers: Bool) -> LearnInput? {
        guard !hasModifiers else { return nil }
        if keyCode == 53 { return .cancel }
        return KeyButtons.id(forKeyCode: keyCode).map(LearnInput.button)
    }

    public static func fromMouse(button: Int) -> LearnInput? {
        (3...31).contains(button) ? .button(button) : nil
    }

    /// The id the tap files a swallowed key under, so its repeats and its up are swallowed too.
    public static func trackId(forKeyCode code: Int64) -> Int? {
        code == 53 ? 1 : KeyButtons.id(forKeyCode: code)
    }
}

public enum LearnArm: Equatable { case listening, refusedGame }
public enum LearnOutcome: Equatable { case captured(Int), cancelled, timedOut, refusedGame, ignored }

/// "Add a button": listens for the next press for ten seconds. Pure; the clock and the game flag are passed in.
public struct ButtonLearner: Equatable {
    public static let window: TimeInterval = 10
    public private(set) var deadline: Date?
    public init() {}

    public var isListening: Bool { deadline != nil }

    public mutating func arm(now: Date, gameInFront: Bool) -> LearnArm {
        guard !gameInFront else { deadline = nil; return .refusedGame }
        deadline = now.addingTimeInterval(Self.window)
        return .listening
    }

    public mutating func disarm() { deadline = nil }

    /// True when the window just ran out (and stops listening).
    public mutating func expire(now: Date) -> Bool {
        guard let deadline, now >= deadline else { return false }
        self.deadline = nil
        return true
    }

    public mutating func feed(_ input: LearnInput, now: Date, gameInFront: Bool) -> LearnOutcome {
        guard isListening else { return .ignored }
        if expire(now: now) { return .timedOut }
        if gameInFront { deadline = nil; return .refusedGame }
        deadline = nil
        switch input {
        case .cancel: return .cancelled
        case .button(let id): return .captured(id)
        }
    }
}

public enum LearnWords {
    public static let armed = "Okay, press the button you want to add. I'm listening for 10 seconds, and Esc cancels."
    public static let timedOut = "I didn't catch a button. Press Add a button to try again."
    public static let cancelled = "Okay, stopped listening."
    public static let refusedGame = "A game is in front, so I'm not listening. Try again once it's closed."

    public static func label(_ id: Int, buttonCount: Int) -> String {
        guard KeyButtons.isKeyButton(id) else { return "Button \(id + 1)" }
        return "Button \(buttonCount + 1 + id - KeyButtons.defaultId) (F\(KeyButtons.fNumber(id)))"
    }

    public static func captured(_ id: Int, buttonCount: Int) -> String {
        "Got it: \(label(id, buttonCount: buttonCount)). Pick what it does below."
    }
}
