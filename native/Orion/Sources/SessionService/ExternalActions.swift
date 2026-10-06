//
//  The things outside Orion: Apple Music, and the outcome type Focus modes share.
//
//  These are Gate 10 because each needs a permission or a piece of setup that
//  can be absent, and the whole point of putting them here is that each fails
//  VISIBLY and on its own. A focus session that silently did not change Focus is
//  worse than one that never claimed to, because Nick would trust it and get
//  interrupted anyway.
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

// Focus modes used to live here as two hardcoded Shortcut names. They moved to
// FocusModes.swift, where one parameterised Shortcut can turn on ANY Focus —
// see the contract at the top of that file.

// MARK: - Apple Music

/// What Music is doing right now, expressed without leaking Apple-event types
/// into the rest of Orion.
public struct AppleMusicNowPlaying: Equatable, Sendable {
    public let persistentID: String
    public let title: String
    public let artist: String
    public let album: String
    public let duration: TimeInterval
    public let position: TimeInterval
    public let volume: Double
    public let isPlaying: Bool
    public let shuffleEnabled: Bool
    public let repeatMode: String

    public init(persistentID: String, title: String, artist: String, album: String,
                duration: TimeInterval, position: TimeInterval, volume: Double,
                isPlaying: Bool, shuffleEnabled: Bool, repeatMode: String) {
        self.persistentID = persistentID
        self.title = title
        self.artist = artist
        self.album = album
        self.duration = duration
        self.position = position
        self.volume = volume
        self.isPlaying = isPlaying
        self.shuffleEnabled = shuffleEnabled
        self.repeatMode = repeatMode
    }
}

public enum AppleMusicStatus: Equatable, Sendable {
    case ready(AppleMusicNowPlaying)
    case unavailable(String)
}

/// Read and control Apple Music for the session player, and pause/resume it for
/// the older opt-in setting.
///
/// Needs Automation consent for Music.app, which macOS asks for once and which
/// can be denied — and if it is denied, every call fails silently unless
/// somebody checks. So the error is inspected specifically: -1743 is "user
/// refused", which is a different sentence from "Music is not running".
///
/// The media controls use Music's own playback API. `sound volume` is Music's
/// source volume, never the Mac's global output volume. Orion still only
/// resumes a session-start pause when Orion itself actually paused playback.
public final class AppleMusicControl {

    public var onLog: ((String) -> Void)?

    /// True only when Orion is the one that paused it. Resuming music Nick
    /// paused himself would be Orion overriding a decision he made.
    private var pausedByOrion = false
    private let stateLock = NSLock()

    public init() {}

    public func isRunning() -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Music").isEmpty
    }

    public func open() -> ExternalOutcome {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Music") else {
            return .notConfigured("Music is not installed.")
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        onLog?("[music] opening Music")
        return .done
    }

    /// One compact Apple event rather than nine round trips on every refresh.
    public func status() -> AppleMusicStatus {
        guard isRunning() else {
            return .unavailable("Open Music to use it here.")
        }

        let source = """
        tell application "Music"
            set stateName to (player state as text)
            set volumeValue to sound volume
            set shuffleValue to shuffle enabled
            set repeatValue to (song repeat as text)
            if stateName is "stopped" then
                return {stateName, "", "", "", 0, 0, volumeValue, shuffleValue, repeatValue, ""}
            end if
            set currentItem to current track
            return {stateName, (name of currentItem as text), (artist of currentItem as text), (album of currentItem as text), duration of currentItem, player position, volumeValue, shuffleValue, repeatValue, (persistent ID of currentItem as text)}
        end tell
        """

        switch execute(source) {
        case .success(let descriptor):
            guard descriptor.numberOfItems >= 10 else {
                return .unavailable("Music returned an incomplete playback status.")
            }
            func item(_ index: Int) -> NSAppleEventDescriptor? { descriptor.atIndex(index) }
            let state = item(1)?.stringValue ?? "stopped"
            return .ready(AppleMusicNowPlaying(
                persistentID: item(10)?.stringValue ?? "",
                title: item(2)?.stringValue ?? "",
                artist: item(3)?.stringValue ?? "",
                album: item(4)?.stringValue ?? "",
                duration: max(0, item(5)?.doubleValue ?? 0),
                position: max(0, item(6)?.doubleValue ?? 0),
                volume: min(1, max(0, Double(item(7)?.int32Value ?? 0) / 100)),
                isPlaying: state == "playing",
                shuffleEnabled: item(8)?.booleanValue ?? false,
                repeatMode: item(9)?.stringValue ?? "off"
            ))
        case .failure(let error):
            return .unavailable(error.outcome.message ?? "Music could not be read.")
        }
    }

    /// Artwork is intentionally fetched separately from the one-second status
    /// poll. A cover can be several megabytes; sending it with every position
    /// update would make a visual improvement into a playback-control delay.
    public func artworkData() -> Data? {
        guard isRunning() else { return nil }
        let source = """
        tell application "Music"
            if player state is stopped then return missing value
            set currentItem to current track
            if (count of artworks of currentItem) is 0 then return missing value
            return raw data of artwork 1 of currentItem
        end tell
        """
        guard case .success(let descriptor) = execute(source) else { return nil }
        let bytes = descriptor.data
        return bytes.isEmpty ? nil : bytes
    }

    @discardableResult
    public func playPause() -> ExternalOutcome {
        // Telling Music launches it when needed, so the first click both opens
        // the app and starts playback instead of requiring a mysterious second
        // click.
        let outcome = tell("playpause")
        if case .done = outcome {
            stateLock.lock(); pausedByOrion = false; stateLock.unlock()
        }
        return outcome
    }

    /// An explicit source choice means play. Using `playpause` here could turn
    /// off a queue that was already playing while the first status refresh was
    /// still in flight.
    @discardableResult
    public func play() -> ExternalOutcome {
        let outcome = tell("play")
        if case .done = outcome {
            stateLock.lock(); pausedByOrion = false; stateLock.unlock()
        }
        return outcome
    }

    /// His playlists, by name, for the session's playlist picker (2026-10-06).
    public func playlists() -> [String] {
        guard isRunning() else { return [] }
        guard case .success(let list) = execute("tell application \"Music\" to get name of every user playlist") else { return [] }
        guard list.numberOfItems > 0 else { return list.stringValue.map { [$0] } ?? [] }
        return (1...list.numberOfItems).compactMap { list.atIndex($0)?.stringValue }
    }

    /// Start one of his playlists by name; it opens Music first if needed.
    @discardableResult
    public func play(playlist name: String) -> ExternalOutcome {
        if !isRunning() { _ = open() }
        let escaped = name.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        switch execute("tell application \"Music\" to play user playlist \"\(escaped)\"") {
        case .success:
            stateLock.lock(); pausedByOrion = false; stateLock.unlock()
            return .done
        case .failure(let error):
            return error.outcome
        }
    }

    @discardableResult
    public func previousTrack() -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        return tell("previous track")
    }

    @discardableResult
    public func nextTrack() -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        return tell("next track")
    }

    @discardableResult
    public func seek(to seconds: TimeInterval) -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        return tell("set player position to \(max(0, seconds))")
    }

    @discardableResult
    public func setVolume(_ value: Double) -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        let percent = Int((min(1, max(0, value)) * 100).rounded())
        return tell("set sound volume to \(percent)")
    }

    @discardableResult
    public func toggleShuffle() -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        return tell("set shuffle enabled to not shuffle enabled")
    }

    /// Set shuffle to a known value. Music reports a change a moment late, so
    /// "toggle, then read back" read the old value and the button never moved
    /// (2026-10-06: "the shuffle doesn't work").
    @discardableResult
    public func setShuffle(_ on: Bool) -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        return tell("set shuffle enabled to \(on ? "true" : "false")")
    }

    @discardableResult
    public func cycleRepeat() -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        let source = """
        tell application "Music"
            set currentRepeat to song repeat
            if currentRepeat is off then
                set song repeat to all
            else
                if currentRepeat is all then
                    set song repeat to one
                else
                    set song repeat to off
                end if
            end if
        end tell
        """
        switch execute(source) {
        case .success: return .done
        case .failure(let error): return error.outcome
        }
    }

    @discardableResult
    public func pauseForSession() -> ExternalOutcome {
        guard isRunning() else { return .notConfigured("Music is not running.") }
        let source = """
        tell application "Music"
            if player state is playing then
                pause
                return true
            end if
            return false
        end tell
        """
        switch execute(source) {
        case .success(let result) where result.booleanValue:
            stateLock.lock(); pausedByOrion = true; stateLock.unlock()
            onLog?("[music] paused for the session")
            return .done
        case .success:
            return .done
        case .failure(let error):
            return error.outcome
        }
    }

    @discardableResult
    public func resumeAfterSession() -> ExternalOutcome {
        // The rule: only resume what Orion stopped.
        stateLock.lock()
        let shouldResume = pausedByOrion
        pausedByOrion = false
        stateLock.unlock()
        guard shouldResume else { return .done }
        guard isRunning() else { return .done }
        onLog?("[music] resuming what it paused")
        return tell("play")
    }

    private func tell(_ command: String) -> ExternalOutcome {
        switch execute("tell application \"Music\" to \(command)") {
        case .success:
            return .done
        case .failure(let error):
            return error.outcome
        }
    }

    private func execute(_ source: String) -> Result<NSAppleEventDescriptor, ExternalScriptError> {
        guard let apple = NSAppleScript(source: source) else {
            return .failure(ExternalScriptError(.failed("could not build the AppleScript")))
        }
        var error: NSDictionary?
        let result = apple.executeAndReturnError(&error)

        guard let error else { return .success(result) }

        let code = (error[NSAppleScript.errorNumber] as? Int) ?? 0
        // -1743: the user declined Automation. Distinct from anything else,
        // because the fix is a checkbox in System Settings and nothing else will
        // make it work.
        if code == -1743 {
            onLog?("[music] Automation consent for Music was refused")
            return .failure(ExternalScriptError(.denied(
                "Orion is not allowed to control Music. Turn it on in "
                + "System Settings ▸ Privacy & Security ▸ Automation ▸ Orion."
            )))
        }
        let message = (error[NSAppleScript.errorMessage] as? String) ?? "unknown error \(code)"
        onLog?("[music] \(message)")
        return .failure(ExternalScriptError(.failed(message)))
    }
}

/// `Result` needs an Error while the UI needs the richer, user-facing outcome.
private struct ExternalScriptError: Error {
    let outcome: ExternalOutcome
    init(_ outcome: ExternalOutcome) { self.outcome = outcome }
}
