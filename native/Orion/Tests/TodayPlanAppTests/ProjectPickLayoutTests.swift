import XCTest
@testable import Orion

/// The model popover sizes itself to the longest model name instead of truncating it.
final class ProjectPickLayoutTests: XCTestCase {
    private func item(_ title: String, badges: [String] = [], missing: Bool = false) -> ProjectPickItem {
        ProjectPickItem(id: title, title: title, detail: "4.7 GB", badges: badges, missing: missing)
    }

    func testShortNamesUseTheMinimumWidth() {
        XCTAssertEqual(ProjectPickLayout.listWidth(for: [item("tiny:1b")]), ProjectPickLayout.minWidth)
        XCTAssertEqual(ProjectPickLayout.listWidth(for: []), ProjectPickLayout.minWidth)
    }

    func testLongNamesGrowTheListToFitThem() {
        let name = "qwen3.5:4b-q4_K_M-extra-long-quant-name"
        let width = ProjectPickLayout.listWidth(for: [item(name)])
        let needed = ProjectPickLayout.textWidth(name, size: 11.5, weight: .semibold) + ProjectPickLayout.rowChrome
        XCTAssertGreaterThan(width, ProjectPickLayout.minWidth)
        XCTAssertGreaterThanOrEqual(width, needed)
        XCTAssertLessThanOrEqual(width, ProjectPickLayout.maxWidth)
    }

    func testBadgesWidenTheRow() {
        let name = "qwen3.5:27b-instruct-q4_K_M-long"
        XCTAssertGreaterThan(ProjectPickLayout.listWidth(for: [item(name, badges: ["vision", "tools"])]),
                             ProjectPickLayout.listWidth(for: [item(name)]))
    }

    func testWidthIsCappedForAbsurdNames() {
        let name = String(repeating: "x", count: 200)
        XCTAssertEqual(ProjectPickLayout.listWidth(for: [item(name)]), ProjectPickLayout.maxWidth)
    }

    func testHeightGrowsWithRowsThenCaps() {
        XCTAssertEqual(ProjectPickLayout.listHeight(for: [item("a"), item("b")]), 84)
        let many = (0..<40).map { item("model-\($0)") }
        XCTAssertEqual(ProjectPickLayout.listHeight(for: many), ProjectPickLayout.maxListHeight)
        XCTAssertTrue(ProjectPickLayout.needsScroll(many))
        XCTAssertFalse(ProjectPickLayout.needsScroll([item("a"), item("b")]))
    }
}
