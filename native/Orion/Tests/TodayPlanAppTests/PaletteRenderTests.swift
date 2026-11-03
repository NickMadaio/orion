import AppKit
import PaletteKit
import SwiftUI
import XCTest
@testable import Orion

/// Renders the command palette's states, and holds the line on how fast it opens. PNGs only when ORION_UI_RENDER_DIR is set.
@MainActor
final class PaletteRenderTests: XCTestCase {
    private let glance = try! JSONDecoder().decode(QuickGlance.self, from: Data(
        #"{"now":{"title":"CS2100 lecture","until":"11:30 AM"},"next":{"title":"Lunch with Priya","at":"12:30 PM","inMinutes":58},"focusToday":"1h 20m","phone":null}"#.utf8))

    private func context(running: Bool = false, session: PaletteSession? = nil) -> PaletteContext {
        let installed = [
            PaletteInstalledApp(name: "Safari", path: "/System/Cryptexes/App/System/Applications/Safari.app"),
            PaletteInstalledApp(name: "Music", path: "/System/Applications/Music.app"),
            PaletteInstalledApp(name: "Stocks", path: "/System/Applications/Stocks.app"),
            PaletteInstalledApp(name: "Notes", path: "/System/Applications/Notes.app"),
            PaletteInstalledApp(name: "Calendar", path: "/System/Applications/Calendar.app"),
            PaletteInstalledApp(name: "Xcode", path: "/Applications/Xcode.app"),
        ]
        let live = running ? [PaletteRunningApp(name: "Messages", bundleID: "com.apple.MobileSMS", path: "/System/Applications/Messages.app", frontmost: false),
                              PaletteRunningApp(name: "Music", bundleID: "com.apple.Music", path: "/System/Applications/Music.app", frontmost: false)] : []
        return PaletteContext(session: session, muted: false, mouseShortcutsOn: true, nextFocusMinutes: 53,
                              todos: [PaletteTodo(title: "Send Priya the problem set", overdue: true, due: "yesterday"),
                                      PaletteTodo(title: "Final pass on the AE1 slides", overdue: false, due: "today")],
                              installed: installed, running: live)
    }

    private func model(_ query: String, running: Bool = false, output: PaletteOutput? = nil, selected: Int = 0) -> PaletteModel {
        let model = PaletteModel(context: context(running: running), frecency: Frecency(), now: { UIRender.date(11, 12) })
        model.glance = glance
        model.query = query
        model.select(selected)
        model.output = output
        return model
    }

    private func render(_ name: String, _ model: PaletteModel) throws {
        let view = PaletteView(model: model, isStatic: true, clockDate: UIRender.date(11, 12))
            .padding(40)
            .background(UIRender.wallpaper(light: false))
            .environment(\.colorScheme, .dark)
            .environment(\.orionFrozenMotion, 1)
        let image = try UIRender.write(name, view, size: CGSize(width: PaletteView.width + 80, height: PaletteView.fitHeight(rows: model.nav.rows, hasOutput: model.output != nil) + 80))
        XCTAssertGreaterThan(image.width, 0)
    }

    func testEmptyShowsTodayFirst() throws {
        let m = model("")
        XCTAssertEqual(m.nav.rows.first?.section, .today)
        try render("1-empty-today", m)
    }

    func testTypingGamSelectsGameReady() throws {
        let m = model("gam")
        XCTAssertEqual(m.nav.selectedItem?.title, "Game ready")
        try render("2-typing-gam", m)
    }

    func testPlusBuyMilk() throws {
        let m = model("+buy milk")
        XCTAssertEqual(m.nav.selectedItem?.action, .addTodo("buy milk"))
        try render("3-plus-buy-milk", m)
    }

    func testInlineAnswer() throws {
        let q = "what's left on my plate today?"
        let m = model(q, output: .answer(question: q, text: "Two things before six. The AE1 slides need a final pass, about forty minutes, and Priya is waiting on your half of the problem set. The gym slot at 17:30 is still free if you want it."))
        try render("4-inline-answer", m)
    }

    func testAppsResults() throws {
        let m = model("s", running: true, selected: 2)
        XCTAssertTrue(m.nav.rows.contains { $0.section == .apps || $0.section == .running })
        try render("5-apps-results", m)
    }

    func testClosePlanAndSubMenu() throws {
        let plan = model(">close", output: .plan(say: "I would close CurseForge (its windows are hidden or minimized). Kept Safari (one of your most recent windows).", closes: ["CurseForge"]))
        try render("6-close-unused-plan", plan)
        let sub = model("mus", running: true)
        sub.openSubMenu()
        try render("7-actions-submenu", sub)
        try render("8-calc", model("=18% of 240"))
    }

    func testHeightFitsContentBetweenTheLimits() {
        let few = PaletteView.fitHeight(rows: model("gam").nav.rows, hasOutput: false)
        let many = PaletteView.fitHeight(rows: model("s", running: true).nav.rows, hasOutput: false)
        XCTAssertGreaterThanOrEqual(few, PaletteView.minHeight)
        XCTAssertLessThan(few, many)
        XCTAssertLessThanOrEqual(many, PaletteView.height)
        XCTAssertLessThanOrEqual(PaletteView.fitHeight(rows: model("").nav.rows, hasOutput: true), PaletteView.height)
    }

    func testShowIsFastAndTheRankingDoesNotBlockTheMainThread() {
        let m = model("")
        let start = CFAbsoluteTimeGetCurrent()
        for text in ["g", "ga", "gam", "game", "safri", "+x", "=2+2"] { m.query = text }
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        XCTAssertLessThan(elapsed, 0.1, "seven keystrokes of ranking took \(elapsed * 1000) ms")
    }
}
