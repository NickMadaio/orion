import Combine
import Foundation

/*
 One local-model narrator, shared by everything that wants a paragraph.

 The morning brief and the health summary are the same job twice: take facts
 Orion has already computed, ask a local model for a few sentences, cache the
 answer so it is written once rather than on every render, and — this is the
 part that matters — be entirely optional. Every surface using this is complete
 without it. The paragraph appears when it arrives and is simply absent when the
 model is not running.

 Caching is by an arbitrary key rather than by date, because the two callers
 want different lifetimes. The brief is written once per logical day. The health
 summary is keyed by day AND phase, so it rewrites when the day moves from
 morning to afternoon to evening and not once in between — three short local
 completions a day, which is nothing, instead of one on every keystroke.
*/

/// What shape the answer should keep.
///
/// The brief wants one flowing paragraph; the health rail wants a short list of
/// labelled takeaways. Both come back from the model as text with newlines in
/// it, and collapsing those newlines — which is right for prose — destroys the
/// list. So the caller says which it asked for.
enum NarrativeStyle {
    /// Collapse to a single paragraph.
    case paragraph
    /// Keep one line per line.
    case lines
}

final class NarrativeWriter: ObservableObject {

    @Published private(set) var text: String?
    @Published private(set) var isWriting = false

    /// The key currently rendered, so a stale paragraph is cleared the moment
    /// the subject changes rather than lingering under new numbers.
    private var loadedKey: String?
    /// Keys already attempted this session, so a model that is not running is
    /// not re-asked on every published change.
    private var attempted: Set<String> = []

    private let defaultsPrefix = "orion.narrative."

    /// `build` returns nil when there is nothing worth saying, which is
    /// different from "the model failed" and must not produce a request.
    func load(key: String, style: NarrativeStyle = .paragraph, build: () -> String?) {
        guard loadedKey != key || text == nil else { return }

        if let cached = UserDefaults.standard.string(forKey: defaultsPrefix + key), !cached.isEmpty {
            text = cached
            loadedKey = key
            return
        }

        // A new subject with no cache: drop the old paragraph immediately.
        // Leaving yesterday's brief on screen under today's numbers is worse
        // than showing no paragraph at all.
        if loadedKey != key {
            text = nil
            loadedKey = key
        }

        guard !isWriting, !attempted.contains(key), let prompt = build() else { return }
        attempted.insert(key)
        isWriting = true

        DispatchQueue.global(qos: .utility).async { [weak self] in
            let started = Date()
            var written: String?
            do {
                written = NarrativeWriter.tidy(try LocalModel.complete(prompt: prompt), style: style)
            } catch {
                // Not surfaced. The screen is complete without it, and an error
                // banner about a thing the user did not ask for is noise.
                OrionLog.write("[narrative] \(key): local model unavailable — \(error.localizedDescription)")
            }

            DispatchQueue.main.async {
                guard let self else { return }
                self.isWriting = false
                guard let written, !written.isEmpty else {
                    // Let a later change try again rather than latching failure
                    // for the rest of the day.
                    self.attempted.remove(key)
                    return
                }
                OrionLog.write("[narrative] \(key): \(written.count) chars in "
                               + "\(Int(Date().timeIntervalSince(started) * 1000))ms")
                UserDefaults.standard.set(written, forKey: self.defaultsPrefix + key)
                guard self.loadedKey == key else { return }
                self.text = written
            }
        }
    }

    /// Small models like to open with "Here's your brief:" and wrap things in
    /// quotes. Strip the scaffolding rather than prompt-engineering against it
    /// forever.
    static func tidy(_ raw: String, style: NarrativeStyle = .paragraph) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        // Drop a leading label line like "Morning brief:" or "Here you go:".
        if let newline = text.firstIndex(of: "\n") {
            let first = text[text.startIndex..<newline].trimmingCharacters(in: .whitespaces)
            if first.hasSuffix(":") && first.count < 60 {
                text = String(text[text.index(after: newline)...])
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        if text.hasPrefix("\"") && text.hasSuffix("\"") && text.count > 2 {
            text = String(text.dropFirst().dropLast())
        }

        let lines = text
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        // Prose: collapse, because a stray blank line turns two sentences into
        // two visual blocks. A list: keep the lines, because they ARE the
        // structure.
        return lines.joined(separator: style == .paragraph ? " " : "\n")
    }
}
