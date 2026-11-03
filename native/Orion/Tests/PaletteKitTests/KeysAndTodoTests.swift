import XCTest
@testable import PaletteKit

final class KeysAndTodoTests: XCTestCase {
    private func key(_ code: UInt16, _ chars: String = "", cmd: Bool = false, shift: Bool = false, opt: Bool = false, ctrl: Bool = false) -> PaletteKey? {
        PaletteKey.from(keyCode: code, characters: chars, command: cmd, shift: shift, option: opt, control: ctrl)
    }

    func testNavigationKeys() {
        XCTAssertEqual(key(126), .up)
        XCTAssertEqual(key(125), .down)
        XCTAssertEqual(key(36), .enter)
        XCTAssertEqual(key(76), .enter)
        XCTAssertEqual(key(53), .escape)
        XCTAssertEqual(key(48), .tab)
        XCTAssertEqual(key(48, shift: true), .backTab)
    }

    func testCommandReturnAsks() { XCTAssertEqual(key(36, cmd: true), .askTyped) }

    func testQuickPicksNeedCommand() {
        XCTAssertEqual(key(18, "1", cmd: true), .quickPick(1))
        XCTAssertEqual(key(25, "9", cmd: true), .quickPick(9))
        XCTAssertNil(key(18, "1"))
        XCTAssertNil(key(29, "0", cmd: true))
    }

    func testCommandKAndQ() {
        XCTAssertEqual(key(40, "k", cmd: true), .actionsMenu)
        XCTAssertEqual(key(12, "q", cmd: true), .quitApp)
        XCTAssertNil(key(40, "k"))
    }

    func testEmacsStyleMovement() {
        XCTAssertEqual(key(45, "n", ctrl: true), .down)
        XCTAssertEqual(key(35, "p", ctrl: true), .up)
    }

    func testPlainTypingPassesThrough() {
        XCTAssertNil(key(0, "a"))
        XCTAssertNil(key(0, "a", shift: true))
        XCTAssertNil(key(0, "a", opt: true))
    }

    // MARK: to-do lines

    func testParsesTodoLines() {
        let text = """
        - Send Priya the problem set · due 2026-11-02 · high · "2 hours a day"
        - Buy milk
        - Read chapter 4 · due 2026-11-03 · booked: 11-03 60 min
            · sub task — 20%
        - Book flights · due 2026-11-09
        """
        let todos = PaletteTodoParser.parse(text, today: "2026-11-03")
        XCTAssertEqual(todos.map(\.title), ["Send Priya the problem set", "Buy milk", "Read chapter 4", "Book flights"])
        XCTAssertEqual(todos.map(\.overdue), [true, false, false, false])
        XCTAssertEqual(todos[0].due, "yesterday")
        XCTAssertEqual(todos[2].due, "today")
        XCTAssertEqual(todos[3].due, "in 6 days")
        XCTAssertEqual(todos[1].due, "")
    }

    func testNothingLineIsNoTodos() {
        XCTAssertEqual(PaletteTodoParser.parse("Nothing on Orion.", today: "2026-11-03"), [])
        XCTAssertEqual(PaletteTodoParser.parse("", today: "2026-11-03"), [])
    }
}
