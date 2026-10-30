import AppKit
import SwiftUI
import XCTest
@testable import Orion

/// Renders the Knowledge tab with ImageRenderer: dark and light, two window sizes, at rest, selected, and the first
/// frame of a selection made from the list. Always asserts the render is not blank; writes PNGs only when
/// ORION_KNOWLEDGE_RENDER_DIR is set (so CI writes nothing), and also renders ORION_KNOWLEDGE_REAL_GRAPH if given.
@MainActor
final class KnowledgeRenderTests: XCTestCase {

    private var outputDirectory: URL? {
        ProcessInfo.processInfo.environment["ORION_KNOWLEDGE_RENDER_DIR"].map { URL(fileURLWithPath: $0) }
    }

    private func sampleGraph() throws -> KnowledgeGraph {
        let url = KnowledgeModelTests.fixtures.appendingPathComponent("sample-graph.json")
        return try JSONDecoder().decode(KnowledgeGraph.self, from: Data(contentsOf: url))
    }

    /// Something like a desktop behind the glass, so the PNG shows the window's real alpha rather than a fill.
    private func wallpaper(_ scheme: ColorScheme) -> some View {
        let dark = scheme == .dark
        return ZStack {
            LinearGradient(colors: dark ? [Color(red: 0.05, green: 0.06, blue: 0.12), Color(red: 0.10, green: 0.07, blue: 0.16)]
                                        : [Color(red: 0.86, green: 0.89, blue: 0.94), Color(red: 0.95, green: 0.92, blue: 0.90)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            Circle().fill((dark ? Color(red: 0.20, green: 0.25, blue: 0.55) : Color(red: 0.75, green: 0.82, blue: 0.98)).opacity(0.45))
                .frame(width: 700).blur(radius: 140).offset(x: 300, y: -220)
            Circle().fill((dark ? Color(red: 0.45, green: 0.18, blue: 0.40) : Color(red: 0.98, green: 0.84, blue: 0.80)).opacity(0.35))
                .frame(width: 600).blur(radius: 160).offset(x: -380, y: 260)
        }
    }

    @discardableResult
    private func render(_ name: String, graph: KnowledgeGraph, scheme: ColorScheme, size: CGSize,
                        select: String? = nil, ringInList: Bool = false, search: String = "") throws -> NSImage {
        let store = KnowledgeStore(graph: graph)
        store.selectedID = select
        store.query.text = search
        let view = KnowledgeView(store: store, availableHeight: size.height - 52, snapshot: true, snapshotRingInList: ringInList)
            .padding(.horizontal, 32).padding(.top, 26)
            .frame(width: size.width, height: size.height, alignment: .topLeading)
            .background(wallpaper(scheme))
            .environment(\.colorScheme, scheme)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage, "ImageRenderer returned nothing for \(name)")
        let cg = try XCTUnwrap(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        XCTAssertEqual(cg.width, Int(size.width * 2))
        XCTAssertTrue(hasDetail(cg), "\(name) rendered blank")
        if let dir = outputDirectory {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let rep = NSBitmapImageRep(cgImage: cg)
            try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(to: dir.appendingPathComponent("\(name).png"))
        }
        return image
    }

    /// Bright, thin marks on the wallpaper: text and line art, not just the gradient.
    private func hasDetail(_ image: CGImage) -> Bool {
        guard let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return false }
        let length = CFDataGetLength(data)
        var minimum = 255, maximum = 0
        stride(from: 0, to: length, by: 4 * 97).forEach { i in
            let v = Int(bytes[i])
            minimum = min(minimum, v); maximum = max(maximum, v)
        }
        return maximum - minimum > 90
    }

    func testRendersTheFixtureGraph() throws {
        let graph = try sampleGraph()
        for scheme in [ColorScheme.dark, .light] {
            let tag = scheme == .dark ? "dark" : "light"
            try render("knowledge-fixture-\(tag)-1280", graph: graph, scheme: scheme, size: CGSize(width: 1280, height: 800))
            try render("knowledge-fixture-\(tag)-960", graph: graph, scheme: scheme, size: CGSize(width: 960, height: 640))
            try render("knowledge-fixture-\(tag)-selected", graph: graph, scheme: scheme, size: CGSize(width: 1280, height: 800), select: "habit:gym")
        }
        try render("knowledge-fixture-dark-midselection", graph: graph, scheme: .dark, size: CGSize(width: 1280, height: 800),
                   select: "course:mktg2201", ringInList: true)
        try render("knowledge-fixture-dark-search", graph: graph, scheme: .dark, size: CGSize(width: 1280, height: 800), search: "gym")
    }

    func testRendersTheRealGraphWhenGiven() throws {
        guard let path = ProcessInfo.processInfo.environment["ORION_KNOWLEDGE_REAL_GRAPH"] else { throw XCTSkip("no real graph given") }
        let graph = try JSONDecoder().decode(KnowledgeGraph.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        try render("knowledge-real-dark-1440", graph: graph, scheme: .dark, size: CGSize(width: 1440, height: 900))
        try render("knowledge-real-light-1440", graph: graph, scheme: .light, size: CGSize(width: 1440, height: 900))
        try render("knowledge-real-dark-1024", graph: graph, scheme: .dark, size: CGSize(width: 1024, height: 700))
        try render("knowledge-real-dark-selected", graph: graph, scheme: .dark, size: CGSize(width: 1440, height: 900), select: "habit:gym")
        try render("knowledge-real-dark-midselection", graph: graph, scheme: .dark, size: CGSize(width: 1440, height: 900),
                   select: "course:mktg2201", ringInList: true)
    }
}
