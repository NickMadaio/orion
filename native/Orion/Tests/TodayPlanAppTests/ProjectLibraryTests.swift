import XCTest
@testable import Orion

final class ProjectLibraryTests: XCTestCase {
    func testSavedProjectsRemainDistinctAndInvalidRecordsAreReported() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        for id in ["project-one", "project-two"] {
            let directory = root.appendingPathComponent(id)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: ["version":1,"id":id,"name":id,"createdAt":"2026-09-23T00:00:00Z","planFile":"plan.md","taskCount":5])
            try data.write(to: directory.appendingPathComponent("project.json"))
        }
        let valid = SavedProject.readAll(at: root)
        XCTAssertEqual(Set(valid.projects.map(\.id)), ["project-one", "project-two"])
        XCTAssertNil(valid.error)
        try Data("{}".utf8).write(to: root.appendingPathComponent("project-two/project.json"))
        let partial = SavedProject.readAll(at: root)
        XCTAssertEqual(partial.projects.map(\.id), ["project-one"])
        XCTAssertNotNil(partial.error)
    }
    func testBriefsBesideTheSnapshotAreListedByTask() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertEqual(SavedProject.briefs(at: root).tasks, [], "no folder is no briefs, not an error")
        XCTAssertFalse(SavedProject.briefs(at: root).common)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        for name in ["common.md", "task-b.md", "task-a.md", ".DS_Store", "notes.txt"] {
            try Data("x".utf8).write(to: root.appendingPathComponent(name))
        }
        let briefs = SavedProject.briefs(at: root)
        XCTAssertTrue(briefs.common)
        XCTAssertEqual(briefs.tasks, ["task-a", "task-b"])
    }
    func testPlanReaderKeepsContractTextSeparateFromReadableGoals() {
        let blocks = ProjectPlanBlock.parse("# Plan\n\nThe goal.\n\n```orion-task\n{\"id\":\"one\"}\n```\n## Next phase")
        XCTAssertEqual(blocks.map(\.kind), ["h1", "text", "code:orion-task", "h2"])
        XCTAssertEqual(blocks[2].text, "{\"id\":\"one\"}")
    }
}
