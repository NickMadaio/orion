//
//  One clip at a time, and the clock owns the boundaries.
//
//  `AVAudioPlayer` rather than an `AVAudioEngine` graph, deliberately. This
//  plays a file from disk at its own rate to the default output; it does not
//  need a mixer, a tap or a format negotiation, and Gate 1 established that the
//  engine `SpeechOutput` already owns holds the device steady at 48 kHz stereo
//  with capture live. Adding a second engine to play a file would be new
//  machinery in exchange for nothing.
//
//  THE CLOCK OWNS PHASE BOUNDARIES. `numberOfLoops = -1` means the delegate's
//  did-finish callback never fires, which is the intended design and not an
//  oversight: a phase ends when the session's arithmetic says it ends, never
//  when a file happens to run out. If a clip is shorter than its block it
//  loops; if it is longer it is cut off. Wiring "clip finished" to "phase over"
//  would make a 43-minute file silently redefine a 50-minute block, which is
//  the exact thing plan correction #10 forbids.
//
//  Pause keeps its offset. `AVAudioPlayer.pause()` holds `currentTime`, and
//  `play()` resumes from it — so a paused break resumes where it was rather
//  than restarting, which is what anyone would expect and what a naive
//  stop/start would get wrong.
//

import Foundation
import AVFoundation
import SessionDomain

public protocol ClipPlaying: AnyObject {
    @discardableResult
    func play(_ name: String) -> Result<Void, ClipFailure>
    func pause()
    func resume()
    func stop()
    var isPlaying: Bool { get }
    var nowPlaying: String? { get }
}

public final class ClipPlayer: NSObject, ClipPlaying, AVAudioPlayerDelegate {

    private let library: ClipLibrary
    private var player: AVAudioPlayer?
    private(set) public var nowPlaying: String?

    /// Reported so the UI can say why nothing is playing instead of showing a
    /// silent, contented-looking player.
    public private(set) var lastFailure: String?

    public var onFailure: ((String) -> Void)?
    public var onLog: ((String) -> Void)?

    /// 0...1. Not the system volume — Orion only ever controls the source it
    /// owns, and using global volume for a fade would duck Nick's music, his
    /// video call and everything else on the machine.
    public var volume: Float = ClipPlayer.defaultVolume {
        didSet { player?.volume = volume }
    }

    /// `ORION_CLIP_VOLUME` (0...1) overrides it. Exists so a verification run
    /// can play at a level that does not take over the room, and so Gate 7's
    /// volume control has something to set.
    public static var defaultVolume: Float {
        guard let raw = ProcessInfo.processInfo.environment["ORION_CLIP_VOLUME"],
              let value = Float(raw) else { return 0.7 }
        return min(1, max(0, value))
    }

    public init(library: ClipLibrary = ClipLibrary()) {
        self.library = library
        super.init()
        observeRouteChanges()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        player?.stop()
    }

    public var isPlaying: Bool { player?.isPlaying ?? false }

    // MARK: Playing

    /// Re-validate, then play, looping until told otherwise.
    @discardableResult
    public func play(_ name: String) -> Result<Void, ClipFailure> {
        // The check that matters: readable NOW, not readable when the session
        // was planned.
        let clip: Clip
        switch library.revalidate(named: name) {
        case .success(let found):
            clip = found
        case .failure(let failure):
            return fail(failure.reason)
        }

        stop()

        do {
            let player = try AVAudioPlayer(contentsOf: clip.url)
            player.delegate = self
            // -1 loops forever. The session clock ends the phase; this file
            // never does. See the header.
            player.numberOfLoops = -1
            player.volume = volume
            guard player.prepareToPlay() else {
                return fail("\(name) could not be prepared for playback")
            }
            guard player.play() else {
                return fail("\(name) would not start playing")
            }
            self.player = player
            nowPlaying = clip.name
            lastFailure = nil
            onLog?("[clip] playing \(clip.name) (\(Int(clip.duration))s, looping)")
            return .success(())
        } catch {
            return fail("\(name) could not be opened: \(error.localizedDescription)")
        }
    }

    public func pause() {
        guard let player, player.isPlaying else { return }
        player.pause()
        onLog?("[clip] paused \(nowPlaying ?? "?") at \(Int(player.currentTime))s")
    }

    /// Resume from the stored offset.
    ///
    /// `play()` on a paused AVAudioPlayer continues from `currentTime` rather
    /// than restarting, which is the whole reason pause is used instead of stop.
    public func resume() {
        guard let player, !player.isPlaying else { return }
        guard player.play() else {
            _ = fail("\(nowPlaying ?? "the clip") would not resume")
            return
        }
        onLog?("[clip] resumed \(nowPlaying ?? "?") at \(Int(player.currentTime))s")
    }

    public func stop() {
        guard let player else { return }
        player.stop()
        self.player = nil
        nowPlaying = nil
    }

    @discardableResult
    private func fail(_ reason: String) -> Result<Void, ClipFailure> {
        lastFailure = reason
        nowPlaying = nil
        onLog?("[clip] \(reason)")
        onFailure?(reason)
        return .failure(ClipFailure(reason))
    }

    // MARK: Route changes

    /// Recover when the output device changes underneath us.
    ///
    /// `AVAudioPlayer` usually follows the default device on its own, but it
    /// does not always survive the device disappearing — unplugging headphones
    /// mid-block can leave a player that reports `isPlaying` while producing
    /// nothing, which is the silent failure this project keeps having. So the
    /// engine configuration notification is watched and playback is restarted
    /// from its own offset if the player has actually stopped.
    private func observeRouteChanges() {
        NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main
        ) { [weak self] _ in
            self?.recoverAfterRouteChange()
        }
    }

    private func recoverAfterRouteChange() {
        guard let player, let name = nowPlaying else { return }
        guard !player.isPlaying else { return }

        let offset = player.currentTime
        onLog?("[clip] output device changed; resuming \(name) from \(Int(offset))s")

        guard case .success(let clip) = library.revalidate(named: name) else {
            _ = fail("\(name) is gone after the output device changed")
            return
        }
        guard let replacement = try? AVAudioPlayer(contentsOf: clip.url) else {
            _ = fail("\(name) could not be reopened after the output device changed")
            return
        }
        replacement.delegate = self
        replacement.numberOfLoops = -1
        replacement.volume = volume
        replacement.currentTime = offset
        guard replacement.prepareToPlay(), replacement.play() else {
            _ = fail("\(name) would not restart after the output device changed")
            return
        }
        self.player = replacement
    }

    // MARK: AVAudioPlayerDelegate

    /// With `numberOfLoops = -1` this should never fire. If it does, the file
    /// stopped for a reason of its own and the phase is still running, so say
    /// so rather than letting the block continue in silence.
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard let name = nowPlaying else { return }
        _ = fail(flag
                 ? "\(name) stopped on its own — the block is still running, but silently"
                 : "\(name) failed while playing")
    }

    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        _ = fail("\(nowPlaying ?? "the clip") hit a decode error: "
                 + (error?.localizedDescription ?? "unknown"))
    }
}
