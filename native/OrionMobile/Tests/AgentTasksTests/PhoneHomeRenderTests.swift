#if os(macOS)
import AppKit
import MobileCore
import OrionViews
import SwiftUI
import XCTest

/// The phone Home drawn from fixtures through the real builder, at iPhone size. PNGs are written only when
/// ORION_UI_RENDER_DIR is set, so CI writes nothing; every render must not be blank.
@MainActor
final class PhoneHomeRenderTests: XCTestCase {
    private let size = CGSize(width: 393, height: 852)
    private let calendar: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/London")!; return c }()
    private func at(_ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: 2, hour: hour, minute: minute))!
    }
    private var now: Date { at(19, 10) }

    private var tracking: LinkSnapshot.Tracking {
        .init(day: "2026-11-02", waterBottles: 4, waterGoal: 9, calories: 0, calorieGoal: 0, protein: 0, proteinGoal: 0, meals: [], supplements: [])
    }
    private var approval: LinkSnapshot.Approval {
        .init(id: "A-7F3K", action: "terminal_run", summary: "terminal_run: ls ~/Projects", context: "List the project folders",
              expiresAt: now.addingTimeInterval(540))
    }
    private var day: OrionGlance {
        OrionGlance(generatedAt: now, source: "iphone", blocks: [
            .init(id: "b1", title: "Essay outline", start: at(18, 30), end: at(19, 30), kind: "orion", fixed: false),
            .init(id: "b2", title: "CS2100 Lab", start: at(19, 40), end: at(21), kind: "class", fixed: true, location: "Room 4.02"),
            .init(id: "b3", title: "Gym", start: at(21, 30), end: at(22, 30), kind: "event", fixed: true),
        ])
    }

    private func home(glance: OrionGlance?, snapshot: LinkSnapshot?, messages: [PhoneHomeMessage] = []) -> PhoneHome {
        PhoneHomeBuilder.build(.init(now: now, calendar: calendar, name: "Nick", glance: glance, snapshot: snapshot, messages: messages))
    }

    private func snapshot(approvals: [LinkSnapshot.Approval] = [], early: EarlyFinishContext? = nil) -> LinkSnapshot {
        LinkSnapshot(generatedAt: now.addingTimeInterval(-15), mac: .init(name: "Mac"), approvals: approvals,
                     health: [.init(date: "2026-11-02", sleepHours: 7.5)], tracking: tracking, earlyFinish: early)
    }

    func testBusyHome() throws {
        let ask = PhoneHomeMessage(id: "m3", askID: "ask-2", mine: "", orion: "The lab starts in 30. Want me to move the Hale reply to tonight?",
                                   sentAt: now.addingTimeInterval(-120))
        let model = home(glance: day, snapshot: snapshot(approvals: [approval], early: .init(kind: "block", title: "Essay outline")),
                         messages: [ask])
        XCTAssertNotNil(model.ask); XCTAssertEqual(model.approvals.count, 1)
        try write("phone-home-busy", model, status: .init(earlyFeedback: nil), height: 1_280)
    }

    func testEmptyHome() throws {
        let model = home(glance: nil, snapshot: nil)
        XCTAssertNil(model.next); XCTAssertTrue(model.glance.isEmpty)
        try write("phone-home-empty", model, status: .init(online: false, presence: "Mac offline"))
    }

    func testApprovalHome() throws {
        let quiet = OrionGlance(generatedAt: now, source: "iphone")
        let model = home(glance: quiet, snapshot: snapshot(approvals: [approval]))
        try write("phone-home-approval", model,
                  status: .init(earlyFeedback: "Nothing is on right now. Next up: CS Lab at 6:10 PM — want to start it early?"))
    }

    func testBusyHomeLight() throws {
        let model = home(glance: day, snapshot: snapshot(early: .init(kind: "block", title: "Essay outline")))
        try write("phone-home-light", model, status: .init(), scheme: .light)
    }

    private func write(_ name: String, _ model: PhoneHome, status: PhoneHomeStatus, scheme: ColorScheme = .dark,
                       height: CGFloat = 852) throws {
        let size = CGSize(width: self.size.width, height: height)
        let view = PhoneHomeView(home: model, status: status, actions: PhoneHomeActions(), orbFrameTime: 4, scrolls: false)
            .frame(width: size.width, height: size.height)
            .environment(\.colorScheme, scheme)
            .environment(\.orionFrozenMotion, 1)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage, "nothing rendered for \(name)")
        let cg = try XCTUnwrap(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        XCTAssertEqual(cg.width, Int(size.width * 2))
        XCTAssertTrue(distinctShades(cg) > 8, "\(name) rendered blank")
        guard let dir = ProcessInfo.processInfo.environment["ORION_UI_RENDER_DIR"] else { return }
        let url = URL(fileURLWithPath: dir)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let png = try XCTUnwrap(NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]))
        try png.write(to: url.appendingPathComponent("\(name).png"))
    }

    /// Text and line art make many shades; a blank frame makes one or two.
    private func distinctShades(_ image: CGImage) -> Int {
        guard let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 0 }
        let length = CFDataGetLength(data)
        var seen = Set<UInt8>()
        var index = 0
        while index < length { seen.insert(bytes[index] / 16); index += 997 }
        return seen.count
    }
}
#endif
