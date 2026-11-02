import AppKit
import SwiftUI
import XCTest
@testable import Orion

/// Renders the living graph at three moments with ImageRenderer: mid-entrance (stars gliding in, threads not yet
/// drawn), at rest with a hover card, a photon pulse and the recent shimmer, and zoomed in on a selection. Asserts each
/// is drawn and that the phases differ; writes PNGs only when ORION_KNOWLEDGE_RENDER_DIR is set.
@MainActor
final class KnowledgeSkyRenderTests: XCTestCase {
    private let size = CGSize(width: 1000, height: 700)

    private var outputDirectory: URL? {
        ProcessInfo.processInfo.environment["ORION_KNOWLEDGE_RENDER_DIR"].map { URL(fileURLWithPath: $0) }
    }

    /// The fixture's facts are dated 10-20 to 10-30; on the 26th only the few from the 25th are fresh.
    private static let fixtureNow: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 10; c.day = 26; c.hour = 9
        return Calendar.current.date(from: c)!
    }()

    private func sky(_ graph: KnowledgeGraph) -> KnowledgeSky {
        let sky = KnowledgeSky()
        sky.load(graph, now: Self.fixtureNow, animated: true)
        sky.ambient = true
        return sky
    }

    private func run(_ sky: KnowledgeSky, frames: Int, from start: Int = 0) {
        for f in start..<(start + frames) { sky.tick(Self.fixtureNow.addingTimeInterval(Double(f) / 60), size: size) }
    }

    func testRendersTheGraphAtThreePhases() throws {
        let graph = try JSONDecoder().decode(KnowledgeGraph.self, from: Data(contentsOf: KnowledgeModelTests.fixtures.appendingPathComponent("sample-graph.json")))
        let living = sky(graph)
        XCTAssertTrue(living.recent.contains(true), "the fixture should have something learned on the 25th")
        XCTAssertLessThan(Double(living.recent.filter { $0 }.count) / Double(living.recent.count), 0.31)

        run(living, frames: 28)
        XCTAssertTrue(living.isEntering)
        let entrance = try render("sky-phase1-entrance", living)

        run(living, frames: 420, from: 28)
        XCTAssertTrue(living.physics!.isSettled)
        let gym = try XCTUnwrap(living.index["habit:gym"])
        living.setHovered(gym)
        if let link = living.linksOf[try XCTUnwrap(living.index["person:self"])].first(where: { !living.linksOf[gym].contains($0) }) {
            living.firePulse(link: link)
        }
        run(living, frames: 40, from: 448)
        let rest = try render("sky-phase2-hover-pulse", living)

        living.setHovered(nil)
        living.selectedID = "course:mktg2201"
        let target = try XCTUnwrap(living.screenPoint(of: "course:mktg2201", size: size))
        living.zoom(by: 1.45, at: target, size: size)
        run(living, frames: 40, from: 488)
        let zoomed = try render("sky-phase3-zoomed-selection", living)

        XCTAssertNotEqual(entrance, rest)
        XCTAssertNotEqual(rest, zoomed)
    }

    func testRendersTwoHundredNodes() throws {
        let living = sky(KnowledgeSkyTests.big(count: 199))
        run(living, frames: 600)
        living.setHovered(living.index["goal:n8"])
        run(living, frames: 30, from: 600)
        try render("sky-200-nodes", living)
    }

    @discardableResult
    private func render(_ name: String, _ sky: KnowledgeSky) throws -> Data {
        let view = SkyStill(sky: sky, style: SkyStyle(palette: KnowledgePalette(scheme: .dark)))
            .frame(width: size.width, height: size.height)
            .background(LinearGradient(colors: [Color(red: 0.05, green: 0.06, blue: 0.12), Color(red: 0.10, green: 0.07, blue: 0.16)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing))
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let cg = try XCTUnwrap(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        let rep = NSBitmapImageRep(cgImage: cg)
        let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(png.count, 20_000, "\(name) looks blank")
        if let dir = outputDirectory {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try png.write(to: dir.appendingPathComponent("\(name).png"))
        }
        return png
    }
}
