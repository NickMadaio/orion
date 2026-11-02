import AppKit
import SwiftUI
import XCTest
@testable import Orion

/// The per-project model choice: parsing of `orion-projects models`, the fallback and missing cases, and the selector
/// rendered closed and open. Model names here are fixtures; nothing in the app names one.
@MainActor
final class ProjectModelTests: XCTestCase {
    private let fixture = """
    {"endpoint":"http://127.0.0.1:11434","defaults":{"worker":"base:9b","reviewer":"base:9b"},
     "models":[{"name":"base:9b","sizeBytes":6600000000,"capabilities":["tools"]},
               {"name":"alpha-vision:12b","sizeBytes":8100000000,"capabilities":["tools","vision"]},
               {"name":"tiny:1b","sizeBytes":640000000,"capabilities":[]}]}
    """

    private func catalog() throws -> ProjectModelCatalog { try XCTUnwrap(ProjectModelCatalog.parse(Data(fixture.utf8))) }

    func testParsesDiscoveryJSON() throws {
        let catalog = try catalog()
        XCTAssertEqual(catalog.models.map(\.name), ["base:9b", "alpha-vision:12b", "tiny:1b"])
        XCTAssertEqual(catalog.defaults["worker"], "base:9b")
        XCTAssertEqual(catalog.info("alpha-vision:12b")?.badges, ["vision", "tools"])
        XCTAssertEqual(catalog.info("base:9b")?.sizeLabel, "6.6 GB")
        XCTAssertEqual(catalog.info("tiny:1b")?.sizeLabel, "640 MB")
        XCTAssertNil(ProjectModelCatalog.parse(Data("not json".utf8)))
    }

    func testUnsetFallsBackToTheDefault() {
        let result = ProjectModelResolution.resolve(chosen: nil, defaultModel: "base:9b", installed: ["base:9b"])
        XCTAssertEqual(result, .init(source: .defaulted, effective: "base:9b", chosen: nil))
    }

    func testChosenModelIsUsed() {
        let result = ProjectModelResolution.resolve(chosen: "tiny:1b", defaultModel: "base:9b", installed: ["base:9b", "tiny:1b"])
        XCTAssertEqual(result.source, .chosen)
        XCTAssertEqual(result.effective, "tiny:1b")
    }

    func testRemovedModelIsMissingAndFallsBack() {
        let result = ProjectModelResolution.resolve(chosen: "gone:3b", defaultModel: "base:9b", installed: ["base:9b"])
        XCTAssertEqual(result.source, .missing)
        XCTAssertEqual(result.effective, "base:9b")
        XCTAssertEqual(result.chosen, "gone:3b")
        // Ollama unreachable: trust the record rather than flag everything missing.
        XCTAssertEqual(ProjectModelResolution.resolve(chosen: "gone:3b", defaultModel: "base:9b", installed: nil).source, .chosen)
    }

    func testMissingChoiceStaysInTheList() throws {
        let rows = ProjectModelRows.items(try catalog(), chosen: "gone:3b")
        XCTAssertEqual(rows.first?.id, "gone:3b")
        XCTAssertEqual(rows.first?.missing, true)
        XCTAssertEqual(rows.count, 4)
    }

    func testStoreResolvesPerRole() throws {
        let store = ProjectModelStore(projectID: "p-one", models: ["worker": "tiny:1b"], catalog: try catalog())
        XCTAssertEqual(store.resolution(role: "worker").effective, "tiny:1b")
        XCTAssertEqual(store.resolution(role: "reviewer").source, .defaulted)
    }

    private func frame<V: View>(_ name: String, _ view: V, size: CGSize) throws {
        try UIRender.write(name, UIRender.onDesktop(view.padding(34), light: false, size: size), size: size)
    }

    func testRendersSelectorClosedAndOpen() throws {
        let catalog = try catalog()
        let closedStore = ProjectModelStore(projectID: "p-one", models: ["worker": "alpha-vision:12b", "reviewer": "gone:3b"], catalog: catalog)
        try frame("w15-projmodel-closed", ProjectModelSection(store: closedStore).frame(width: 560), size: CGSize(width: 700, height: 280))
        try frame("w15-projmodel-open",
                  ProjectPickList(defaultRow: ProjectModelRows.defaultRow("base:9b"),
                                  items: ProjectModelRows.items(catalog, chosen: "alpha-vision:12b"),
                                  selection: "alpha-vision:12b", onSelect: { _ in }, onRefresh: {}),
                  size: CGSize(width: 420, height: 300))
        try frame("w15-projmodel-pills",
                  VStack(alignment: .leading, spacing: 14) {
                      PillFace(label: "Default", note: "(base:9b)")
                      PillFace(label: "alpha-vision:12b", open: true)
                      PillFace(label: "gone:3b", note: "missing", noteHue: OrionTheme.orange, missing: true)
                  },
                  size: CGSize(width: 420, height: 200))
    }
}
