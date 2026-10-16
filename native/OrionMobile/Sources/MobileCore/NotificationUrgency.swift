import Foundation

/// Which alert records the phone shows as time-sensitive (breaks through a Focus).
///
/// 2026-10-16 audit (#12): an urgent outreach message never arrived urgent,
/// because the alert always carried level 1. The Mac link now writes level 2 for
/// an urgent `kind "orion"` alert, and this rule honours it.
public enum NotificationUrgency {
    public static func isTimeSensitive(kind: String?, level: Int) -> Bool {
        (kind == "checkin" && level >= 2) || (kind == "orion" && level >= 2) || kind == "approval"
    }
}
