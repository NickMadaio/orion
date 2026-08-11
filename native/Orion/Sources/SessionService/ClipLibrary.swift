//
//  The clips, found by convention and checked before they are trusted.
//
//  Nick drops audio files into one directory and they become available. No
//  import step, no database, no per-file configuration — the directory listing
//  IS the library. That is the right trade for three files he chose himself.
//
//  Everything here is about not lying. A clip that is missing, unreadable, or
//  not actually audio has to produce a REASON, not a silence. The failure this
//  guards against is the one this project keeps having: an empty list that looks
//  exactly like "nothing configured" when the truth is "the file moved" or "the
//  directory permissions changed".
//
//  Validation happens twice on purpose. Once at setup, so a session is not
//  planned around a file that cannot be played; and again immediately before
//  playback, because a file that was readable when the session was planned can
//  be gone fifty minutes later — an external drive unmounted, a sync client
//  moving things, Nick tidying up.
//

import Foundation
import AVFoundation
import SessionDomain

/// Why a clip cannot be used, as something `Result` will accept.
///
/// A named type rather than a bare String so the reason travels through
/// `throws` and `Result` intact and can be shown to Nick verbatim — every one
/// of these is written to be read by him, not by a log parser.
public struct ClipFailure: Error, LocalizedError, Equatable, Sendable {
    public let reason: String
    public init(_ reason: String) { self.reason = reason }
    public var errorDescription: String? { reason }
}

// MARK: - What a clip is

public struct Clip: Equatable, Sendable, Identifiable {
    /// The file's name without its extension. This is what a plan stores, so
    /// renaming a file breaks the reference deliberately and visibly rather
    /// than silently playing a different one.
    public let name: String
    public let url: URL
    public let duration: TimeInterval

    public var id: String { name }

    public init(name: String, url: URL, duration: TimeInterval) {
        self.name = name
        self.url = url
        self.duration = duration
    }

    public var assignment: ClipAssignment {
        ClipAssignment(name: name, fit: .trimOrLoop, mediaDuration: duration)
    }
}

/// A file that is in the directory but cannot be used, and why.
///
/// Kept and surfaced rather than filtered out. A file Nick can see in Finder
/// that Orion silently ignores is a bug report waiting to happen.
public struct RejectedClip: Equatable, Sendable {
    public let name: String
    public let reason: String
}

public struct ClipInventory: Equatable, Sendable {
    public let clips: [Clip]
    public let rejected: [RejectedClip]

    /// The folder this inventory actually describes.
    ///
    /// Carried rather than read back from `ClipLibrary.directoryURL`, which is
    /// the DEFAULT and not necessarily the one that was scanned. Getting that
    /// wrong means telling Nick to drop his clips into a folder nobody is
    /// looking at, which is worse than saying nothing.
    public let directory: URL

    /// Nil when the directory itself is the problem — missing, or unreadable.
    /// Distinct from "the directory is there and empty", which is a different
    /// thing to tell somebody.
    public let directoryProblem: String?

    public var isEmpty: Bool { clips.isEmpty }

    /// What to show when there is nothing to play. Never just "no clips".
    public var explanation: String? {
        if let directoryProblem { return directoryProblem }
        if !clips.isEmpty { return nil }
        if rejected.isEmpty {
            return "No audio files in \(directory.path). "
                 + "Drop the binaural clips in there and they will appear."
        }
        let names = rejected.map { "\($0.name) (\($0.reason))" }.joined(separator: ", ")
        return "Found \(rejected.count) file\(rejected.count == 1 ? "" : "s") that could not be "
             + "used: \(names)"
    }
}

// MARK: - The library

public final class ClipLibrary {

    /// One directory, by convention.
    public static var directoryURL: URL {
        if let override = ProcessInfo.processInfo.environment["ORION_FOCUS_CLIPS"],
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw")
            .appendingPathComponent("orion-controlled")
            .appendingPathComponent("focus-clips")
    }

    /// What AVFoundation will actually open. Deliberately a list rather than
    /// "anything": scanning a directory and trying to decode every file in it
    /// turns a stray PDF into a confusing error instead of an ignored file.
    public static let audioExtensions: Set<String> = [
        "m4a", "mp3", "wav", "aiff", "aif", "caf", "flac", "aac", "mp4"
    ]

    private let directory: URL

    public init(directory: URL? = nil) {
        self.directory = directory ?? Self.directoryURL
    }

    public var url: URL { directory }

    // MARK: Discovery

    /// Everything in the directory, sorted by name, each one opened to prove it
    /// is really playable and to learn how long it is.
    public func inventory() -> ClipInventory {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directory.path,
                                             isDirectory: &isDirectory) else {
            return ClipInventory(
                clips: [], rejected: [], directory: directory,
                directoryProblem: "There is no clip folder at \(directory.path) yet. "
                                + "Create it and drop the binaural files in."
            )
        }
        guard isDirectory.boolValue else {
            return ClipInventory(clips: [], rejected: [], directory: directory,
                                 directoryProblem: "\(directory.path) is a file, not a folder.")
        }

        let contents: [URL]
        do {
            contents = try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.isReadableKey],
                options: [.skipsHiddenFiles]
            )
        } catch {
            return ClipInventory(
                clips: [], rejected: [], directory: directory,
                directoryProblem: "Could not read \(directory.path): \(error.localizedDescription)"
            )
        }

        var clips: [Clip] = []
        var rejected: [RejectedClip] = []

        for url in contents.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let name = url.deletingPathExtension().lastPathComponent
            guard Self.audioExtensions.contains(url.pathExtension.lowercased()) else { continue }

            switch validate(url) {
            case .success(let duration):
                clips.append(Clip(name: name, url: url, duration: duration))
            case .failure(let reason):
                rejected.append(RejectedClip(name: url.lastPathComponent, reason: reason))
            }
        }

        return ClipInventory(clips: clips, rejected: rejected,
                             directory: directory, directoryProblem: nil)
    }

    /// Find one clip by the name a plan stored.
    public func clip(named name: String) -> Clip? {
        inventory().clips.first { $0.name == name }
    }

    // MARK: Validation

    public enum Validation: Equatable {
        case success(duration: TimeInterval)
        case failure(reason: String)
    }

    /// Open the file and ask it how long it is.
    ///
    /// Actually opening it is the point — `fileExists` proves nothing about
    /// whether AVFoundation can decode it, and a zero-byte file, a truncated
    /// download and a renamed text file all pass an existence check.
    public func validate(_ url: URL) -> Validation {
        guard FileManager.default.fileExists(atPath: url.path) else {
            return .failure(reason: "the file is not there")
        }
        guard FileManager.default.isReadableFile(atPath: url.path) else {
            return .failure(reason: "no permission to read it")
        }

        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? Int ?? 0
        guard size > 0 else { return .failure(reason: "the file is empty") }

        do {
            let file = try AVAudioFile(forReading: url)
            let rate = file.fileFormat.sampleRate
            guard rate > 0 else { return .failure(reason: "it reports no sample rate") }
            let duration = Double(file.length) / rate
            guard duration > 0 else { return .failure(reason: "it contains no audio") }
            return .success(duration: duration)
        } catch {
            return .failure(reason: "not audio Orion can decode")
        }
    }

    /// The check that runs immediately before playback rather than at setup.
    ///
    /// A separate entry point so the call site reads as what it is. Fifty
    /// minutes is long enough for a drive to unmount or a sync client to move
    /// something, and discovering that by playing silence is the worst way to
    /// find out.
    public func revalidate(named name: String) -> Result<Clip, ClipFailure> {
        guard let clip = clip(named: name) else {
            return .failure(ClipFailure("\(name) is no longer in \(directory.lastPathComponent)"))
        }
        switch validate(clip.url) {
        case .success:
            return .success(clip)
        case .failure(let reason):
            return .failure(ClipFailure("\(name) cannot be played: \(reason)"))
        }
    }

    // MARK: Shuffling

    /// A shuffled order, produced here so the domain stays pure.
    ///
    /// The domain takes an explicit permutation because a plan that shuffles
    /// differently on every call cannot be reproduced from a fixture. This is
    /// where the randomness is allowed to live.
    public func shuffledOrder(count: Int) -> [Int] {
        guard count > 0 else { return [] }
        return Array(0..<count).shuffled()
    }
}
