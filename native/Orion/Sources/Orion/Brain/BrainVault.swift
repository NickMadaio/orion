import Foundation

/// One parsed note of the Obsidian vault: where it is, how it opens, who it links to and its first words.
struct BrainNote: Equatable, Sendable {
    /// Vault-relative path without the `.md` ("10 Projects/Atlas").
    let path: String
    /// Raw wikilink targets as written, aliases and headings already removed ("00 Inbox/README", "Atlas").
    let links: [String]
    /// The first line or two of the body, readable (links shown as their names).
    let preview: [String]

    var title: String { path.split(separator: "/").last.map(String.init) ?? path }
}

/// The Brain view's reading of `~/Documents/orionBrain` (wave 17): every note a node, every `[[link]]` an edge.
/// Pure functions only: parsing text, resolving links, building the graph. Reading files and the mtime cache live in
/// `BrainVaultLoader`. The vault is never written.
enum BrainVault {
    static let ghostGroup = "ghost"
    static let rootGroup = "Home"
    /// Above this many unresolved targets the ghosts are dropped: they would be noise, not signal.
    static let maxGhosts = 40
    static let edgeKind = "links"

    // MARK: Where

    /// `ORION_BRAIN_VAULT`, else `~/Documents/orionBrain` (the rule every ORION script reads the vault by).
    static func vaultURL(env: [String: String] = ProcessInfo.processInfo.environment,
                         home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        if let path = env["ORION_BRAIN_VAULT"], !path.isEmpty { return URL(fileURLWithPath: path) }
        return home.appendingPathComponent("Documents/orionBrain")
    }

    // MARK: Folders

    /// The top-level folder a note lives in; a note at the vault's root belongs to "Home".
    static func folder(of path: String) -> String {
        let parts = path.split(separator: "/")
        return parts.count > 1 ? String(parts[0]) : rootGroup
    }

    /// The numbered folders in their own order, then everything else: a slot decides colour and bearing.
    static let folderOrder = ["00", "10", "20", "30", "40", "50", "60", "90"]

    static func slot(of group: String?) -> Int {
        guard let group else { return 8 }
        if group == ghostGroup { return 9 }
        if let index = folderOrder.firstIndex(where: { group.hasPrefix($0) }) { return index }
        return 8
    }

    // MARK: Parsing a note

    private static let linkPattern = try! NSRegularExpression(pattern: #"!?\[\[([^\[\]\n]+?)\]\]"#)
    private static let fencePattern = try! NSRegularExpression(pattern: "```.*?```|~~~.*?~~~", options: [.dotMatchesLineSeparators])
    private static let inlineCodePattern = try! NSRegularExpression(pattern: "`[^`\n]*`")
    private static let attachmentExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf", "mp3", "mp4", "mov", "m4a", "wav", "canvas", "base", "heic"]

    static func parse(path: String, text: String) -> BrainNote {
        let (frontMatter, body) = splitFrontMatter(text)
        return BrainNote(path: path, links: wikilinkTargets(in: frontMatter + "\n" + body), preview: preview(of: body, title: path))
    }

    /// Every `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[Note#^block]]` and `![[embed]]` in a text, as the
    /// bare target. Code is skipped; heading-only links (`[[#Heading]]`) and attachments are not notes.
    static func wikilinkTargets(in text: String) -> [String] {
        let clean = blanking(inlineCodePattern, in: blanking(fencePattern, in: text))
        let whole = NSRange(clean.startIndex..., in: clean)
        return linkPattern.matches(in: clean, range: whole).compactMap { match in
            guard let range = Range(match.range(at: 1), in: clean) else { return nil }
            return target(of: String(clean[range]))
        }
    }

    private static func target(of inner: String) -> String? {
        var t = inner
        if let bar = t.firstIndex(of: "|") { t = String(t[..<bar]) }
        if let hash = t.firstIndex(of: "#") { t = String(t[..<hash]) }
        t = t.trimmingCharacters(in: CharacterSet(charactersIn: "\\ \t"))
        while t.hasPrefix("/") { t.removeFirst() }
        if t.lowercased().hasSuffix(".md") { t = String(t.dropLast(3)) }
        else if let dot = t.lastIndex(of: "."), attachmentExtensions.contains(t[t.index(after: dot)...].lowercased()) { return nil }
        return t.isEmpty ? nil : t
    }

    private static func blanking(_ pattern: NSRegularExpression, in text: String) -> String {
        pattern.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: " ")
    }

    private static func splitFrontMatter(_ text: String) -> (String, String) {
        guard text.hasPrefix("---") else { return ("", text) }
        let lines = text.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---",
              let close = lines.dropFirst().firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "---" }) else { return ("", text) }
        return (lines[1..<close].joined(separator: "\n"), lines[(close + 1)...].joined(separator: "\n"))
    }

    /// The first two lines worth reading: no rules, no heading that only repeats the title, links shown by name.
    private static func preview(of body: String, title: String) -> [String] {
        let name = title.split(separator: "/").last.map(String.init)?.lowercased() ?? ""
        var out: [String] = []
        for raw in body.components(separatedBy: "\n") {
            let line = readable(raw)
            guard !line.isEmpty, line != "---", line.lowercased() != name else { continue }
            out.append(line.count > 140 ? String(line.prefix(138)) + "…" : line)
            if out.count == 2 { break }
        }
        return out
    }

    private static let displayPattern = try! NSRegularExpression(pattern: #"!?\[\[([^\[\]|#\n]*)(?:#[^\[\]|\n]*)?(?:\|([^\[\]\n]*))?\]\]"#)

    private static func readable(_ raw: String) -> String {
        var line = raw.trimmingCharacters(in: .whitespaces)
        while line.hasPrefix("#") { line.removeFirst() }
        for marker in ["- [ ] ", "- [x] ", "- ", "* ", "> "] where line.hasPrefix(marker) { line = String(line.dropFirst(marker.count)) }
        let ns = line as NSString
        var result = ""
        var cursor = 0
        for m in displayPattern.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
            let alias = m.range(at: 2).location != NSNotFound ? ns.substring(with: m.range(at: 2)) : ""
            let name = (ns.substring(with: m.range(at: 1)) as NSString).lastPathComponent
            result += alias.isEmpty ? name : alias
            cursor = m.range.location + m.range.length
        }
        result += ns.substring(from: cursor)
        return result.replacingOccurrences(of: "**", with: "").trimmingCharacters(in: .whitespaces)
    }

    // MARK: Building the graph

    static func graph(from notes: [BrainNote], vaultName: String, maxGhosts: Int = BrainVault.maxGhosts) -> KnowledgeGraph {
        let sorted = notes.sorted { $0.path.lowercased() < $1.path.lowercased() }
        let byPath = Dictionary(sorted.map { ($0.path.lowercased(), $0.path) }, uniquingKeysWith: { first, _ in first })
        let byName = Dictionary(grouping: sorted.map(\.path)) { ($0.split(separator: "/").last.map(String.init) ?? $0).lowercased() }

        var ghostLabels: [String: String] = [:]
        var seen = Set<String>()
        var edges: [KnowledgeEdge] = []
        for note in sorted {
            for target in note.links {
                let to: String
                if let path = resolve(target, from: note.path, byPath: byPath, byName: byName) {
                    to = noteID(path)
                } else {
                    let key = target.lowercased()
                    ghostLabels[key] = ghostLabels[key] ?? target
                    to = "ghost:" + key
                }
                let from = noteID(note.path)
                guard from != to else { continue }
                // One thread per pair, whichever way the links run.
                guard seen.insert(from < to ? "\(from)|\(to)" : "\(to)|\(from)").inserted else { continue }
                edges.append(KnowledgeEdge(from: from, to: to, kind: edgeKind, reason: "[[link]]"))
            }
        }
        let keepGhosts = ghostLabels.count <= maxGhosts
        let kept = keepGhosts ? edges : edges.filter { !$0.to.hasPrefix("ghost:") }
        let noteNodes = sorted.map { node(for: $0, vaultName: vaultName) }
        let ghosts = keepGhosts ? ghostLabels.keys.sorted().map { key in
            KnowledgeNode(id: "ghost:" + key, type: "note", label: ghostLabels[key] ?? key, group: ghostGroup)
        } : []
        return KnowledgeGraph(nodes: noteNodes + ghosts, edges: kept)
    }

    static func noteID(_ path: String) -> String { "note:" + path }

    private static func node(for note: BrainNote, vaultName: String) -> KnowledgeNode {
        KnowledgeNode(id: noteID(note.path), type: "note", label: note.title,
                      facts: note.preview.map { KnowledgeFact(text: $0) },
                      group: folder(of: note.path), openURL: obsidianURL(vault: vaultName, path: note.path))
    }

    /// `obsidian://open?vault=<name>&file=<path>`, both URL-encoded (a slash becomes %2F, a space %20).
    static func obsidianURL(vault: String, path: String) -> URL? {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s }
        return URL(string: "obsidian://open?vault=\(enc(vault))&file=\(enc(path))")
    }

    /// Obsidian's rule: a full path wins; otherwise the file name, case-insensitively, preferring the linking note's
    /// own folder when two notes share a name.
    private static func resolve(_ target: String, from source: String, byPath: [String: String], byName: [String: [String]]) -> String? {
        let key = target.lowercased()
        if let exact = byPath[key] { return exact }
        let name = key.split(separator: "/").last.map(String.init) ?? key
        guard let candidates = byName[name] else { return nil }
        let narrowed = key.contains("/") ? candidates.filter { $0.lowercased().hasSuffix("/" + key) } : candidates
        guard !narrowed.isEmpty else { return nil }
        let home = source.split(separator: "/").dropLast().joined(separator: "/").lowercased()
        return narrowed.first { $0.split(separator: "/").dropLast().joined(separator: "/").lowercased() == home } ?? narrowed[0]
    }
}
