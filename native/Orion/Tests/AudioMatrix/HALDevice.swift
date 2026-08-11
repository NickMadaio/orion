//
//  What the OUTPUT DEVICE itself is doing, asked of CoreAudio rather than of
//  AVAudioEngine.
//
//  This distinction is the whole experiment. `engine.outputNode.outputFormat`
//  reports the format the engine has negotiated for its own end of the pipe; it
//  will happily say 48 kHz stereo while the hardware underneath has been
//  reconfigured to something else, and it says nothing at all once the engine is
//  stopped. The claim under test — "a running engine pins the shared output
//  device to 24 kHz mono and drags the rest of the Mac down with it"
//  (SpeechOutput.swift:50-64) — is a claim about the DEVICE, shared by every
//  process on the machine. So it has to be asked of the device.
//
//  Read-only. Nothing here sets a property; the harness observes, it does not
//  reconfigure Nick's audio hardware.
//

import Foundation
import CoreAudio

/// A point-in-time reading of one audio device.
struct DeviceReading: Equatable {
    var deviceID: AudioDeviceID
    var name: String
    var nominalSampleRate: Double
    var outputChannels: Int
    /// Every rate the device is willing to run at. If 24000 is absent from this
    /// list, the device cannot be pinned to 24 kHz and that half of the
    /// hypothesis is dead on arrival.
    var availableSampleRates: [ClosedRange<Double>]

    var summary: String {
        "\(name) — \(Int(nominalSampleRate)) Hz, \(outputChannels) ch"
    }

    /// Two readings differ in a way that matters if the rate or the channel
    /// count moved. Device ID changes are a route change, reported separately.
    static func degraded(from before: DeviceReading, to after: DeviceReading) -> Bool {
        before.nominalSampleRate != after.nominalSampleRate
            || before.outputChannels != after.outputChannels
    }
}

enum HALDevice {

    // MARK: Reading the device

    /// The current default output device, or nil if CoreAudio will not say.
    static func defaultOutput() -> DeviceReading? {
        guard let id = defaultOutputID() else { return nil }
        return read(id)
    }

    static func defaultOutputID() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
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

    /// The current default INPUT device.
    ///
    /// Reported because of the mechanism this harness is really hunting. A
    /// Bluetooth headset has two profiles: A2DP, which is stereo and high rate
    /// but has no microphone, and HFP, which has a microphone and is mono at a
    /// low rate. Opening the mic on a headset that is also the output device
    /// forces the whole link into HFP, and the music turns to mud — the exact
    /// symptom SpeechOutput.swift:50-64 blames on AVAudioEngine. If that is what
    /// is happening, no output graph can fix it, and the answer is to keep the
    /// input on the built-in microphone.
    static func defaultInput() -> DeviceReading? {
        guard let id = defaultInputID() else { return nil }
        var reading = read(id)
        reading.outputChannels = channels(of: id, scope: kAudioObjectPropertyScopeInput)
        return reading
    }

    static func defaultInputID() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
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

    /// True when input and output are the same physical device — the precondition
    /// for the HFP collapse above.
    static func inputAndOutputShareADevice() -> Bool {
        guard let input = defaultInputID(), let output = defaultOutputID() else { return false }
        return input == output
    }

    static func read(_ id: AudioDeviceID) -> DeviceReading {
        DeviceReading(
            deviceID: id,
            name: name(of: id),
            nominalSampleRate: nominalSampleRate(of: id),
            outputChannels: outputChannels(of: id),
            availableSampleRates: availableSampleRates(of: id)
        )
    }

    // MARK: Individual properties

    static func name(of id: AudioDeviceID) -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioObjectPropertyName,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        // Unmanaged rather than CFString: the property returns a retained
        // CFStringRef, and handing CoreAudio the address of a managed reference
        // is how you get a double release. takeRetainedValue consumes the +1.
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let status = AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value)
        guard status == noErr, let value else { return "device \(id)" }
        return value.takeRetainedValue() as String
    }

    static func nominalSampleRate(of id: AudioDeviceID) -> Double {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var rate = Float64(0)
        var size = UInt32(MemoryLayout<Float64>.size)
        let status = AudioObjectGetPropertyData(id, &address, 0, nil, &size, &rate)
        return status == noErr ? Double(rate) : 0
    }

    /// Summed across every output stream, which is what "the device is mono now"
    /// would actually look like.
    static func outputChannels(of id: AudioDeviceID) -> Int {
        channels(of: id, scope: kAudioObjectPropertyScopeOutput)
    }

    static func channels(of id: AudioDeviceID, scope: AudioObjectPropertyScope) -> Int {
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

        let list = UnsafeMutableAudioBufferListPointer(
            raw.assumingMemoryBound(to: AudioBufferList.self)
        )
        return list.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    static func availableSampleRates(of id: AudioDeviceID) -> [ClosedRange<Double>] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyAvailableNominalSampleRates,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(0)
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0 else {
            return []
        }

        let count = Int(size) / MemoryLayout<AudioValueRange>.size
        var ranges = [AudioValueRange](repeating: AudioValueRange(), count: count)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &ranges) == noErr else {
            return []
        }
        return ranges.map { $0.mMinimum...$0.mMaximum }
    }

    /// Whether the device would even accept 24 kHz. Answers half the hypothesis
    /// on its own.
    static func supports(rate: Double, on id: AudioDeviceID) -> Bool {
        availableSampleRates(of: id).contains { $0.contains(rate) }
    }
}
