//
//  Who gets to be heard, and who gets quieter while they are.
//
//  Five participants want the speakers: the focus clip, Apple Music, the
//  microphone, wake-word capture, and Orion's voice. This coordinates the
//  ones Orion can address directly -- the clip it owns, and Apple Music when
//  it is scriptable -- against the one that has to be understood: the voice.
//
//  THE RULE THAT MATTERS: never touch global system volume.
//
//  The app target used to have a SECOND file, `AudioDucking.swift`, that did
//  exactly that -- shelling out to `osascript ... set volume` and dropping
//  GLOBAL system volume, tied only to the `.listening` phase, so the room
//  came back to full volume the instant Orion started THINKING or SPEAKING --
//  the worst possible moment. Its own restore also declined to fire if the
//  volume had moved by hand, which could strand the whole Mac quiet with
//  nothing running to explain why. Two files, two contradictory policies.
//
//  That contradiction is resolved by keeping this file's rule intact and
//  narrowing the other file's role to the one thing the platform genuinely
//  requires it for: macOS has no per-app volume API for an arbitrary,
//  unscriptable source (a browser tab, say), so a system-wide duck is kept
//  ONLY there, opt-in, and scoped to listening -- never to speaking, because
//  Orion's own voice shares that same output. See AudioDucking.swift in the
//  app target for that half and the physical reason it cannot live here.
//
//  This file only ever changes `ClipPlayer.volume` and Apple Music's own
//  `sound volume`, both independent audio streams from Orion's own TTS
//  playback -- which is why both are safe to duck for the WHOLE exchange
//  (listening, thinking, and speaking) rather than only while Orion is
//  actually talking.
//
//  Ducking rather than pausing, deliberately: a fifty-minute binaural track
//  that stops and restarts every time Orion says a sentence is far more
//  distracting than one that dips. Music defaults to the same duck rather
//  than a pause for the same reason; `AppleMusicControl.pauseForSession()` /
//  `resumeAfterSession()` already exist for anyone who wants the harder stop
//  instead and are untouched by this file.
//

import Foundation

public final class AudioCoordinator {

    private let clips: ClipPlaying
    private let setClipVolume: (Float) -> Void
    private let currentClipVolume: () -> Float

    private let queue = DispatchQueue(label: "com.nickmadaio.orion.audio-coordinator")

    /// What the clip drops to while Orion talks. Not zero — a bed that vanishes
    /// entirely reads as the audio having broken.
    public var duckedFraction: Float = 0.25

    /// How long a fade takes, in steps. Short enough not to swallow the first
    /// word, long enough not to click.
    private let fadeSteps = 8
    private let fadeDuration: TimeInterval = 0.18

    private var unducked: Float?
    private var speakers = 0

    // MARK: Apple Music

    /// Optional so tests, and any run without Music installed, need not
    /// provide one. `AppleMusicControl` conforms via the retroactive
    /// extension at the bottom of this file.
    private let music: MusicDucking?

    /// Music's own AppleScript round trip is tens of milliseconds; a
    /// dedicated queue means a slow Music call never delays a clip fade that
    /// happens to be scheduled on `queue` at the same moment.
    private let musicQueue = DispatchQueue(label: "com.nickmadaio.orion.audio-coordinator.music")

    /// How far down Music goes. Separate from `duckedFraction` because Music
    /// plays alongside Orion's whole exchange, not only the sentence he is
    /// saying right now, so a slightly less aggressive duck reads as "still
    /// there" rather than "paused".
    public var musicDuckedFraction: Double = 0.3

    /// Below this, ducking Music is pointless and restoring it would be a
    /// surprise -- same reasoning as the system-volume fallback's floor.
    private static let musicFloor = 0.12

    /// What Music's volume was before Orion ducked it. `nil` means Orion is
    /// not currently holding a Music duck.
    private var musicDuckedFromVolume: Double?

    /// How many phases of the current exchange are asking for the duck.
    /// Reference counted the same way `speakers` is, so overlapping
    /// begin/end calls -- a barge-in that immediately reopens listening,
    /// for instance -- cannot restore Music underneath a conversation that
    /// is still open.
    private var conversationHolders = 0

    public init(clips: ClipPlaying,
                setClipVolume: @escaping (Float) -> Void,
                currentClipVolume: @escaping () -> Float,
                music: MusicDucking? = nil) {
        self.clips = clips
        self.setClipVolume = setClipVolume
        self.currentClipVolume = currentClipVolume
        self.music = music
        recoverMusicFromCrash()
    }

    // MARK: Speaking (the clip; unchanged from before this pass)

    /// Duck for the duration of `speaking`, then come back up.
    ///
    /// Reference-counted, because transition announcements and enforcement lines
    /// can overlap: two things speaking must not mean the first one to finish
    /// restores the volume underneath the second.
    public func whileSpeaking(_ speaking: () -> Void) {
        beginSpeaking()
        speaking()
        endSpeaking()
    }

    public func beginSpeaking() {
        let shouldDuck: Bool = queue.sync {
            speakers += 1
            guard speakers == 1 else { return false }
            unducked = currentClipVolume()
            return true
        }
        guard shouldDuck, let from = unducked else { return }
        fade(from: from, to: from * duckedFraction)
    }

    public func endSpeaking() {
        let target: Float? = queue.sync {
            speakers = max(0, speakers - 1)
            guard speakers == 0, let restore = unducked else { return nil }
            unducked = nil
            return restore
        }
        guard let target else { return }
        fade(from: currentClipVolume(), to: target)
    }

    /// Everything has stopped; forget any ducking state.
    ///
    /// Needed because a crash or a stop mid-sentence would otherwise leave the
    /// clip permanently quiet with nothing left running to explain why — the
    /// same failure the app target's system-volume fallback has to guard
    /// against too. Also the unconditional half of "restore audio now": it
    /// clears the clip AND Music, regardless of whether Music looks
    /// hand-changed, because a caller reaching for this wants everything back
    /// right now, not an automatic guess.
    public func reset() {
        let clipTarget: Float? = queue.sync {
            defer { speakers = 0; unducked = nil }
            return unducked
        }
        if let clipTarget { setClipVolume(clipTarget) }

        musicQueue.sync {
            conversationHolders = 0
            guard let prior = musicDuckedFromVolume else { return }
            musicDuckedFromVolume = nil
            music?.setDuckedVolume(prior)
            MusicDuckState.clear()
        }
    }

    // MARK: Fading

    private func fade(from: Float, to: Float) {
        guard fadeSteps > 0 else { return setClipVolume(to) }
        let step = (to - from) / Float(fadeSteps)
        let interval = fadeDuration / Double(fadeSteps)

        for index in 1...fadeSteps {
            let value = from + step * Float(index)
            queue.asyncAfter(deadline: .now() + interval * Double(index)) { [weak self] in
                self?.setClipVolume(max(0, min(1, value)))
            }
        }
    }

    // MARK: Conversation-spanning lease (Music)
    //
    // Nick's own words: "lower it, talk to me, once we're done it gets raised
    // back to normal". That is listening AND thinking AND speaking, not just
    // the sentence Orion happens to be saying -- unlike the clip fade above,
    // which is intentionally scoped tighter (see the header on why a
    // fifty-minute clip should not stop and restart every sentence, versus
    // Music which reads fine dipped for a whole exchange).

    /// Call when a turn begins -- phase entering `.listening` or, for a typed
    /// turn that skips it, `.thinking`. Idempotent across overlapping holders.
    public func beginConversation() {
        musicQueue.async { [weak self] in
            guard let self else { return }
            self.conversationHolders += 1
            guard self.conversationHolders == 1 else { return }
            self.duckMusicIfPlaying()
        }
    }

    /// Call when the phase returns to idle (or errors out). Restores Music
    /// only if Nick did not touch its volume himself meanwhile.
    public func endConversation() {
        musicQueue.async { [weak self] in
            guard let self else { return }
            self.conversationHolders = max(0, self.conversationHolders - 1)
            guard self.conversationHolders == 0 else { return }
            self.restoreMusicIfWeDuckedIt()
        }
    }

    /// Runs on `musicQueue`.
    private func duckMusicIfPlaying() {
        guard let music else { return }
        guard let now = music.duckableVolume(), now > Self.musicFloor else { return }
        musicDuckedFromVolume = now
        MusicDuckState.persist(priorVolume: now)
        music.setDuckedVolume(now * musicDuckedFraction)
    }

    /// Runs on `musicQueue`.
    private func restoreMusicIfWeDuckedIt() {
        guard let music, let prior = musicDuckedFromVolume else { return }
        musicDuckedFromVolume = nil
        defer { MusicDuckState.clear() }
        guard let now = music.duckableVolume() else { return }
        let expected = prior * musicDuckedFraction
        guard abs(now - expected) <= 0.03 else {
            // Nick touched Music's own volume slider while Orion was talking.
            // His choice wins, same rule as everywhere else in this pass.
            return
        }
        music.setDuckedVolume(prior)
    }

    /// Orion did not exit cleanly last time and may have left Music ducked
    /// with nothing left running to explain why. Checked once, at
    /// construction, under the same "only if nothing else changed it since"
    /// rule as every other recovery path in this pass.
    private func recoverMusicFromCrash() {
        guard let music, let state = MusicDuckState.load() else { return }
        guard let now = music.duckableVolume() else { MusicDuckState.clear(); return }
        let expected = state.priorVolume * musicDuckedFraction
        if abs(now - expected) <= 0.03 {
            music.setDuckedVolume(state.priorVolume)
        }
        MusicDuckState.clear()
    }
}

// MARK: - Music, abstracted for testability

/// What `AudioCoordinator` needs from a scriptable music source. Kept this
/// narrow so a test can fake "Music is playing at 0.6" without AppleScript,
/// the way `SilentClips` already fakes `ClipPlaying`.
public protocol MusicDucking: AnyObject {
    /// Current volume 0...1 if the source is actually playing right now,
    /// else nil -- ducking or restoring something that already stopped by
    /// itself is not this coordinator's job.
    func duckableVolume() -> Double?
    func setDuckedVolume(_ value: Double)
}

/// Crash-safety marker for the Music duck, mirroring `AudioRouteState` and
/// `SystemVolumeDuckState` in the app target -- same shape, same reason: this
/// object's in-memory state dies with the process.
private enum MusicDuckState {
    struct State: Codable {
        let priorVolume: Double
    }

    private static let path: String = {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".openclaw")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return (dir as NSString).appendingPathComponent("orion-music-duck-state.json")
    }()

    static func persist(priorVolume: Double) {
        guard let data = try? JSONEncoder().encode(State(priorVolume: priorVolume)) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    static func load() -> State? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        return try? JSONDecoder().decode(State.self, from: data)
    }

    static func clear() {
        try? FileManager.default.removeItem(atPath: path)
    }
}

// MARK: - AppleMusicControl conformance

/// Retroactive, deliberately: `AppleMusicControl` lives in
/// `ExternalActions.swift` and already exposes exactly what is needed
/// (`status()`, `setVolume(_:)`); this just names that shape as
/// `MusicDucking` without adding a dependency in the other direction.
extension AppleMusicControl: MusicDucking {
    public func duckableVolume() -> Double? {
        guard case .ready(let info) = status(), info.isPlaying else { return nil }
        return info.volume
    }

    public func setDuckedVolume(_ value: Double) {
        setVolume(value)
    }
}
