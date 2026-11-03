import CoreGraphics
import XCTest
@testable import Orion

/// Wave 17: the vault reader. Wikilink forms, aliases, headings, case-blind matching, ghosts, folder colour, the
/// Obsidian URL, the mtime cache, and a vault-sized fixture held to the same stillness and step-time bars.
/// Every vault here is a fixture in a temp directory; nothing reads or writes the real one.
@MainActor
final class BrainVaultTests: XCTestCase {
    // MARK: Fixture vaults

    static func makeVault(_ files: [String: String]) throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("brain-fixture-\(UUID().uuidString)/orionBrain")
        for (path, text) in files {
            let url = root.appendingPathComponent(path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try text.write(to: url, atomically: true, encoding: .utf8)
        }
        return root
    }

    /// About `count` notes across the eight numbered folders, each linking to a few others in assorted forms.
    static func bigVault(count: Int = 150) throws -> URL {
        let folders = ["00 Inbox", "10 Projects", "20 Areas", "30 Resources", "40 Daily", "50 Concepts", "60 Sources", "90 System"]
        var files: [String: String] = ["Home.md": "# Home\nThe map. [[10 Projects/Note 1|first]] and [[Note 2]].\n"]
        for i in 1..<count {
            let folder = folders[i % folders.count]
            let hub = (i * 7) % (count - 1) + 1
            let next = (i * 13) % (count - 1) + 1
            let forms = ["[[Note \(hub)]]", "[[note \(next)|alias]]", "[[Note \(hub)#Heading]]"]
            files["\(folder)/Note \(i).md"] = "---\ntitle: Note \(i)\n---\n# Note \(i)\nBody line for note \(i).\nSee \(forms[i % 3]) and \(forms[(i + 1) % 3]) and [[Home]].\n"
        }
        return try makeVault(files)
    }

    private func graph(_ files: [String: String], maxGhosts: Int = BrainVault.maxGhosts) throws -> KnowledgeGraph {
        let root = try Self.makeVault(files)
        defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
        let loader = BrainVaultLoader()
        let loaded = loader.load(root: root)
        guard maxGhosts != BrainVault.maxGhosts else { return loaded }
        let notes = loaded.nodes.filter { !$0.isGhost }.map { BrainNote(path: String($0.id.dropFirst(5)), links: [], preview: []) }
        return BrainVault.graph(from: notes, vaultName: "x", maxGhosts: maxGhosts)
    }

    private func pairs(_ g: KnowledgeGraph) -> Set<String> {
        Set(g.edges.map { "\($0.from.dropFirst(5).description)->\($0.to.replacingOccurrences(of: "note:", with: ""))" })
    }

    // MARK: Wikilink forms

    func testWikilinkFormsResolveToTheirTarget() {
        let text = """
        plain [[Atlas]], aliased [[Atlas|the app]], heading [[Atlas#Plan]], block [[Atlas#^abc123]],
        path [[10 Projects/Atlas]], extension [[Atlas.md]], embed ![[Atlas]], table \\[[Atlas\\|x]]
        """
        let targets = BrainVault.wikilinkTargets(in: text)
        XCTAssertEqual(targets.filter { $0 == "Atlas" }.count, 7)
        XCTAssertTrue(targets.contains("10 Projects/Atlas"))
    }

    func testHeadingOnlyLinksAttachmentsAndCodeAreNotNotes() {
        let text = "see [[#Local heading]] and ![[diagram.png]] and `[[inline]]` and\n```\n[[fenced]]\n```\nbut [[Real note]]"
        XCTAssertEqual(BrainVault.wikilinkTargets(in: text), ["Real note"])
    }

    func testLinksMatchByFilenameCaseInsensitivelyAcrossFolders() throws {
        let g = try graph([
            "10 Projects/Atlas.md": "x",
            "20 Areas/Me.md": "talks about [[atlas]] and [[ATLAS#Plan|that]]",
            "Home.md": "[[Me]] [[10 projects/atlas]]",
        ])
        XCTAssertEqual(pairs(g), ["20 Areas/Me->10 Projects/Atlas", "Home->20 Areas/Me", "Home->10 Projects/Atlas"])
        XCTAssertEqual(g.edges.count, 3, "one thread per pair however many times it is linked")
    }

    func testAnAmbiguousNamePrefersTheLinkingNotesFolder() throws {
        let g = try graph([
            "10 Projects/README.md": "[[README]]-neighbour [[Other]]",
            "10 Projects/Other.md": "[[README]]",
            "20 Areas/README.md": "x",
            "20 Areas/Mine.md": "[[README]]",
        ])
        XCTAssertTrue(pairs(g).contains("20 Areas/Mine->20 Areas/README"))
        XCTAssertTrue(pairs(g).contains("10 Projects/Other->10 Projects/README"))
    }

    func testSelfLinksAreDropped() throws {
        let g = try graph(["A.md": "[[A]] [[#Heading]] [[B]]", "B.md": "x"])
        XCTAssertEqual(pairs(g), ["A->B"])
    }

    // MARK: Ghosts

    func testUnresolvedLinksBecomeFaintGhostNodes() throws {
        let g = try graph(["A.md": "[[Missing thing]] [[missing THING]]", "B.md": "[[Missing thing]]"])
        let ghosts = g.nodes.filter(\.isGhost)
        XCTAssertEqual(ghosts.map(\.label), ["Missing thing"])
        XCTAssertEqual(g.edges.filter { $0.to == "ghost:missing thing" }.count, 2)
        XCTAssertNil(ghosts.first?.openURL, "a ghost has nothing to open")
    }

    func testTooManyGhostsAreDropped() {
        let notes = [BrainNote(path: "A", links: (0..<50).map { "Nope \($0)" } + ["B"], preview: []), BrainNote(path: "B", links: [], preview: [])]
        let g = BrainVault.graph(from: notes, vaultName: "v")
        XCTAssertTrue(g.nodes.filter(\.isGhost).isEmpty)
        XCTAssertEqual(g.edges.count, 1, "the real link stays; the ghost threads go with the ghosts")
        XCTAssertEqual(BrainVault.graph(from: notes, vaultName: "v", maxGhosts: 100).nodes.filter(\.isGhost).count, 50)
    }

    // MARK: Folders, colour, size

    func testNotesCarryTheirTopFolderAndItsOwnHue() throws {
        let g = try graph(["10 Projects/Atlas.md": "x", "40 Daily/2026-11-02.md": "x", "Home.md": "x", "90 System/Policy.md": "x"])
        let folders = Dictionary(uniqueKeysWithValues: g.nodes.map { ($0.label, $0.group ?? "") })
        XCTAssertEqual(folders, ["Atlas": "10 Projects", "2026-11-02": "40 Daily", "Home": "Home", "Policy": "90 System"])
        let palette = KnowledgePalette(scheme: .dark)
        let hues = ["00 Inbox", "10 Projects", "20 Areas", "30 Resources", "40 Daily", "50 Concepts", "60 Sources", "90 System"].map { "\(palette.folderColor($0))" }
        XCTAssertEqual(Set(hues).count, 8, "eight folders, eight hues")
    }

    func testSizeFollowsLinkDegree() throws {
        let g = try graph(["Hub.md": "[[A]] [[B]] [[C]] [[D]] [[E]]", "A.md": "x", "B.md": "x", "C.md": "x", "D.md": "x", "E.md": "x", "Lonely.md": "x"])
        let sky = KnowledgeSky()
        sky.load(g, now: Date(), animated: false)
        XCTAssertGreaterThan(sky.radius(sky.index["note:Hub"]!), sky.radius(sky.index["note:A"]!))
        XCTAssertGreaterThan(sky.radius(sky.index["note:A"]!), sky.radius(sky.index["note:Lonely"]!))
    }

    // MARK: Card and URL

    func testTheCardCarriesTheFirstLinesAndAnObsidianURL() throws {
        let g = try graph(["10 Projects/Atlas & Co.md": "---\ntitle: x\n---\n# Atlas & Co\nA lecture app for [[Nick|me]].\n- second line with **bold**\nthird line"])
        let node = try XCTUnwrap(g.nodes.first)
        XCTAssertEqual(node.facts.map(\.text), ["A lecture app for me.", "second line with bold"])
        let url = try XCTUnwrap(node.openURL).absoluteString
        XCTAssertEqual(url, "obsidian://open?vault=orionBrain&file=10%20Projects%2FAtlas%20%26%20Co")
    }

    func testTheVaultPathFollowsTheEnvironmentOrTheDefault() {
        let home = URL(fileURLWithPath: "/home/someone")
        XCTAssertEqual(BrainVault.vaultURL(env: ["ORION_BRAIN_VAULT": "/vaults/mine"], home: home).path, "/vaults/mine")
        XCTAssertEqual(BrainVault.vaultURL(env: [:], home: home).path, "/home/someone/Documents/orionBrain")
    }

    // MARK: Reading and cache

    func testHiddenFoldersAndNonNotesAreSkippedAndTheVaultIsNeverWritten() throws {
        let root = try Self.makeVault(["A.md": "[[B]]", "B.md": "x", ".obsidian/workspace.md": "[[A]]", "Img/pic.png": "x", "C.md.bak-12": "x"])
        defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
        func listing() -> [String] {
            (FileManager.default.enumerator(atPath: root.path)?.allObjects as? [String] ?? []).sorted()
        }
        let before = listing()
        let g = BrainVaultLoader().load(root: root)
        XCTAssertEqual(g.nodes.map(\.label).sorted(), ["A", "B"])
        XCTAssertEqual(listing(), before)
    }

    func testTheCacheRereadsOnlyWhatChanged() throws {
        let root = try Self.makeVault(["A.md": "[[B]]", "B.md": "x", "C.md": "y"])
        defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
        let loader = BrainVaultLoader()
        let first = loader.load(root: root)
        XCTAssertEqual(loader.filesRead, 3)
        XCTAssertEqual(loader.load(root: root), first)
        XCTAssertEqual(loader.filesRead, 0, "nothing changed: not one file is opened")
        try "[[B]] [[C]] and more".write(to: root.appendingPathComponent("A.md"), atomically: true, encoding: .utf8)
        let changed = loader.load(root: root)
        XCTAssertEqual(loader.filesRead, 1)
        XCTAssertEqual(changed.edges.count, 2)
    }

    // MARK: Vault-sized graph

    func testAVaultSizedGraphHasTheRightShape() throws {
        let root = try Self.bigVault()
        defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
        let g = BrainVaultLoader().load(root: root)
        XCTAssertEqual(g.nodes.filter { !$0.isGhost }.count, 150)
        XCTAssertGreaterThan(g.edges.count, 250)
    }

    func testAVaultSizedSkySettlesToRestAndStepsUnderFourMilliseconds() {
        let g = Self.syntheticVault(nodes: 160, edges: 340)
        XCTAssertEqual(g.nodes.count, 160)
        XCTAssertEqual(g.edges.count, 340)
        var physics = SkyPhysics(g, size: CGSize(width: 1100, height: 760)).entering()
        for _ in 0..<3 { physics = physics.stepped() }
        var samples: [Double] = []
        for _ in 0..<40 {
            let start = DispatchTime.now().uptimeNanoseconds
            physics = physics.stepped()
            samples.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
        }
        XCTAssertFalse(physics.isSettled, "the timed steps must be hot ones")
        let median = samples.sorted()[samples.count / 2]
        XCTAssertLessThan(median, 4.0, "median step \(median) ms for 160 nodes and 340 edges")

        for _ in 0..<SkyTuning.maxSteps { physics = physics.stepped() }
        XCTAssertTrue(physics.isSettled)
        XCTAssertEqual(physics.topSpeed, 0, accuracy: 1e-9)
        let frozen = physics.ids.indices.map(physics.point)
        for _ in 0..<300 { physics = physics.stepped() }
        XCTAssertEqual(physics.ids.indices.map(physics.point), frozen, "rest is still")
    }

    func testBrainLabelsArriveWithZoom() {
        XCTAssertGreaterThan(SkyLabels.brainMinDegree(zoom: 0.7), SkyLabels.brainMinDegree(zoom: 1.0))
        XCTAssertGreaterThan(SkyLabels.brainMinDegree(zoom: 1.0), SkyLabels.brainMinDegree(zoom: 1.5))
        XCTAssertEqual(SkyLabels.brainMinDegree(zoom: 3), 0)
    }

    /// A deterministic vault-shaped graph with exact counts: folders as groups, hash-picked links.
    static func syntheticVault(nodes count: Int, edges wanted: Int) -> KnowledgeGraph {
        let folders = ["00 Inbox", "10 Projects", "20 Areas", "30 Resources", "40 Daily", "50 Concepts", "60 Sources", "90 System"]
        let nodes = (0..<count).map { KnowledgeNode(id: "note:n\($0)", type: "note", label: "Note \($0)", group: folders[$0 % folders.count]) }
        var seen = Set<String>(), edges: [KnowledgeEdge] = []
        var i = 0
        while edges.count < wanted {
            let a = Int(SkyPhysics.hash("a\(i)") % UInt64(count)), b = Int(SkyPhysics.hash("b\(i)") % UInt64(min(count, 24 + i % 60)))
            i += 1
            guard a != b, seen.insert("\(min(a, b))-\(max(a, b))").inserted else { continue }
            edges.append(KnowledgeEdge(from: nodes[a].id, to: nodes[b].id, kind: BrainVault.edgeKind, reason: "[[link]]"))
        }
        return KnowledgeGraph(nodes: nodes, edges: edges)
    }
}
