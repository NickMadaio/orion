import AppKit
import SwiftUI
import XCTest
@testable import Orion

/// Wave 17 renders: the hub layout and the Brain view through the real Knowledge tab. Always asserts the render is
/// not blank; writes PNGs only when ORION_KNOWLEDGE_RENDER_DIR is set.
@MainActor
final class Wave17GraphRenderTests: XCTestCase {
    private let size = CGSize(width: 1280, height: 800)

    private func render(_ name: String, _ store: KnowledgeStore) throws {
        let view = KnowledgeView(store: store, availableHeight: size.height - 52, snapshot: true)
            .padding(.horizontal, 32).padding(.top, 26)
            .frame(width: size.width, height: size.height, alignment: .topLeading)
            .background(LinearGradient(colors: [Color(red: 0.05, green: 0.06, blue: 0.12), Color(red: 0.10, green: 0.07, blue: 0.16)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing))
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let cg = try XCTUnwrap(renderer.nsImage?.cgImage(forProposedRect: nil, context: nil, hints: nil), name)
        let png = try XCTUnwrap(NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(png.count, 40_000, "\(name) looks blank")
        if let dir = ProcessInfo.processInfo.environment["ORION_KNOWLEDGE_RENDER_DIR"].map({ URL(fileURLWithPath: $0) }) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try png.write(to: dir.appendingPathComponent("\(name).png"))
        }
    }

    private func settle(_ sky: KnowledgeSky, hover id: String? = nil) {
        let canvas = CGSize(width: size.width - 64 - 214 - 36 - (id == nil ? 0 : 0), height: size.height - 150)
        sky.ambient = false
        for f in 0..<3 { sky.tick(Date().addingTimeInterval(Double(f)), size: canvas) }
        if let id { sky.setHovered(sky.index[id]) }
    }

    func testRendersTheHubView() throws {
        let graph = try JSONDecoder().decode(KnowledgeGraph.self, from: Data(contentsOf: KnowledgeModelTests.fixtures.appendingPathComponent("sample-graph.json")))
        let store = KnowledgeStore(graph: graph)
        try render("w17d-hub-view", store)
        store.selectedID = "hub:habit"
        try render("w17d-hub-selected", store)
    }

    func testRendersTheBrainView() throws {
        let root = try BrainVaultTests.bigVault(count: 150)
        defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
        let graph = BrainVaultLoader().load(root: root)
        let brain = BrainStore(graph: graph)
        let store = KnowledgeStore(graph: .empty, brain: brain)
        store.mode = .brain
        try render("w17d-brain-view", store)
        brain.sky.setHovered(brain.sky.index["note:10 Projects/Note 1"] ?? 5)
        try render("w17d-brain-hover", store)
    }
}
