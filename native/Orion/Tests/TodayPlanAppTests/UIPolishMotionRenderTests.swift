import AppKit
import MobileCore
import OrionViews
import SwiftUI
import XCTest
@testable import Orion

/// Frames from the middle of the 2026-10-30 animations, held still for ImageRenderer: ORION's reply partway
/// through its reveal, and the morning brief halfway through its staggered arrival. (The Knowledge ring travelling
/// from list to graph is `knowledge-fixture-dark-midselection` in KnowledgeRenderTests.)
@MainActor
final class UIPolishMotionRenderTests: XCTestCase {

    private let wide = CGSize(width: 1280, height: 800)

    private func replyArriving() -> ChatConversation {
        var conversation = UIRender.conversation()
        conversation.messages.append(ChatMessage(id: "6", role: .orion,
            text: "Drafted: \u{201C}Hey Priya — I'll have my half of the problem set to you by 4. Sorry for the wait!\u{201D} Want me to send it from Messages?",
            thinking: "Found Priya in contacts. Kept it to two lines.", at: UIRender.date(14, 8), device: "mac"))
        return conversation
    }

    func testRendersAReplyMidReveal() throws {
        for progress in [0.35, 0.7] {
            let thread = ChatModeView(summaries: UIRender.summaries(), conversation: replyArriving(), models: [],
                                      selectedModel: .constant(nil), draft: .constant(""), waiting: false, liveThinking: nil,
                                      onSelect: { _ in }, onNew: {}, onSend: {}, onRename: { _, _ in }, onDelete: { _ in },
                                      snapshot: true, snapshotReveal: progress)
                .padding(.horizontal, 22).padding(.top, 20)
            try UIRender.write("motion-chat-reveal-\(Int(progress * 100))", UIRender.onDesktop(thread, light: false, size: wide), size: wide)
        }
    }

    func testRendersTheBriefMidArrival() throws {
        let defaults = UserDefaults(suiteName: "orion.ui-render.\(UUID().uuidString)")!
        let writer = NarrativeWriter(defaults: defaults, complete: { _, _ in "" })
        let panel = MorningBriefPanel(facts: UIRender.briefFacts(), writer: writer, onStartDay: {})
            .padding(.horizontal, 46).padding(.top, 26)
            // Innermost environment wins: holds every entrance halfway, over onDesktop's "settled".
            .environment(\.orionFrozenMotion, 0.5)
        try UIRender.write("motion-brief-arriving", UIRender.onDesktop(panel, light: false, size: wide), size: wide)
    }
}
