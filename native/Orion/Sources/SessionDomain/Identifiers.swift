//
//  The names things go by, and why each one is shaped the way it is.
//
//  Two of these carry real weight.
//
//  `RequestID` is what makes commands idempotent. Every caller — voice, the
//  dashboard, the Console, a script over IPC — stamps its command with one, and
//  the reducer refuses a request ID it has already applied. That is what lets a
//  retry after a timeout be safe: the second attempt is not a second pause.
//
//  `EffectID` is what makes effects replay-safe. It is DERIVED, not random:
//  the same effect computed twice produces the same ID, so a crash between
//  "emit" and "acknowledge" cannot speak the same line twice or append a second
//  history record for one session. A random ID would defeat the entire point,
//  because after a restart the domain would not recognise its own past work.
//

import Foundation

// MARK: - Session identity

public struct SessionID: Hashable, Codable, CustomStringConvertible, Sendable {
    public let raw: String

    public init(_ raw: String) { self.raw = raw }

    /// Injected rather than generated, because the domain is pure. The service
    /// supplies one at start; the tests supply a fixed one so fixtures are
    /// stable.
    public init(from uuid: UUID) { raw = uuid.uuidString }

    public var description: String { raw }
}

// MARK: - Phases

public struct PhaseID: Hashable, Codable, CustomStringConvertible, Sendable {
    public let raw: String

    public init(_ raw: String) { self.raw = raw }

    /// Derived from the session and the position, so a phase's identity is a
    /// fact about the plan rather than a random number that has to be persisted
    /// and matched up later.
    public init(session: SessionID, index: Int) {
        raw = "\(session.raw)#\(index)"
    }

    public var description: String { raw }
}

// MARK: - Requests

/// The idempotency key on a command.
public struct RequestID: Hashable, Codable, CustomStringConvertible, Sendable {
    public let raw: String

    public init(_ raw: String) { self.raw = raw }
    public init(from uuid: UUID) { raw = uuid.uuidString }

    public var description: String { raw }
}

// MARK: - Effects

/// A stable name for one side effect.
///
/// Derived from what the effect IS, never from when it was produced. Two runs
/// of `reconcile` over the same state must name the same effect identically or
/// acknowledgement cannot work across a restart.
public struct EffectID: Hashable, Codable, CustomStringConvertible, Sendable {
    public let raw: String

    public init(_ raw: String) { self.raw = raw }

    public init(session: SessionID, phaseIndex: Int, kind: String) {
        raw = "\(session.raw)/\(phaseIndex)/\(kind)"
    }

    /// For effects that belong to the session as a whole rather than to a phase.
    public init(session: SessionID, kind: String) {
        raw = "\(session.raw)/-/\(kind)"
    }

    public var description: String { raw }
}

// MARK: - Day keys

/// What logical day a session belongs to.
///
/// A protocol rather than a function because the app's answer is not the
/// domain's answer. `OrionDay` in the app target takes the LATER of the WHOOP
/// wake time and a 4 am floor, and it reads UserDefaults to do it — impure, and
/// not something the domain should reimplement or be coupled to. So the app
/// injects its own provider and stays the single authority on what day it is.
///
/// The default below is the floor half of that rule, which is the part that can
/// be pure. It exists so tests and headless callers have a correct answer
/// without the app.
public protocol DayKeyProvider: Sendable {
    func key(at instant: Date) -> String
}

/// The 4 am cutoff rule, with no wake-time input.
///
/// Mirrors `OrionDay.cutoff(before:)` deliberately, including the hour. Working
/// until 2 am is a late night, not an early morning, and a session started then
/// belongs to the day that is ending.
///
/// **Never `toISOString()`.** That is UTC, and west of Greenwich it rolls over
/// before local midnight — at 22:30 in New York it already says tomorrow. This
/// project has already shipped that bug once, in `orion-daily`, where it filed
/// every evening's memory under the following day.
public struct CutoffDayKeys: DayKeyProvider {
    public let cutoffHour: Int
    public let calendar: Calendar

    public init(cutoffHour: Int = 4, calendar: Calendar = .current) {
        self.cutoffHour = cutoffHour
        self.calendar = calendar
    }

    public func key(at instant: Date) -> String {
        CivilDay(of: dayStart(at: instant), in: calendar.timeZone).key
    }

    /// The most recent occurrence of the cutoff hour at or before `instant`.
    public func dayStart(at instant: Date) -> Date {
        let todaysCutoff = calendar.date(
            bySettingHour: cutoffHour, minute: 0, second: 0, of: instant
        ) ?? calendar.startOfDay(for: instant)

        if todaysCutoff <= instant { return todaysCutoff }
        return calendar.date(byAdding: .day, value: -1, to: todaysCutoff) ?? todaysCutoff
    }

    // There is deliberately no `DateFormatter` here any more, and the reason is
    // a defect this file shipped with.
    //
    // The key used to be rendered by a shared static formatter that set a
    // locale and NO time zone — so it formatted in `TimeZone.current`, the
    // MACHINE's zone, while `dayStart` computed the boundary in the INJECTED
    // calendar's zone. Whenever those two disagreed, the key named the wrong
    // day. Measured 2026-09-01, London calendar on a New York machine:
    //
    //     instant 2026-09-08T04:30Z  (05:30 in London, past the 4am cutoff)
    //     dayStart -> 2026-09-08T03:00Z   key() -> "2026-09-07"    off by one
    //
    // It was invisible because the tests inject `America/New_York` on a machine
    // that IS `America/New_York`, so the injection proved nothing — the same
    // self-verifying shape AGENTS.md already records. It becomes live the
    // moment the machine's zone and Orion's home zone differ, which is what
    // happens when Nick lands in London.
    //
    // `CivilDay` has no instant to render, so the class of bug is gone rather
    // than fixed: there is nothing left that could pick a zone on its own.
}
