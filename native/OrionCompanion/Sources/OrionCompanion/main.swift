import AppKit
@preconcurrency import ApplicationServices
import EventKit
import Foundation
import ServiceManagement
import UserNotifications
import WebKit

private struct BridgeRequest: Decodable {
    let id: String
    let action: String
    let payload: [String: String]
}

private struct BridgeResponse: Encodable {
    let id: String
    let ok: Bool
    let result: [String: String]?
    let error: String?
}

@main
@MainActor
final class OrionCompanion: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var runtime: Process?
    private var window: NSWindow?
    private let projectRoot = URL(fileURLWithPath: "/Users/nickmadaio/Desktop/ORION", isDirectory: true)
    private var bridgeTimer: Timer?
    private var inFlightBridgeRequests = Set<String>()

    private var bridgeRequests: URL { projectRoot.appendingPathComponent("orion/data/native_bridge/requests", isDirectory: true) }
    private var bridgeResponses: URL { projectRoot.appendingPathComponent("orion/data/native_bridge/responses", isDirectory: true) }

    static func main() {
        let app = NSApplication.shared
        let delegate = OrionCompanion()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        try? FileManager.default.createDirectory(at: bridgeRequests, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: bridgeResponses, withIntermediateDirectories: true)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "Orion"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Start local runtime", action: #selector(startRuntime), keyEquivalent: "s"))
        menu.addItem(NSMenuItem(title: "Open Orion", action: #selector(openOrion), keyEquivalent: "o"))
        menu.addItem(NSMenuItem(title: "Runtime status", action: #selector(showStatus), keyEquivalent: "r"))
        menu.addItem(NSMenuItem(title: "Launch Orion at login", action: #selector(enableLaunchAtLogin), keyEquivalent: "l"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Orion", action: #selector(quit), keyEquivalent: "q"))
        statusItem.menu = menu
        startRuntime()
        bridgeTimer = Timer.scheduledTimer(timeInterval: 0.2, target: self, selector: #selector(processBridgeRequests), userInfo: nil, repeats: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.openOrion() }
    }

    @objc private func openOrion() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let webView = WKWebView(frame: .zero)
        webView.load(URLRequest(url: URL(string: "http://127.0.0.1:8765/")!))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1050, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Orion"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    @objc private func startRuntime() {
        guard runtime?.isRunning != true else {
            statusItem.button?.title = "Orion · ready"
            return
        }
        let process = Process()
        process.executableURL = projectRoot.appendingPathComponent(".venv/bin/python")
        process.arguments = [projectRoot.appendingPathComponent("main.py").path, "serve"]
        process.currentDirectoryURL = projectRoot
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            runtime = process
            statusItem.button?.title = "Orion · starting"
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.showStatus() }
        } catch {
            statusItem.button?.title = "Orion · start failed"
        }
    }

    @objc private func showStatus() {
        Task { [weak self] in
            let url = URL(string: "http://127.0.0.1:8765/health")!
            let data = try? await URLSession.shared.data(from: url).0
            self?.statusItem.button?.title = data == nil ? "Orion · offline" : "Orion · ready"
        }
    }

    @objc private func enableLaunchAtLogin() {
        do {
            try SMAppService.mainApp.register()
            statusItem.button?.title = "Orion · launches at login"
        } catch {
            statusItem.button?.title = "Orion · login setup failed"
        }
    }

    @objc private func quit() { NSApplication.shared.terminate(nil) }

    @objc private func processBridgeRequests() {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: bridgeRequests.path) else { return }
        for name in names where name.hasSuffix(".json") && !inFlightBridgeRequests.contains(name) {
            let requestURL = bridgeRequests.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: requestURL), let request = try? JSONDecoder().decode(BridgeRequest.self, from: data) else {
                try? FileManager.default.removeItem(at: requestURL)
                continue
            }
            inFlightBridgeRequests.insert(name)
            try? FileManager.default.removeItem(at: requestURL)
            Task { [weak self] in
                guard let self else { return }
                let response: BridgeResponse
                do {
                    response = BridgeResponse(id: request.id, ok: true, result: try await self.handleBridge(request), error: nil)
                } catch {
                    response = BridgeResponse(id: request.id, ok: false, result: nil, error: error.localizedDescription)
                }
                let target = self.bridgeResponses.appendingPathComponent("\(request.id).json")
                if let output = try? JSONEncoder().encode(response) { try? output.write(to: target, options: .atomic) }
                self.inFlightBridgeRequests.remove(name)
            }
        }
    }

    private func handleBridge(_ request: BridgeRequest) async throws -> [String: String] {
        switch request.action {
        case "status":
            return ["platform": "macOS", "native_timer_shortcut": "Orion Native Timer", "native_timer_ready": String(shortcutExists(named: "Orion Native Timer")), "notifications": await notificationStatus(), "accessibility": accessibilityStatus(), "reminders": authorizationStatus(for: .reminder), "calendar": authorizationStatus(for: .event)]
        case "request_notifications": return ["granted": String(try await requestNotificationPermission())]
        case "request_accessibility":
            let granted = requestAccessibilityAccess()
            return ["granted": String(granted), "settings_opened": String(!granted)]
        case "notify": try await notify(title: request.payload["title"] ?? "Orion", body: request.payload["body"] ?? ""); return ["status": "scheduled"]
        case "request_reminders_access": return ["granted": String(try await requestEventAccess(for: .reminder))]
        case "request_calendar_access": return ["granted": String(try await requestEventAccess(for: .event))]
        case "list_upcoming_calendar_events": return try listUpcomingCalendarEvents()
        case "list_incomplete_reminders": return try await listIncompleteReminders()
        case "create_reminder": return try createReminder(payload: request.payload)
        case "create_calendar_event": return try createCalendarEvent(payload: request.payload)
        case "set_clock_timer":
            guard shortcutExists(named: "Orion Native Timer") else { throw NSError(domain: "Orion", code: 1, userInfo: [NSLocalizedDescriptionKey: "Create the Shortcuts shortcut named Orion Native Timer with Apple's Set Timer action first."]) }
            guard let seconds = request.payload["seconds"], Int(seconds) != nil else { throw NSError(domain: "Orion", code: 2, userInfo: [NSLocalizedDescriptionKey: "A timer duration in seconds is required."]) }
            try runShortcut(named: "Orion Native Timer", input: seconds); return ["status": "started", "backend": "macOS Clock"]
        default: throw NSError(domain: "Orion", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unknown native action."])
        }
    }

    private func authorizationStatus(for entity: EKEntityType) -> String { switch EKEventStore.authorizationStatus(for: entity) { case .fullAccess: return "full_access"; case .writeOnly: return "write_only"; case .denied: return "denied"; case .restricted: return "restricted"; case .notDetermined: return "not_determined"; @unknown default: return "unknown" } }
    private func requestEventAccess(for entity: EKEntityType) async throws -> Bool { activateForPermissionPrompt(); let store = EKEventStore(); return entity == .event ? try await store.requestFullAccessToEvents() : try await store.requestFullAccessToReminders() }
    private func listUpcomingCalendarEvents() throws -> [String: String] { guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { throw NSError(domain: "Orion", code: 4, userInfo: [NSLocalizedDescriptionKey: "Allow Calendar access in Orion first."]) }; let store = EKEventStore(); let end = Calendar.current.date(byAdding: .day, value: 7, to: Date())!; let values = store.events(matching: store.predicateForEvents(withStart: Date(), end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }.prefix(25).map { ["title": $0.title ?? "Untitled", "start": ISO8601DateFormatter().string(from: $0.startDate), "end": ISO8601DateFormatter().string(from: $0.endDate)] }; return ["events_json": String(data: try JSONSerialization.data(withJSONObject: values), encoding: .utf8)!] }
    private func listIncompleteReminders() async throws -> [String: String] { guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { throw NSError(domain: "Orion", code: 5, userInfo: [NSLocalizedDescriptionKey: "Allow Reminders access in Orion first."]) }; let store = EKEventStore(); let values: [[String: String]] = await withCheckedContinuation { continuation in store.fetchReminders(matching: store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)) { continuation.resume(returning: ($0 ?? []).prefix(50).map { ["title": $0.title ?? "Untitled", "identifier": $0.calendarItemIdentifier] }) } }; return ["reminders_json": String(data: try JSONSerialization.data(withJSONObject: values), encoding: .utf8)!] }
    private func createReminder(payload: [String: String]) throws -> [String: String] { guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess, let title = payload["title"], !title.isEmpty else { throw NSError(domain: "Orion", code: 6, userInfo: [NSLocalizedDescriptionKey: "A permitted reminder title is required."]) }; let store = EKEventStore(); let reminder = EKReminder(eventStore: store); reminder.title = title; reminder.calendar = store.defaultCalendarForNewReminders(); if let text = payload["due_at"], let date = ISO8601DateFormatter().date(from: text) { reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date) }; try store.save(reminder, commit: true); return ["status": "created", "identifier": reminder.calendarItemIdentifier] }
    private func createCalendarEvent(payload: [String: String]) throws -> [String: String] { guard EKEventStore.authorizationStatus(for: .event) == .fullAccess, let title = payload["title"], let startText = payload["start"], let start = ISO8601DateFormatter().date(from: startText), let endText = payload["end"], let end = ISO8601DateFormatter().date(from: endText), end > start else { throw NSError(domain: "Orion", code: 7, userInfo: [NSLocalizedDescriptionKey: "A permitted event needs a title plus valid start and end times."]) }; let store = EKEventStore(); let event = EKEvent(eventStore: store); event.title = title; event.startDate = start; event.endDate = end; event.calendar = store.defaultCalendarForNewEvents; try store.save(event, span: .thisEvent, commit: true); return ["status": "created", "identifier": event.calendarItemIdentifier] }
    private func requestNotificationPermission() async throws -> Bool { activateForPermissionPrompt(); return try await withCheckedThrowingContinuation { continuation in UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: granted) } } } }
    private func notificationStatus() async -> String { let settings = await UNUserNotificationCenter.current().notificationSettings(); switch settings.authorizationStatus { case .authorized: return "authorized"; case .denied: return "denied"; case .notDetermined: return "not_determined"; case .provisional: return "provisional"; case .ephemeral: return "ephemeral"; @unknown default: return "unknown" } }
    private func accessibilityStatus() -> String { AXIsProcessTrusted() ? "trusted" : "not_granted" }
    private func requestAccessibilityAccess() -> Bool { let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary; return AXIsProcessTrustedWithOptions(options) }
    private func activateForPermissionPrompt() { NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil) }
    private func notify(title: String, body: String) async throws { let content = UNMutableNotificationContent(); content.title = title; content.body = body; content.sound = .default; try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) }
    private func shortcutExists(named name: String) -> Bool { let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts"); process.arguments = ["list"]; let output = Pipe(); process.standardOutput = output; do { try process.run(); process.waitUntilExit(); return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.split(separator: "\n").contains(Substring(name)) == true } catch { return false } }
    private func runShortcut(named name: String, input: String) throws { let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts"); process.arguments = ["run", name, "-i", input]; try process.run(); process.waitUntilExit(); if process.terminationStatus != 0 { throw NSError(domain: "Orion", code: 8, userInfo: [NSLocalizedDescriptionKey: "The native timer shortcut could not run."]) } }
}
