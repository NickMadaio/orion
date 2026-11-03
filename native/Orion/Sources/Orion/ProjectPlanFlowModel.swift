import Foundation

/// Everything the Plan flow draws, worked out once: the steps, where each stands, the blocks that sit above the
/// flow and each prose block's inline markdown. w17 (Nick: "the plan section is kinda laggy"): this used to be
/// rebuilt inside `body` on every parent render (every 2 s refresh), markdown parsing included.
struct ProjectPlanFlowModel {
    /// What the model depends on. Two inputs with the same key draw the same flow.
    struct Key: Hashable {
        let blocks: [Int]          // per-block hash of kind + text
        let tasks: [String]        // title + status of each run task, in order
    }

    let key: Key
    let blocks: [ProjectPlanBlock]
    let steps: [ProjectPlanStep]
    let states: [Int: ProjectPlanStepState]
    let leading: [ProjectPlanBlock]
    let byID: [Int: ProjectPlanBlock]
    let rich: [Int: AttributedString]

    static func key(blocks: [ProjectPlanBlock], tasks: [ProjectAgentStatus.WorkItem]) -> Key {
        Key(blocks: blocks.map { var h = Hasher(); h.combine($0.kind); h.combine($0.text); return h.finalize() },
            tasks: tasks.map { "\($0.title)\u{1F}\($0.status.rawValue)" })
    }

    static func build(blocks: [ProjectPlanBlock], tasks: [ProjectAgentStatus.WorkItem], key: Key? = nil) -> Self {
        let steps = ProjectPlanStep.steps(from: blocks)
        let stepIDs = Set(steps.flatMap { [$0.id] + $0.details })
        var rich: [Int: AttributedString] = [:]
        for block in blocks where block.kind == "text" {
            rich[block.id] = (try? AttributedString(markdown: block.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                ?? AttributedString(block.text)
        }
        return Self(key: key ?? Self.key(blocks: blocks, tasks: tasks), blocks: blocks, steps: steps,
                    states: ProjectPlanStep.states(for: steps, tasks: tasks),
                    leading: blocks.filter { !stepIDs.contains($0.id) },
                    byID: Dictionary(uniqueKeysWithValues: blocks.map { ($0.id, $0) }), rich: rich)
    }
}

/// Remembers the last few models so a re-render with the same plan and task states is a lookup, not a rebuild.
final class ProjectPlanFlowCache {
    static let shared = ProjectPlanFlowCache()
    private let lock = NSLock()
    private var entries: [(Key, ProjectPlanFlowModel)] = []
    private let capacity = 4
    private(set) var builds = 0
    typealias Key = ProjectPlanFlowModel.Key

    func model(blocks: [ProjectPlanBlock], tasks: [ProjectAgentStatus.WorkItem]) -> ProjectPlanFlowModel {
        let key = ProjectPlanFlowModel.key(blocks: blocks, tasks: tasks)
        lock.lock(); defer { lock.unlock() }
        if let hit = entries.first(where: { $0.0 == key }) { return hit.1 }
        let model = ProjectPlanFlowModel.build(blocks: blocks, tasks: tasks, key: key)
        builds += 1
        entries = Array(([(key, model)] + entries).prefix(capacity))
        return model
    }
}
