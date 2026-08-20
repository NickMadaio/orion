//
//  Focus modes: one Shortcut, any mode.
//
//  macOS still has no public API for Focus. The only way in is a Shortcut the
//  user creates, which means the SHAPE of that setup is a contract between this
//  file and something built by hand in an app Orion cannot see. So the contract
//  is written down here, once, and everything else is derived from it:
//
//      Orion runs ONE shortcut and hands it a single line of text:
//
//          on work
//          off work
//          on do not disturb
//          on sleep
//
//      — the word `on` or `off`, a space, then the Focus mode in lower case.
//
//  Why that shape and not JSON or a dictionary: the thing parsing it is an
//  if-statement inside Shortcuts, and "Text contains work" is one tap. The state
//  goes FIRST so `begins with off` splits the two halves before any mode is
//  looked at, and the mode is left as ordinary spaced words so the condition
//  reads like the name on the Focus itself.
//
//  Two hardcoded shortcut names used to live here — "Orion Focus On" and
//  "Orion Focus Off" — which is why Orion complained at every launch that a
//  Shortcut called "Orion Focus On" did not exist. It never will: one shortcut
//  that takes an argument is both fewer things to build and the only version
//  that can turn on a mode nobody thought of when this was written.
//
//  Everything that can be wrong is a DISTINCT outcome, because the fixes are
//  different: an unknown mode is Orion's list being short, a missing Shortcut is
//  a thing to build, and a nonzero exit is a shortcut that ran and broke. A
//  session that silently failed to change Focus is worse than one that never
//  claimed to, because it is trusted and then interrupted.
//

import Foundation

// MARK: - What we are asking for

public enum FocusIntent: String, Equatable, Sendable, CaseIterable {
    case on
    case off

    /// Forgiving, because the word arrives from speech through a small model and
    /// "turn it on", "enable" and "start" are all the same request.
    public init?(spoken: String) {
        let cleaned = FocusModeParser.tidy(spoken)
        switch cleaned {
        case "on", "enable", "enabled", "start", "activate", "turn on", "begin", "yes", "true":
            self = .on
        case "off", "disable", "disabled", "stop", "end", "deactivate", "turn off",
             "clear", "cancel", "no", "false":
            self = .off
        default:
            return nil
        }
    }
}

/// A Focus mode name that has already been through normalisation, so nothing
/// downstream has to wonder whether "DND" and "Do Not Disturb" are the same
/// thing. There is deliberately no public initialiser taking a raw string —
/// the only way to get one is through the parser.
public struct FocusMode: Equatable, Sendable, CustomStringConvertible {
    /// Lower case, single-spaced. This is what goes into the Shortcut.
    public let canonical: String
    /// What the caller actually said, kept for the log line so a mismatch is
    /// diagnosable rather than mysterious.
    public let spoken: String

    init(canonical: String, spoken: String) {
        self.canonical = canonical
        self.spoken = spoken
    }

    public var description: String { canonical }
}

// MARK: - Turning speech into a mode

public enum FocusModeParser {

    /// Apple's built-in Focus modes. Anything else Nick has invented is added
    /// through `custom` rather than guessed at, because a mode Orion invents is
    /// a mode his Shortcut has no branch for — it would run, match nothing, and
    /// report success while doing nothing at all.
    public static let builtIn: [String] = [
        "do not disturb",
        "work",
        "personal",
        "sleep",
        "driving",
        "fitness",
        "gaming",
        "mindfulness",
        "reading"
    ]

    /// The words people actually say, mapped to the mode they mean.
    private static let synonyms: [String: String] = [
        "dnd": "do not disturb",
        "donotdisturb": "do not disturb",
        "do not disturb me": "do not disturb",
        "quiet": "do not disturb",
        "silence": "do not disturb",
        "silent": "do not disturb",
        "working": "work",
        "deep work": "work",
        "bedtime": "sleep",
        "sleeping": "sleep",
        "night": "sleep",
        "workout": "fitness",
        "exercise": "fitness",
        "gym": "fitness",
        "meditation": "mindfulness",
        "meditate": "mindfulness",
        "read": "reading",
        "games": "gaming",
        "drive": "driving",
        "driving mode": "driving"
    ]

    /// Lower case, punctuation to spaces, whitespace collapsed.
    ///
    /// Punctuation becomes a SPACE rather than nothing, so "do-not-disturb"
    /// normalises to the same three words as "Do Not Disturb" instead of to one
    /// unmatchable token.
    public static func tidy(_ raw: String) -> String {
        let lowered = raw.lowercased()
        let spaced = lowered.map { character -> Character in
            character.isLetter || character.isNumber ? character : " "
        }
        return String(spaced)
            .split(separator: " ", omittingEmptySubsequences: true)
            .joined(separator: " ")
    }

    /// Strip the words people add that are not part of the name: "work mode",
    /// "focus work", "the work focus".
    private static func stripDecoration(_ tidied: String) -> String {
        var words = tidied.split(separator: " ").map(String.init)
        while let first = words.first, ["the", "my", "focus", "mode"].contains(first), words.count > 1 {
            words.removeFirst()
        }
        while let last = words.last, ["mode", "focus", "on", "please"].contains(last), words.count > 1 {
            words.removeLast()
        }
        return words.joined(separator: " ")
    }

    /// The one place a spoken mode becomes a canonical one. Nil means Orion does
    /// not know this mode — which is reported, never guessed at.
    public static func mode(_ raw: String, custom: [String] = []) -> FocusMode? {
        let tidied = tidy(raw)
        guard !tidied.isEmpty else { return nil }
        let stripped = stripDecoration(tidied)
        let known = builtIn + custom.map(tidy).filter { !$0.isEmpty }

        for candidate in [stripped, tidied] {
            if let hit = known.first(where: { $0 == candidate }) {
                return FocusMode(canonical: hit, spoken: raw)
            }
            if let mapped = synonyms[candidate], known.contains(mapped) {
                return FocusMode(canonical: mapped, spoken: raw)
            }
            // Last resort: compare with the spaces taken out, so "donotdisturb"
            // and "do not disturb" are the same mode however the speech
            // recogniser chose to break it up.
            let squashed = candidate.replacingOccurrences(of: " ", with: "")
            if let hit = known.first(where: {
                $0.replacingOccurrences(of: " ", with: "") == squashed
            }) {
                return FocusMode(canonical: hit, spoken: raw)
            }
            if let mapped = synonyms[squashed], known.contains(mapped) {
                return FocusMode(canonical: mapped, spoken: raw)
            }
        }
        return nil
    }
}

// MARK: - Running a Shortcut

public struct ShortcutRun: Equatable, Sendable {
    public let status: Int32
    /// Nil when the process could not be started at all, which is a different
    /// failure from a shortcut that ran and exited nonzero.
    public let launchFailure: String?

    public init(status: Int32, launchFailure: String? = nil) {
        self.status = status
        self.launchFailure = launchFailure
    }

    public var worked: Bool { status == 0 && launchFailure == nil }
}

/// Behind a protocol so the whole path above it can be tested without a
/// Shortcuts library, a Focus mode, or Nick's Mac in a particular state.
public protocol ShortcutRunning: AnyObject {
    /// Every shortcut name, or nil when the list itself could not be read —
    /// which must not be mistaken for "you have no shortcuts".
    func names() -> [String]?
    func run(_ name: String, input: String) -> ShortcutRun
}

/// The real one: `/usr/bin/shortcuts`.
public final class ShortcutsCLI: ShortcutRunning {

    private let executable = URL(fileURLWithPath: "/usr/bin/shortcuts")

    public init() {}

    public func names() -> [String]? {
        let process = Process()
        process.executableURL = executable
        process.arguments = ["list"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            return String(decoding: data, as: UTF8.self)
                .split(separator: "\n")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        } catch {
            return nil
        }
    }

    /// `-i` is `--input-path`: the CLI takes a FILE, not a literal string. That
    /// is the detail that quietly breaks a first attempt at this — passing the
    /// text directly makes Shortcuts look for a file with that name. So the line
    /// is written to a private temp file with a `.txt` extension (the extension
    /// is what lets Shortcuts hand it to the shortcut as text) and removed
    /// afterwards, whatever happened.
    public func run(_ name: String, input: String) -> ShortcutRun {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("orion-focus-\(UUID().uuidString).txt")
        defer { try? FileManager.default.removeItem(at: file) }

        do {
            try Data(input.utf8).write(to: file, options: [.atomic])
            try? FileManager.default.setAttributes([.posixPermissions: 0o600],
                                                   ofItemAtPath: file.path)
        } catch {
            return ShortcutRun(status: -1, launchFailure: error.localizedDescription)
        }

        let process = Process()
        process.executableURL = executable
        process.arguments = ["run", name, "-i", file.path]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return ShortcutRun(status: process.terminationStatus)
        } catch {
            return ShortcutRun(status: -1, launchFailure: error.localizedDescription)
        }
    }
}

// MARK: - The control

/// Turn a Focus mode on or off through one user-built Shortcut.
///
/// The name of that shortcut is configuration, not a constant: it defaults to
/// `ORION Focus Toggle`, an environment variable overrides it for tests, and
/// UserDefaults overrides both so it can be corrected from the app without a
/// rebuild.
public final class FocusModeControl {

    public static let defaultShortcutName = "ORION Focus Toggle"
    public static let defaultMode = "do not disturb"

    /// UserDefaults keys, in one place so the settings screen and this file
    /// cannot disagree about the spelling.
    public enum Key {
        public static let shortcutName = "orion.focus.shortcutName"
        public static let mode = "orion.focus.mode"
        public static let customModes = "orion.focus.customModes"
    }

    private let runner: ShortcutRunning
    private let defaults: UserDefaults

    public var onLog: ((String) -> Void)?

    public init(runner: ShortcutRunning = ShortcutsCLI(),
                defaults: UserDefaults = .standard) {
        self.runner = runner
        self.defaults = defaults
    }

    // MARK: Configuration

    public var shortcutName: String {
        if let override = ProcessInfo.processInfo.environment["ORION_FOCUS_SHORTCUT"],
           !override.trimmingCharacters(in: .whitespaces).isEmpty {
            return override.trimmingCharacters(in: .whitespaces)
        }
        let stored = (defaults.string(forKey: Key.shortcutName) ?? "")
            .trimmingCharacters(in: .whitespaces)
        return stored.isEmpty ? Self.defaultShortcutName : stored
    }

    /// The mode a focus session turns on, when nobody named one.
    public var sessionMode: FocusMode {
        let stored = (defaults.string(forKey: Key.mode) ?? "").trimmingCharacters(in: .whitespaces)
        return FocusModeParser.mode(stored, custom: customModes)
            ?? FocusMode(canonical: Self.defaultMode, spoken: Self.defaultMode)
    }

    /// Focus modes Nick invented, which Orion cannot know about otherwise.
    /// Comma separated, because it is edited in a text field.
    public var customModes: [String] {
        (defaults.string(forKey: Key.customModes) ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// Everything Orion will accept, for the settings screen to show.
    public var knownModes: [String] {
        var seen = Set<String>()
        return (FocusModeParser.builtIn + customModes.map(FocusModeParser.tidy))
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    // MARK: Asking

    /// Turn a named mode on or off.
    ///
    /// Every refusal happens BEFORE the Shortcut is invoked where it can, so a
    /// mode Orion does not know never becomes a shortcut run that matches no
    /// branch and reports success.
    @discardableResult
    public func set(_ spokenMode: String, to intent: FocusIntent) -> ExternalOutcome {
        guard let mode = FocusModeParser.mode(spokenMode, custom: customModes) else {
            onLog?("[focus-mode] no Focus mode called “\(spokenMode)” — known: "
                   + knownModes.joined(separator: ", "))
            return .notConfigured(
                "Orion does not know a Focus mode called “\(spokenMode)”. "
                + "It knows \(knownModes.joined(separator: ", ")) — add yours in "
                + "Settings ▸ Focus session if it is a Focus you made."
            )
        }
        return set(mode, to: intent)
    }

    @discardableResult
    public func set(_ mode: FocusMode, to intent: FocusIntent) -> ExternalOutcome {
        let name = shortcutName
        let input = Self.input(mode: mode, intent: intent)

        switch exists(name) {
        case .some(false):
            onLog?("[focus-mode] the “\(name)” Shortcut does not exist")
            return .notConfigured(setupInstructions)
        case .none:
            // The list itself could not be read. Try anyway rather than refusing
            // on a check that failed — a working setup must not be blocked by a
            // broken diagnostic.
            onLog?("[focus-mode] could not list Shortcuts; running “\(name)” regardless")
        case .some(true):
            break
        }

        let run = runner.run(name, input: input)
        if let failure = run.launchFailure {
            onLog?("[focus-mode] could not run “\(name)”: \(failure)")
            return .failed(failure)
        }
        guard run.worked else {
            onLog?("[focus-mode] “\(name)” exited \(run.status) for “\(input)”")
            return .failed(
                "The “\(name)” Shortcut exited \(run.status) when asked for “\(input)”. "
                + "Open it in Shortcuts and check it has a branch for \(mode.canonical)."
            )
        }
        onLog?("[focus-mode] ran “\(name)” with “\(input)”")
        return .done
    }

    /// The session's own mode, for the coordinator.
    @discardableResult
    public func enableForSession() -> ExternalOutcome { set(sessionMode, to: .on) }

    @discardableResult
    public func disableForSession() -> ExternalOutcome { set(sessionMode, to: .off) }

    // MARK: What the UI needs

    /// True, false, or unknown — and unknown is a real answer, not a false.
    public func exists(_ name: String) -> Bool? {
        guard let names = runner.names() else { return nil }
        return names.contains(name)
    }

    public func isConfigured() -> Bool { exists(shortcutName) == true }

    public var setupInstructions: String {
        "Create one Shortcut named “\(shortcutName)” that accepts text input and "
        + "reads it as “on <mode>” or “off <mode>” — for example “on work”. "
        + "macOS has no other way to change a Focus mode."
    }

    /// THE CONTRACT, in one function. Everything that builds or documents the
    /// input goes through here so the Shortcut and the app cannot drift apart.
    public static func input(mode: FocusMode, intent: FocusIntent) -> String {
        "\(intent.rawValue) \(mode.canonical)"
    }
}
