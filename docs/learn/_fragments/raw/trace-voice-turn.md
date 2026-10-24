<!-- prompt: Read-only research in /Users/nickmadaio/Desktop/ORION (a personal assistant: Swift Mac app in native/Orion/Sources/Orion, OpenClaw TS plugin in plugin/orion-control/src, scripts/). Very thorough. Do NOT edit anything, do not run builds or anything that calls networks.

Trace a VOICE TURN end to end through the Mac app: wake word detection (WakeWord.swift) -> speech-to-text (SpeechInput.swift, Deep -->

I traced a full voice turn through the Mac app: 18 hops in order, then the config branches, failure behaviour, gaps I found, git history, and the config inventory. I verified every line number with `grep -n`/`cat -n`, edited nothing, ran no builds and made no network calls. The working tree is clean for every file below (`git status --short` printed nothing), so all line numbers match HEAD.

All Swift paths below are relative to `/Users/nickmadaio/Desktop/ORION/native/Orion/Sources/Orion/` unless I give a full path.

---

## Ordered hops

### Hop 0: Push-to-talk key (the entry that bypasses the wake word)
**`PushToTalk.swift:98-115`** (Right Option, keyCode 61). **`:119-144`**: Left Option (keyCode 58) counts only if held alone for `leftOptionHold = 0.3`s; any ⌘/⌃/⇧ or another key cancels it.
```swift
guard event.keyCode == PushToTalkMonitor.rightOptionKeyCode else { return }
let down = event.modifierFlags.contains(.option)
if heldKeyCode == PushToTalkMonitor.leftOptionKeyCode { return }
if down {
    guard !isHeld else { return }
    isHeld = true
    heldKeyCode = PushToTalkMonitor.rightOptionKeyCode
    onPressed?()
} else {
    guard isHeld else { return }
    isHeld = false
    heldKeyCode = nil
    onReleased?()
```
**`AppDelegate.swift:119-121`**:
```swift
pushToTalk.onPressed = { [weak self] in self?.state.beginListening() }
pushToTalk.onReleased = { [weak self] in self?.state.endListening() }
pushToTalk.onEscape = { [weak self] in self?.handleEscape() }
```
- **In:** `NSEvent` `.flagsChanged`. **Out:** no-argument callbacks. A press calls `beginListening(handsFree: false)`.
- **Why:** the header (`:13-19`) says a global monitor needs Accessibility and a local monitor covers the case where Orion itself is frontmost. Without Accessibility, "macOS simply never calls us".
- **Other entry points:** `orion://listen` (`AppDelegate.swift:190-194`) calls `beginListening(handsFree: true, followUp: true)`.

### Hop 1: The single microphone tap, shared by everything
**`SpeechInput.swift:485-505`**:
```swift
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
- **Out:** `(AVAudioPCMBuffer, Double 0…1)` goes to `onMonitor`, and `route()` sends it to the recogniser.
- **How the wake word keeps the tap open:** `AppState.applyWakeWord` (`AppState.swift:529-555`) calls `speechInput.startMonitoring()` (`SpeechInput.swift:398-408`).
- **Why:** "exactly ONE `AVAudioEngine` and exactly ONE input tap … Orion never opens a second microphone session" (`:22-27`).
- **Device routing:** `AudioInputRouteLease` (`:474`) switches input to the built-in mic when output is Bluetooth.
- **Who consumes it:** `AppState.swift:1082-1091` feeds each buffer to `retainForVerification`, `wakeWord.observe` and `bargeInMonitor.observe`.

### Hop 2: Wake-word energy gate and rolling recognition windows
**`WakeWord.swift:288-304`**, with thresholds at `:211-227`:
```swift
func observe(_ buffer: AVAudioPCMBuffer, level: Double) {
    guard isActive, !suspended else { return }
    let now = Date()
    guard now >= armedAt else { return }
    guard let request else {
        preroll.append(buffer)
        if preroll.count > WakeWordListener.prerollLimit { preroll.removeFirst() }
        if level >= WakeWordListener.openLevel { openWindow() }
        return
    }
    if level >= WakeWordListener.holdLevel { lastLoudAt = now }
    request.append(buffer)
}
```
- **Thresholds:** `openLevel 0.18`, `holdLevel 0.11`, `hangover 1.1s`, `windowLimit 9s`, `retriggerGuard 2.5s`, `rearmDelay 0.9s`, `prerollLimit 5` (about 100 ms).
- **Recogniser settings:** `openWindow` (`:311-358`) sets `requiresOnDeviceRecognition = true` unconditionally, plus `contextualStrings ["Orion","Hey Orion","OK Orion"]` and `taskHint .search`.
- **Failure:** if the Mac cannot recognise on-device, `start()` (`:243-245`) refuses to run and `onUnavailable` turns the preference off (`AppState.swift:1097-1101`).
- **Why:** rule 1 in the header, "NOTHING LEAVES THE MACHINE … there is no code path from here to a network provider".

### Hop 3: Wake-word fuzzy match
**`WakeWord.swift:93-117`** (`find`), `:129-140` (`matches`), `:398-411` (`consider`):
```swift
private func consider(_ text: String) {
    guard !text.isEmpty else { return }
    let now = Date()
    guard now.timeIntervalSince(lastFire) > WakeWordListener.retriggerGuard else { return }
    guard let hit = WakeWord.find(in: text, tolerance: tolerance) else { return }
    lastFire = now
    closeWindow()
    preroll.removeAll(keepingCapacity: true)
    onWake?(hit.command.isEmpty ? nil : hit.command)
}
```
- **In:** the transcript string. **Out:** `onWake(String?)`, the trailing command or nil. `WakeHit { command: String }` is at `:45-47`.
- **Matching:** 10 `acceptedVariants` (`:71-82`), `minimumLength 5`, word-length gap ≤ 2, and Levenshtein distance ≤ `floor(len × tolerance)`.
- **Tolerance** (`SummonSettings.swift:84-88`): strict 0.12, balanced 0.26, eager 0.42.

### Hop 4: Speaker verification (wake word only, fails open)
**`AppState.swift:1102-1130`**:
```swift
wakeWord.onWake = { [weak self] trailing in
    guard let self else { return }
    let window = self.recentAudio()
    self.speakerVerifier.verify(
        samples: window.samples,
        sampleRate: window.rate
    ) { [weak self] result in
        guard let self else { return }
        switch result {
        case .match(let score):
            ...; self.handleWake(trailing: trailing)
        case .cannotVerify(let reason):
            ...; self.handleWake(trailing: trailing)
        case .reject(let score, let threshold):
            OrionLog.write(String(format: "[voiceid] ignored a wake — %.3f below %.3f", ...
```
- **Audio window:** the last 2.0 s of channel-0 floats (`verificationSeconds`, `:328-330`, `:1145-1155`).
- **Wire** (`SpeakerVerifier.swift:118-141`): newline-terminated JSON `{"op":"verify","audio":"<b64 f32le>","rate":<Int>}` over unix socket `~/.openclaw/orion-voiceid.sock`. The reply is `{ok, match, score, threshold, enrolled}`.
- **Thresholds:** socket timeout `1.5`s. The app accepts if `match == true` or `score >= wakeSimilarityFloor 0.45` (`:59`, `:137`).
- **Daemon side** (`/Users/nickmadaio/Desktop/ORION/scripts/orion_voiceid_daemon.py:68-78`): `MIN_SECONDS 0.35`, `THRESHOLD_SIGMA 2.0`, and the bar is clamped to `[0.45, 0.88]`.
- **Failure:** a dead daemon, missing model, no enrollment, a timeout, or `isFiltering == false` all return `.cannotVerify`, and the wake proceeds anyway (header rule 1: "FAILS OPEN"). Push-to-talk is never gated (rule 2). Rejection is silent to the user.

### Hop 5: Self-echo guard on the wake, then dispatch
**`AppState.swift:562-584`**:
```swift
guard phase == .idle else { return }
if speechOutput.recentlySpoke(),
   SelfEcho.isEcho(heard: trailing ?? "", spoken: speechOutput.lastSpokenText) || (trailing ?? "").isEmpty {
    OrionLog.write("[wake] ignored — ORION was just speaking; that was his own voice")
    return
}
onWantsSummon?()
hologram.ping()
if let command = trailing?..., command.count >= 2 {
    heard = command
    send(command)
} else {
    beginListening(handsFree: true)
}
```
- **Echo window:** `recentlySpoke` defaults to 2.5 s (`SpeechOutput.swift:74-76`).
- **`SelfEcho.isEcho`** (`/Users/nickmadaio/Desktop/ORION/native/OrionMobile/Sources/MobileCore/SelfEcho.swift:15-26`): needs 3 or more heard words with at least 60% overlap with what Orion said.
- **Note:** a bare "Orion" within 2.5 s of a reply ending is always ignored.
- **One breath:** "Orion, X" goes straight to `send()` (hop 11) and skips STT entirely.

### Hop 6: `beginListening` and phase bookkeeping
**`AppState.swift:1522-1564`**:
```swift
if phase == .speaking {
    bargeIn()
}
guard !speechInput.isRunning else { ... return }
...
if wantsHandsFree { conversationOpen = true } else { conversationOpen = false }
if !followUp {
    preservedTranscript = ""
    continuationChainRemaining = AppState.maxContinuationChain
}
setPhase(.listening)
...
speechInput.start()
if wantsHandsFree { startHandsFree(followUp: followUp) }
```
**`setPhase`** (`:1263-1311`) is the single choke point:
```swift
if next == .listening {
    AudioDucking.beginListeningFallback()
} else if phaseWasListening {
    AudioDucking.endListeningFallback()
}
...
if phaseIsActive, !phaseWasActive { audioCoordinator.beginConversation() } ...
wakeWord.setSuspended(next != .idle)
bargeInMonitor.setActive(activeReplyOrigin.allowsSpeech && (next == .speaking || next == .thinking))
```
- **Ducking:** the system-volume duck is listening-only and off by default (`AudioDucking.systemVolumeFallbackEnabled = false`, `AudioDucking.swift:54`). When enabled it uses factor 0.3 and floor 12, and writes a crash marker to `~/.openclaw/orion-system-volume-duck-state.json`. Music and clip ducking span listening, thinking and speaking via `AudioCoordinator`.
- **Wake suspension:** "Deaf unless idle. This is what stops Orion waking itself."

### Hop 7: Speech-to-text provider choice (Apple or Deepgram)
**`SpeechInput.swift:363-375`**:
```swift
let wanted = VoiceSettings.stt
if wanted == .deepgram, let key = Secrets.deepgramKey {
    OrionLog.write("[ear] Deepgram selected, key present — connecting")
    startDeepgram(key: key)
} else {
    if wanted == .deepgram {
        ...announce(.apple, "Deepgram is selected but no \(Secrets.deepgramVariable) was found — listening on-device instead.")
    } else { announce(.apple, nil) }
    startApple(recognizer)
}
```
- **Config:** UserDefaults `OrionSTTProvider` (`apple` by default, or `deepgram`), in `VoiceProviders.swift:67-90`.
- **Key lookup** (`VoiceProviders.swift:113-124`): environment, then Keychain (item name from `model-roles.json`, account `openclaw`, never prompts, falls back to `/usr/bin/security`), then `/Users/nickmadaio/Desktop/ORION/.env`.
- **Apple path** (`:589-632`): on-device when supported. Its error path is the "Dictation stopped unexpectedly…" message.

### Hop 8: Deepgram Flux stream
**`DeepgramSpeech.swift:224-257`** (connect and auth), `:369-385` (receive):
```swift
private func handle(_ raw: String) {
    guard let message = FluxTurns.parse(raw) else { return }
    DispatchQueue.main.async {
        guard !self.failed else { return }
        switch message {
        case .connected: ...
        case .error(_, let description): self.fail(description)
        case .turn:
            let decision = self.fluxTracker.absorb(message)
            self.interim = self.fluxTracker.transcript
            if !self.interim.isEmpty { self.onPartial?(self.interim) }
            if case .finish(let text) = decision { self.onSegment?(text); self.onEndOfSpeech?() }
```
- **URL** (`FluxTurns.swift:10-21`): `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.7&eot_timeout_ms=5000`.
- **Uplink:** int16 LE mono 16 kHz from `LinearPCMConverter` (`:66-127`).
- **Auth:** an `Authorization: Token …` header, retried once with the `["token", key]` subprotocol.
- **Server messages:** `{"type":"Connected"|"TurnInfo"|"Error", event, turn_index, transcript, words[], end_of_turn_confidence}`.
- **Timeouts:** `openTimeout 1.5`s, `timeoutIntervalForRequest 15`.
- **Failure:** `onFailure` triggers `fallBackToApple` (`SpeechInput.swift:683-702`), which replays up to `replayLimit 140` buffers (about 3 s) into Apple. Starvation (no routed audio for 5 s while the room is loud, `starvationFloor 0.08`) also falls back. If the mic produces no buffers for 1.5 s it restarts, at most 3 times per turn.

### Hop 9: End of utterance: key release, Flux end-of-turn, or the adaptive model
**Key release:** `AppState.endListening` (`:1831-1836`) moves to `.thinking`, then `SpeechInput.stop()` (`SpeechInput.swift:721-739`):
```swift
if let deepgram {
    deepgram.finish()
    scheduleFinal(after: SpeechInput.deepgramFinalGrace)
    return
}
request?.endAudio()
scheduleFinal(after: SpeechInput.appleFinalGrace)
```
- `deepgramFinalGrace 0.8`. `appleFinalGrace` comes from UserDefaults `OrionVoiceAppleFinalGrace` (default 1.2, clamped 0.4…4.0).

**Hands-free** (`AppState.swift:1629-1685`):
```swift
guard now.timeIntervalSince(handsFreeStartedAt) >= AppState.handsFreeLeadIn else { return }
if activeSTTProvider == .deepgram { return }
guard let endpoint = handsFreeEndpoint else { return }
switch endpoint.verdict(at: now) {
case .keepListening, .extending: return
case .finalize: stopHandsFree(); endListening()
}
```
- **Constants:** `handsFreeLeadIn 1.0`, `handsFreeLimit 12` (also enforced by an independent GCD deadline at `:1600`), `followUpGrace 6`, `continuationGrace 2.5`, `followUpSettle 0.45`, and a 0.2 s poll.
- **`AdaptiveEndpointModel`** (`AdaptiveEndpointModel.swift:101-122`): base `endpointingSeconds` from UserDefaults `OrionVoiceEndpointingMs` (default 900, range 100–4000). The extended window is `max(base × 1.8, resolvedUtteranceEndMs / 1000)`, where `resolvedUtteranceEndMs = max(OrionVoiceUtteranceEndMs [default 1800], endpointing + 600)`. `lowConfidenceFloor 0.55`. Continuation phrases and trailing words ("and", "um", "the", "to", …) extend the window.

**Deepgram end-of-turn:** `onEndOfSpeech` (`SpeechInput.swift:661-668`) runs `deliverFinal`, which calls `onFinal(text)` (`:826-841`).

### Hop 10: Final-transcript echo guard and cut-off preservation
**`AppState.swift:1713-1768`**:
```swift
if speechOutput.recentlySpoke(within: 4),
   SelfEcho.isEchoWhileSpeaking(heard: text, spoken: speechOutput.lastSpokenText) {
    OrionLog.write("[echo] dropped a transcript that was ORION's own reply")
    endConversation()
    return
}
...
switch (wasHandsFree, activeSTTProvider == .deepgram) {
case (true, true): looksCutOff = !AdaptiveEndpointModel.hasTerminalPunctuation(text)
case (_, false): looksCutOff = AdaptiveEndpointModel.hasContinuationCue(text) && !AdaptiveEndpointModel.hasTerminalPunctuation(text)
case (false, true): looksCutOff = false
}
```
- **Echo window:** 4 s. `isEchoWhileSpeaking` treats empty text as echo. Fragments under 3 words count as echo only if every word is in Orion's sentence, unless they contain an interrupt word (`stop, wait, hold, orion, no, cancel, shut`).
- **Cut-off:** text that looks cut off is preserved, and the ear reopens as a follow-up, at most `maxContinuationChain 2` times.
- `sendHeard` (`:1773-1775`) is just `send(text)`. The comment says the AddressGate was removed on 2026-10-08.

### Hop 11: `send()` sets the reply origin, which decides whether the reply is spoken
**`AppState.swift:1901-1903`**:
```swift
private func send(_ text: String, typed: Bool = false) {
    let origin: ReplyOrigin = typed ? .typed : .voice
    activeReplyOrigin = origin
```
**`ReplyOrigin.swift:1-6`** (the whole file):
```swift
/// Speech is a property of the initiating input, captured for each reply.
/// Timers and focus effects never acquire it from an overlapping voice turn.
enum ReplyOrigin {
    case typed, voice
    var allowsSpeech: Bool { self == .voice }
}
```
- **Short-circuits before the gateway:** `isResumeRequest` ("continue", "keep going", …, `:1909`), and `QuickAnswer.reply` for clock questions (`:1915`).
- **Prompt wrapper:** `agentRequest(userText:spoken:)` (`:2075-2113`) wraps the text in `[Orion app context …]` and, for voice, adds "your answer will be SPOKEN: one to three short sentences…".
- **Session key:** `orion-chat-<id>` or `GatewayClient.sessionKey = "orion-app-v2"`.

### Hop 12: Gateway call (the `openclaw` CLI subprocess)
**`GatewayClient.swift:120-133`**:
```swift
process.executableURL = URL(fileURLWithPath: binaryPath)
process.arguments = [
    "agent",
    "--session-key", session,
    "--message", recentOutreach() + SchedulingMemory.context(for: text) + text,
    "--json",
    "--timeout", String(Int(RunTimeouts.agentTimeout))
]
let thinking = ThinkingPolicy.level(for: text, model: model, boostedUntil: boostedUntil(session))
if let model { process.arguments?.append(contentsOf: ["--model", model]) }
process.arguments?.append(contentsOf: ["--thinking", thinking])
```
- **Binary:** `/Users/nickmadaio/.openclaw/bin/openclaw`. **argv:** `agent --session-key S --message M --json --timeout 300 [--model X] --thinking L`.
- **Environment:** PATH is extended, and only `GOG_KEYRING_PASSWORD` is passed through.
- **Header:** "talks to the OpenClaw gateway through the documented CLI rather than its WebSocket RPC … the CLI is the stable contract."
- **Timeouts** (`RunTimeouts.swift`): `agentTimeout 300`. SIGTERM at `terminateAt = 320`, SIGKILL `killGrace 5` s later. `clientReadDeadline 360`. App watchdog `watchdogCeiling 420`.
- **Progress feed:** `openclaw audit --session S --after <ms> --json` every 3 s on a separate queue (`:330-383`).
- **Health probe:** `GatewayHealthProbe.check(port:)`, with the port read from `~/.openclaw/openclaw.json` `gateway.port` (default **18789**, `:67-76`).

### Hop 13: Reply parsing and the generation gate
**`GatewayClient.swift:408-449`** (`extractReply`): looks for `result.payloads[].text` first, then `payloads`, `messages`, `outputs`, then the `text`, `reply`, `message`, `content`, `output` keys.
**`AppState.swift:1958-1981`**:
```swift
guard self.askGeneration == generation else {
    if self.pausedGeneration == generation, case .success(let reply) = result {
        self.pausedGeneration = nil
        self.pausedReplacementText = reply.text
        self.append(.system, "(The paused answer is ready — say \"continue\" to hear it.)")
    }
    return
}
...
case .success(let reply): self.deliver(reply, origin: origin)
case .failure(let error): ... self.failThinking(message)
```
- **Out:** `GatewayReply { text: String, elapsedMs: Int, thinking: String? }`.
- **Gateway down or failing:** `GatewayError` (`.missingBinary`, `.failed`, `.timedOut`, `.unparseable`, `.inFlight`) leads to `failThinking`, which shows "Thinking stalled after Ns. <msg> Last seen: …". The phase goes to `.error`, then back to `.idle` after 4 s (`:1494-1504`).
- **Agent wedged:** `recoverFromStuckThinking` fires at 420 s, or 20 s after audit reports the run finished (`wedgeGraceAfterRunEnd`), and shows "That question never came back…".

### Hop 14: The speak gate (`deliver` then `speak`)
**`AppState.swift:2115-2124`** and **`:762-772`**:
```swift
private func speak(_ text: String, origin: ReplyOrigin) {
    guard origin.allowsSpeech else {
        conversationOpen = false
        setPhase(.idle)
        statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
        return
    }
    setPhase(.speaking)
    statusLine = "Speaking…"
    speechOutput.speak(text)
}
```
- Typed replies are shown and never spoken.
- `deliverReach` (`:493-519`) forces `.voice` for Orion-initiated outreach, so that path is spoken too.

### Hop 15: `SpeechOutput`, then `TTSClient`, over the TTS daemon socket
**`TTSClient.swift:211-217`**:
```swift
try connection.send(json: [
    "op": "synth",
    "text": text,
    "mode": "stream",
    "preempt": true,
    "provider": provider
])
```
- **Socket:** `/Users/nickmadaio/.openclaw/orion-tts.sock` (`:160`). Connect timeout 5 s, read timeout 60 s.
- **Frames:** `{"event":"chunk","index":n,"path":"…wav"}` then `{"event":"done","ok":true,"chunks":n,"engine":"…"}`. An error frame is `{"ok":false,"code":"cancelled"|…,"error":…}`.
- **`provider`:** comes from UserDefaults `OrionTTSProvider` (`local` by default, or `elevenlabs`).
- **Playback** (`SpeechOutput.swift:174-198`): each chunk WAV is scheduled on an `AVAudioPlayerNode` at 24 kHz mono Float32 as soon as it arrives. The device is released `1.5`s after speech ends.
- **Daemon dead, or it fails before any audio:** `failToFallback` uses `AVSpeechSynthesizer` en-US and shows "Warm voice unavailable (…) — using the built-in voice." (`:326-338`). If it fails after partial audio, nothing is re-spoken and the notice is "Voice stream ended early".

### Hop 16: Inside the TTS daemon (engine choice and fallback)
**`/Users/nickmadaio/Desktop/ORION/scripts/orion_tts_daemon.py:1805-1813`**:
```python
def engine_for(self, requested: Optional[str]) -> tuple[Engine, str]:
    if not requested:
        return self.engine, self.default_provider
    provider = resolve_provider(requested, self.cloud is not None, True)
    if provider == PROVIDER_CLOUD and self.cloud is not None:
        return self.cloud, PROVIDER_CLOUD
    assert self.local is not None
    return self.local, PROVIDER_LOCAL
```
- **Local chain** (`:1537-1572`): `MlxWarmEngine` (Marvis 250M 8-bit, at `~/.cache/huggingface/hub/mlx-audio/...`), then `MlxGenerateFnEngine`, then `MlxCliEngine`, then `/usr/bin/say`.
- **Per-chunk fallback** (`:1862-1912`): if the cloud engine fails before producing audio, the local engine re-synthesises that chunk. If it fails after, the partial chunk is kept.
- **Text prep:** text goes through `spoken_times()` (`:507`) and `chunk_text` (`first_max 90`, `max_chars 240`).
- **Barge-in:** `preempt` cancels other jobs.
- **Install:** `scripts/orion-tts-install` writes LaunchAgent `com.nickmadaio.orion.tts.plist` with `RunAtLoad` and `KeepAlive`, so launchd restarts a dead daemon.
- **Engine reporting:** the `engine` in `done` goes to `onActiveEngine`. If ElevenLabs was configured but another engine served, the transcript says "ElevenLabs was unavailable — that reply used the X voice." (`AppState.swift:1131-1140`).

### Hop 17: Spoken barge-in while thinking or speaking
**`BargeInMonitor.swift:192-208`**: a separate on-device recogniser on the same tap. Thresholds `openLevel 0.14`, `holdLevel 0.09`, `hangover 1.0`, `windowLimit 6`, `retriggerGuard 1.5`.
**`TurnTakingState.swift:95-137`** (the policy):
```swift
static func mode(forOutputRoute route: AudioRouteKind, phase: TurnPhase) -> BargeInMode {
    if case .speaking = phase, route == .speakers { return .voiceRestricted }
    return .voiceEnabled
}
static let speakerEnergyFloor: Double = 0.22
...
case .voiceRestricted:
    guard energy >= speakerEnergyFloor else { return false }
    let compactHeard = compact(heard)
    if !compactHeard.isEmpty, compact(currentlySpoken).contains(compactHeard) { return false }
    if SelfEcho.isEchoWhileSpeaking(heard: heard, spoken: currentlySpoken) { return false }
    return !SelfEcho.interruptions(in: heard, spoken: currentlySpoken).isEmpty
```
- **Route detection:** "headset" means the default output is Bluetooth (`AppState.swift:1172-1177`). Wired headphones are not detected.
- **Action** (`AppState.swift:1194-1224`), after another echo check:
  - During `.speaking`: mark the reply `[interrupted]`, call `speechOutput.stop`, start a hands-free listen, and seed `preservedTranscript` with what was heard.
  - During `.thinking`: `pauseThinking` leaves the subprocess running and keeps the late answer for "continue".
- **Escape or a PTT press** (`bargeIn`, `:1839-1852`): stops the voice, or cancels thinking via `GatewayClient.cancelInFlight` (SIGTERM, then SIGKILL after 5 s).
- **Stop path:** `SpeechOutput.stop` calls `tts.cancelAll()`, which sends `{"op":"cancel"}` on its own connection and bumps the generation.

### Hop 18: After speech, the follow-up ear and the watchdog
**`AppState.swift:1059-1068`**:
```swift
if self.conversationOpen, self.wakeWordEnabled {
    self.setPhase(.idle)
    self.statusLine = "Go ahead…"
    DispatchQueue.main.asyncAfter(deadline: .now() + AppState.followUpSettle) { [weak self] in
        guard let self else { return }
        guard self.conversationOpen, self.wakeWordEnabled, self.phase == .idle else { return }
        self.beginListening(handsFree: true, followUp: true)
    }
    return
}
```
- **Follow-ups:** only voice-started (hands-free) turns reopen the ear. PTT sets `conversationOpen = false`.
- **Re-arm:** the wake word re-arms 0.9 s after `.idle`.
- **Speaking watchdog:** UserDefaults `OrionSpeakingStallTimeout` (default 12 s, range 4–60) and `absoluteSpeakingCeiling 300` (`VoiceTuning.swift:102-117`), handled by `recoverFromStuckSpeaking` (`:1471-1492`).

---

## Gaps and inconsistencies (verified with grep)

1. **The Deepgram endpointing settings no longer reach Deepgram.** `DeepgramConfig.endpointingMs`, `utteranceEndMs` and `model` (`DeepgramSpeech.swift:37,49,53`) are never read; their only references are their own definitions. `FluxConfig.url()` hardcodes `model=flux-general-en`, `eot_threshold 0.7` and `eot_timeout_ms 5000`.
   - On top of that, `checkHandsFree` returns early when the provider is Deepgram (`AppState.swift:1675`).
   - So with Deepgram, `OrionVoiceEndpointingMs` has no effect on hands-free turns. The comment header in `AdaptiveEndpointModel.swift:7-24` claims it was rewired; that is no longer true.
2. **Deepgram confidence is never sent.** `DeepgramStream.onConfidence` is declared (`:161`) but never called, and `handleResults`, which comments refer to, no longer exists. `lowConfidenceFloor` never triggers.
3. **The "Finalize" comment is wrong.** The comment on `DeepgramStream.finish()` mentions sending `Finalize`, but the code sends only `{"type":"CloseStream"}` (`:280`).
4. **`AudioDucking.systemVolumeFallbackEnabled` is always false.** Nothing sets it, so the system-volume duck never runs.
5. **The cloud-voice opt-in is bypassed per request.** For a request that names a provider, the daemon calls `resolve_provider(requested, cloud, True)`. That means the app's `provider: "elevenlabs"` skips the daemon's `ORION_TTS_CLOUD_VOICE` opt-in whenever a key exists.

---

## Git history (`git log --format='%h %ad %s' --date=short`)

- **WakeWord.swift:** 8cf62aa 2026-07-30 Wake word, corner summon, and a menu-bar typing surface
- **SpeechInput.swift:**
  - ff0ec35 2026-10-02 connect native chat, Flux turns…
  - 7724c43 2026-09-30
  - 0e006c0 2026-09-06 endpointing setting wired to a label
  - 3e14200 2026-09-05 a turn you can watch, music survives
  - 93e9a42 2026-08-20
  - 3a87a71 2026-08-04
  - d1955f1 2026-07-30 SIGHUP / endOfStream
  - a187595 2026-07-30 Deepgram starved by optional-chained converter
  - 51518c4, 3c60325, 8cf62aa, 2f6bc6e (all 2026-07-30)
- **DeepgramSpeech.swift:** ff0ec35 10-02, 0e006c0 09-06, 1c9c503 09-01 Keychain-backed secrets, 93e9a42 08-20, 3a87a71 08-04, d1955f1 07-30, 8cf62aa 07-30
- **FluxTurns.swift:** 3dc76c5 2026-10-02 finish flux-turns through Codex handover
- **SelfEcho.swift:** b59bdca 2026-09-30 ORION for iPhone
- **AdaptiveEndpointModel.swift:** 7724c43 09-30, 0e006c0 09-06
- **PushToTalk.swift:** 01576d2 2026-10-06 Escape/Done ends your turn; Left Option push-to-talk; 2f6bc6e 07-30
- **SpeakerVerifier.swift:** 3a87a71 2026-08-04
- **GatewayClient.swift:**
  - a139f4b 10-07 reach
  - 9e901a9 10-07 think only when it matters
  - ae41446 10-02
  - ff0ec35 10-02
  - d0eeebb 09-07 verified gateway readiness
  - 3e14200 09-05
  - 93e9a42 08-20
  - 3a87a71 08-04
  - 8f1f4e5 07-30 reply parser
  - 2f6bc6e 07-30
- **AppState.swift:**
  - e5cd0d0 10-08 remove the address gate, wait out breaths
  - 98065bf 10-08 cut-off speech is kept
  - dce48ae 10-08 morning briefing
  - 224687a 10-07
  - a139f4b 10-07
  - 18c29b9 10-07 overheard speech no longer reaches Claude
  - c2e1824 10-07
  - 01576d2 10-06
  - c254378 10-06
  - 0903801 10-02
  - e34a9c6 10-02 speak only for voice turns
  - ae41446 10-02
  - ff0ec35 10-02
  - 7724c43 09-30
  - 8cc9cbe 09-15
- **ReplyOrigin.swift:** e34a9c6 2026-10-02 speak only for voice turns
- **SpeechOutput.swift:** 7724c43 09-30, 0e006c0 09-06, 3a87a71 08-04, 8f1f4e5 07-30, 8cf62aa 07-30, 2f6bc6e 07-30
- **TTSClient.swift:** 8cf62aa 07-30, 2f6bc6e 07-30
- **VoiceProviders.swift:** 7724c43 09-30, 1c9c503 09-01, 8cf62aa 07-30
- **BargeInMonitor.swift:** 0e006c0 2026-09-06
- **TurnTakingState.swift:** 7724c43 09-30, 8cc9cbe 09-15, 0e006c0 09-06
- **AudioDucking.swift:** 3e14200 09-05, 3a87a71 08-04
- **VoiceTuning.swift:** 0e006c0 09-06, 3e14200 09-05, 93e9a42 08-20, 3a87a71 08-04
- **AppDelegate.swift:** b6d72ea 10-08, 98a810c 10-08, 27242e0 10-08, f1fe2b2 10-08, dce48ae 10-08, a139f4b 10-07, 01576d2 10-06, c254378 10-06
- **orion_tts_daemon.py:**
  - a796471 2026-09-30 TTS daemon and voice-ID installers
  - 1c9c503 09-01
  - d1955f1 07-30
  - b0b21be 07-30 choppy cloud voice
  - 73aa6a4 07-30 pin MLX to one thread
  - 8cf62aa 07-30
  - 807ee86 07-30 warm TTS daemon
- **orion_voiceid_daemon.py:** 08cfaa8 08-04, 3a87a71 08-04, 154c3fb 08-04
- **orion-tts-install:** a796471 2026-09-30

---

## Config, secrets and endpoints inventory (names only)

**UserDefaults** (domain `com.nickmadaio.orion.app`):
- `OrionSTTProvider`, `OrionTTSProvider`
- `OrionWakeWordEnabled`, `OrionWakeSensitivity`
- `OrionVoiceEndpointingMs`, `OrionVoiceUtteranceEndMs`, `OrionVoiceAppleFinalGrace`, `OrionSpeakingStallTimeout`. The plugin can set these four through `TUNABLE_SETTINGS` in `/Users/nickmadaio/Desktop/ORION/plugin/orion-control/src/catalog.ts:547-587`.
- Not voice-related but in the same files: `OrionSummonCorner`, `OrionAutoDismissSeconds`, `OrionHologramBrightness`, `OrionOrbSize`, `OrionHologramQuality`.

**Environment variables:**
- App: `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `GOG_KEYRING_PASSWORD` (passed through to the agent), `PATH`.
- TTS daemon:
  - `ORION_ENV_FILE`
  - `ORION_TTS_{MODEL, MLX_CLI, VOICE, SPEED, SAMPLE_RATE, SOCKET, TCP_PORT, TOKEN, RUNTIME_DIR, QUEUE_MAX, FIRST_CHUNK_CHARS, CHUNK_CHARS, GAP_MS, CACHE_ENTRIES, WARMUP_TEXT, WARMUP, PLAY_CMD, CHUNK_TTL_S, ENGINE, LOG, CLOUD_VOICE}`
  - `ORION_ELEVEN_{BASE_URL, VOICE_ID, MODEL, STABILITY, SIMILARITY, STYLE, SPEAKER_BOOST, OUTPUT_FORMAT, TIMEOUT_S, STALL_S, FIRST_SEGMENT_MS, SEGMENT_MS}`
- Voice-ID daemon: `ORION_VOICEID_SOCKET`, `ORION_VOICEID_PROFILE`.

**Keychain** (generic password, account `openclaw`):
- `ORION ElevenLabs` and `ORION Deepgram`, as hardcoded in `orion_tts_daemon.py:223-226`.
- The Swift app instead reads the item name from `~/.openclaw/orion-controlled/model-roles.json` → `providers.<p>.credential.ref`.

**Sockets, ports and files:**
- Unix sockets: `~/.openclaw/orion-tts.sock`, `~/.openclaw/orion-voiceid.sock`.
- Gateway port: `~/.openclaw/openclaw.json` `gateway.port`, default **18789**.
- TTS daemon TCP: `127.0.0.1:<ORION_TTS_TCP_PORT>`, off by default (0).
- Deepgram: `wss://api.deepgram.com/v2/listen`. ElevenLabs default base: `https://api.elevenlabs.io`.
- LaunchAgents: `com.nickmadaio.orion.tts`, `com.nickmadaio.orion.voiceid`.
- Voice profile: `~/.openclaw/orion-voiceid.json` (mode 0600).
- Fallback plaintext secrets file: `/Users/nickmadaio/Desktop/ORION/.env`.
- Outreach context: `~/.openclaw/orion-controlled/outreach.jsonl`.