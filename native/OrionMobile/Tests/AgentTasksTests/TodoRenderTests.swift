import SwiftUI
import XCTest
import MobileCore
@testable import OrionViews

/// Renders the shared to-do screen (the phone's Lists tab at touch size, the Mac's Plan tasks at pointer size)
/// to PNGs for review. Skipped unless ORION_RENDER_DIR is set. ORION_RENDER_GLANCE optionally points at a
/// glance.json to use real to-dos; otherwise the shared fixture is drawn.
@MainActor
final class TodoRenderTests: XCTestCase {
    private func items(now: Date) throws -> [TodoItem] {
        if let path = ProcessInfo.processInfo.environment["ORION_RENDER_GLANCE"],
           let glance = GlanceFile.read(URL(fileURLWithPath: path)) {
            return glance.todos.map { TodoItem(id: $0.id, title: $0.title, due: $0.due, done: $0.done, priority: TodoPriority(glanceRank: $0.priority)) }
        }
        struct Row: Decodable { let id: String; let eventKit: Int; let due: String?; let done: Bool }
        struct Fixture: Decodable { let todos: [Row] }
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url.appendingPathComponent("tests/fixtures/todo-order.json")))
        let iso = ISO8601DateFormatter()
        return fixture.todos.reversed().map { TodoItem(id: $0.id, title: $0.id.replacingOccurrences(of: "-", with: " "), due: $0.due.flatMap(iso.date), done: $0.done, priority: TodoPriority(eventKit: $0.eventKit)) }
    }

    private func render(_ density: TodoDensity, width: CGFloat, name: String, dir: String, items: [TodoItem]) throws {
        let noop = TodoActions(add: { _ in }, toggle: { _ in }, rename: { _, _ in }, setPriority: { _, _ in }, setDue: { _, _ in },
                               setNotes: { _, _ in }, delete: { _ in }, reorder: { _ in }, schedule: { _ in })
        let view = TodoListScreen(items: items, actions: noop, density: density)
            .padding(18).frame(width: width, alignment: .topLeading)
            .background(Color(red: 0.04, green: 0.05, blue: 0.07)).environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.cgImage else { return XCTFail("no image for \(name)") }
        let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
        try data.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name))
    }

    func testRenderListScreens() throws {
        guard let dir = ProcessInfo.processInfo.environment["ORION_RENDER_DIR"] else { throw XCTSkip("set ORION_RENDER_DIR") }
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let list = try items(now: Date())
        try render(.touch, width: 390, name: "phone-lists-tab.png", dir: dir, items: list)
        try render(.pointer, width: 620, name: "mac-plan-tasks.png", dir: dir, items: list)
    }
}
