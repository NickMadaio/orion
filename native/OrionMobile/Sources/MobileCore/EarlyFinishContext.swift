import Foundation
public struct EarlyFinishContext: Codable, Equatable, Sendable {
    /// "after-class" (a class is under way), "block" (a task or activity is) or "none".
    public var kind: String
    public var title: String?
    public var classTitle: String?
    /// For a block: "task" (study, a to-do) or "activity" (the gym, a break). Older planners omit it.
    public var blockKind: String?
    public init(kind: String, title: String? = nil, classTitle: String? = nil, blockKind: String? = nil) {
        self.kind = kind; self.title = title; self.classTitle = classTitle; self.blockKind = blockKind
    }
}
