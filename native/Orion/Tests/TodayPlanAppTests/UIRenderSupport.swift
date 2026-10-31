import AppKit
import MobileCore
import SwiftUI
import XCTest
@testable import Orion

/// Shared plumbing for the ImageRenderer snapshot suites: a desktop behind the glass, a PNG writer that only writes
/// when `ORION_UI_RENDER_DIR` is set (so CI writes nothing), and a check that a render is not blank.
///
/// "Light" here means a LIGHT DESKTOP, not a light colour scheme: the dashboard forces the dark scheme, and what
/// changes with Nick's wallpaper is what shows through the window's real alpha. A pale desktop is the hard case.
@MainActor
enum UIRender {
    static var outputDirectory: URL? {
        ProcessInfo.processInfo.environment["ORION_UI_RENDER_DIR"].map { URL(fileURLWithPath: $0) }
    }

    static func wallpaper(light: Bool) -> some View {
        ZStack {
            LinearGradient(colors: light ? [Color(red: 0.86, green: 0.89, blue: 0.94), Color(red: 0.95, green: 0.92, blue: 0.90)]
                                         : [Color(red: 0.05, green: 0.06, blue: 0.12), Color(red: 0.10, green: 0.07, blue: 0.16)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            Circle().fill((light ? Color(red: 0.75, green: 0.82, blue: 0.98) : Color(red: 0.20, green: 0.25, blue: 0.55)).opacity(0.45))
                .frame(width: 700).blur(radius: 140).offset(x: 300, y: -220)
            Circle().fill((light ? Color(red: 0.98, green: 0.84, blue: 0.80) : Color(red: 0.45, green: 0.18, blue: 0.40)).opacity(0.35))
                .frame(width: 600).blur(radius: 160).offset(x: -380, y: 260)
        }
    }

    /// The dashboard's own treatment: the surface at its default alpha over the wallpaper, dark scheme forced.
    static func onDesktop<Content: View>(_ content: Content, light: Bool, size: CGSize) -> some View {
        content
            .frame(width: size.width, height: size.height, alignment: .topLeading)
            .background(OrionTheme.ink.opacity(SurfaceSettings.defaultOpacity))
            .background(wallpaper(light: light))
            .environment(\.colorScheme, .dark)
            // ImageRenderer never runs onAppear, so entrances are held settled unless a test asks for a mid-frame.
            .environment(\.orionFrozenMotion, 1)
    }

    @discardableResult
    static func write<Content: View>(_ name: String, _ view: Content, size: CGSize) throws -> CGImage {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage, "ImageRenderer returned nothing for \(name)")
        let cg = try XCTUnwrap(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        XCTAssertEqual(cg.width, Int(size.width * 2))
        XCTAssertTrue(hasDetail(cg), "\(name) rendered blank")
        if let dir = outputDirectory {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let rep = NSBitmapImageRep(cgImage: cg)
            try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(to: dir.appendingPathComponent("\(name).png"))
        }
        return cg
    }

    /// Bright, thin marks on the wallpaper: text and line art, not just the gradient.
    static func hasDetail(_ image: CGImage) -> Bool {
        guard let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return false }
        let length = CFDataGetLength(data)
        var minimum = 255, maximum = 0
        stride(from: 0, to: length, by: 4 * 97).forEach { i in
            let v = Int(bytes[i])
            minimum = min(minimum, v); maximum = max(maximum, v)
        }
        return maximum - minimum > 60
    }

    // MARK: Fixtures

    static let zone = TimeZone(identifier: "Europe/London")!

    static func date(_ hour: Int, _ minute: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: 10, day: 30, hour: hour, minute: minute))!
    }

    static func conversation() -> ChatConversation {
        let messages = [
            ChatMessage(id: "1", role: .user, text: "what's left on my plate today?", at: date(14, 2), device: "mac"),
            ChatMessage(id: "2", role: .orion,
                        text: "Two things before six. The MKTG2201 slides need a final pass — about forty minutes — and Priya is waiting on your half of the CS2100 problem set. The gym slot at 17:30 is still free if you want it.",
                        thinking: "Reading the plan, reminders and calendar for the rest of today…", at: date(14, 2), device: "mac"),
            ChatMessage(id: "3", role: .user, text: "move the gym to tomorrow morning", at: date(14, 5), device: "mac"),
            ChatMessage(id: "4", role: .orion, text: "Done — gym is at 08:00 tomorrow, before your first class. Tonight is clear after the slides.",
                        at: date(14, 5), device: "mac"),
            ChatMessage(id: "5", role: .user, text: "and draft a note to priya saying I'll send it by 4", at: date(14, 7), device: "mac"),
        ]
        return ChatConversation(id: "c", title: "Rest of today", createdAt: date(14, 2), updatedAt: date(14, 7), model: nil, messages: messages)
    }

    static func summaries() -> [ChatSummary] {
        [ChatSummary(id: "c", title: "Rest of today", updatedAt: date(14, 7), preview: "and draft a note to priya", count: 5),
         ChatSummary(id: "b", title: "London flat viewing", updatedAt: date(11, 40), preview: "Saturday at 11 works", count: 8),
         ChatSummary(id: "a", title: "Study plan for midterms", updatedAt: date(9, 15), preview: "Start with ECON1115", count: 12)]
    }

    static func briefFacts() -> BriefFacts {
        let clock = BriefClock(now: date(8, 12), timeZone: zone)
        let events = [
            AgendaEvent(id: "e1", title: "CS2100 lecture", start: date(10), end: date(11, 30), isAllDay: false, calendarName: "Classes", colorHex: "5BB8FF"),
            AgendaEvent(id: "e2", title: "Lunch with Priya", start: date(12, 30), end: date(13, 30), isAllDay: false, calendarName: "Personal", colorHex: "5CEB99"),
            AgendaEvent(id: "e3", title: "MKTG2201 seminar", start: date(15), end: date(16), isAllDay: false, calendarName: "Classes", colorHex: "B385FF"),
        ]
        let tasks = [SyncedTask(id: "t1", title: "Final pass on the AE1 slides", isComplete: false, dueDate: date(0), hasAlarm: false),
                     SyncedTask(id: "t2", title: "Send Priya the problem set", isComplete: false, dueDate: date(0), hasAlarm: false)]
        var facts = BriefFacts(day: LogicalDay(start: date(7, 10), fromWakeTime: true), clock: clock, events: events)
        facts.wokeAt = date(7, 10)
        facts.dueToday = tasks
        facts.readings = BriefFacts.Readings(recovery: 71, sleepPerformance: 84, sleepHours: 7.6, hrvDelta: "+6",
                                             restingHeartRate: 52, strainTarget: StrainTarget.forRecovery(71))
        facts.committedMinutes = 210
        facts.signal = PlanningSignal.derive(recovery: 71, sleepPerformance: 84, sleepHours: 7.6, strain: 8, sampleCount: 7, readingAgeHours: 1)
        facts.calendarConnected = true
        facts.tasksConnected = true
        return facts
    }
}
