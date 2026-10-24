import AVFoundation
import Foundation
import Speech

/*
 Spoken barge-in — interrupting Orion by voice, not just by key or Escape.

 Fault 2 of the revamp Nick asked for: before this, the ONLY way to cut Orion
 off was Escape or push-to-talk. `AppState.setPhase` tears the wake word's
 recognition window down for every phase except `.idle`
 (`wakeWord.setSuspended(next != .idle)`), deliberately, so Orion's own voice
 is never transcribed while he is speaking. That guard is correct and stays
 untouched — this is a SECOND, purpose-built listener, not a repurposing of
 `WakeWordListener`, because "does this count as an interruption" is a
 different, route-dependent question from "did someone say the wake word".
 See `BargeInPolicy` in `TurnTakingState.swift`, which is the actual decision;
 this class only feeds it real signals.

 What makes this safe to enable AT ALL is the audio-coexistence work already
 committed in `3e14200`: `AudioInputRouteLease` captures from the BUILT-IN Mac
 microphone whenever output is Bluetooth, so headphone audio never reaches
 the microphone in the first place. On a headset route, spoken barge-in is
 unconditional. On built-in speakers, Orion's own voice IS on the mic, so
 `BargeInPolicy` demands an energy floor and rejects any heard text that
 echoes what Orion is currently saying.

 Same input discipline as the wake word: no engine of its own, no second
 microphone session, on-device recognition only. It only ever sees buffers
 `SpeechInput` already taps and hands to `onMonitor` — see `AppState.wireSpeech`.
 */
final class BargeInMonitor {

    /// Fires on the main thread with whatever was heard, only once
    /// `BargeInPolicy` has already judged it a real interruption for the
    /// current phase and route.
    var onBargeIn: ((String) -> Void)?
    /// Fires on the main thread whenever recognition yields words, before any policy: "he is talking", from voice
    /// detection rather than raw level (a noisy kitchen is loud but says nothing). Used to keep ORION's cue and
    /// progress updates from talking over him (2026-10-23 review, HIGH 4).
    var onHeardWords: (() -> Void)?

    /// Whatever Orion is CURRENTLY saying, read fresh on every candidate —
    /// never cached, so a stale value can neither wrongly reject nor wrongly
    /// accept.
    var currentlySpoken: () -> String = { "" }
    /// The live output route, read fresh on every candidate for the same
    /// reason — Nick can put headphones on or take them off mid-session.
    var currentRoute: () -> AudioRouteKind = { .speakers }
    /// Which phase Orion is in right now. `.thinking` is unconditionally
    /// trusted (nothing is being played, so nothing can be echoed); `.speaking`
    /// is route-gated. See `BargeInPolicy.mode`.
    var currentPhase: () -> TurnPhase = { .idle }

    private(set) var isActive = false

    private let recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    /// Bumped on every window change so a retired task cannot fire late.
    private var generation = 0

    private var windowOpenedAt = Date.distantPast
    private var lastLoudAt = Date.distantPast
    private var lastFire = Date.distantPast
    private var latestLevel: Double = 0
    private var preroll: [AVAudioPCMBuffer] = []
    private var sweeper: Timer?

    /// Same shape as `WakeWordListener`'s thresholds, tuned slightly more
    /// sensitive: a barge-in only has to notice SOME speech, not identify a
    /// specific word, so a shorter runway to open a window is the right
    /// trade — the cost of a spurious window is one wasted recognition pass,
    /// not a wrongly-fired action, because `BargeInPolicy` still has to agree.
    private static let openLevel: Double = 0.14
    private static let holdLevel: Double = 0.09
    private static let hangover: TimeInterval = 1.0
    private static let windowLimit: TimeInterval = 6
    private static let retriggerGuard: TimeInterval = 1.5
    private static let prerollLimit = 5

    init() {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer()
    }

    var canRunLocally: Bool {
        guard let recognizer else { return false }
        return recognizer.supportsOnDeviceRecognition
    }

    /// Enabled only while `.thinking` or `.speaking` — see `AppState.setPhase`.
    func setActive(_ value: Bool) {
        guard value != isActive else { return }
        isActive = value
        if value {
            sweeper?.invalidate()
            sweeper = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                self?.sweep()
            }
        } else {
            sweeper?.invalidate()
            sweeper = nil
            closeWindow()
            preroll.removeAll(keepingCapacity: true)
        }
    }

    /// One buffer from the shared input tap, with its level. Main thread,
    /// pushed by `SpeechInput.onMonitor` — never pulled, never a second
    /// engine.
    func observe(_ buffer: AVAudioPCMBuffer, level: Double) {
        guard isActive, canRunLocally else { return }
        latestLevel = level
        guard let request else {
            preroll.append(buffer)
            if preroll.count > BargeInMonitor.prerollLimit { preroll.removeFirst() }
            if level >= BargeInMonitor.openLevel { openWindow() }
            return
        }
        if level >= BargeInMonitor.holdLevel { lastLoudAt = Date() }
        request.append(buffer)
    }

    // MARK: Windows — same shape as WakeWordListener: stand up the new one
    // before retiring the old, so no buffer ever has nowhere to go.

    private func openWindow() {
        guard let recognizer, recognizer.isAvailable else { return }
        let fresh = SFSpeechAudioBufferRecognitionRequest()
        fresh.shouldReportPartialResults = true
        fresh.requiresOnDeviceRecognition = true
        fresh.addsPunctuation = false
        fresh.taskHint = .search

        generation &+= 1
        let mine = generation
        let outgoingRequest = request
        let outgoingTask = task

        request = fresh
        windowOpenedAt = Date()
        lastLoudAt = Date()

        task = recognizer.recognitionTask(with: fresh) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.generation == mine else { return }
                if let result {
                    self.consider(result.bestTranscription.formattedString)
                    guard self.generation == mine, result.isFinal else { return }
                    self.rotateOrClose()
                    return
                }
                if error != nil { self.closeWindow() }
            }
        }

        outgoingRequest?.endAudio()
        outgoingTask?.cancel()

        let carried = preroll
        preroll.removeAll(keepingCapacity: true)
        for buffer in carried { fresh.append(buffer) }
    }

    private func rotateOrClose() {
        guard isActive else { closeWindow(); return }
        if Date().timeIntervalSince(lastLoudAt) < BargeInMonitor.hangover {
            openWindow()
        } else {
            closeWindow()
        }
    }

    private func closeWindow() {
        guard request != nil || task != nil else { return }
        generation &+= 1
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }

    private func sweep() {
        guard isActive, request != nil else { return }
        let now = Date()
        if now.timeIntervalSince(lastLoudAt) >= BargeInMonitor.hangover {
            closeWindow()
            return
        }
        if now.timeIntervalSince(windowOpenedAt) >= BargeInMonitor.windowLimit {
            openWindow()
        }
    }

    // MARK: Deciding

    private func consider(_ text: String) {
        guard !text.isEmpty else { return }
        onHeardWords?()
        let now = Date()
        guard now.timeIntervalSince(lastFire) > BargeInMonitor.retriggerGuard else { return }

        let phase = currentPhase()
        let route = currentRoute()
        let mode = BargeInPolicy.mode(forOutputRoute: route, phase: phase)
        guard BargeInPolicy.isInterruption(
            mode: mode, heardText: text, energy: latestLevel, currentlySpoken: currentlySpoken()
        ) else { return }

        lastFire = now
        closeWindow()
        preroll.removeAll(keepingCapacity: true)
        onBargeIn?(text)
    }
}
