//
//  Who gets to be heard, and who gets quieter while they are.
//
//  Five participants want the speakers: the focus clip, Apple Music, the
//  microphone, wake-word capture, and Orion's voice. This coordinates the ONE
//  of them Orion owns — the clip — against the one that has to be understood —
//  the voice.
//
//  THE RULE THAT MATTERS: never touch global system volume.
//
//  `AudioDucking` in the app does exactly that, by shelling out to
//  `osascript ... set volume`, and it is the wrong instrument for this. It ducks
//  everything on the machine, including a call Nick is on and music he started
//  himself; and its own `restore()` deliberately declines to restore if he
//  touched the knob meanwhile, which leaves the whole Mac at thirty percent with
//  no obvious cause. Orion may only quieten the source it owns. That is why this
//  changes `ClipPlayer.volume` and nothing else.
//
//  Ducking rather than pausing, deliberately: a fifty-minute binaural track that
//  stops and restarts every time Orion says a sentence is far more distracting
//  than one that dips.
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

    public init(clips: ClipPlaying,
                setClipVolume: @escaping (Float) -> Void,
                currentClipVolume: @escaping () -> Float) {
        self.clips = clips
        self.setClipVolume = setClipVolume
        self.currentClipVolume = currentClipVolume
    }

    // MARK: Speaking

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
    /// same failure `AudioDucking.restore()` has, and the reason it is not used
    /// here.
    public func reset() {
        let target: Float? = queue.sync {
            defer { speakers = 0; unducked = nil }
            return unducked
        }
        if let target { setClipVolume(target) }
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
}
