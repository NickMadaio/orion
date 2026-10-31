import AppKit
import MobileCore
import OrionViews
import SwiftUI
import XCTest
@testable import Orion

/// Snapshot renders of the main surfaces that can be built without a live `AppState`: the chat thread, the morning
/// brief, the dashboard kit the Health, Finance and Brand tabs are built from, and the parked brief. Each over a
/// dark and a light desktop. Always asserts a render is not blank; writes PNGs only when ORION_UI_RENDER_DIR is set.
///
/// Written so it compiles against the code before the 2026-10-30 polish as well as after, which is how the
/// before/after pairs were made from the same harness.
@MainActor
final class UIPolishRenderTests: XCTestCase {

    private let wide = CGSize(width: 1280, height: 800)

    func testRendersTheChatThread() throws {
        for light in [false, true] {
            let tag = light ? "light" : "dark"
            let thread = ChatModeView(summaries: UIRender.summaries(), conversation: UIRender.conversation(),
                                      models: [ModelChoice(id: "q", label: "qwen3.5 · local", local: true)],
                                      selectedModel: .constant(nil), draft: .constant(""), waiting: true,
                                      liveThinking: "Finding Priya in contacts…\nDrafting a two-line note",
                                      onSelect: { _ in }, onNew: {}, onSend: {}, onRename: { _, _ in }, onDelete: { _ in }, snapshot: true)
                .padding(.horizontal, 22).padding(.top, 20)
            try UIRender.write("chat-\(tag)", UIRender.onDesktop(thread, light: light, size: wide), size: wide)
        }
    }

    func testRendersTheMorningBrief() throws {
        let facts = UIRender.briefFacts()
        let defaults = UserDefaults(suiteName: "orion.ui-render.\(UUID().uuidString)")!
        let writer = NarrativeWriter(defaults: defaults, complete: { _, _ in "" })
        for light in [false, true] {
            let tag = light ? "light" : "dark"
            let panel = MorningBriefPanel(facts: facts, writer: writer, onStartDay: {}).padding(.horizontal, 46).padding(.top, 26)
            try UIRender.write("brief-\(tag)", UIRender.onDesktop(panel, light: light, size: wide), size: wide)
        }
    }

    func testRendersTheDashboardKit() throws {
        for light in [false, true] {
            let tag = light ? "light" : "dark"
            let kit = DashboardKitSheet(facts: UIRender.briefFacts()).padding(.horizontal, 46).padding(.top, 30)
            try UIRender.write("kit-\(tag)", UIRender.onDesktop(kit, light: light, size: wide), size: wide)
        }
    }
}

/// The pieces every reading tab is made of, laid out the way Health and Finance use them: a tile of rows, figures,
/// meters, and the outline actions.
private struct DashboardKitSheet: View {
    let facts: BriefFacts

    var body: some View {
        HStack(alignment: .top, spacing: 56) {
            VStack(alignment: .leading, spacing: 26) {
                SectionRule(title: "Today", trailing: "updated 08:12")
                HStack(alignment: .top, spacing: 44) {
                    RingMeter(progress: 0.71, value: "71", caption: "recovery", tint: OrionTheme.green, diameter: 118)
                    VStack(alignment: .leading, spacing: 16) {
                        BigStat(value: "7.6", unit: "h", caption: "sleep")
                        BigStat(value: "52", unit: "bpm", caption: "resting", size: 26)
                    }
                }
                ZoneBar(value: 5, target: 8, tint: OrionTheme.blue)
                Sparkline(points: [0.3, 0.42, 0.38, 0.6, 0.55, 0.72, 0.68])
                OrionTile(padding: 18, spacing: 4, accent: OrionTheme.violet) {
                    SectionRule(title: "Supplements")
                    DataRow(label: "Magnesium", sublabel: "evening", value: "taken", tickable: true, ticked: true)
                    DataRow(label: "Vitamin D", sublabel: "morning", value: "due", tickable: true)
                    DataRow(label: "Creatine", value: "5 g")
                }
                HStack(spacing: 14) {
                    LogButton(title: "Log water", systemImage: "drop") {}
                    StepButton(systemImage: "minus") {}
                    InlineAction(title: "History", systemImage: "arrow.right") {}
                }
            }
            .frame(width: 470)
            VStack(alignment: .leading, spacing: 22) {
                SectionRule(title: "Spending", trailing: "October")
                BigStat(value: "£412", caption: "this month", tint: OrionTheme.text, size: 46)
                OrionTile(padding: 18) {
                    DataRow(label: "Groceries", sublabel: "Tesco · Sainsbury's", value: "£126")
                    DataRow(label: "Transport", sublabel: "TfL", value: "£58")
                    DataRow(label: "Eating out", value: "£91", valueTint: OrionTheme.orange)
                }
                NotConnected(what: "Plaid", detail: "Bank sync is off", actionTitle: "Connect") {}
                HStack(spacing: 16) {
                    StatChip(icon: "drop.fill", value: "5", tint: OrionTheme.blue)
                    StatChip(icon: "pills.fill", value: "2", tint: OrionTheme.violet)
                    StatChip(icon: "bolt.fill", value: "Online", tint: OrionTheme.green)
                }
                ParkedBriefCard(facts: facts) {}.frame(width: 178)
            }
            .frame(width: 380)
            .padding(.top, 48)
        }
    }
}
