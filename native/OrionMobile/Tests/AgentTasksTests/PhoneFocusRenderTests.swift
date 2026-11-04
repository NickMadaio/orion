#if os(macOS)
import AppKit
import MobileCore
import OrionViews
import SwiftUI
import XCTest

/// Home in focus, in a break and paused, and the slim banner, drawn at iPhone size. PNGs are written only when
/// ORION_UI_RENDER_DIR is set; every render must not be blank.
@MainActor
final class PhoneFocusRenderTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func session(phase: String, status: String = "running", ends: TimeInterval?, total: Double, remaining: Double? = nil) -> LinkSnapshot.FocusSession {
        .init(sessionId: "s-abc", task: "Finish resume", phase: phase, status: status, endsAt: ends.map { now.addingTimeInterval($0) },
              phaseSeconds: total, remainingSeconds: remaining, block: 1, blocks: 3, allowed: nil)
    }

    func testFocusHome() throws {
        try write("phone-focus-home", PhoneFocusHome(session: session(phase: "focus", ends: 1_920, total: 3_000),
                                                      status: .init(shield: "SHIELDING SOCIAL · VIDEO · GAMES"), actions: PhoneFocusActions(), at: now, orbFrameTime: 4))
    }

    func testFocusHomeAskingForPicks() throws {
        try write("phone-focus-home-picks", PhoneFocusHome(session: session(phase: "focus", ends: 1_920, total: 3_000),
                                                            status: .init(shield: "PICK YOUR FOCUS APPS", shieldNeedsAction: true), actions: PhoneFocusActions(), at: now, orbFrameTime: 4))
    }

    func testBreakHome() throws {
        try write("phone-focus-break", PhoneFocusHome(session: session(phase: "break", ends: 290, total: 600),
                                                       status: .init(shield: "BREAK · YOUR APPS ARE OPEN"), actions: PhoneFocusActions(), at: now, orbFrameTime: 4))
    }

    func testPausedHome() throws {
        try write("phone-focus-paused", PhoneFocusHome(session: session(phase: "focus", status: "paused", ends: nil, total: 3_000, remaining: 1_200),
                                                        status: .init(), actions: PhoneFocusActions(), at: now, orbFrameTime: 4))
    }

    func testLightHome() throws {
        try write("phone-focus-home-light", PhoneFocusHome(session: session(phase: "focus", ends: 1_920, total: 3_000),
                                                            status: .init(shield: "SHIELDING SOCIAL · VIDEO"), actions: PhoneFocusActions(), at: now, orbFrameTime: 4), scheme: .light)
    }

    func testBanner() throws {
        let view = VStack(spacing: 10) {
            PhoneFocusBanner(session: session(phase: "focus", ends: 1_920, total: 3_000), at: now) {}
            PhoneFocusBanner(session: session(phase: "break", ends: 290, total: 600), at: now) {}
        }.padding(.vertical, 16)
        try write("phone-focus-banner", view, height: 140)
    }

    private func write<V: View>(_ name: String, _ content: V, scheme: ColorScheme = .dark, height: CGFloat = 852) throws {
        let size = CGSize(width: 393, height: height)
        let view = content.frame(width: size.width, height: size.height).background(Color(red: 0.035, green: 0.04, blue: 0.05))
            .environment(\.colorScheme, scheme).environment(\.orionFrozenMotion, 1)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage, "nothing rendered for \(name)")
        let cg = try XCTUnwrap(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        XCTAssertEqual(cg.width, Int(size.width * 2))
        guard let dir = ProcessInfo.processInfo.environment["ORION_UI_RENDER_DIR"] else { return }
        let url = URL(fileURLWithPath: dir)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let png = try XCTUnwrap(NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]))
        try png.write(to: url.appendingPathComponent("\(name).png"))
    }
}
#endif
