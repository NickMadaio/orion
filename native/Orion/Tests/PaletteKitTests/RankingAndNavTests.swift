import XCTest
@testable import PaletteKit

final class RankingAndNavTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func context(running: [PaletteRunningApp] = [], installed: [PaletteInstalledApp] = [],
                         todos: [PaletteTodo] = [], session: PaletteSession? = nil) -> PaletteContext {
        PaletteContext(session: session, muted: false, mouseShortcutsOn: true, nextFocusMinutes: nil,
                       todos: todos, installed: installed, running: running)
    }

    private let apps = [
        PaletteInstalledApp(name: "Safari", path: "/Applications/Safari.app"),
        PaletteInstalledApp(name: "Spotify", path: "/Applications/Spotify.app"),
        PaletteInstalledApp(name: "Xcode", path: "/Applications/Xcode.app"),
        PaletteInstalledApp(name: "Steam", path: "/Applications/Steam.app"),
    ]

    private func titles(_ q: String, _ ctx: PaletteContext, _ f: Frecency = Frecency()) -> [String] {
        PaletteRanker.results(input: PaletteInput.parse(q), context: ctx, frecency: f, now: now).map(\.title)
    }

    func testGamFindsGameReadyFirst() {
        XCTAssertEqual(titles("gam", context()).first, "Game ready")
    }

    func testAcronymGrFindsGameReady() {
        XCTAssertTrue(titles("gr", context()).prefix(3).contains("Game ready"))
    }

    func testTypoFindsApp() {
        XCTAssertEqual(titles("safri", context(installed: apps)).first, "Safari")
    }

    func testFrecencyReordersCloseCalls() {
        let ctx = context(installed: apps)
        let before = titles("s", ctx)
        let steamID = PaletteRanker.results(input: .search("steam"), context: ctx, frecency: Frecency(), now: now).first!.id
        let learned = Frecency().recording(steamID, query: "s", now: now.addingTimeInterval(-60))
        let after = titles("s", ctx, learned)
        XCTAssertNotEqual(before.firstIndex(of: "Steam"), after.firstIndex(of: "Steam"))
        XCTAssertLessThan(after.firstIndex(of: "Steam") ?? 99, before.firstIndex(of: "Steam") ?? 98)
    }

    func testAskFallbackIsAlwaysLast() {
        let rows = PaletteRanker.results(input: .search("gam"), context: context(), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.last?.section, .ask)
        XCTAssertEqual(rows.last?.action, .ask("gam"))
    }

    func testRowsAreGroupedBySection() {
        let rows = PaletteRanker.results(input: .search("s"), context: context(installed: apps), frecency: Frecency(), now: now)
        var seen = Set<PaletteSection>(), last: PaletteSection?
        for row in rows where row.section != last {
            XCTAssertFalse(seen.contains(row.section), "section \(row.section) appears twice")
            seen.insert(row.section); last = row.section
        }
    }

    func testPlusModeIsOneAddTodoRow() {
        let rows = PaletteRanker.results(input: .addTodo("buy milk"), context: context(), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.map(\.action), [.addTodo("buy milk")])
    }

    func testEmptyPlusPromptsInsteadOfAdding() {
        let rows = PaletteRanker.results(input: .addTodo(""), context: context(), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.count, 1)
        XCTAssertNotEqual(rows.first?.action, .addTodo(""))
    }

    func testCalcModeShowsTheAnswer() {
        let rows = PaletteRanker.results(input: .calc("18% of 240"), context: context(), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.first?.title, "43.2")
        XCTAssertEqual(rows.first?.action, .copy("43.2"))
    }

    func testActionModeOnlyListsActions() {
        let rows = PaletteRanker.results(input: .action("a"), context: context(installed: apps), frecency: Frecency(), now: now)
        XCTAssertFalse(rows.isEmpty)
        XCTAssertTrue(rows.allSatisfy { $0.section == .actions })
    }

    func testAskModeIsOneAskRow() {
        let rows = PaletteRanker.results(input: .ask("is it raining"), context: context(), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.map(\.action), [.ask("is it raining")])
    }

    func testBrowseShowsTodayFirstAndIsBounded() {
        let todos = [PaletteTodo(title: "Send Priya the set", overdue: true, due: "yesterday")]
        let rows = PaletteRanker.results(input: .browse, context: context(todos: todos), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.first?.section, .today)
        XCTAssertLessThanOrEqual(rows.count, 9)
    }

    func testRunningAppOffersSwitchAndTheInstalledDuplicateIsHidden() {
        let running = [PaletteRunningApp(name: "Safari", bundleID: "com.apple.Safari", path: "/Applications/Safari.app", frontmost: false)]
        let rows = PaletteRanker.results(input: .search("safari"), context: context(running: running, installed: apps), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.filter { $0.title == "Safari" }.count, 1)
        XCTAssertEqual(rows.first { $0.title == "Safari" }?.section, .running)
    }

    func testSessionControlsFollowTheSession() {
        let idle = titles("", context())
        _ = idle
        let running = PaletteSession(paused: false, onBreak: false)
        let t = titles("finish", context(session: running))
        XCTAssertTrue(t.contains("Finish the session"))
        XCTAssertFalse(titles("finish", context()).contains("Finish the session"))
    }

    func testTodoDoneIsAnActionOnTheTodoRow() {
        let todos = [PaletteTodo(title: "Email Sam", overdue: false, due: "today")]
        let rows = PaletteRanker.results(input: .search("email sam"), context: context(todos: todos), frecency: Frecency(), now: now)
        XCTAssertEqual(rows.first?.action, .todoDone("Email Sam"))
    }

    func testFocusPhraseOffersAFocusRow() {
        let rows = PaletteRanker.results(input: .search("focus 90"), context: context(), frecency: Frecency(), now: now)
        XCTAssertTrue(rows.contains { $0.action == .startFocus(minutes: 90) })
    }

    // MARK: navigation

    private func nav(_ q: String = "s") -> PaletteNav {
        PaletteNav(rows: PaletteRanker.results(input: .search(q), context: context(installed: apps), frecency: Frecency(), now: now))
    }

    func testMoveWrapsBothWays() {
        let n = nav()
        XCTAssertEqual(n.selected, 0)
        XCTAssertEqual(n.moved(by: -1).selected, n.rows.count - 1)
        XCTAssertEqual(n.moved(by: -1).moved(by: 1).selected, 0)
    }

    func testQuickPickIsOneBasedAndBounded() {
        let n = nav()
        XCTAssertEqual(n.quickPick(1)?.id, n.rows[0].id)
        XCTAssertEqual(n.quickPick(2)?.id, n.rows[1].id)
        XCTAssertNil(n.quickPick(0))
        XCTAssertNil(n.quickPick(10))
        XCTAssertNil(n.quickPick(n.rows.count + 1))
    }

    func testTabCyclesToTheNextSectionAndWraps() {
        let n = nav()
        let sections = n.rows.map(\.section)
        XCTAssertGreaterThan(Set(sections).count, 1)
        var cur = n
        var visited: [PaletteSection] = [cur.selectedItem!.section]
        for _ in 0..<Set(sections).count { cur = cur.cycledSection(); visited.append(cur.selectedItem!.section) }
        XCTAssertEqual(visited.first, visited.last)
        XCTAssertEqual(Set(visited).count, Set(sections).count)
        // lands on a section's first row
        XCTAssertTrue(cur.selected == 0 || cur.rows[cur.selected - 1].section != cur.rows[cur.selected].section)
    }

    func testReplacingRowsKeepsTheSelectionOnTheSameRow() {
        let n = nav().moved(by: 1)
        let id = n.selectedItem?.id
        XCTAssertEqual(n.replacingRows(n.rows.reversed()).selectedItem?.id, id)
    }

    func testReplacingRowsWithoutTheSelectedRowResetsToTop() {
        let n = nav().moved(by: 1)
        XCTAssertEqual(n.replacingRows(Array(n.rows.dropFirst(2))).selected, 0)
    }

    func testEmptyNavIsSafe() {
        let n = PaletteNav(rows: [])
        XCTAssertNil(n.selectedItem)
        XCTAssertEqual(n.moved(by: 1).selected, 0)
        XCTAssertEqual(n.cycledSection().selected, 0)
    }

    func testSubMenuOpensOnTheSelectedRowAndClosesOnEscape() {
        let n = nav("safari")
        let opened = n.openingSubMenu()
        XCTAssertNotNil(opened.subMenu)
        XCTAssertFalse(opened.subMenu!.isEmpty)
        XCTAssertEqual(opened.moved(by: 1).subSelected, 1 % opened.subMenu!.count)
        XCTAssertNil(opened.closingSubMenu().subMenu)
    }

    func testSubMenuForARunningAppHasQuit() {
        let running = [PaletteRunningApp(name: "Safari", bundleID: "com.apple.Safari", path: "/Applications/Safari.app", frontmost: false)]
        let n = PaletteNav(rows: PaletteRanker.results(input: .search("safari"), context: context(running: running), frecency: Frecency(), now: now))
        XCTAssertTrue(n.openingSubMenu().subMenu!.contains { $0.action == .quitApp(name: "Safari") })
    }
}

extension RankingAndNavTests {
    func testBackTabGoesToThePreviousSection() {
        let n = PaletteNav(rows: PaletteRanker.results(input: .search("s"), context: PaletteModelFixture.apps, frecency: Frecency(), now: Date()))
        XCTAssertEqual(n.cycledSection().cycledSection(backward: true).selected, n.selected)
    }
}

enum PaletteModelFixture {
    static let apps = PaletteContext(session: nil, muted: false, mouseShortcutsOn: true, nextFocusMinutes: nil, todos: [],
        installed: [PaletteInstalledApp(name: "Safari", path: "/A/Safari.app"), PaletteInstalledApp(name: "Steam", path: "/A/Steam.app")], running: [])
}

extension RankingAndNavTests {
    func testACrowdedSectionDoesNotPushAnotherOffTheList() {
        let many = (1...12).map { PaletteInstalledApp(name: "Send app \($0)", path: "/A/S\($0).app") }
        let ctx = PaletteContext(session: nil, muted: false, mouseShortcutsOn: true, nextFocusMinutes: nil,
                                 todos: [PaletteTodo(title: "Send Priya the set", overdue: true, due: "yesterday")], installed: many, running: [])
        let rows = PaletteRanker.results(input: .search("send"), context: ctx, frecency: Frecency(), now: Date())
        XCTAssertTrue(rows.contains { $0.section == .today })
        XCTAssertTrue(rows.contains { $0.section == .apps })
        XCTAssertTrue(rows.contains { $0.section == .ask })
    }
}
