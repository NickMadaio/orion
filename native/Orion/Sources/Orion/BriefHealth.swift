import Foundation

/// Each component can come from a different record. Fetch time is not record
/// age, and a recent recovery must not make older sleep or strain current.
extension WhoopSnapshot {
    func briefReadingAgeHours(at now: Date) -> Double? {
        var dates: [Date?] = []
        if recovery != nil { dates.append(recoverySleepEndedAt) }
        if sleepPerformance != nil || sleepHours != nil { dates.append(sleepRecordedOn) }
        if strain != nil { dates.append(strainRecordedOn) }
        guard !dates.isEmpty, dates.allSatisfy({ $0.map { $0 <= now } ?? false }),
              let oldest = dates.compactMap({ $0 }).min() else { return nil }
        return now.timeIntervalSince(oldest) / 3600
    }

    func briefHighlights(clock: BriefClock) -> [BriefHighlight] {
        var result: [BriefHighlight] = []
        if recovery != nil {
            let signal = PlanningSignal.derive(recovery: recovery, sleepPerformance: nil,
                sleepHours: nil, strain: nil, sampleCount: 0, readingAgeHours: nil)
            result.append(BriefHighlight(id: "recovery", text:
                "The available recovery signal is \(signal.recoveryWord); \(clock.recordLabel(recoverySleepEndedAt, subject: "associated sleep ended"))."))
        }
        if sleepPerformance != nil || sleepHours != nil {
            // Describe provenance, without turning a fixed score threshold into
            // an assertion about Nick's personal baseline or today's capacity.
            result.append(BriefHighlight(id: "sleep", text:
                "For the available sleep information, \(clock.recordLabel(sleepRecordedOn, subject: "sleep ended"))."))
        }
        return result
    }
}
