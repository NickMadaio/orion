import AppKit
import MobileCore
import OrionViews
import SwiftUI
import XCTest
@testable import Orion

/// Wave 12 (2026-11-02) before/after renders of Home, chat and the nav bar. Writes PNGs only when
/// ORION_UI_RENDER_DIR is set; ORION_W12_TAG ("before" / "after") names them.
@MainActor
final class Wave12RenderTests: XCTestCase {
    private let wide = CGSize(width: 1280, height: 800)
    private var tag: String { ProcessInfo.processInfo.environment["ORION_W12_TAG"] ?? "after" }

    func testRendersChat() throws {
        var conversation = UIRender.conversation()
        // A gap of more than 30 minutes, so the quiet time divider shows.
        conversation.messages.append(ChatMessage(id: "6", role: .orion, text: "Sent. Priya has it.", at: UIRender.date(16, 30), device: "mac"))
        conversation.messages.append(ChatMessage(id: "7", role: .user, text: "thanks, what is next?", at: UIRender.date(17, 20), device: "mac"))
        let thread = ChatModeView(summaries: UIRender.summaries(), conversation: conversation, models: [],
                                  selectedModel: .constant(nil), draft: .constant(""), waiting: true,
                                  liveThinking: "Finding Priya in contacts…\nDrafting a two-line note",
                                  onSelect: { _ in }, onNew: {}, onSend: {}, onRename: { _, _ in }, onDelete: { _ in }, snapshot: true)
            .padding(.horizontal, 22).padding(.top, 20)
        try UIRender.write("w12-\(tag)-chat", UIRender.onDesktop(thread, light: false, size: wide), size: wide)
    }

    func testRendersHome() throws {
        let defaults = UserDefaults(suiteName: "orion.ui-render.\(UUID().uuidString)")!
        let writer = NarrativeWriter(defaults: defaults, complete: { _, _ in "" })
        let panel = MorningBriefPanel(facts: UIRender.briefFacts(), writer: writer, onStartDay: {})
            .padding(.horizontal, 46).padding(.top, 26)
        try UIRender.write("w12-\(tag)-home", UIRender.onDesktop(panel, light: false, size: wide), size: wide)
    }

    func testRendersNavBar() throws {
        let bar = NavRow()
        let size = CGSize(width: 1280, height: 90)
        try UIRender.write("w12-\(tag)-nav", UIRender.onDesktop(bar, light: false, size: size), size: size)
    }
}

private struct NavRow: View {
    var body: some View {
        DashboardHeader(selected: .home, issues: [], onSelect: { _ in })
    }
}
