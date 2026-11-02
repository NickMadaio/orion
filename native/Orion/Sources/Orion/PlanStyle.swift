import Foundation
import MobileCore
import SwiftUI

/*
 Wave 14 (Plan tab): the small decisions behind the rounder Plan page, kept pure so they can be pinned by tests
 and the views stay drawing code.
   · PlanBlockFamily  which colour a timeline node takes: class, movement, task, free time or travel;
   · CalendarDots     which dots a month day shows: one per kind of thing, capped, with what did not fit counted;
   · PlanNotice       the Calendar/Reminders warnings folded into one quiet capsule;
   · MonthTravel      which way a month page slides;
   · PlanRings        how full the Open ring is.
*/

/// The colour family of one block on the plan timeline. The planner only knows commitment / task / free /
/// transition; Nick reads his day as class, gym, tasks and free time, so the node colour follows that reading.
enum PlanBlockFamily: Equatable {
    case classTime, move, task, free, travel

    /// Whole words that mean "moving the body". Matched as words so "prune" never reads as "run".
    private static let movementWords: Set<String> = ["gym", "run", "running", "workout", "lift", "lifting", "swim",
                                                     "yoga", "walk", "climb", "climbing", "cardio", "train", "training"]
    private static let travelWords: Set<String> = ["commute", "travel", "drive", "bus", "train-ride", "transit"]

    static func of(kind: TodayPlanBlock.Kind, title: String) -> PlanBlockFamily {
        let words = Set(title.lowercased().split(whereSeparator: { !$0.isLetter && $0 != "-" }).map(String.init))
        switch kind {
        case .free: return .free
        case .transition: return .travel
        case .commitment: return words.isDisjoint(with: travelWords) ? .classTime : .travel
        case .task: return words.isDisjoint(with: movementWords) ? .task : .move
        }
    }

    var hue: Color {
        switch self {
        case .classTime: return OrionTheme.violet
        case .move: return OrionTheme.orange
        case .task: return OrionTheme.accent
        case .free: return OrionTheme.green
        case .travel: return OrionTheme.textSoft
        }
    }
}

/// The dots under a day number in the month view.
enum CalendarDots {
    struct Result: Equatable {
        let shown: [CalendarEntry]
        let overflow: Int
    }

    /// One dot per kind of thing (each event colour, done, due, overdue, focus), in the order they first appear,
    /// capped at `limit`. Three lectures in the same calendar are one dot: the dot says "class happened", and a
    /// row of identical dots is noise.
    static func make(for entries: [CalendarEntry], limit: Int = 4) -> Result {
        let distinct = entries.reduce(into: (seen: Set<String>(), kept: [CalendarEntry]())) { acc, entry in
            let key = Self.key(entry.kind)
            guard !acc.seen.contains(key) else { return }
            acc = (acc.seen.union([key]), acc.kept + [entry])
        }.kept
        let cap = max(0, limit)
        return Result(shown: Array(distinct.prefix(cap)), overflow: max(0, distinct.count - cap))
    }

    private static func key(_ kind: CalendarEntry.Kind) -> String {
        switch kind {
        case .event(let hex): return "event:\(hex?.uppercased() ?? "-")"
        case .completed: return "completed"
        case .deadline(let overdue): return overdue ? "overdue" : "due"
        case .focus: return "focus"
        }
    }
}

/// The access warnings as one capsule: a short title, the full sentences for whoever opens it, and whether a
/// trip to System Settings would fix it.
struct PlanNotice: Equatable {
    let title: String
    let details: [String]
    let needsSettings: Bool

    static func make(disclosures: [String], remindersGranted: Bool) -> PlanNotice? {
        let lower = disclosures.map { $0.lowercased() }
        let calendarDenied = lower.contains { $0.contains("calendar access") }
        let remindersDenied = !remindersGranted || lower.contains { $0.contains("reminders access") }
        let reminderLine = "Tasks: Reminders access has not been granted, so the task list is empty."
        let details = disclosures + (remindersDenied && !lower.contains(where: { $0.contains("reminders access") }) ? [reminderLine] : [])
        guard !details.isEmpty else { return nil }
        switch (calendarDenied, remindersDenied) {
        case (true, true): return PlanNotice(title: "Calendar and Reminders access needed", details: details, needsSettings: true)
        case (true, false): return PlanNotice(title: "Calendar access needed", details: details, needsSettings: true)
        case (false, true): return PlanNotice(title: "Reminders access needed", details: details, needsSettings: true)
        case (false, false): return PlanNotice(title: "Some of the calendar could not be read", details: details, needsSettings: false)
        }
    }
}

/// Which way a month page slides: forward in time slides in from the right.
enum MonthTravel {
    static func direction(from old: Date, to new: Date, calendar: Calendar = .current) -> Int {
        let a = calendar.dateComponents([.year, .month], from: old)
        let b = calendar.dateComponents([.year, .month], from: new)
        let lhs = (a.year ?? 0) * 12 + (a.month ?? 0)
        let rhs = (b.year ?? 0) * 12 + (b.month ?? 0)
        return rhs == lhs ? 0 : (rhs > lhs ? 1 : -1)
    }
}

enum PlanRings {
    /// The share of the list still open, 0...1. An empty list is an empty ring, not a full one.
    static func openFraction(open: Int, total: Int) -> Double {
        guard total > 0 else { return 0 }
        return min(1, max(0, Double(open) / Double(total)))
    }
}
