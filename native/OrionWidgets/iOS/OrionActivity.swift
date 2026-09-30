import ActivityKit
import Foundation

/*
 ORION on the lock screen and in the Dynamic Island (2026-09-29).

 One Live Activity at a time, showing the thing that matters now: the
 check-in he's chasing, else the block that's on (with its time running
 down), else what starts within the hour. Compiled into both the app, which
 starts and updates it, and the widget extension, which draws it.
*/
struct OrionActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "checkin", "now" or "next".
        var mode: String
        var title: String
        var detail: String
        var kind: String
        var start: Date
        var end: Date
        /// Check-in escalation, 0–4; 0 when not a check-in.
        var level: Int
        var nextTitle: String?
        var nextAt: Date?
        /// OrionGlance.Mood raw value, for the hologram still.
        var mood: String
    }
}

#if canImport(AlarmKit)
import AlarmKit

/// The wake alarm's metadata; the app schedules it, the extension draws its countdown.
@available(iOS 26.0, *)
struct WakeMetadata: AlarmMetadata {}
#endif
