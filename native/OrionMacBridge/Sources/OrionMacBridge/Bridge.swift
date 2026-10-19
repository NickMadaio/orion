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
        // `--selftest` runs pure assertions and exits, without touching
        // stdin or any TCC-gated API. See ScreenPrivacy.swift for why this
        // exists instead of an XCTest target.
        if CommandLine.arguments.contains("--selftest") {
            let failures = ScreenPrivacySelfTest.run()
            if failures.isEmpty {
                print("SELFTEST PASS")
                exit(0)
            }
            for failure in failures {
                print("SELFTEST FAIL: \(failure.name) -- \(failure.detail)")
            }
            print("SELFTEST FAILED (\(failures.count) of the checks)")
            exit(1)
        }
        // Argv mode, not the JSON protocol: a yes/no the caller acts on by exit code.
        if CommandLine.arguments.dropFirst().first == "authenticate" {
            exit(await OwnerAuthentication.run(arguments: CommandLine.arguments))
        }
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
                "screen_recording": ScreenCapture.isGranted() ? "granted" : "not_granted",
            ]
        // PHASE 53/54. Computer use. `screen_observe` reads the accessibility
        // tree (text, cheap, redactable); `screen_capture` is the pixel
        // fallback and needs the stronger Screen Recording grant. Both
        // refuse ENTIRELY -- no partial, no redacted-but-present tree -- for
        // anything ScreenPrivacy denies. See ScreenObserve.swift /
        // ScreenCapture.swift for the actual checks.
        case "screen_observe":
            return try encodeObservation(ScreenObserve.observe())
        case "screen_capture":
            return try encodeCapture(ScreenCapture.capture())
        // PHASE 53. Control. Every case requires `expected_bundle_id` -- the
        // caller must have observed the screen first and named what it saw,
        // or there is nothing to compare the live frontmost app against.
        case "screen_click":
            let expected = try requirePayload(request, "expected_bundle_id")
            guard let xString = request.payload?["x"], let x = Double(xString),
                  let yString = request.payload?["y"], let y = Double(yString) else {
                throw BridgeError.invalidRequest("screen_click requires numeric x and y.")
            }
            let result = try ScreenControl.click(expectedBundleID: expected, x: x, y: y)
            return try encode(result)
        case "screen_type":
            let expected = try requirePayload(request, "expected_bundle_id")
            let text = try requirePayload(request, "text")
            let result = try ScreenControl.type(expectedBundleID: expected, text: text)
            return try encode(result)
        case "screen_key":
            let expected = try requirePayload(request, "expected_bundle_id")
            let key = try requirePayload(request, "key")
            let result = try ScreenControl.key(expectedBundleID: expected, name: key)
            return try encode(result)
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
            // 25 was the old cap: a week of classes plus ORION's own blocks passed
            // it, and the planner could not see the end of the week (2026-09-29).
            let days = Int(request.payload?["days"] ?? "") ?? 7
            let limit = Int(request.payload?["limit"] ?? "") ?? 200
            // "from": "today" also returns what already happened today (2026-10-01:
            // "extend the DS lab" — the lab had ended on the calendar, so ORION could
            // not see it and booked a second one).
            let fromToday = request.payload?["from"] == "today"
            return try listUpcomingCalendarEvents(days: min(max(days, 1), 60), limit: min(max(limit, 1), 500), fromToday: fromToday)
        case "list_deadlines":
            return try listUpcomingCalendarEvents(days: 90, oneOffOnly: true, limit: 40)
        case "list_incomplete_reminders":
            return try await listIncompleteReminders(payload: request.payload ?? [:])
        case "list_reminder_lists":
            return try await listReminderLists()
        case "move_reminder":
            return try moveReminder(payload: request.payload ?? [:])
        case "complete_reminder":
            return try completeReminder(payload: request.payload ?? [:])
        case "update_reminder":
            return try updateReminder(payload: request.payload ?? [:])
        case "create_reminder":
            return try createReminder(payload: request.payload ?? [:])
        case "create_calendar_event":
            return try createCalendarEvent(payload: request.payload ?? [:])
        case "get_calendar_event":
            return try getCalendarEvent(payload: request.payload ?? [:])
        case "move_calendar_event":
            return try moveCalendarEvent(payload: request.payload ?? [:])
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

    static func requirePayload(_ request: Request, _ key: String) throws -> String {
        guard let value = request.payload?[key], !value.isEmpty else {
            throw BridgeError.invalidRequest("\(key) is required.")
        }
        return value
    }

    /// One JSON string field, the same shape `events_json` / `reminders_json`
    /// already use: a nested structure does not fit `[String: String]`, so it
    /// travels as a JSON-encoded string under one key.
    static func encode<T: Encodable>(_ value: T, field: String = "result_json") throws -> [String: String] {
        let data = try JSONEncoder().encode(value)
        guard let string = String(data: data, encoding: .utf8) else {
            throw BridgeError.unavailable("Could not encode the result.")
        }
        return [field: string]
    }

    static func encodeObservation(_ observation: ScreenObservation) throws -> [String: String] {
        var result = try encode(observation, field: "observation_json")
        result["app_name"] = observation.appName
        result["bundle_id"] = observation.bundleID
        result["node_count"] = String(observation.nodeCount)
        result["truncated"] = String(observation.truncated)
        return result
    }

    static func encodeCapture(_ capture: ScreenCaptureResult) throws -> [String: String] {
        var result = try encode(capture, field: "capture_json")
        result["path"] = capture.path
        result["width"] = String(capture.width)
        result["height"] = String(capture.height)
        result["app_name"] = capture.appName
        result["bundle_id"] = capture.bundleID
        return result
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

    /// `days`/`oneOffOnly` added 2026-09-29 for `orion-agenda deadlines`: a real
    /// scenario asked "when's my macro quiz?" and got "not on the calendar" --
    /// the quiz was 17 days out and the seven-day window never saw it. Weekly
    /// classes are skipped there because they would fill the whole list.
    static func listUpcomingCalendarEvents(days: Int = 7, oneOffOnly: Bool = false, limit: Int = 25, fromToday: Bool = false) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw BridgeError.unavailable("Allow Calendar access in Orion before asking it to read your schedule.")
        }
        let store = EKEventStore()
        let end = Calendar.current.date(byAdding: .day, value: days, to: Date())!
        let start = fromToday ? Calendar.current.startOfDay(for: Date()) : Date()
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
            .filter { !oneOffOnly || !$0.hasRecurrenceRules }
            .sorted { $0.startDate < $1.startDate }
            .prefix(limit)
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
                    "location": event.location ?? "",
                    "orion": OrionTags.kind(in: event.notes),
                    // Every marker (kind first, then logged / anchor / rank-*), comma-separated; `orion` stays the first.
                    "orionTags": OrionTags.markers(in: event.notes).joined(separator: ","),
                    "allDay": event.isAllDay ? "true" : "false",
                ]
            }
        return ["events_json": String(data: try JSONSerialization.data(withJSONObject: events), encoding: .utf8)!]
    }

    /// Open reminders with the list each is on (2026-09-30: "plan my day from my
    /// todo list" also read his groceries, because every list came back as one).
    /// payload "list": comma-separated list names to read; omitted = every list.
    static func listIncompleteReminders(payload: [String: String] = [:]) async throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before asking it to read your reminders.")
        }
        let store = EKEventStore()
        let wanted = (payload["list"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        let lists = store.calendars(for: .reminder).filter { wanted.isEmpty || wanted.contains($0.title.lowercased()) }
        if !wanted.isEmpty && lists.isEmpty { return ["reminders_json": "[]"] }
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: wanted.isEmpty ? nil : lists)
        let iso = ISO8601DateFormatter()
        let items: [[String: String]] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { values in
                let mapped = (values ?? []).prefix(200).map { reminder -> [String: String] in
                    var item = ["title": reminder.title ?? "Untitled", "identifier": reminder.calendarItemIdentifier,
                                "list": reminder.calendar?.title ?? ""]
                    if let due = reminder.dueDateComponents.flatMap({ Calendar.current.date(from: $0) }) { item["due"] = iso.string(from: due) }
                    // How he wants it spread, and how much it matters (2026-10-06).
                    if let notes = reminder.notes, !notes.isEmpty { item["notes"] = notes }
                    if let level = OrionMacBridge.priorityWord(reminder.priority) { item["priority"] = level }
                    return item
                }
                continuation.resume(returning: mapped)
            }
        }
        return ["reminders_json": String(data: try JSONSerialization.data(withJSONObject: items), encoding: .utf8)!]
    }

    /// Every Reminders list, with how many open items it holds.
    static func listReminderLists() async throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before asking it to read your reminders.")
        }
        let store = EKEventStore()
        let calendars = store.calendars(for: .reminder)
        let openLists: [String] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)) {
                continuation.resume(returning: ($0 ?? []).map { $0.calendar?.calendarIdentifier ?? "" })
            }
        }
        let rows: [[String: String]] = calendars.map { list in
            ["title": list.title, "identifier": list.calendarIdentifier,
             "open": String(openLists.filter { $0 == list.calendarIdentifier }.count),
             "writable": String(list.allowsContentModifications),
             "default": String(list.calendarIdentifier == store.defaultCalendarForNewReminders()?.calendarIdentifier)]
        }
        return ["lists_json": String(data: try JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!]
    }

    /// Put one reminder on another list (same reminder, same identifier).
    static func moveReminder(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before moving a reminder.")
        }
        guard let identifier = payload["identifier"], !identifier.isEmpty, let listName = payload["list"], !listName.isEmpty else {
            throw BridgeError.invalidRequest("Moving a reminder needs its identifier and a list name.")
        }
        let store = EKEventStore()
        guard let reminder = store.calendarItem(withIdentifier: identifier) as? EKReminder else {
            throw BridgeError.invalidRequest("No reminder has that identifier.")
        }
        guard let list = store.calendars(for: .reminder).first(where: { $0.title.caseInsensitiveCompare(listName) == .orderedSame }),
              list.allowsContentModifications else {
            throw BridgeError.invalidRequest("There is no writable Reminders list called \(listName).")
        }
        let from = reminder.calendar?.title ?? ""
        reminder.calendar = list
        try store.save(reminder, commit: true)
        return ["status": "moved", "identifier": identifier, "from": from, "to": list.title, "title": reminder.title ?? ""]
    }

    static func createReminder(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before creating a reminder.")
        }
        guard let title = payload["title"], !title.isEmpty else { throw BridgeError.invalidRequest("A reminder title is required.") }
        let store = EKEventStore()
        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        // payload "list": the list to put it on (ORION's to-dos go on "Orion", the
        // list the Mac and phone apps show). Falls back to the default list.
        let named = payload["list"].flatMap { name in
            store.calendars(for: .reminder).first { $0.title.caseInsensitiveCompare(name) == .orderedSame && $0.allowsContentModifications }
        }
        reminder.calendar = named ?? store.defaultCalendarForNewReminders()
        if let dueAt = payload["due_at"], let date = ISO8601DateFormatter().date(from: dueAt) {
            reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        }
        if let notes = payload["notes"], !notes.isEmpty { reminder.notes = notes }
        if let level = payload["priority"], let value = OrionMacBridge.priorityValue(level) { reminder.priority = value }
        try store.save(reminder, commit: true)
        return ["status": "created", "identifier": reminder.calendarItemIdentifier]
    }

    /// Change a to-do in place (2026-10-06): its due date, how he wants it spread
    /// (the notes), its priority or its title. A key left out is left alone;
    /// "due_at": "" clears the due date.
    static func updateReminder(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before changing a reminder.")
        }
        guard let identifier = payload["identifier"], !identifier.isEmpty else {
            throw BridgeError.invalidRequest("A reminder identifier is required.")
        }
        let store = EKEventStore()
        guard let reminder = store.calendarItem(withIdentifier: identifier) as? EKReminder else {
            throw BridgeError.invalidRequest("No reminder has that identifier.")
        }
        if let title = payload["title"], !title.isEmpty { reminder.title = title }
        if let dueAt = payload["due_at"] {
            if dueAt.isEmpty { reminder.dueDateComponents = nil }
            else if let date = ISO8601DateFormatter().date(from: dueAt) {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            } else { throw BridgeError.invalidRequest("due_at must be an ISO-8601 time.") }
        }
        if let notes = payload["notes"] { reminder.notes = notes.isEmpty ? nil : notes }
        if let level = payload["priority"] {
            guard let value = OrionMacBridge.priorityValue(level) else { throw BridgeError.invalidRequest("priority must be high, medium, low or none.") }
            reminder.priority = value
        }
        try store.save(reminder, commit: true)
        return ["status": "updated", "identifier": identifier, "title": reminder.title ?? ""]
    }

    /// Reminders' 1–4 is high, 5 medium, 6–9 low, 0 none.
    static func priorityWord(_ value: Int) -> String? {
        switch value { case 1...4: return "high"; case 5: return "medium"; case 6...9: return "low"; default: return nil }
    }
    static func priorityValue(_ word: String) -> Int? {
        switch word.lowercased() { case "high": return 1; case "medium": return 5; case "low": return 9; case "none", "": return 0; default: return nil }
    }

    /// Tick one reminder off by identifier (2026-09-29). "I finished the MSF
    /// course, tick it off" used to get "want me to delete that reminder?",
    /// because deleting was the only change on offer. Completing keeps the
    /// history in Reminders the way ticking it on the phone does.
    static func completeReminder(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw BridgeError.unavailable("Allow Reminders access in Orion before completing a reminder.")
        }
        guard let identifier = payload["identifier"], !identifier.isEmpty else {
            throw BridgeError.invalidRequest("A reminder identifier is required.")
        }
        let store = EKEventStore()
        guard let reminder = store.calendarItem(withIdentifier: identifier) as? EKReminder else {
            throw BridgeError.invalidRequest("No reminder has that identifier.")
        }
        reminder.isCompleted = payload["completed"] != "false"
        try store.save(reminder, commit: true)
        return ["status": reminder.isCompleted ? "completed" : "reopened", "identifier": identifier,
                "title": reminder.title ?? ""]
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
        // 2026-10-19: the default calendar here was "School", a feed that syncs from the university: ORION's blocks written to it were
        // removed again within a minute (the Gym and `cs lab` were gone 45 s after the write). The caller names a calendar of his own.
        let wanted = payload["calendar"] ?? ""
        event.calendar = store.calendars(for: .event).first { $0.title == wanted && $0.allowsContentModifications }
            ?? store.defaultCalendarForNewEvents
        // Blocks ORION plans itself carry a marker, so the planner knows it may
        // move them later ("[orion:study]", "[orion:side_project]").
        if let kind = payload["orionKind"], kind.range(of: #"^[a-z_]{1,20}$"#, options: .regularExpression) != nil {
            event.notes = OrionTags.notes(kind: kind, tags: OrionTags.parse(payload: payload["orionTags"]))
        }
        try store.save(event, span: .thisEvent, commit: true)
        return ["status": "created", "identifier": event.calendarItemIdentifier]
    }

    /// Move one event (this occurrence only) by its identifier. Used by
    /// `orion-reschedule`, which decides what may move; this only moves.
    static func moveCalendarEvent(payload: [String: String]) throws -> [String: String] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw BridgeError.unavailable("Allow Calendar access in Orion before moving an event.")
        }
        guard let identifier = payload["identifier"], !identifier.isEmpty,
              let start = payload["start"].flatMap({ ISO8601DateFormatter().date(from: $0) }),
              let end = payload["end"].flatMap({ ISO8601DateFormatter().date(from: $0) }), end > start else {
            throw BridgeError.invalidRequest("Moving an event needs its identifier and valid start and end times.")
        }
        let store = EKEventStore()
        guard let event = store.calendarItem(withIdentifier: identifier) as? EKEvent else {
            throw BridgeError.invalidRequest("No event with that identifier.")
        }
        let from = ISO8601DateFormatter().string(from: event.startDate)
        event.startDate = start
        event.endDate = end
        try store.save(event, span: .thisEvent, commit: true)
        return ["status": "moved", "title": event.title ?? "Untitled", "from": from,
                "start": ISO8601DateFormatter().string(from: start)]
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

        // payload "span": "future" with "start" (the occurrence's ISO start)
        // removes that occurrence and every later one of a repeating event
        // ("get rid of all of them going forwards", 2026-09-30). The identifier
        // alone names the series, so the occurrence is found by its start.
        if payload["span"] == "future" {
            guard let startText = payload["start"], let start = ISO8601DateFormatter().date(from: startText) else {
                throw BridgeError.invalidRequest("Removing future occurrences needs the occurrence's start time.")
            }
            let window = store.predicateForEvents(withStart: start.addingTimeInterval(-60), end: start.addingTimeInterval(60), calendars: [event.calendar])
            guard let occurrence = store.events(matching: window).first(where: { $0.calendarItemIdentifier == event.calendarItemIdentifier }) else {
                throw BridgeError.invalidRequest("No occurrence of that event starts at \(startText).")
            }
            let title = occurrence.title ?? "(untitled)"
            try store.remove(occurrence, span: .futureEvents, commit: true)
            return ["status": "deleted", "span": "future", "title": title]
        }
        // payload "start" alone: just that occurrence ("skip Marketing today",
        // 2026-10-06). Without it a repeating event's identifier names the
        // series, and .thisEvent removed its FIRST occurrence, not today's.
        if let startText = payload["start"], let start = ISO8601DateFormatter().date(from: startText) {
            let window = store.predicateForEvents(withStart: start.addingTimeInterval(-60), end: start.addingTimeInterval(60), calendars: [event.calendar])
            guard let occurrence = store.events(matching: window).first(where: { $0.calendarItemIdentifier == event.calendarItemIdentifier }) else {
                throw BridgeError.invalidRequest("No occurrence of that event starts at \(startText).")
            }
            guard occurrence.calendar.allowsContentModifications else {
                throw BridgeError.invalidRequest("read-only calendar: \(occurrence.calendar.title)")
            }
            let title = occurrence.title ?? "(untitled)"
            try store.remove(occurrence, span: .thisEvent, commit: true)
            return ["status": "deleted", "span": "this", "title": title]
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
