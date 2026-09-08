import Foundation

public enum TodayPlanError: Error, LocalizedError, Equatable {
    case invalidInput, invalidPreferences, staleSources, revisionConflict, corruptStore, replayMismatch, nothingToUndo, unknownBlock
    case pinConflict(String)
    public var errorDescription: String? {
        switch self {
        case .invalidInput: return "The plan contains invalid or conflicting data. Refresh its sources."
        case .invalidPreferences: return "Check your day hours, sleep minimum and time budgets."
        case .staleSources: return "Calendar or task data is missing or stale. Refresh before planning."
        case .revisionConflict: return "The plan changed since this preview. Reload and review it again."
        case .corruptStore: return "The saved plan cannot be read safely. Its file has been preserved."
        case .replayMismatch: return "This operation identifier was already used for a different change."
        case .nothingToUndo: return "There is no plan change to undo."
        case .unknownBlock: return "That task block is no longer part of the current plan."
        case .pinConflict(let title): return "The pinned slot for \(title) no longer fits. Finish it, release its pin, or resolve the calendar, estimate or day-budget conflict before replanning."
        }
    }
}

public struct TodayPlanPreferences: Codable, Equatable, Sendable {
    public var wakeMinute: Int = 480
    public var sleepMinute: Int = 1320
    public var minimumSleepMinutes: Int = 480
    public var freeMinutes: Int = 60
    public var transitionMinutes: Int = 10
    public var defaultTaskMinutes: Int = 30
    public init() {}
    public func validate() throws {
        guard (0..<1440).contains(wakeMinute), (1...1440).contains(sleepMinute), wakeMinute < sleepMinute,
              (360...720).contains(minimumSleepMinutes),
              1440 - sleepMinute + wakeMinute >= minimumSleepMinutes,
              (0...720).contains(freeMinutes), (0...120).contains(transitionMinutes),
              (5...240).contains(defaultTaskMinutes) else { throw TodayPlanError.invalidPreferences }
    }
}

public struct TodayPlanTask: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let minutes: Int
    public let priority: Int
    public let due: Date?
    public let completedInSource: Bool
    public init(id: String, title: String, minutes: Int, priority: Int, due: Date? = nil, completedInSource: Bool = false) {
        self.id = id; self.title = title; self.minutes = minutes; self.priority = priority
        self.due = due; self.completedInSource = completedInSource
    }
}

public struct TodayPlanCommitment: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let start: Date
    public let end: Date
    public let allDay: Bool
    public init(id: String, title: String, start: Date, end: Date, allDay: Bool = false) {
        self.id = id; self.title = title; self.start = start; self.end = end; self.allDay = allDay
    }
}

/// A user-chosen slot carried into a new proposal as a hard constraint.
/// Saved snapshots retain this on the task block; older unpinned files decode unchanged.
public struct TodayPlanPin: Equatable, Sendable {
    public let taskID: String
    public let start: Date
    public let end: Date
    public init(taskID: String, start: Date, end: Date) {
        self.taskID = taskID; self.start = start; self.end = end
    }
}

public struct TodayPlanBlock: Codable, Equatable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable { case commitment, task, transition, free }
    public let id: String
    public let sourceID: String?
    public let title: String
    public let kind: Kind
    public let start: Date
    public let end: Date
    public var isPinned: Bool? = nil
    public var pinned: Bool { isPinned == true }
    public var minutes: Int {
        let value = end.timeIntervalSince(start) / 60
        return value.isFinite && value >= 0 && value < Double(Int.max) ? Int(value) : 0
    }
    public func contains(_ date: Date) -> Bool { start <= date && date < end }
}

/// A snapshot is evidence and a proposal, never an executable calendar mutation.
public struct TodayPlan: Codable, Equatable, Sendable {
    public let day: Date
    public let timeZone: String
    public let generatedAt: Date
    public let windowStart: Date
    public let windowEnd: Date
    public let preferences: TodayPlanPreferences
    public let tasks: [TodayPlanTask]
    public let commitments: [TodayPlanCommitment]
    public let blocks: [TodayPlanBlock]
    public let completedIDs: [String]
    public let deferredIDs: [String]
    public let warnings: [String]
    public let reason: String
    public let sourceFingerprint: String
    public var freeMinutes: Int { blocks.filter { $0.kind == .free }.reduce(0) { $0 + $1.minutes } }
    public func freeMinutes(after now: Date) -> Int {
        blocks.filter { $0.kind == .free && $0.end > now }.reduce(0) {
            $0 + max(0, Int($1.end.timeIntervalSince(max(now, $1.start)) / 60))
        }
    }
    public func current(at now: Date) -> TodayPlanBlock? {
        blocks.first { $0.contains(now) && $0.kind != .free && $0.kind != .transition }
            ?? blocks.first { $0.contains(now) }
    }
    public func nextCommitment(at now: Date) -> TodayPlanBlock? { blocks.first { $0.start > now && $0.kind == .commitment } }
    public func next(at now: Date) -> TodayPlanBlock? { blocks.first { $0.start > now && $0.kind != .transition } }

    func validateInputs() throws {
        try preferences.validate()
        guard TimeZone(identifier: timeZone) != nil, finite(day), finite(generatedAt),
              finite(windowStart), finite(windowEnd), windowStart <= windowEnd,
              windowEnd.timeIntervalSince(day) <= 26 * 3600,
              tasks.count <= 500, commitments.count <= 1000, blocks.count <= 5000,
              Set(tasks.map(\.id)).count == tasks.count,
              Set(commitments.map(\.id)).count == commitments.count,
              Set(blocks.map(\.id)).count == blocks.count,
              tasks.allSatisfy({ validText($0.id) && validText($0.title) && (1...720).contains($0.minutes)
                  && (-1000...1000).contains($0.priority) && ($0.due.map(finite) ?? true) }),
              commitments.allSatisfy({ validText($0.id) && validText($0.title) && finite($0.start) && finite($0.end) && $0.end > $0.start }),
              blocks.allSatisfy({ validText($0.id) && validText($0.title) && finite($0.start) && finite($0.end) && $0.start < $0.end }),
              validText(reason), validText(sourceFingerprint), completedIDs.count <= 1000, Set(completedIDs).count == completedIDs.count,
              completedIDs.allSatisfy(validText), warnings.count <= 2000 else { throw TodayPlanError.invalidInput }
        guard let zone = TimeZone(identifier: timeZone) else { throw TodayPlanError.invalidInput }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        guard calendar.startOfDay(for: generatedAt) == day,
              let tomorrow = calendar.date(byAdding: .day, value: 1, to: day),
              let wake = calendar.date(bySettingHour: preferences.wakeMinute / 60, minute: preferences.wakeMinute % 60, second: 0, of: day),
              let sleep = calendar.date(bySettingHour: (preferences.sleepMinute / 60) % 24, minute: preferences.sleepMinute % 60, second: 0,
                                        of: preferences.sleepMinute == 1440 ? tomorrow : day),
              let nextWake = calendar.date(bySettingHour: preferences.wakeMinute / 60, minute: preferences.wakeMinute % 60, second: 0, of: tomorrow),
              nextWake.timeIntervalSince(sleep) >= Double(preferences.minimumSleepMinutes * 60),
              windowEnd == sleep,
              windowStart == min(sleep, max(wake, Date(timeIntervalSinceReferenceDate: ceil(generatedAt.timeIntervalSinceReferenceDate / 60) * 60))),
              warnings.allSatisfy(validText), deferredIDs.count <= tasks.count,
              Set(deferredIDs).count == deferredIDs.count else { throw TodayPlanError.invalidInput }
    }

    public func validate() throws {
        try validateInputs()
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: timeZone)!
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: day)!
        let wake = calendar.date(bySettingHour: preferences.wakeMinute / 60, minute: preferences.wakeMinute % 60, second: 0, of: day)!
        let fixed = commitments.filter { !$0.allDay && $0.start < tomorrow && $0.end > day }
        let eventBlocks = blocks.filter { $0.kind == .commitment }
        guard Set(eventBlocks.compactMap(\.sourceID)) == Set(fixed.map(\.id)), eventBlocks.count == fixed.count,
              blocks == blocks.sorted(by: { ($0.start, $0.id) < ($1.start, $1.id) }) else { throw TodayPlanError.invalidInput }
        let scheduled = blocks.filter { $0.kind == .task }
        let unfinished = Set(tasks.filter { !$0.completedInSource && !completedIDs.contains($0.id) }.map(\.id))
        guard Set(deferredIDs).isDisjoint(with: Set(scheduled.compactMap(\.sourceID))),
              unfinished == Set(deferredIDs).union(scheduled.compactMap(\.sourceID)) else { throw TodayPlanError.invalidInput }
        let taskMinutes = scheduled.reduce(0) { $0 + $1.minutes }
        guard freeMinutes >= min(preferences.freeMinutes, freeMinutes + taskMinutes) else { throw TodayPlanError.invalidInput }
        for block in blocks where block.kind != .commitment {
            let earliest = block.pinned && block.kind == .task ? wake : windowStart
            guard block.start >= earliest, block.end <= windowEnd,
                  (!block.pinned || (block.kind == .task && block.end > generatedAt)),
                  !blocks.contains(where: { $0.id != block.id && $0.start < block.end && block.start < $0.end })
            else { throw TodayPlanError.invalidInput }
        }
        for block in blocks where block.kind == .commitment {
            guard !block.pinned, commitments.contains(where: { $0.id == block.sourceID && !$0.allDay && $0.start == block.start && $0.end == block.end })
            else { throw TodayPlanError.invalidInput }
        }
        guard Set(scheduled.compactMap(\.sourceID)).count == scheduled.count else { throw TodayPlanError.invalidInput }
        for block in scheduled {
            guard block.start >= (block.pinned ? wake : windowStart), block.end <= windowEnd,
                  let id = block.sourceID, !completedIDs.contains(id),
                  tasks.contains(where: { $0.id == id && !$0.completedInSource
                      && block.end.timeIntervalSince(block.start) == Double($0.minutes * 60)
                      && ($0.due.map { $0 < generatedAt || block.end <= $0 } ?? true) }),
                  !fixed.contains(where: { $0.start.addingTimeInterval(-Double(preferences.transitionMinutes * 60)) < block.end
                      && block.start < $0.end.addingTimeInterval(Double(preferences.transitionMinutes * 60)) }),
                  !blocks.contains(where: { $0.id != block.id && $0.start < block.end && block.start < $0.end })
            else { throw TodayPlanError.invalidInput }
        }
    }
}

// Bound dates before handing them to Calendar or converting durations to Int.
func finite(_ date: Date) -> Bool {
    date.timeIntervalSinceReferenceDate.isFinite && (Date.distantPast...Date.distantFuture).contains(date)
}
func validText(_ value: String) -> Bool { !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf8.count <= 4096 }
