import CloudKit
import MobileCore
import UserNotifications
import WidgetKit

/*
 Makes ORION's urgent pushes time-sensitive (2026-09-29).

 CloudKit's push options have no interruption level, so every check-in used to
 arrive as an ordinary notification that a Focus silences. This extension sees
 each one first (the subscription asks for mutable content) and marks as
 time-sensitive exactly three kinds: an urgent outreach message (2026-10-16), a check-in he has already ignored at least
 once (level 2+), and an approval ORION is blocked on. Everything else passes
 through unchanged. Sleep Focus still wins for bedtime nudges: those are the
 phone's own notifications and never come through here.
*/
final class NotificationService: UNNotificationServiceExtension {
    private var deliver: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        deliver = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content); return
        }
        self.content = content
        let fields = (CKNotification(fromRemoteNotificationDictionary: request.content.userInfo) as? CKQueryNotification)?.recordFields
        let kind = fields?["kind"] as? String
        let level = fields?["level"] as? Int ?? 0
        if Self.isUrgent(kind: kind, level: level) {
            content.interruptionLevel = .timeSensitive
            content.relevanceScore = min(1, 0.5 + Double(level) * 0.15)
        }
        if kind == "checkin" { content.threadIdentifier = "orion.checkin" }
        // WP5: a CloudKit subscription has one fixed category, so the record's own `category` is applied here:
        // a question gets "orion.ask" (a text-reply field), everything else keeps the check-in buttons.
        if let category = fields?["category"] as? String, ["orion.ask", "orion.checkin"].contains(category) {
            content.categoryIdentifier = category
        }
        // The check-in widgets and lock screen redraw from the app's next glance.
        WidgetCenter.shared.reloadAllTimelines()
        contentHandler(content)
    }

    override func serviceExtensionTimeWillExpire() {
        if let deliver, let content { deliver(content) }
    }

    static func isUrgent(kind: String?, level: Int) -> Bool {
        // 2026-10-16: also an urgent outreach message (kind "orion", level 2); rule lives in MobileCore.
        NotificationUrgency.isTimeSensitive(kind: kind, level: level)
    }
}
