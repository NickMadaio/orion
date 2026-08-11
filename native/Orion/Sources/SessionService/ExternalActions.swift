//
//  The things outside Orion: Do Not Disturb, and Apple Music.
//
//  Both are Gate 10 because both need a permission or a piece of setup that can
//  be absent, and the whole point of putting them here is that each fails
//  VISIBLY and on its own. A focus session that silently did not turn on Do Not
//  Disturb is worse than one that never claimed to, because Nick would trust it
//  and get interrupted anyway.
//
//  So there is no "best effort" in this file. Every call returns an outcome that
//  says which of three things happened: it worked, it is not set up, or it was
//  refused. The UI shows the difference.
//

import Foundation
import AppKit

public enum ExternalOutcome: Equatable, Sendable {
    case done
    /// The Shortcut or the app is not there. Nick has to set something up.
    case notConfigured(String)
    /// macOS refused — usually Automation consent that was never granted or was
    /// denied. Distinct from "not set up", because the fix is different.
    case denied(String)
    case failed(String)

    public var worked: Bool { self == .done }

    public var message: String? {
        switch self {
        case .done: return nil
        case .notConfigured(let why): return why
        case .denied(let why): return why
        case .failed(let why): return why
        }
    }
}

// MARK: - Do Not Disturb

/// Driven through a Shortcut, because macOS has no public API for Focus modes.
///
/// A named Shortcut Nick creates once. That is a real setup cost and it is
/// disclosed rather than hidden: if the Shortcut is missing this says so by
/// name, instead of a session quietly running with notifications on.
public final class DoNotDisturbControl {

    public static let shortcutOn = "Orion Focus On"
    public static let shortcutOff = "Orion Focus Off"

    public var onLog: ((String) -> Void)?

    public init() {}

    public func enable() -> ExternalOutcome { run(Self.shortcutOn) }
    public func disable() -> ExternalOutcome { run(Self.shortcutOff) }

    /// Whether the setup exists, so the UI can say so BEFORE a session starts
    /// rather than at the moment it fails.
    public func isConfigured() -> Bool {
        exists(Self.shortcutOn) && exists(Self.shortcutOff)
    }

    public var setupInstructions: String {
        "Create two Shortcuts named “\(Self.shortcutOn)” and “\(Self.shortcutOff)” "
        + "using Apple's Set Focus action. Orion cannot change Focus modes without them — "
        + "macOS has no other way in."
    }

    private func exists(_ name: String) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
        process.arguments = ["list"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return String(decoding: data, as: UTF8.self)
                .split(separator: "\n").contains { $0.trimmingCharacters(in: .whitespaces) == name }
        } catch {
            return false
        }
    }

    private func run(_ name: String) -> ExternalOutcome {
        guard exists(name) else {
            onLog?("[dnd] the “\(name)” Shortcut does not exist")
            return .notConfigured(setupInstructions)
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
        process.arguments = ["run", name]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                onLog?("[dnd] “\(name)” exited \(process.terminationStatus)")
                return .failed("The “\(name)” Shortcut did not run cleanly.")
            }
            onLog?("[dnd] ran “\(name)”")
            return .done
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}

// MARK: - Apple Music

/// Pause and resume Apple Music around a session.
///
/// Needs Automation consent for Music.app, which macOS asks for once and which
/// can be denied — and if it is denied, every call fails silently unless
/// somebody checks. So the error is inspected specifically: -1743 is "user
/// refused", which is a different sentence from "Music is not running".
///
/// Orion only ever pauses and resumes what it paused. It does not change the
/// volume, choose tracks, or touch the library.
public final class AppleMusicControl {

    public var onLog: ((String) -> Void)?

    /// True only when Orion is the one that paused it. Resuming music Nick
    /// paused himself would be Orion overriding a decision he made.
    private var pausedByOrion = false

    public init() {}

    public func isRunning() -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Music").isEmpty
    }

    @discardableResult
    public func pauseForSession() -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }

        switch tell("if player state is playing then pause") {
        case .done:
            pausedByOrion = true
            onLog?("[music] paused for the session")
            return .done
        case let other:
            return other
        }
    }

    @discardableResult
    public func resumeAfterSession() -> ExternalOutcome {
        // The rule: only resume what Orion stopped.
        guard pausedByOrion else { return .done }
        pausedByOrion = false
        guard isRunning() else { return .done }
        onLog?("[music] resuming what it paused")
        return tell("play")
    }

    private func tell(_ command: String) -> ExternalOutcome {
        let script = "tell application \"Music\" to \(command)"
        guard let apple = NSAppleScript(source: script) else {
            return .failed("could not build the AppleScript")
        }
        var error: NSDictionary?
        apple.executeAndReturnError(&error)

        guard let error else { return .done }

        let code = (error[NSAppleScript.errorNumber] as? Int) ?? 0
        // -1743: the user declined Automation. Distinct from anything else,
        // because the fix is a checkbox in System Settings and nothing else will
        // make it work.
        if code == -1743 {
            onLog?("[music] Automation consent for Music was refused")
            return .denied("Orion is not allowed to control Music. Turn it on in "
                           + "System Settings ▸ Privacy & Security ▸ Automation ▸ Orion.")
        }
        let message = (error[NSAppleScript.errorMessage] as? String) ?? "unknown error \(code)"
        onLog?("[music] \(message)")
        return .failed(message)
    }
}
