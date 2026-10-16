import Foundation
import CoreAudio

/*
 Keep the Bluetooth headset in its high-quality profile by never asking it for
 audio at all.

 MEASURED tonight, not reasoned. `system_profiler SPAudioDataType` on this Mac:

     Sony WH-1000XM4   Default INPUT : Yes   1 ch @ 16000 Hz   Bluetooth
     Sony WH-1000XM4   Default OUTPUT: Yes   2 ch @ 44100 Hz   Bluetooth
     MacBook Pro Microphone          :       1 ch @ 44100 Hz   Built-in

 and with a live `AVAudioEngine` tap (see Tests/AudioMatrix), the moment ANY
 process opens capture on the default input, the OUTPUT device -- the SAME
 physical headset -- collapses from 44100 Hz/2ch to 16000 Hz/1ch within about a
 second, and it does not recover on its own once capture stops. That is
 Apple's documented A2DP -> HFP handoff <https://support.apple.com/en-us/102217>:
 opening a Bluetooth headset's microphone switches the whole link out of
 high-quality listening and playback quality goes with it. This is "the second
 I start talking to Orion the audio is terrible" -- it is the profile switch,
 not a level Orion could duck its way out of.

 The fix is route policy: never let Orion's microphone session touch that
 device. Capture from the built-in microphone instead, which is always
 present on a MacBook and never forces the headset out of A2DP.

 Two mechanisms were tried and MEASURED to fail before the one below, and it
 is worth recording why so nobody re-tries them:

   1. `AVAudioIONode.auAudioUnit.deviceID` -- get-only in this SDK. Cannot be
      set at all; the compiler refuses it.
   2. `AudioUnitSetProperty(..., kAudioOutputUnitProperty_CurrentDevice, ...)`
      directly on `engine.inputNode`'s underlying `AudioUnit`. This DOES take
      effect immediately -- read back right after setting it, it reports the
      device that was just requested -- but a running `AVAudioEngine`
      re-asserts the system default onto its own input unit within about a
      second of `start()`, silently undoing it. Measured: the override held
      for the first sampled instant and had reverted by the next one, with the
      output device degraded in between exactly as if no override had ever
      been applied.

 What actually holds, measured for a full multi-second window with the engine
 running the entire time: change the SYSTEM DEFAULT input device
 (`kAudioHardwarePropertyDefaultInputDevice`) to the built-in microphone
 BEFORE the engine starts. Once the built-in mic genuinely IS the default,
 there is nothing for `AVAudioEngine` to "correct" it back to. The Bluetooth
 link is never asked for its microphone side at all, so it never leaves A2DP,
 and the measured output device held 44100 Hz / 2 ch for the entire run.

 The cost, stated rather than hidden: this is a MACHINE-WIDE default, not a
 setting private to Orion's own capture session. While the lease below is
 held, any OTHER app that opens a FRESH input stream during that window would
 also get the built-in mic rather than the headset. An app already mid-call
 (already holding its own open stream) is unaffected -- this only changes what
 a NEW `AVAudioEngine`/`AudioQueue` open resolves to. There is no per-process
 input-device override that survives `AVAudioEngine`'s own re-assertion, so
 this machine-wide trade is deliberate, not an oversight.

 A SECOND thing was measured, and it changes when this lease is allowed to
 give the route back:

 Once `SpeechInput`'s single `AVAudioEngine` has had its `.inputNode` touched
 even once, that node keeps tracking the system default input for as long as
 the engine OBJECT exists -- stopped or not. Restoring the default back to the
 Bluetooth headset while that engine is merely stopped (its permanent state
 between utterances; it is never deallocated) re-triggers the SAME A2DP -> HFP
 collapse this lease exists to prevent, measured to persist for as long as the
 engine stays alive with nothing further touching the input. Only fully
 DEALLOCATING the engine before restoring let the output recover and stay
 recovered -- see PHASE_AUDIO_COEXISTENCE.md for the four-way comparison that
 found this. `SpeechInput` cannot cheaply deallocate and rebuild its engine
 between every utterance -- wake-word monitoring depends on it staying up --
 so restoring after every utterance would spend most of this fix's benefit
 undoing itself a moment later.

 The policy this measurement forces: once applied, the override is held for
 the REST OF ORION'S RUN, not released after each utterance. It is only handed
 back by `releaseAtQuit()`, called from `SpeechInput.abort()` when the app is
 actually quitting -- the engine is torn down and the process exits shortly
 after, so any final re-negotiation blip has nothing left running to sustain
 it. The honest cost: while Orion has listened at least once this run, any
 OTHER app that relies on "whatever the system default input is" gets the
 built-in mic instead of the headset until Orion quits. An app that lets Nick
 pick its input device explicitly (most conferencing apps do) is unaffected.
*/

enum AudioRoute {

    // MARK: Device introspection

    static func defaultOutputID() -> AudioDeviceID? {
        deviceID(for: kAudioHardwarePropertyDefaultOutputDevice)
    }

    static func defaultInputID() -> AudioDeviceID? {
        deviceID(for: kAudioHardwarePropertyDefaultInputDevice)
    }

    private static func deviceID(for selector: AudioObjectPropertySelector) -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id
        )
        return status == noErr && id != 0 ? id : nil
    }

    /// Changes the MACHINE-WIDE default input device. See the file header for
    /// why this, rather than a per-process override, is the mechanism that
    /// actually holds against `AVAudioEngine`.
    @discardableResult
    static func setDefaultInput(_ id: AudioDeviceID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var mutableID = id
        let status = AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil,
            UInt32(MemoryLayout<AudioDeviceID>.size), &mutableID
        )
        return status == noErr
    }

    static func transportType(of id: AudioDeviceID) -> UInt32 {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyTransportType,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        _ = AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value)
        return value
    }

    static func isBluetooth(_ id: AudioDeviceID) -> Bool {
        let transport = transportType(of: id)
        return transport == kAudioDeviceTransportTypeBluetooth
            || transport == kAudioDeviceTransportTypeBluetoothLE
    }

    // MARK: Output route (awareness `audio.mac`, contract C1)

    enum OutputKind: String, Equatable {
        case bluetooth, wired, airplay, speakers
    }

    /// Where sound goes now, for `focus-activity.json` `audio`.
    struct OutputRoute: Equatable {
        var kind: OutputKind
        var device: String
        /// Headphones in his ears: Bluetooth and wired. AirPlay is a speaker.
        var headphones: Bool { kind == .bluetooth || kind == .wired }
    }

    /// The headphone-jack data source ('hdpn') of the built-in output.
    static let headphoneDataSource: UInt32 = 0x6864706E

    /// Pure: transport and data source (and name, for USB) to a route.
    static func classifyOutput(transport: UInt32, dataSource: UInt32?, name: String) -> OutputKind {
        switch transport {
        case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return .bluetooth
        case kAudioDeviceTransportTypeAirPlay: return .airplay
        case kAudioDeviceTransportTypeBuiltIn: return dataSource == headphoneDataSource ? .wired : .speakers
        case kAudioDeviceTransportTypeUSB: return name.lowercased().contains("headphone") ? .wired : .speakers
        default: return .speakers
        }
    }

    static func outputRoute() -> OutputRoute? {
        guard let id = defaultOutputID() else { return nil }
        let name = deviceName(of: id)
        let kind = classifyOutput(transport: transportType(of: id), dataSource: outputDataSource(of: id), name: name)
        return OutputRoute(kind: kind, device: name)
    }

    private static func outputDataSource(of id: AudioDeviceID) -> UInt32? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDataSource,
            mScope: kAudioObjectPropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value)
        return status == noErr ? value : nil
    }

    static func deviceName(of id: AudioDeviceID) -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioObjectPropertyName,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var name: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &name) == noErr, let name else { return "" }
        return name.takeRetainedValue() as String
    }

    static func inputChannels(of id: AudioDeviceID) -> Int {
        channels(of: id, scope: kAudioObjectPropertyScopeInput)
    }

    private static func channels(of id: AudioDeviceID, scope: AudioObjectPropertyScope) -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(0)
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0 else {
            return 0
        }
        let raw = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else { return 0 }
        let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        return list.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    /// The first built-in device with an input -- the MacBook's own
    /// microphone, whatever this particular Mac model calls it. Always
    /// present; that is the whole reason it is the fallback.
    static func builtInInputDeviceID() -> AudioDeviceID? {
        allDeviceIDs().first {
            transportType(of: $0) == kAudioDeviceTransportTypeBuiltIn && inputChannels(of: $0) > 0
        }
    }

    private static func allDeviceIDs() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(0)
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size
        ) == noErr else { return [] }
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids
        ) == noErr else { return [] }
        return ids
    }

    /// True exactly when opening the microphone right now would force the
    /// shared Bluetooth link into HFP: output is Bluetooth AND the input that
    /// would be opened is also Bluetooth. Checks the actual precondition
    /// (both sides Bluetooth) rather than assuming input and output are
    /// literally the same device object, since CoreAudio exposes a headset's
    /// mic and speaker sides as two separate `AudioDeviceID`s.
    static func openingTheMicWouldDegradeOutput() -> Bool {
        guard let output = defaultOutputID(), isBluetooth(output) else { return false }
        guard let input = defaultInputID(), isBluetooth(input) else { return false }
        return true
    }
}

// MARK: - The lease

/// Holds the system default input pinned to the built-in microphone for as
/// long as Orion's own microphone session is open, so opening the mic never
/// asks the Bluetooth headset for anything and its output never degrades.
///
/// Reference counted: push-to-talk and wake-word monitoring share ONE
/// `AVAudioEngine` in `SpeechInput` and can overlap (a press during an
/// already-open monitoring session must not release the route out from under
/// the monitoring session when the press ends). `begin()`/`end()` must be
/// called in exactly the same pairing `SpeechInput` already uses to start and
/// truly stop that shared engine.
final class AudioInputRouteLease {

    private var holders = 0
    private var priorDefaultInput: AudioDeviceID?
    private let queue = DispatchQueue(label: "com.nickmadaio.orion.audio-route")

    init() {
        recoverFromCrash()
    }

    /// Call right before the shared microphone engine starts.
    func begin() {
        queue.sync {
            holders += 1
            guard holders == 1 else { return }
            guard AudioRoute.openingTheMicWouldDegradeOutput() else { return }
            guard let builtIn = AudioRoute.builtInInputDeviceID() else {
                OrionLog.write("[audio-route] output is Bluetooth but no built-in microphone "
                    + "was found -- leaving input alone, music will degrade while listening")
                return
            }
            let prior = AudioRoute.defaultInputID()
            guard AudioRoute.setDefaultInput(builtIn) else {
                OrionLog.write("[audio-route] could not switch default input to the built-in microphone")
                return
            }
            priorDefaultInput = prior
            AudioRouteState.persist(priorInput: prior, appliedInput: builtIn)
            let priorDescription = prior.map(String.init) ?? "unknown"
            OrionLog.write("[audio-route] output is Bluetooth -- switched default input from "
                + "\(priorDescription) to the built-in microphone (\(builtIn)) for this session")
        }
    }

    /// Call once the shared microphone engine has genuinely stopped -- not
    /// merely between utterances while the wake word still holds it open.
    ///
    /// Deliberately does NOT restore the route. See the file header: doing
    /// that here, with the engine merely stopped rather than deallocated, was
    /// measured to re-trigger the same degradation this lease exists to
    /// prevent. This just retires the holder count; the built-in mic stays
    /// the default until `releaseAtQuit()`.
    func end() {
        queue.sync {
            holders = max(0, holders - 1)
        }
    }

    /// A press that started the engine but failed before anything actually
    /// opened (permission denied, hardware error) never really took the
    /// microphone. Same accounting as `end()`, named for what the caller is
    /// actually telling us.
    func cancel() { end() }

    /// Call once, when Orion is actually quitting -- `SpeechInput.abort()`.
    /// This is the only path allowed to restore the machine-wide default,
    /// because it is the only point where the engine that would otherwise
    /// re-degrade the output is about to go away with it.
    func releaseAtQuit() {
        let prior: AudioDeviceID? = queue.sync {
            defer { priorDefaultInput = nil }
            return priorDefaultInput
        }
        guard let prior else { return }
        restore(to: prior)
    }

    private func restore(to prior: AudioDeviceID) {
        // Someone else may have changed the input while we held it -- a
        // device plugged in, System Settings, another app choosing its own
        // input. Their choice wins; stomping over it to put back what WE set
        // is the exact mistake the old `AudioDucking.restore()` made with
        // system volume.
        guard let current = AudioRoute.defaultInputID() else {
            AudioRouteState.clear()
            return
        }
        guard current == AudioRoute.builtInInputDeviceID() else {
            OrionLog.write("[audio-route] default input changed to \(current) while Orion held "
                + "it -- leaving it, not restoring \(prior)")
            AudioRouteState.clear()
            return
        }
        _ = AudioRoute.setDefaultInput(prior)
        OrionLog.write("[audio-route] restored default input to \(prior) at quit")
        AudioRouteState.clear()
    }

    /// Orion did not exit cleanly last time and may have left the system
    /// default input pinned to the built-in mic with nothing left running to
    /// explain why. Checked once, at construction (app launch): put it back
    /// under the same "only if nothing else changed it since" rule, or clear
    /// the stale marker if something already did.
    private func recoverFromCrash() {
        guard let state = AudioRouteState.load() else { return }
        OrionLog.write("[audio-route] found a route change left over from a run that did not "
            + "exit cleanly -- checking whether it is safe to undo")
        if AudioRoute.defaultInputID() == state.appliedInput {
            _ = AudioRoute.setDefaultInput(state.priorInput)
            OrionLog.write("[audio-route] recovered: restored default input to \(state.priorInput)")
        } else {
            OrionLog.write("[audio-route] default input already changed since then -- leaving it, "
                + "only clearing the stale marker")
        }
        AudioRouteState.clear()
    }
}

/// Crash-safety marker for the input-route lease, persisted to disk because
/// the lease's own in-memory state dies with the process. If Orion is killed
/// while holding it, this is what lets the NEXT launch put things back
/// instead of leaving the built-in mic pinned as the system default forever.
private enum AudioRouteState {
    struct State: Codable {
        let priorInput: AudioDeviceID
        let appliedInput: AudioDeviceID
    }

    private static let path: String = {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".openclaw")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return (dir as NSString).appendingPathComponent("orion-audio-route-state.json")
    }()

    static func persist(priorInput: AudioDeviceID?, appliedInput: AudioDeviceID) {
        guard let priorInput else { return }
        guard let data = try? JSONEncoder().encode(
            State(priorInput: priorInput, appliedInput: appliedInput)
        ) else { return }
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
