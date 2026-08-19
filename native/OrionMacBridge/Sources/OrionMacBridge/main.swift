@preconcurrency import ApplicationServices
import EventKit
import Foundation
import UserNotifications

struct Request: Decodable {
    let id: String
    let action: String
    let payload: [String: String]?
}

struct Response: Encodable {
    let id: String
    let ok: Bool
    let result: [String: String]?
    let error: String?
}

enum BridgeError: LocalizedError {
    case invalidRequest(String)
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message), .unavailable(let message): return message
        }
    }
}

@main
enum OrionMacBridge {
    static let nativeTimerShortcut = "Orion Native Timer"

    static func main() async {
        while let line = readLine() {
            let response: Response
            do {
                let request = try JSONDecoder().decode(Request.self, from: Data(line.utf8))
                let result = try await handle(request)
                response = Response(id: request.id, ok: true, result: result, error: nil)
            } catch {
                response = Response(id: "unknown", ok: false, result: nil, error: error.localizedDescription)
            }
            if let data = try? JSONEncoder().encode(response), let output = String(data: data, encoding: .utf8) {
                print(output)
                fflush(stdout)
            }
        }
    }

    static func handle(_ request: Request) async throws -> [String: String] {
        switch request.action {
        case "status":
            return [
                "platform": "macOS",
                "native_timer_shortcut": nativeTimerShortcut,
                "native_timer_ready": String(shortcutExists(named: nativeTimerShortcut)),
                "notifications": await notificationStatus(),
                "accessibility": accessibilityStatus(),
                "reminders": authorizationStatus(for: .reminder),
                "calendar": authorizationStatus(for: .event),
            ]
        case "request_notifications":
            let granted = try await requestNotificationPermission()
            return ["granted": String(granted)]
        case "request_accessibility":
            let granted = requestAccessibilityAccess()
            return ["granted": String(granted), "settings_opened": String(!granted)]
        case "notify":
            let title = request.payload?["title"] ?? "Orion"
            let body = request.payload?["body"] ?? ""
            try await notify(title: title, body: body)
            return ["status": "scheduled"]
        case "request_reminders_access":
            let granted = try await requestEventAccess(for: .reminder)
            return ["granted": String(granted)]
        case "request_calendar_access":
            let granted = try await requestEventAccess(for: .event)
            return ["granted": String(granted)]
        case "list_upcoming_calendar_events":
            return try listUpcomingCalendarEvents()
        case "list_incomplete_reminders":
            return try await listIncompleteReminders()
        case "create_reminder":
            return try createReminder(payload: request.payload ?? [:])
        case "create_calendar_event":
            return try createCalendarEvent(payload: request.payload ?? [:])
        case "get_calendar_event":
            return try getCalendarEvent(payload: request.payload ?? [:])
        case "delete_calendar_event":
            return try deleteCalendarEvent(payload: request.payload ?? [:])
        case "set_clock_timer":
            guard shortcutExists(named: nativeTimerShortcut) else {
                throw BridgeError.unavailable("Create the Shortcuts shortcut named \(nativeTimerShortcut) with Apple’s Set Timer action first.")
            }
            let seconds = request.payload?["seconds"] ?? ""
            guard Int(seconds) != nil else { throw BridgeError.invalidRequest("A timer duration in seconds is required.") }
            try runShortcut(named: nativeTimerShortcut, input: seconds)
            return ["status": "started", "backend": "macOS Clock"]
        default:
            throw BridgeError.invalidRequest("Unknown native action: \(request.action)")
        }
    }

    static func authorizationStatus(for entity: EKEntityType) -> String {
        switch EKEventStore.authorizationStatus(for: entity) {
        case .fullAccess: return "full_access"
        case .writeOnly: return "write_only"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not_determined"
        @unknown default: return "unknown"
        }
    }

    static func requestEventAccess(for entity: EKEntityType) async throws -> Bool {
        let store = EKEventStore()
        if entity == .event { return try await store.requestFullAccessToEvents() }
        return try await store.requestFullAccessToReminders()
    }

    static func listUpcomingCalendarEvents() throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw BridgeError.unavailable("Allow Calendar access in Orion before asking it to read your schedule.")
        }
        let store = EKEventStore()
        let end = Calendar.current.date(byAdding: .day, value: 7, to: Date())!
        let events = store.events(matching: store.predicateForEvents(withStart: Date(), end: end, calendars: nil))
            .sorted { $0.startDate < $1.startDate }
            .prefix(25)
            .map { event in
                // The identifier travels with every event, not just newly created
                // ones. Without it a caller can only remove something it made
                // moments ago -- ask Orion to cancel a meeting he merely read and
                // he has nothing to name it by, which invites a delete-by-title
                // that the bridge deliberately refuses to offer.
                [
                    "title": event.title ?? "Untitled",
                    "start": ISO8601DateFormatter().string(from: event.startDate),
                    "end": ISO8601DateFormatter().string(from: event.endDate),
                    "identifier": event.calendarItemIdentifier,
                ]
            }
        return ["events_json": String(data: try JSONSerialization.data(withJSONObject: events), encoding: .utf8)!]
    }

    static func listIncompleteReminders() async throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before asking it to read your reminders.")
        }
        let store = EKEventStore()
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let items: [[String: String]] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { values in
                let mapped = (values ?? []).prefix(50).map { reminder in
                    ["title": reminder.title ?? "Untitled", "identifier": reminder.calendarItemIdentifier]
                }
                continuation.resume(returning: mapped)
            }
        }
        return ["reminders_json": String(data: try JSONSerialization.data(withJSONObject: items), encoding: .utf8)!]
    }

    static func createReminder(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before creating a reminder.")
        }
        guard let title = payload["title"], !title.isEmpty else { throw BridgeError.invalidRequest("A reminder title is required.") }
        let store = EKEventStore()
        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.calendar = store.defaultCalendarForNewReminders()
        if let dueAt = payload["due_at"], let date = ISO8601DateFormatter().date(from: dueAt) {
            reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        }
        try store.save(reminder, commit: true)
        return ["status": "created", "identifier": reminder.calendarItemIdentifier]
    }

    static func createCalendarEvent(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw BridgeError.unavailable("Allow Calendar access in Orion before creating an event.")
        }
        guard let title = payload["title"], !title.isEmpty,
              let startText = payload["start"], let start = ISO8601DateFormatter().date(from: startText),
              let endText = payload["end"], let end = ISO8601DateFormatter().date(from: endText), end > start else {
            throw BridgeError.invalidRequest("An event needs a title and valid start and end times.")
        }
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = start
        event.endDate = end
        event.calendar = store.defaultCalendarForNewEvents
        try store.save(event, span: .thisEvent, commit: true)
        return ["status": "created", "identifier": event.calendarItemIdentifier]
    }

    /// Exact readback for a typed mutation. `list_upcoming_calendar_events`
    /// intentionally covers only seven days; using it to verify an event a
    /// month away would report a false failure and invite a duplicate retry.
    static func getCalendarEvent(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw BridgeError.unavailable("Allow Calendar access in Orion before reading an event.")
        }
        guard let identifier = payload["identifier"], !identifier.isEmpty else {
            throw BridgeError.invalidRequest("Reading an event needs its identifier.")
        }
        let store = EKEventStore()
        guard let event = store.calendarItem(withIdentifier: identifier) as? EKEvent else {
            return ["exists": "false", "identifier": identifier]
        }
        return [
            "exists": "true",
            "identifier": identifier,
            "title": event.title ?? "Untitled",
            "start": ISO8601DateFormatter().string(from: event.startDate),
            "end": ISO8601DateFormatter().string(from: event.endDate),
        ]
    }

    /// Remove an event by the identifier `create_calendar_event` handed back.
    ///
    /// Deliberately identifier-only: there is no "delete everything matching
    /// this title" here, because a fuzzy delete against a real calendar that
    /// syncs to every device Nick owns is a bad trade at any convenience.
    /// Anything calling this must have created or read the exact event first.
    static func deleteCalendarEvent(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw BridgeError.unavailable("Allow Calendar access in Orion before removing an event.")
        }
        guard let identifier = payload["identifier"], !identifier.isEmpty else {
            throw BridgeError.invalidRequest("Removing an event needs its identifier.")
        }

        let store = EKEventStore()
        guard let event = store.calendarItem(withIdentifier: identifier) as? EKEvent else {
            throw BridgeError.invalidRequest("No event with that identifier — it may already be gone.")
        }

        let title = event.title ?? "(untitled)"
        try store.remove(event, span: .thisEvent, commit: true)
        return ["status": "deleted", "title": title]
    }

    static func requestNotificationPermission() async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: granted) }
            }
        }
    }

    static func notificationStatus() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "not_determined"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "unknown"
        }
    }

    /// Accessibility is intentionally separate from file and calendar access. macOS
    /// grants it to the signed bridge application, and the prompt opens System
    /// Settings rather than silently enabling computer control.
    static func accessibilityStatus() -> String {
        AXIsProcessTrusted() ? "trusted" : "not_granted"
    }

    static func requestAccessibilityAccess() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    static func notify(title: String, body: String) async throws {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    static func shortcutExists(named name: String) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
        process.arguments = ["list"]
        let output = Pipe()
        process.standardOutput = output
        do {
            try process.run()
            process.waitUntilExit()
            return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.split(separator: "\n").contains(Substring(name)) == true
        } catch { return false }
    }

    static func runShortcut(named name: String, input: String) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
        process.arguments = ["run", name, "-i", input]
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 { throw BridgeError.unavailable("The native timer shortcut could not run.") }
    }
}
