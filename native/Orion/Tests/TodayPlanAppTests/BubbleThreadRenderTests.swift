import AppKit
import SwiftUI
import XCTest
@testable import Orion

/// W16-d: the proactive bubble's states, drawn as the summon panel draws them (no plate: straight over the desktop), with the
/// composer under them. PNGs only when ORION_UI_RENDER_DIR is set.
@MainActor
final class BubbleThreadRenderTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let message = "You're out - is Go over Orion learning plan still happening, or did plans change? I'll update the calendar."
    private let reply = "yea im at a friends place, away rn. push it to tmrw"

    private func base() -> BubbleThread { BubbleThread(message: message, reachID: "reach-1", shownAt: t0) }

    private func frame(_ name: String, _ thread: BubbleThread, light: Bool = false) throws {
        let size = CGSize(width: 320, height: 420)
        let panel = VStack(spacing: 0) {
            Spacer(minLength: 0)
            BubbleThreadView(thread: thread, width: 260).padding(.bottom, 8)
            composer.padding(.bottom, 8)
        }
        .frame(width: size.width, height: size.height)
        .background(UIRender.wallpaper(light: light))
        .environment(\.colorScheme, .dark)
        .environment(\.orionFrozenMotion, 1)
        try UIRender.write(name, panel, size: size)
    }

    /// ImageRenderer cannot draw the AppKit-backed TextField, so the composer is a static stand-in of the same shape.
    private var composer: some View {
        HStack(spacing: 8) {
            Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.5)).frame(width: 22, height: 22)
                .background(Color.white.opacity(0.06), in: Circle())
            Text("Reply to ORION").font(.system(size: 13)).foregroundStyle(.white.opacity(0.4))
            Spacer()
            Image(systemName: "mic.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.5)).frame(width: 22, height: 22)
                .background(Color.white.opacity(0.06), in: Circle())
        }
        .padding(10).frame(width: 260)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.12), lineWidth: 1))
    }

    func testRendersEveryState() throws {
        let waiting = base().replied(reply, now: t0).sent(generation: 1, now: t0)
        try frame("w16-d-bubble-1-shown", base())
        try frame("w16-d-bubble-2-sending", base().replied(reply, now: t0))
        try frame("w16-d-bubble-3-waiting", waiting)
        try frame("w16-d-bubble-4-answered", waiting.answered("Okay — moved Go over Orion learning plan to 7:30 PM tomorrow. Have fun.", generation: 1))
        try frame("w16-d-bubble-5-timed-out", waiting.ticked(now: t0.addingTimeInterval(60)))
        try frame("w16-d-bubble-6-failed", waiting.failed(generation: 1))
        try frame("w16-d-bubble-4-answered-light", waiting.answered("Okay — moved Go over Orion learning plan to 7:30 PM tomorrow. Have fun.", generation: 1), light: true)
    }
}
