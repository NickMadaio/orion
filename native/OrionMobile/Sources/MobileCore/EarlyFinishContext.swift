import Foundation
public struct EarlyFinishContext: Codable, Equatable, Sendable {
    public var kind: String
    public var title: String?
    public var classTitle: String?
    public init(kind: String, title: String? = nil, classTitle: String? = nil) { self.kind = kind; self.title = title; self.classTitle = classTitle }
}
