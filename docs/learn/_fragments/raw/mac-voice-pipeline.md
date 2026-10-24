<!-- prompt: You are a research helper for a study guide about the ORION repo at /Users/nickmadaio/Desktop/ORION (snapshot HEAD 6c93032, 2026-10-14). STRICTLY READ-ONLY: do not edit, create, or delete any file; do not run builds, tests, installs, git commands that modify anything, or anything that calls a network API. Reading files, grep, wc, and `git log` are fine. Never copy secrets (API keys, tokens, phone  -->

# ORION voice pipeline: study notes (native mac app)

Snapshot: HEAD 6c93032, 2026-10-14. I only read files. Unless noted, all paths are relative to `native/Orion/Sources/Orion/`. Anything I inferred rather than read is marked **(inferred)**.

Four facts that change how the rest reads:
- The Deepgram socket now uses Flux v2 with a hardcoded query string. `VoiceTuning.endpointingMs`, `utteranceEndMs`, `DeepgramConfig.model` and the ModelContract `stt` role are no longer used to build the URL (commit ff0ec35, 2026-10-02).
- `DeepgramStream.onConfidence` is never called, so the low-confidence signal in `AdaptiveEndpointModel` never fires.
- `TurnTakingModel` is used only by the harness. The live app uses `BargeInPolicy` and the endpoint model directly.
- `AudioDucking`'s system-volume duck defaults to off and nothing turns it on. The live duck is Apple Music plus Orion's own clip, done in `SessionService/AudioCoordinator.swift`.

---

## 1. File table

| File | Lines | Purpose |
|---|---|---|
| WakeWord.swift | 412 | "Orion" detection. On-device SFSpeechRecognizer in short rolling windows, a fuzzy Levenshtein match against known mishearings, and an energy gate. Has no microphone of its own. |
| SpeechInput.swift | 842 | Owns the single `AVAudioEngine` and its single input tap. Runs the Apple or Deepgram recogniser, a replay buffer for seamless fallback, a passive monitor tap, and a starvation and dead-mic watchdog. |
| DeepgramSpeech.swift | 397 | `DeepgramConfig`, `LinearPCMConverter` (float to int16 16 kHz mono), and `DeepgramStream` (a URLSession WebSocket to Flux v2). |
| SpeakerVerifier.swift | 192 | Unix-socket NDJSON client to `orion_voiceid_daemon.py`. Fails open and is consulted only on the wake word. |
| TurnTakingState.swift | 290 | Pure types: `TurnPhase` and substates, `BargeInPolicy` (route- and echo-aware), `TurnAction`, and `TurnTakingModel` (harness only). |
| BargeInMonitor.swift | 209 | A second on-device recogniser fed by the same tap, active during `.thinking`/`.speaking`. Calls `BargeInPolicy`. |
| AdaptiveEndpointModel.swift | 207 | Pure end-of-turn decision: transcript stability, continuation vocabulary, a confidence flag, and resume phrases. No learning, no persistence. |
| SpeechOutput.swift | 390 | Plays TTS chunks through AVAudioEngine and AVAudioPlayerNode at 24 kHz mono. Releases the device after 1.5 s idle. Falls back to AVSpeechSynthesizer. |
| TTSClient.swift | 306 | Blocking POSIX unix socket, NDJSON to the TTS daemon at `~/.openclaw/orion-tts.sock`. Handles stream and cancel. |
| AudioDucking.swift | 213 | Opt-in system-volume duck during `.listening` via `osascript`, with a crash marker. Off by default. |
| VoiceProviders.swift | 238 | `TTSProvider`/`STTProvider` enums, `VoiceSettings` (UserDefaults), and `Secrets` (env, then Keychain, then `.env`; prompt-free Keychain read with a `/usr/bin/security` fallback). |
| VoiceTuning.swift | 201 | UserDefaults tunables: endpointing, utterance-end, Apple grace, speaking stall, and phase ceilings. |
| AudioRoute.swift | 365 | CoreAudio introspection plus `AudioInputRouteLease`. Pins the system default input to the built-in mic when output is Bluetooth, so the headset never drops to HFP. |
| AudioLevel.swift | 36 | `orionNormalisedLevel`: RMS dBFS mapped from -55..-10 to 0..1. |
| PushToTalk.swift | 168 | NSEvent monitors: Right Option (61), Left Option held alone (58, 0.3 s), Escape (53). |
| AmbientSound.swift | 208 | Synthesised rain, waves and wind noise for break screens. Separate engine. Not part of the voice turn. |
| ReachVolume.swift | 44 | Uses NSAppleScript to set a sensible or full volume before Orion speaks unprompted. |
| StallWatchdog.swift | 93 | Pure, clock-injected stall and ceiling verdict for phases. |
| GlobalHotKey.swift | 183 | Carbon `RegisterEventHotKey` for ⌥Tab (Console). Not a voice-turn component. |
| AppState.swift | 2182 | Orchestration: wiring, phase machine, hands-free endpointing, echo rejection, barge-in, watchdogs, and the call to `GatewayClient.ask`. |

Harnesses (`native/Orion/Tests/`): `TurnTakingHarness/main.swift` (448), `AudioMatrix/main.swift` (657) plus `HALDevice.swift` (288), `WatchdogHarness/main.swift` (182). Shared code: `native/OrionMobile/Sources/MobileCore/FluxTurns.swift` (76) and `SelfEcho.swift` (56).

---

## 2. One voice turn, end to end

### 2.0 Shape

```
PushToTalkMonitor ─┐                          ┌─ WakeWordListener (on-device SF, windows)
 (R-Opt 61 /       │   SpeechInput: ONE AVAudioEngine, ONE inputNode tap (1024 frames, native fmt)
  L-Opt 58 held)   │      ├─ onMonitor(buffer, level) ──┼─ BargeInMonitor (on-device SF, thinking/speaking)
                   │      │                             └─ AppState.retainForVerification (2 s ring)
                   └──> AppState.beginListening ─> speechInput.start()
                          ├─ Apple: SFSpeechAudioBufferRecognitionRequest (on-device if supported)
                          └─ Deepgram: LinearPCMConverter → DeepgramStream (wss Flux v2)
       onPartial/onFinal ─> AppState.handleFinalTranscript ─> send() ─> GatewayClient.ask (Process: openclaw agent …)
       reply ─> SpeechOutput.speak ─> TTSClient (unix socket NDJSON) ─> chunk WAV paths ─> AVAudioPlayerNode
```

### 2.1 Summoning

**Wake word.** The engine is `SFSpeechRecognizer(locale: en-US)` with `requiresOnDeviceRecognition = true`, set unconditionally. If on-device recognition is unsupported, `start()` refuses with `onUnavailable`, and AppState switches the preference off (`WakeWord.swift:241-246`, `AppState.swift:1097-1101`). It is not Apple keyword spotting: it transcribes text and fuzzy-matches it.

- **contextualStrings:** `["Orion","Hey Orion","OK Orion"]`. Request settings: `taskHint = .search`, `addsPunctuation = false`, partial results on (`WakeWord.swift:314-323`).
- **Accepted variants:** `orion, oreon, orian, orien, oryon, oryan, arion, aurion, aurian, ohryan`. `minimumLength = 5`. A match is tested on one token or on two adjacent tokens joined (to catch "oh Ryan"). The length gap must be 2 or less, and the edit distance must be at most `floor(len × tolerance)` (`WakeWord.swift:71-140`).
- **Tolerance** comes from `WakeSensitivity` in `SummonSettings.swift:69-91`: strict 0.12, balanced 0.26 (default), eager 0.42. Against a five-letter target that allows 0, 1 or 2 edits.
- **Energy gate and windows:**
  - Thresholds: `openLevel 0.18`, `holdLevel 0.11` (hysteresis), `hangover 1.1 s`, `windowLimit 9 s`, `retriggerGuard 2.5 s`, `rearmDelay 0.9 s`. Preroll is 5 buffers, about 100 ms (`WakeWord.swift:211-227`).
  - With no window open, the listener only keeps preroll and compares the level.
  - `openWindow` stands up the new request before retiring the old one, and replays the preroll into it.
  - Callbacks are generation-checked.
  - A 0.5 s sweeper timer closes quiet windows and rolls windows that hit the 9 s limit (`WakeWord.swift:254, 384-394`).
- **Suspension:** `AppState.setPhase` calls `wakeWord.setSuspended(next != .idle)` (`AppState.swift:1306`). Suspension tears the window down, so Orion's own voice is never transcribed.

```swift
// WakeWord.swift:288-304
func observe(_ buffer: AVAudioPCMBuffer, level: Double) {
    guard isActive, !suspended else { return }
    let now = Date()
    guard now >= armedAt else { return }

    guard let request else {
        // Closed. Keep a breath of audio in hand, and open only on real
        // energy — this branch is what makes an empty room free.
        preroll.append(buffer)
        if preroll.count > WakeWordListener.prerollLimit { preroll.removeFirst() }
        if level >= WakeWordListener.openLevel { openWindow() }
        return
    }

    if level >= WakeWordListener.holdLevel { lastLoudAt = now }
    request.append(buffer)
}
```

On a hit, `consider()` closes the window and fires `onWake(tail-or-nil)` (`WakeWord.swift:398-411`). AppState then runs speaker verification first (section 2.4), then `handleWake`:
- It drops the wake if Orion spoke within the last 2.5 s and the tail is empty or an echo (`SelfEcho.isEcho`).
- A tail of 2 or more characters is sent directly ("Orion, what's on my calendar").
- Otherwise it calls `beginListening(handsFree: true)` (`AppState.swift:562-583`).

**Push-to-talk** (`PushToTalk.swift`):
- Right Option is keyCode 61 and edge-triggered on the `.option` flag.
- Left Option is 58. It counts only if held alone for 0.3 s with no ⌘, ⌃ or ⇧, and no other key or modifier during the wait (`PushToTalk.swift:23-29, 119-158`).
- Escape (53) uses a local monitor always, plus a global monitor installed only while speaking (`setGlobalEscapeWatch`).
- The global monitor needs Accessibility; without it macOS never delivers events.

Wiring is in `AppDelegate.swift:119-122`: `onPressed → state.beginListening()`, `onReleased → state.endListening()`, `onEscape → handleEscape()`. `handleEscape` maps `.listening` to `finishTurnNow`, and `.speaking`/`.thinking` to `bargeIn()` (`AppDelegate.swift:262-279`). Push-to-talk is never speaker-verified.

`AppState.beginListening` (`AppState.swift:1522-1565`):
- Calls `bargeIn()` if Orion is speaking.
- Sets `conversationOpen = wantsHandsFree`.
- Clears `preservedTranscript` unless this is a follow-up.
- Runs `setPhase(.listening)`, `speechInput.start()`, and `startHandsFree` if hands-free.

### 2.2 Microphone capture

There is one `AVAudioEngine` in `SpeechInput` (`SpeechInput.swift:67`). `startMicrophone()`:
1. Calls `inputRoute.begin()` first. This is the Bluetooth lease (section 2.11), so the format read next reflects the built-in mic.
2. Reads `input.outputFormat(forBus: 0)`, the device's native format (for example 44.1 or 48 kHz float). There is no forced format.
3. Installs the tap with `bufferSize: 1024`.

```swift
// SpeechInput.swift:476-505
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
guard format.sampleRate > 0, format.channelCount > 0 else {
    inputRoute.cancel()
    onError?("No microphone input is available right now.")
    return false
}

input.removeTap(onBus: 0)
input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
    let level = orionNormalisedLevel(buffer)
    DispatchQueue.main.async {
        guard let self else { return }
        self.lastBufferAt = Date()
        self.onMonitor?(buffer, level)
        if self.isRunning { self.onLevel?(level) }
        if level >= SpeechInput.starvationFloor { self.lastLoudAt = Date() }
        self.logAudio(level)
        self.route(buffer)
    }
}
```

**Two modes.**
- *Utterance mode* (`start()`/`stop()`).
- *Monitoring*: `startMonitoring()` holds the tap open with no recogniser, for the wake word. `stopEngine(force:)` keeps the session if `monitoring` is set (`SpeechInput.swift:398-421, 800-812`).

`AVAudioEngineConfigurationChange` is observed. During an open turn it restarts the mic. While only monitoring, it does `stopEngine(force: true)` and then `startMicrophone()` (`SpeechInput.swift:426-444`).

**Level** (`AudioLevel.swift:28-35`): mean-square across channels, then `db = 20·log10(rms)`, then `(db+55)/45` clamped to 0..1.

**Permissions:** `requestPermissions` calls `NSApp.activate(ignoringOtherApps:)` first. Without that, an LSUIElement app with a non-activating panel gets an instant denial. Speech permission is asked first, then microphone (`SpeechInput.swift:135-170`). There is a fast path when both are already authorized (`SpeechInput.swift:333-336`).

### 2.3 Recognition

**Choosing the ear** (`SpeechInput.begin`, `SpeechInput.swift:353-385`): `VoiceSettings.stt` (UserDefaults `OrionSTTProvider`, default `apple`). Deepgram is used only if `Secrets.deepgramKey` resolves. Otherwise the Apple recogniser is used, with a transcript note when Deepgram was selected but the key is missing.

**Apple** (`SpeechInput.swift:589-632`):
- `SFSpeechAudioBufferRecognitionRequest`, partial results on, `requiresOnDeviceRecognition = true` only if supported. Unlike the wake word, this path does not refuse server recognition.
- Partials go to `latestText` and `onPartial`. `isFinal` triggers `deliverFinal()`.
- An error while `awaitingFinal` delivers the final. An error while running is reported as "Dictation stopped unexpectedly".
- On key release, `stop()` calls `endAudio()`, then `scheduleFinal(after: VoiceTuning.appleFinalGrace)` (default 1.2 s, range 0.4–4.0) (`SpeechInput.swift:721-739`).

**Deepgram Flux v2.**
- URL builder is `FluxConfig().url()` in MobileCore (`DeepgramSpeech.swift:58-60`). With defaults it is:
  `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.7&eot_timeout_ms=5000`
- `eager_eot_threshold` is appended only if set; it is nil by default.

```swift
// native/OrionMobile/Sources/MobileCore/FluxTurns.swift:10-21
public func url() -> URL {
    ...
    var parts = URLComponents(string: "wss://api.deepgram.com/v2/listen")!
    parts.queryItems = [URLQueryItem(name: "model", value: "flux-general-en"),
        URLQueryItem(name: "encoding", value: "linear16"), URLQueryItem(name: "sample_rate", value: "16000"),
        URLQueryItem(name: "eot_threshold", value: String(clamp(eotThreshold, 0.5, 1, fallback: 0.7))),
        URLQueryItem(name: "eot_timeout_ms", value: String(min(max(eotTimeoutMs, 500), 60000)))]
    if let eagerEotThreshold { parts.queryItems?.append(URLQueryItem(name: "eager_eot_threshold", value: String(clamp(eagerEotThreshold, 0.3, 0.9, fallback: 0.5)))) }
    return parts.url!
}
```

- **Model constants:** `DeepgramConfig.model = ModelContract.model(role: "stt", fallback: "flux-general-en")` (`DeepgramSpeech.swift:37-40`), but **nothing reads it**. The URL hardcodes the model. `language "en-US"`, `endpointingMs` and `utteranceEndMs` are also defined but unused.
- **Session:** `URLSessionConfiguration.ephemeral`, `waitsForConnectivity = false`, `timeoutIntervalForRequest = 15` (`DeepgramSpeech.swift:194-200`).
- **Authentication:**
  - Attempt 0 sends the header `Authorization: Token <key>` (`DeepgramSpeech.swift:229-231`).
  - Attempt 1, after a ping or receive failure before open, puts the key in the WebSocket subprotocol: `webSocketTask(with:url, protocols: ["token", key])` (`DeepgramSpeech.swift:235`).
  - Exactly one retry (`retryOrFail`, `DeepgramSpeech.swift:259-269`).
- **Open detection:** a zero-length `sendPing` success, or a `Connected` message. `openTimeout = 1.5 s`, then `fail` (`DeepgramSpeech.swift:56, 216-221, 242-256`).
- **Audio frames:** `LinearPCMConverter` uses `AVAudioConverter` from the tap format to Int16 16 kHz mono interleaved. It rebuilds when the source format changes and uses `.noDataNow` rather than `.endOfStream` (the past bug, section 7). Output goes as a binary frame: `task.send(.data(audio))` (`DeepgramSpeech.swift:72-127, 306-317`).
- **Control messages** are text frames. `finish()` sends only `{"type":"CloseStream"}` (`DeepgramSpeech.swift:272-281, 332-338`). The comment still mentions `Finalize`, but ff0ec35 removed it.
- **Parsing** (`FluxTurns.parse`):
  - `type` of `Connected`, `Error` (code, description), or `TurnInfo`.
  - `TurnInfo` carries `event` (`StartOfTurn` / `Update` / `EagerEndOfTurn` / `TurnResumed` / `EndOfTurn`), `turn_index`, `transcript`, `words[{word, confidence, start, end}]`, and `end_of_turn_confidence`.
  - `FluxTurnTracker.absorb` resets the transcript on a new turn index. `EndOfTurn` maps to `.finish(text)` (`FluxTurns.swift:40-75`).

```swift
// DeepgramSpeech.swift:369-385
private func handle(_ raw: String) {
    guard let message = FluxTurns.parse(raw) else { return }
    DispatchQueue.main.async {
        guard !self.failed else { return }
        switch message {
        case .connected:
            if !self.isOpen { self.isOpen = true; self.openTimer?.invalidate(); self.onOpen?() }
        case .error(_, let description): self.fail(description)
        case .turn:
            let decision = self.fluxTracker.absorb(message)
            self.interim = self.fluxTracker.transcript
            if !self.interim.isEmpty { self.onPartial?(self.interim) }
            if case .finish(let text) = decision { self.onSegment?(text); self.onEndOfSpeech?() }
        default: break
        }
    }
}
```

- `EndOfTurn` is authoritative for both hands-free and held-key turns. `onEndOfSpeech` stops the engine and delivers the final (`SpeechInput.swift:661-668`). `onConfidence` is never invoked anywhere, and `end_of_turn_confidence` and word confidences are parsed but dropped.
- On key release with Deepgram: `deepgram.finish()`, then `scheduleFinal(after: 0.8 s)` as the safety net (`SpeechInput.swift:100, 730-736`).

**Fallback rules** (`SpeechInput.fallBackToApple`, `SpeechInput.swift:683-702`):
- **Triggers:** no key; open timeout (1.5 s); socket failure or Flux `Error`; `send` error; nil converter; 5 consecutive conversion failures; the starvation watchdog (room loud, nothing routed for 5 s).
- **What happens:** Deepgram is aborted. `startApple` replays the `replay` buffer (up to 140 buffers, about 3 s, captured while Deepgram was handshaking). If the key is already up, it calls `endAudio()` and schedules the Apple grace. The user is told via `onActiveProvider(.apple, note)`.

**Listening watchdog** (inside SpeechInput, 1 s timer, `SpeechInput.swift:264-312`):
- No buffers for more than 1.5 s: `restartMicrophone`, at most 3 per turn, then an error.
- Room loud (level ≥ 0.08 within 5 s) but no routing progress for 5 s: Deepgram falls back to Apple. On Apple there is no second ear, so it only logs `STARVED`.

### 2.4 Speaker verification

- **Capture:** `AppState.retainForVerification` keeps a rolling 2 s mono window of channel 0 at the tap's native rate. Every monitor buffer feeds it (`AppState.swift:1145-1161`; `verificationSeconds = 2.0`).
- **Call:** `SpeakerVerifier.verify` goes over the unix socket `~/.openclaw/orion-voiceid.sock` with NDJSON:
  `{"op":"verify","audio":"<base64 f32le>","rate":<Int>}` and reply keys `ok, score, enrolled, match, threshold, error`. `{"op":"ping"}` returns `usable, enrolled, detail, threshold`.
  Send and receive timeouts are 1.5 s (`SpeakerVerifier.swift:52, 61-64, 118-191`).
- **Decision:** a match is `reply.match == true` or `score >= wakeSimilarityFloor (0.45)`. Otherwise it is `.reject`. Any failure returns `.cannotVerify` and the wake proceeds (fails open). It is never consulted for push-to-talk. A reject is silent apart from a log line (`AppState.swift:1102-1130`).
- **Method (daemon side, `scripts/orion_voiceid_daemon.py`):**
  - Resemblyzer `VoiceEncoder` embeddings, cosine similarity, maximum over the enrolled samples.
  - Threshold is mean − 2σ, clamped to [0.45, 0.88]. `MIN_SECONDS = 0.35`.
  - Ops: `enroll`, `finalize`, `reset`, `ping`, `verify`.
- **Enrolment storage:** `~/.openclaw/orion-voiceid.json` (mode 0600), override env `ORION_VOICEID_PROFILE`. Socket override is `ORION_VOICEID_SOCKET`.

```swift
// SpeakerVerifier.swift:133-140
let score = reply["score"] as? Double ?? 0
if (reply["enrolled"] as? Bool) == false {
    return .cannotVerify(reason: "no voice enrolled")
}
if (reply["match"] as? Bool) == true || score >= Self.wakeSimilarityFloor {
    return .match(score: score)
}
return .reject(score: score, threshold: reply["threshold"] as? Double ?? 0)
```

### 2.5 Endpointing

**Push-to-talk:** the turn ends when the key comes up. `endListening` sets `.thinking` and calls `speechInput.stop()` (`AppState.swift:1831-1836`).

**Hands-free** (`startHandsFree`/`checkHandsFree`, `AppState.swift:1568-1689`):
- A 0.2 s timer polls.
- `handsFreeLeadIn = 1.0 s`: never end during the first second.
- `handsFreeLimit = 12 s` hard cap. It is enforced twice: in the timer, and by an independent `DispatchQueue.global().asyncAfter` deadline.
- Follow-up windows (`awaitingFollowUp`) have no model until `lastVoiceAt` moves. Grace is `followUpGrace = 6 s`, or `continuationGrace = 2.5 s` if a fragment is preserved. On expiry, `endConversation()`.
- **With Deepgram active, `checkHandsFree` returns early:** `if activeSTTProvider == .deepgram { return }` (`AppState.swift:1675`). Endpointing is then entirely Flux `EndOfTurn` (eot_threshold 0.7, eot_timeout 5000 ms) plus the 12 s cap.
- With Apple, `handsFreeEndpoint.verdict` decides.

**`AdaptiveEndpointModel`** (pure struct, no learning, no persistence; it is per-turn and recreated each time):
- **Constructed with:** `baseSilence = VoiceTuning.endpointingSeconds` (900 ms default) and `extendedSilence = max(base × 1.8, resolvedUtteranceEndMs/1000)`. With defaults that is `max(1.62, max(1800, 900+600)/1000) = 1.8 s` (`VoiceTuning.swift:148-157`). The harness mirrors 1.62 instead, so it does not exactly match the app defaults **(inferred from the formula)**.
- **Updates:** `noteTranscript` resets `lastEvidenceAt` on *any* text change, including shrinking. It sets `sawContinuationCue` and `sawLowConfidence` (confidence < 0.55, which never arrives now).
- **Verdict:** finalize if silence ≥ (extended if a cue or low confidence was seen, else base); otherwise `.extending` or `.keepListening` (`AdaptiveEndpointModel.swift:101-122`).
- **Continuation cues:**
  - Phrases: "hold on", "hold up", "wait", "i'm not done", "im not done", "one sec", "one second", "hang on", "give me a second", "not finished", "not done yet".
  - A trailing word in a set of about 50 conjunctions, fillers, articles, prepositions and pronouns (widened 2026-09-29) (`AdaptiveEndpointModel.swift:144-173`).
- `considerationThreshold = 0.4 × base` separates `capturing` from `possiblePause`; it is used only by `TurnTakingModel`.

```swift
// AdaptiveEndpointModel.swift:101-122
mutating func noteTranscript(_ text: String, confidence: Double? = nil, at now: Date) {
    if text != lastText {
        lastEvidenceAt = now
        lastText = text
    }
    sawContinuationCue = AdaptiveEndpointModel.hasContinuationCue(text)
    if let confidence {
        sawLowConfidence = confidence < AdaptiveEndpointModel.lowConfidenceFloor
    }
}

func verdict(at now: Date) -> EndpointVerdict {
    let silence = now.timeIntervalSince(lastEvidenceAt)
    let needsExtension = sawContinuationCue || sawLowConfidence
    let required = needsExtension ? extendedSilence : baseSilence
    guard silence >= required else {
        return needsExtension ? .extending(requiredSilence: required) : .keepListening
    }
    return .finalize
}
```

**Post-final cut-off repair** (`handleFinalTranscript`, `AppState.swift:1713-1770`):
1. Echo check: if Orion spoke within 4 s and `SelfEcho.isEchoWhileSpeaking` matches, drop the text and call `endConversation()`.
2. Join with `appendContinuation(text, to: preservedTranscript)`.
3. Decide `looksCutOff`:
   - hands-free with Deepgram: no terminal punctuation;
   - any turn with Apple: a continuation cue and no terminal punctuation;
   - push-to-talk with Deepgram: never.
4. If it looks cut off and `continuationChainRemaining > 0` (max 2): preserve the text, go to `.idle`, wait `followUpSettle 0.45 s`, then `beginListening(handsFree: true, followUp: true)`.
5. Otherwise `sendHeard(combined)`.

There is also a resume path: `isResumeRequest` matches phrases like "continue", "keep going" or "what were you saying" exactly (after stripping `.?!`). It re-speaks the paused or interrupted reply (`AppState.swift:1796-1820, 1909`).

### 2.6 TurnTakingState

- `TurnPhase`: `idle | listening(capturing|possiblePause|finalizing) | thinking | speaking(playing|interrupted)`.
- `TurnAction`: `stopSpeaking | pauseTask | cancelTask | finalizeUtterance | none`.
- `TurnTakingModel` transitions:
  - `beginListening` → `listening(.capturing)` with a fresh endpoint model;
  - `transcriptUpdated` / `silenceTick` → substates, with `.finalizeUtterance` setting `.finalizing`;
  - `utteranceDelivered` → `.thinking`; `replyReady` → `.speaking(.playing)`; `speechFinished` / `returnToIdle` → `.idle`;
  - `bargeIn`: thinking with non-empty text gives `.pauseTask`; speaking that passes policy gives `.interrupted` and `.stopSpeaking`;
  - `hardInterrupt`: speaking gives `.stopSpeaking`, thinking gives `.cancelTask`, and the phase goes to idle (`TurnTakingState.swift:166-289`).
- **The app does not instantiate `TurnTakingModel`.** The live phase is `AppState.phase: OrionPhase` (idle, listening, thinking, speaking, error), driven only by `setPhase` (`AppState.swift:1263-1311`). `turnPhaseForBargeIn()` maps it onto `TurnPhase` for the policy (`AppState.swift:1182-1189`).

`setPhase` side effects, in order:
1. Hologram state and `onSpeakingChanged`.
2. `armWatchdog(for:)`.
3. `stopHandsFree()` if leaving listening.
4. `AudioDucking.begin/endListeningFallback`.
5. `audioCoordinator.begin/endConversation` across listening, thinking and speaking.
6. `wakeWord.setSuspended(next != .idle)`.
7. `bargeInMonitor.setActive(voice origin && (speaking || thinking))`.

### 2.7 Sending to the brain

`send(_:typed:)` (`AppState.swift:1901-1990`):
1. Resume request check.
2. `QuickAnswer.reply` for instant clock answers.
3. `setPhase(.thinking)`.
4. Builds the prompt with `agentRequest(userText:spoken:)`.
5. On the serial `agentQueue`, calls `GatewayClient.ask(request, session: chatSession, model: chatModel)`. The session is `orion-chat-<id>` or `GatewayClient.sessionKey = "orion-app-v2"`.
6. The completion is generation-gated (`askGeneration`). If the turn was paused, a late answer is kept as `pausedReplacementText`.
7. `deliver` → `speak(text, origin:)`. Only `.voice`-origin replies are spoken (`ReplyOrigin.allowsSpeech`).

Subprocess (`GatewayClient.swift:115-131`): executable `/Users/nickmadaio/.openclaw/bin/openclaw`, argv
`agent --session-key <session> --message <recentOutreach + SchedulingMemory.context + text> --json --timeout <RunTimeouts.agentTimeout> [--model <m>] --thinking <ThinkingPolicy.level>`.
The child's PATH gets `/usr/bin:/bin:/usr/sbin:/sbin:~/.openclaw/bin` appended, plus env `GOG_KEYRING_PASSWORD` if resolvable. The backstop is SIGTERM at `RunTimeouts.terminateAt`, then SIGKILL after `killGrace`.

### 2.8 TTS: TTSClient and the daemon

`TTSClient.socketPath = "/Users/nickmadaio/.openclaw/orion-tts.sock"` is a hardcoded absolute path (`TTSClient.swift:160`).
- The connect timeout is 5 s and the read timeout is raised to 60 s per stream (`TTSClient.swift:195, 208`).
- A probe (`isReachable`) uses a 0.4 s timeout. Cancel opens its own connection on its own queue with a 1 s timeout.

NDJSON protocol (`TTSClient.swift:14-17, 211-217`):
```
-> {"op":"synth","text":"...","mode":"stream","preempt":true,"provider":"local|elevenlabs"}
<- {"event":"chunk","id":"...","index":N,"text":"...","ms":173,"path":"/…wav"}
<- {"event":"done","ok":true,"id":"...","chunks":3,"ms":812,"engine":"mlx-warm|elevenlabs|…"}
<- {"ok":false,"code":"cancelled"|…,"error":"…"}     (error frame, no "event" key)
-> {"op":"cancel"}                                    (separate connection; one reply frame read)
```

Frame handling (`TTSClient.swift:251-289`):
- `chunk` → `onChunk(URL(fileURLWithPath: path))` on the main thread.
- `done` → `.finished(chunks, engine)`, or `.failed`.
- An error frame with `code == "cancelled"` → `.cancelled`.
- EOF → `.finished(engine: "unknown")` if anything was delivered, otherwise `.failed`.
- A `generation` counter drops stale frames.

**Cloud TTS providers.** The Swift side has **no HTTP calls**. `VoiceProviders.swift` only defines `TTSProvider {local "Local (MLX)", elevenlabs "ElevenLabs"}`. `daemonProvider = rawValue` is sent as `provider`, and the daemon may override it and reports the engine that actually served.

Key lookup is `Secrets.elevenLabsKey` (env var `ELEVENLABS_API_KEY`) and `Secrets.deepgramKey` (`DEEPGRAM_API_KEY`), resolved in this order:
1. process environment;
2. Keychain, but only if `~/.openclaw/orion-controlled/model-roles.json` names `providers.<p>.credential.source == "keychain"` with a `ref`. Account `openclaw`, service = ref, `kSecUseAuthenticationUIFail`;
3. `/usr/bin/security find-generic-password -a openclaw -s <item> -w`;
4. `/Users/nickmadaio/Desktop/ORION/.env`.

Values are cached per process and prefetched at launch off the main thread (`VoiceProviders.swift:113-209`; `AppDelegate.swift:21`).

For context, the daemon (`scripts/orion_tts_daemon.py:335-362, 1277-1288`):
- ElevenLabs is opt-in via `ORION_TTS_CLOUD_VOICE`.
- Base URL `ORION_ELEVEN_BASE_URL` (default `https://api.elevenlabs.io`). Request `POST {base}/v1/text-to-speech/{voice_id}/stream?output_format=pcm_<rate>` (method inferred; URL and header read), header `xi-api-key`.
- Voice `ORION_ELEVEN_VOICE_ID` (default `21m00Tcm4TlvDq8ikWAM`, "Rachel"). Model `ORION_ELEVEN_MODEL` (default `eleven_flash_v2_5`).
- Its Keychain label for `ELEVENLABS_API_KEY` is "ORION ElevenLabs".
- The local engine is MLX audio ("mlx-warm" in-process, with fallbacks "mlx-generate-fn" and "mlx-cli"). Runtime directory `~/.openclaw/tmp/orion-tts`.

### 2.9 SpeechOutput playback

`speak(text)`:
- Calls `stop(reason: "new reply starting")`.
- Sets `currentText` and `lastSpokenText`.
- Calls `tts.stream`.
- Each chunk WAV goes through `loadBuffer` (AVAudioFile, converted to 24 kHz mono float32 if needed), then `scheduleBuffer(..., completionCallbackType: .dataPlayedBack)`, and `pendingBuffers` is incremented.
- `finishIfDrained` requires `streamComplete && pendingBuffers == 0`. It then calls `onFinished` and `scheduleDeviceRelease` (`SpeechOutput.swift:87-245`).

The graph is `player → mainMixerNode` at `playbackFormat` (24 kHz mono float32), with a mixer tap (`format: nil`) that drives the hologram level and `noteSpeechProgress` (`SpeechOutput.swift:43-46, 247-276`). `releaseDevice()` runs after `deviceReleaseDelay = 1.5 s`: it removes the tap and calls `engine.stop()`, because `pause()` keeps the device (`SpeechOutput.swift:50-64, 144-166`).

Fallback to `AVSpeechSynthesizer` (en-US voice) happens when:
- the daemon is unreachable or fails before any chunk played;
- `done` arrives with 0 chunks;
- the engine fails to start.

The hologram is then driven by a synthetic sine envelope at 20 Hz, and `onActiveEngine("system")` is reported. If chunks already played, a failure only posts the notice "Voice stream ended early" (`SpeechOutput.swift:206-229, 326-363`).

```swift
// SpeechOutput.swift:206-229
private func handle(_ outcome: TTSOutcome, originalText: String) {
    guard isSpeaking else { return }
    switch outcome {
    case .cancelled:
        return
    case .finished(let chunks, let engine):
        streamComplete = true
        onActiveEngine?(engine)
        if chunks == 0 && !playedAnything {
            failToFallback(reason: nil, text: originalText)
            return
        }
        finishIfDrained()
    case .failed(let message):
        if playedAnything {
            streamComplete = true
            onNotice?("Voice stream ended early: \(message)")
            finishIfDrained()
        } else {
            failToFallback(reason: message, text: originalText)
        }
    }
}
```

After `onFinished` (`AppState.swift:1041-1073`):
- If `listenAfterReach` is set, or `conversationOpen && wakeWordEnabled`: go to `.idle` with "Go ahead…", wait 0.45 s (`followUpSettle`), then `beginListening(handsFree: true, followUp: true)`.
- Otherwise go idle with "Hold Right Option to talk".

Speaking-phase floor: `StallWatchdog(stallAfter: VoiceTuning.stallTimeout (12 s), ceiling: 300 s)`. Progress comes from output-level callbacks. The thinking phase gets `(∞, RunTimeouts.watchdogCeiling = 420 s)` (`AppState.swift:1380-1392`).

### 2.10 BargeInMonitor

This is the second on-device SF recogniser. It is fed by the same `onMonitor` and is active only while the phase is speaking or thinking and the reply has voice origin (`AppState.swift:1310`).
- Thresholds, slightly more sensitive than the wake word: `openLevel 0.14`, `holdLevel 0.09`, `hangover 1.0 s`, `windowLimit 6 s`, `retriggerGuard 1.5 s`, preroll 5 (`BargeInMonitor.swift:70-75`).
- For each partial it evaluates `BargeInPolicy.mode(route, phase)` and `isInterruption(mode, text, latestLevel, currentlySpoken)`.
- `currentRoute` comes from `AppState.currentOutputRouteKind()`: any Bluetooth (classic or LE) default output is `.headset`, everything else is `.speakers`. Wired headphones therefore count as speakers (`AppState.swift:1172-1177`).

Policy (`TurnTakingState.swift:95-142`):
- `.speaking` with `.speakers` → `voiceRestricted`. Everything else (including `.thinking` on speakers) → `voiceEnabled`, meaning any non-empty text interrupts.
- `voiceRestricted` rejects when:
  - energy < `speakerEnergyFloor 0.22`, or
  - the alphanumeric-compacted heard text is a substring of the compacted current sentence, or
  - `SelfEcho.isEchoWhileSpeaking`.
  
  It then *requires* an interrupt word that Orion is not saying himself. `SelfEcho.interruptWords = {stop, wait, hold, orion, no, cancel, shut}`. The echo ratio threshold is 0.6 of heard words, applied only when 3 or more words were heard (`SelfEcho.swift:15-47`).

```swift
// TurnTakingState.swift:119-136
switch mode {
case .voiceEnabled:
    return true
case .voiceRestricted:
    guard energy >= speakerEnergyFloor else { return false }
    let compactHeard = compact(heard)
    if !compactHeard.isEmpty, compact(currentlySpoken).contains(compactHeard) { return false }
    if SelfEcho.isEchoWhileSpeaking(heard: heard, spoken: currentlySpoken) { return false }
    return !SelfEcho.interruptions(in: heard, spoken: currentlySpoken).isEmpty
}
```

`AppState.handleSpokenBargeIn` (`AppState.swift:1194-1227`) runs a second echo check against `lastSpokenText`.
- **Speaking:** `markLastReplyInterrupted` (appends " [interrupted]"), `speechOutput.stop`, `conversationOpen = true`, idle, `beginListening(handsFree: true)`, and seeds `preservedTranscript = heardText`.
- **Thinking:** `pauseThinking`. The subprocess is *not* killed. `askGeneration` is bumped, `pausedGeneration` is kept, and it starts listening.
- Escape and push-to-talk go through `bargeIn()`, which cancels a thinking turn (`cancelThinking` → `GatewayClient.cancelInFlight`, SIGTERM then SIGKILL) (`AppState.swift:1839-1885`).

There are four echo defences: BargeInPolicy, `handleSpokenBargeIn`, `handleWake` (2.5 s), and `handleFinalTranscript` (4 s).

### 2.11 AudioDucking and AudioRoute

**AudioDucking** (`AudioDucking.swift`):
- Mechanism: `osascript -e "output volume of (get volume settings)"` and `osascript -e "set volume output volume N"`.
- In `.listening`, volume goes to `max(1, current × 0.3)` if current > 12.
- Restore happens only if the volume is within ±2 of the ducked value, meaning nobody changed it by hand.
- Crash marker: `~/.openclaw/orion-system-volume-duck-state.json`.
- **Gated by `systemVolumeFallbackEnabled = false`, and nothing sets it** (`AudioDucking.swift:54`). This is effectively off.

The live duck is in `SessionService/AudioCoordinator.swift`:
- `beginConversation`/`endConversation` are reference-counted and span listening, thinking and speaking.
- Apple Music's own `sound volume` drops to `musicDuckedFraction 0.3` (floor 0.12) via NSAppleScript (`SessionService/ExternalActions.swift`).
- The Orion clip drops to `duckedFraction 0.25`.
- Crash marker: `~/.openclaw/orion-music-duck-state.json`.
- `shutDown` calls `AudioDucking.restoreSystemVolumeNow()` and `audioCoordinator.reset()`.

**AudioRoute** (`AudioRoute.swift`), CoreAudio HAL only:
- `AudioInputRouteLease.begin()` is reference-counted on a serial queue. On the first holder it checks `openingTheMicWouldDegradeOutput()`: the default output and default input are both transport Bluetooth or BluetoothLE.
- If so, it sets the **machine-wide** `kAudioHardwarePropertyDefaultInputDevice` to the first built-in device with input channels, *before* the engine reads its format.
- It persists `{priorInput, appliedInput}` to `~/.openclaw/orion-audio-route-state.json`.
- `end()` only decrements; it deliberately does **not** restore. `releaseAtQuit()` (from `SpeechInput.abort()`) restores only if the default is still the built-in mic.
- `recoverFromCrash()` runs at init.
- No explicit AirPods code: AirPods are covered by the generic Bluetooth transport check **(inferred)**.

```swift
// AudioRoute.swift:236-257
func begin() {
    queue.sync {
        holders += 1
        guard holders == 1 else { return }
        guard AudioRoute.openingTheMicWouldDegradeOutput() else { return }
        guard let builtIn = AudioRoute.builtInInputDeviceID() else { ...; return }
        let prior = AudioRoute.defaultInputID()
        guard AudioRoute.setDefaultInput(builtIn) else { ...; return }
        priorDefaultInput = prior
        AudioRouteState.persist(priorInput: prior, appliedInput: builtIn)
        ...
    }
}
```

---

## 3. Outbound network calls and subprocesses

| What | Where | Detail |
|---|---|---|
| Deepgram WebSocket | `DeepgramSpeech.swift:224-238`, URL from `FluxTurns.swift:14-20` | Upgrade request to `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.7&eot_timeout_ms=5000`. Header `Authorization: Token <DEEPGRAM_API_KEY>` (attempt 0) or subprotocol `["token", key]` (attempt 1). Binary frames carry int16 LE 16 kHz mono PCM. Text frame `{"type":"CloseStream"}`. Also a `sendPing`. |
| TTS daemon (local, not network) | `TTSClient.swift:160, 184-305` | AF_UNIX `/Users/nickmadaio/.openclaw/orion-tts.sock`, NDJSON as in 2.8. |
| Voice-ID daemon (local) | `SpeakerVerifier.swift:63, 143-191` | AF_UNIX `~/.openclaw/orion-voiceid.sock`, `{"op":"ping"}` / `{"op":"verify","audio":b64,"rate":Int}`. |
| ElevenLabs (from the daemon, not Swift) | `scripts/orion_tts_daemon.py:1277-1288` | `{base}/v1/text-to-speech/{voice}/stream?output_format=…`, header `xi-api-key`. |
| `openclaw agent` | `GatewayClient.swift:48, 115-131` | `/Users/nickmadaio/.openclaw/bin/openclaw agent --session-key S --message M --json --timeout T [--model m] --thinking L` |
| `/usr/bin/security` | `VoiceProviders.swift:188-201` | `find-generic-password -a openclaw -s <item> -w`; stdout is piped and never logged. |
| `/usr/bin/osascript` | `AudioDucking.swift:153-182` | `-e "output volume of (get volume settings)"`, `-e "set volume output volume N"`. Only if the fallback is enabled, plus restore and crash recovery. |
| NSAppleScript (in-process) | `ReachVolume.swift:17-43` | get, set or unmute volume for unprompted speech. |
| `node orion-reach` | `AppState.swift:749-757` | `~/.openclaw/tools/node-v24.15.0/bin/node ~/.openclaw/orion-remote/scripts/orion-reach <line> --kind reminder --urgent --why "…"`. Reminders, adjacent to voice. |
| Apple SFSpeechRecognizer | `SpeechInput.swift:594-596` | Requires on-device only if supported; otherwise Apple may use its server **(inferred from the API)**. The wake word and barge-in monitor are forced on-device. |

---

## 4. Config flags, env vars and UserDefaults

UserDefaults domain: `com.nickmadaio.orion.app`, as cited in comments.

| Key or variable | Default | Effect | Location |
|---|---|---|---|
| `OrionSTTProvider` | `apple` | Ear: apple or deepgram | `VoiceProviders.swift:68, 81-90` |
| `OrionTTSProvider` | `local` | `provider` field sent to the TTS daemon | `VoiceProviders.swift:67, 70-79` |
| `OrionVoiceEndpointingMs` | 900 (100–4000) | Base silence for the Apple hands-free endpoint model. **Not sent to Deepgram any more.** | `VoiceTuning.swift:22, 40-46` |
| `OrionVoiceUtteranceEndMs` | 1800 (1000–8000) | Only feeds `extendedEndpointingSeconds` via `resolvedUtteranceEndMs = max(ue, ep+600)` | `VoiceTuning.swift:53-68` |
| `OrionVoiceAppleFinalGrace` | 1.2 s (0.4–4.0) | Wait for the Apple final after key release | `VoiceTuning.swift:72-82` |
| `OrionSpeakingStallTimeout` | 12 s (4–60) | Speaking watchdog stall | `VoiceTuning.swift:102-112` |
| constants | 300 s / `RunTimeouts.watchdogCeiling` (420) | Speaking and thinking ceilings | `VoiceTuning.swift:117, 141` |
| `OrionWakeWordEnabled` | false | Wake word plus the monitoring tap | `SummonSettings.swift:93-159` |
| `OrionWakeSensitivity` | `balanced` | Tolerance 0.12 / 0.26 / 0.42 | `SummonSettings.swift:69-91, 161-169` |
| `AudioDucking.systemVolumeFallbackEnabled` | false (static var, no UI) | System-volume duck while listening | `AudioDucking.swift:54` |
| `DEEPGRAM_API_KEY` / `ELEVENLABS_API_KEY` | none | env, then Keychain item from the contract `providers.deepgram|elevenlabs.credential.ref` (account `openclaw`), then `.env` | `VoiceProviders.swift:106-124` |
| `GOG_KEYRING_PASSWORD` | none | Passed through to the agent subprocess | `GatewayClient.swift:139-141` |
| `~/.openclaw/orion-controlled/model-roles.json` | n/a | `schema_version == 1`. Gives `roles.stt.primary` (now unused by the URL) and the `providers.*.credential` Keychain ref. Cached per process. | `ModelContract.swift:24-77` |
| Daemon env (Python) | see 2.4 and 2.8 | `ORION_VOICEID_SOCKET/PROFILE`, `ORION_TTS_SOCKET`, `ORION_TTS_ENGINE`, `ORION_TTS_CLOUD_VOICE`, `ORION_ELEVEN_*` | scripts |

Hardcoded timing constants in AppState: `handsFreeLeadIn 1.0`, `handsFreeLimit 12`, `followUpGrace 6`, `continuationGrace 2.5`, `followUpSettle 0.45`, `maxContinuationChain 2`, `verificationSeconds 2.0` (`AppState.swift:327-330, 403, 418-420, 451-456`).

---

## 5. Persistence

| Path | Read/write | Owner |
|---|---|---|
| `~/.openclaw/orion-audio-route-state.json` | write on lease apply; read and clear at launch or quit | `AudioRoute.swift:343-364` |
| `~/.openclaw/orion-system-volume-duck-state.json` | system-volume duck marker | `AudioDucking.swift:194-212` |
| `~/.openclaw/orion-music-duck-state.json` | Music duck marker | `SessionService/AudioCoordinator.swift:273-290` |
| `~/.openclaw/orion-voiceid.json` | speaker profile (vectors, threshold, enrolledAt), 0600; written by the daemon only | `scripts/orion_voiceid_daemon.py:62-63, 156-177` |
| `~/.openclaw/orion-tts.sock`, `~/.openclaw/orion-voiceid.sock` | sockets | |
| Chunk WAVs under the daemon's runtime directory (`~/.openclaw/tmp/orion-tts`, TTL 120 s) | read by `SpeechOutput.loadBuffer` | daemon |
| `~/.openclaw/orion-controlled/model-roles.json` | read once | ModelContract |
| `/Users/nickmadaio/Desktop/ORION/.env` | read (secret fallback) | `VoiceProviders.swift:106, 211-231` |
| `~/.openclaw/logs/orion-app.log` | append log (`[audio]`, `[deepgram]`, `[voiceid]`, `[speech] CUT OFF…`, watchdog lines that `orion-doctor` greps for) | `OrionLog.swift:13-27` |
| UserDefaults keys in section 4 | | |

**The endpoint model persists nothing.** `AdaptiveEndpointModel` is rebuilt per turn from `VoiceTuning`.

---

## 6. History (most informative commits)

- **WakeWord.swift:** only `8cf62aa 2026-07-30` "Wake word, corner summon, and a menu-bar typing surface". Untouched since.
- **SpeechInput.swift:**
  - `ff0ec35 2026-10-02` Flux turns (EndOfTurn authoritative, Apple fallback);
  - `7724c43 2026-09-30` includes the dead-mic restart (2026-09-29 incident) **(inferred from comment dates)**;
  - `0e006c0 2026-09-06` endpointing setting wired; confidence hook added;
  - `3e14200 2026-09-05` `AudioInputRouteLease` integration;
  - `93e9a42 2026-08-20` checkpoint;
  - `3a87a71 2026-08-04` endpointing 300 to 900 ms, tunable;
  - `d1955f1 2026-07-30` `.endOfStream` converter bug;
  - `a187595 2026-07-30` optional-chained converter dropped all audio;
  - `51518c4 2026-07-30` instrumented the hearing path;
  - `3c60325 2026-07-30` activate before the permission prompt.
- **DeepgramSpeech.swift:**
  - `ff0ec35` moved from `v1/listen` nova-3 (with `punctuate`, `smart_format`, `vad_events`, `endpointing`, `utterance_end_ms`, interim results, and a `Finalize` control) to Flux `v2/listen` `flux-general-en`;
  - `0e006c0` endpointing from VoiceTuning;
  - `1c9c503 2026-09-01` Keychain-backed secrets;
  - `3a87a71`, `d1955f1`, `8cf62aa`.
- **SpeakerVerifier.swift:** `3a87a71 2026-08-04` (introduced).
- **TurnTakingState.swift:** `0e006c0` (introduced); `8cc9cbe 2026-09-15` docs path move; `7724c43 2026-09-30` SelfEcho / "It's 8:07 PM" fix.
- **BargeInMonitor.swift:** `0e006c0` only.
- **AdaptiveEndpointModel.swift:** `0e006c0` (introduced, 118 harness checks); `7724c43` widened trailing-word set.
- **SpeechOutput.swift:** `2f6bc6e`, `8cf62aa` (07-30); `8f1f4e5 2026-07-30` release the device after 1.5 s (muffled-music bug); `3a87a71` speaking watchdog; `0e006c0` `currentText`; `7724c43` `lastSpokenText` / `recentlySpoke`.
- **TTSClient.swift:** `2f6bc6e`, `8cf62aa` only (2026-07-30).
- **VoiceProviders.swift:** `8cf62aa`; `1c9c503` Keychain; `7724c43` prompt-free Keychain plus the security tool and prefetch (2026-09-29 incident).
- **AudioDucking.swift:** `3a87a71` (introduced); `3e14200` narrowed to an opt-in listening-only fallback.
- **AudioRoute.swift:** `3e14200 2026-09-05` only.

---

## 7. Gotchas and lessons recorded in comments

1. **Converter `.endOfStream`** (`DeepgramSpeech.swift:103-114`; d1955f1). A cached AVAudioConverter was told end-of-stream after the first buffer, so every later call produced zero frames. Deepgram stayed connected and heard nothing.
2. **Optional-chained converter** (`SpeechInput.swift:537-545`; a187595). `converter?.data(...)` silently dropped all audio. It is now a guard with a starvation fallback.
3. **Permission prompt from a non-activating app is instantly denied.** The log showed press, then refused, then denied within 1 s (`SpeechInput.swift:137-151`).
4. **2026-08-12 twelve-minute deafness.** `.thinking` wedged because `GatewayClient.ask` blocked in `readDataToEndOfFile()` on the serial `agentQueue` (a grandchild held the pipe). Log: `ear=deepgram sent=4156540B` frozen for 12 minutes. This produced the generalised `StallWatchdog`, the `ear=monitor` log wording, and SIGTERM-then-SIGKILL (`StallWatchdog.swift:13-26`; `SpeechInput.swift:219-226`).
5. **Speaking could never end.** `pendingBuffers` stayed above 0 when a completion handler never fired. Fixed with a 12 s stall and 300 s ceiling (`VoiceTuning.swift:86-101`).
6. **Endpointing 300 ms clipped every comma**, so it went to 900 ms (`VoiceTuning.swift:29-39`). Then **the setting was "wired to a label"**: hands-free used a hidden 1.3 s `handsFreeHangover`, so raising the setting to 1400 never mattered (`AdaptiveEndpointModel.swift:7-24`; `AppState.swift:421-430`). After ff0ec35 the same shape partly returned **(inferred)**:
   - with Deepgram, `checkHandsFree` returns early and Flux eot settings are hardcoded, so `OrionVoiceEndpointingMs` again affects only the Apple path;
   - the docs comments in `AdaptiveEndpointModel.swift:36-42` (`smart_format`, `handleResults`) and `DeepgramSpeech.swift:42-53` are stale.
7. **Confidence signal is dead.** `onConfidence` is never fired, so `sawLowConfidence` is always false **(read)**. The harness still tests it with injected confidence.
8. **`finish()` comment says Finalize, the code sends only CloseStream** (`DeepgramSpeech.swift:271-281`).
9. **A2DP to HFP collapse** was measured on a Sony WH-1000XM4: output went from 44100 Hz/2ch to 16000 Hz/1ch within about 1 s of any capture and did not recover. Two failed fixes are recorded: `auAudioUnit.deviceID` is get-only, and `kAudioOutputUnitProperty_CurrentDevice` was re-asserted away by the engine within about 1 s. Restoring the default input while the engine still exists re-triggers the collapse, so the lease is held until quit (`AudioRoute.swift:8-85`).
10. **A running engine at 24 kHz mono muffled music;** `pause()` keeps the device (`SpeechOutput.swift:50-64`; 8f1f4e5). AmbientSound notes that a 48 kHz stereo source against a device pinned to 24 kHz produced silence, and that taking an interleaved device format verbatim segfaulted (`AmbientSound.swift:17-20, 115-124`).
11. **2026-09-29 echo incidents.**
    - "It's 8:07 PM" came back as "it's 8:07 p.m.", which defeated the substring check. Fixed with alphanumeric compaction.
    - Orion's own "Orion" cut off a 699-character answer.
    - Echo woke the wake word twice a minute.
    - Tails like "Eight" or "It's eight" were sent to the brain.
    
    Fixes are spread across `TurnTakingState.swift:124-135`, `SelfEcho.swift:3-12`, and `AppState.swift:1715-1724`.
12. **2026-09-29 Keychain prompt.** A locally signed rebuild invalidated "always allow", so a hidden prompt on the main thread froze a press (once for 26 s) or returned NO KEY. Fixed with `kSecUseAuthenticationUIFail`, the `/usr/bin/security` fallback, a cache, and launch prefetch (`VoiceProviders.swift:151-163`).
13. **2026-09-29 dead mic mid-turn:** audio for 1 s, then nothing, read as a quiet room. Now restarted after 1.5 s without buffers, at most 3 times (`SpeechInput.swift:287-292, 448-461`).
14. **2026-10-08 cut-off sentence** ("after class, I want to do… … and do long") was sent four times. This led to `looksCutOff`, continuation chaining and `pauseThinking` seeding (`AppState.swift:1740-1747, 1256-1258`). AddressGate was removed the same day after dropping five real follow-ups (`AppState.swift:1771-1775`).
15. **The speaker-ID floor masks the measured bar.** The Swift floor of 0.45 equals the daemon's `THRESHOLD_FLOOR`, so any score ≥ 0.45 wakes, whatever the profile threshold (up to 0.88). In practice the bar is 0.45 **(inferred)**. The daemon notes a rejected MFCC fallback: enrolled 0.999, similar voice 0.996, a margin of 0.004 that is noise.
16. **Hardcoded user paths:** `TTSClient.socketPath`, `Secrets.envPath` and `GatewayClient.binaryPath` are absolute `/Users/nickmadaio/...`.
17. **TTSClient comment:** the first chunk is playable in about 170 ms. `replayLimit` 140 × 1024 frames at 48 kHz is about 3 s.

---

## 8. What the harnesses prove

**`Tests/run-turntaking-test.sh`** compiles the real `AdaptiveEndpointModel.swift`, plus `TurnTakingState.swift` with `import MobileCore` stripped by sed, plus the real `SelfEcho.swift` and `TurnTakingHarness/main.swift`. It is pure Foundation with no device or network. It mirrors base 0.9 and extended 1.62. It covers:
- verdicts at 0.5, 1.0, 1.5 and 2.5 s, with and without a cue;
- trailing versus leading filler;
- a shrinking transcript resetting the clock;
- continuation vocabulary, `appendContinuation`, and resume phrases;
- low versus high confidence (injected);
- the full `TurnTakingModel` substate lifecycle;
- `BargeInPolicy` mode for every phase and route, and `isInterruption` cases (energy floor, echo substring, 8:07 PM punctuation, own-sentence fragment, "yeah okay cool" not stopping on speakers, "Orion stop" stopping, his own "Orion" not stopping);
- interruption at the start, middle and end of a reply;
- thinking pausing rather than cancelling;
- `hardInterrupt` being unconditional;
- 100 SplitMix64-seeded simulated turns that all return to idle.

It does **not** prove the live wiring: AppState does not use `TurnTakingModel`, and there is no real mic or socket. The "mic opens equal closes" check is trivially satisfied, since both counters increment unconditionally in the loop **(inferred, `TurnTakingHarness/main.swift:368-436`)**.

**`Tests/run-audio-matrix.sh`** compiles `AudioMatrix/HALDevice.swift` and `main.swift` against AVFoundation and CoreAudio. It is a hardware experiment that makes sound.
- While a separate engine plays a 48 kHz stereo neighbour (440 Hz left, 880 Hz right) and a mic tap is live, it builds candidate graphs:
  - **A:** the shipped graph, player to mixer at 24 kHz mono with a nil-format tap;
  - **B:** player to outputNode;
  - **C:** mixer to output at hardware format, with config-change handling.
- It records the HAL default output and input rates and channels at stages 0–7.
- Flags: `--candidate`, `--seconds`, `--no-capture`, `--input-route default|builtin`.
- It exits non-zero only if the device is still degraded at the end.
- Recorded results (`docs/planning/v2/PHASE_AUDIO_COEXISTENCE.md:38-87`):
  - with the default (Bluetooth) input, output moves to 16000/1 at "capture live" and stays there;
  - with `builtin`, all of A, B and C hold 44100/2 throughout, and output is still 44100/2 after the simulated quit restore.
- This refuted "the 24 kHz engine pins the device" as the cause of headset degradation; the cause was the HFP mic. That justified `AudioInputRouteLease`. Limits: microphone permission belongs to the terminal, and there is no loopback capture of the actual output.

**`Tests/run-watchdog-test.sh`** compiles the real `StallWatchdog.swift` with `WatchdogHarness/main.swift` against a fixed epoch. It proves:
- speaking: 240 s of flowing audio stays healthy; 11 s since the last buffer is healthy; 12 s is a stall; a never-ending reply hits the 300 s ceiling;
- thinking (∞ stall, 420 s ceiling): 30, 180 and 320 s are healthy; 420 s is over the ceiling; the 12-minute mark is long recovered; a day later it is a ceiling, never a stall;
- stall wins over ceiling when both apply;
- exact boundaries: 4.999 versus 5.0, and 99.999 versus 100.0.

It does not prove AppState's `checkPhaseWatchdog` wiring. The evidence for that is the log lines `[speech] watchdog recovered a stuck speaking phase` and `[think] watchdog recovered a stuck thinking phase`.