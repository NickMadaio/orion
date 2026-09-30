import Foundation
import MobileCore

/// Notes from the phone into ORION's memory journal (2026-09-29): the day file
/// `~/.openclaw/workspace/memory/YYYY-MM-DD.md` that ORION already reads, under
/// its own "## From the iPhone" heading. Append-only; the phone's words are
/// marked as coming from the phone so they are never mistaken for the Mac.
public struct MemoryNote {
    public let directory: URL
    public init(directory: URL = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".openclaw/workspace/memory")) {
        self.directory = directory
    }

    @discardableResult
    public func append(_ text: String, at: Date) throws -> URL {
        let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd"; day.locale = Locale(identifier: "en_US_POSIX")
        let clock = DateFormatter(); clock.dateFormat = "HH:mm"; clock.locale = Locale(identifier: "en_US_POSIX")
        let file = directory.appendingPathComponent("\(day.string(from: at)).md")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var existing = (try? String(contentsOf: file, encoding: .utf8)) ?? "# \(day.string(from: at))\n"
        let flat = text.replacingOccurrences(of: "\n", with: " / ").trimmingCharacters(in: .whitespaces)
        let line = "- \(clock.string(from: at)) — [iphone] \(flat)"
        guard !existing.contains(line) else { return file }
        let heading = "## From the iPhone"
        if let range = existing.range(of: heading) {
            existing.insert(contentsOf: "\n\n\(line)", at: range.upperBound)
        } else {
            existing = existing.trimmingCharacters(in: .newlines) + "\n\n\(heading)\n\n\(line)\n"
        }
        try existing.write(to: file, atomically: true, encoding: .utf8)
        return file
    }
}
