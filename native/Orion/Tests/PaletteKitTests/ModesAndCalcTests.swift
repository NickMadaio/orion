import XCTest
@testable import PaletteKit

final class ModesAndCalcTests: XCTestCase {
    func testEmptyIsBrowse() { XCTAssertEqual(PaletteInput.parse("  "), .browse) }

    func testPlainTextSearches() { XCTAssertEqual(PaletteInput.parse("gam"), .search("gam")) }

    func testQuestionMarkPrefixAsks() {
        XCTAssertEqual(PaletteInput.parse("?what's on today"), .ask("what's on today"))
        XCTAssertEqual(PaletteInput.parse("? how long is the flight"), .ask("how long is the flight"))
    }

    func testQuestionsAreAsked() {
        XCTAssertEqual(PaletteInput.parse("what should i do first today"), .ask("what should i do first today"))
        XCTAssertEqual(PaletteInput.parse("is it going to rain?"), .ask("is it going to rain?"))
        XCTAssertEqual(PaletteInput.parse("gam?"), .ask("gam?"))
    }

    func testOneWordInterrogativeStillSearches() {
        XCTAssertEqual(PaletteInput.parse("what"), .search("what"))
        XCTAssertEqual(PaletteInput.parse("how"), .search("how"))
    }

    func testPlusAddsATodo() {
        XCTAssertEqual(PaletteInput.parse("+buy milk"), .addTodo("buy milk"))
        XCTAssertEqual(PaletteInput.parse("+  call mum "), .addTodo("call mum"))
        XCTAssertEqual(PaletteInput.parse("+"), .addTodo(""))
    }

    func testEqualsIsACalculation() {
        XCTAssertEqual(PaletteInput.parse("=2+2"), .calc("2+2"))
        XCTAssertEqual(PaletteInput.parse("= 18% of 240"), .calc("18% of 240"))
    }

    func testGreaterThanRunsAnAction() {
        XCTAssertEqual(PaletteInput.parse(">game"), .action("game"))
        XCTAssertEqual(PaletteInput.parse("> water"), .action("water"))
        XCTAssertEqual(PaletteInput.parse(">"), .action(""))
    }

    // MARK: calculator

    private func calc(_ s: String) -> String? { Calculator.evaluate(s).map(Calculator.format) }

    func testArithmeticAndPrecedence() {
        XCTAssertEqual(calc("2+2"), "4")
        XCTAssertEqual(calc("2+3*4"), "14")
        XCTAssertEqual(calc("(2+3)*4"), "20")
        XCTAssertEqual(calc("2^3^2"), "512")
        XCTAssertEqual(calc("-3+5"), "2")
        XCTAssertEqual(calc("10/4"), "2.5")
        XCTAssertEqual(calc("7 % 4"), "3")
    }

    func testFriendlyForms() {
        XCTAssertEqual(calc("18% of 240"), "43.2")
        XCTAssertEqual(calc("12 x 3"), "36")
        XCTAssertEqual(calc("2k + 500"), "2,500")
        XCTAssertEqual(calc("1,200 / 4"), "300")
        XCTAssertEqual(calc("(84+16)/4"), "25")
    }

    func testFloatNoiseIsTrimmed() { XCTAssertEqual(calc("0.1+0.2"), "0.3") }

    func testBadInputIsNilNotACrash() {
        XCTAssertNil(calc("2+"))
        XCTAssertNil(calc("1/0"))
        XCTAssertNil(calc("abc"))
        XCTAssertNil(calc("(2+3"))
        XCTAssertNil(calc(""))
        XCTAssertNil(calc("9^9^9^9"))
    }

    func testLargeNumbersGetSeparators() { XCTAssertEqual(calc("1000*1000"), "1,000,000") }
}
