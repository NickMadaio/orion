import XCTest
import CoreAudio
@testable import Orion

final class AudioRouteTests: XCTestCase {
    private func kind(_ transport: UInt32, _ source: UInt32? = nil, _ name: String = "") -> AudioRoute.OutputKind {
        AudioRoute.classifyOutput(transport: transport, dataSource: source, name: name)
    }

    func testBluetoothAndBluetoothLEAreBluetooth() {
        XCTAssertEqual(kind(kAudioDeviceTransportTypeBluetooth), .bluetooth)
        XCTAssertEqual(kind(kAudioDeviceTransportTypeBluetoothLE), .bluetooth)
    }

    func testBuiltInWithHeadphoneSourceIsWiredElseSpeakers() {
        XCTAssertEqual(kind(kAudioDeviceTransportTypeBuiltIn, AudioRoute.headphoneDataSource), .wired)
        XCTAssertEqual(kind(kAudioDeviceTransportTypeBuiltIn, 0x69737370 /* 'ispk' */), .speakers)
        XCTAssertEqual(kind(kAudioDeviceTransportTypeBuiltIn, nil), .speakers)
    }

    func testHeadphoneDataSourceIsTheFourCharCodeHdpn() {
        XCTAssertEqual(AudioRoute.headphoneDataSource, UInt32(bigEndian: 0x68647067) == 0 ? 0 : 0x6864706E)
        XCTAssertEqual(String(format: "%c%c%c%c", 0x68, 0x64, 0x70, 0x6E), "hdpn")
    }

    func testAirPlayIsASpeakerNotHeadphones() {
        XCTAssertEqual(kind(kAudioDeviceTransportTypeAirPlay), .airplay)
        XCTAssertFalse(AudioRoute.OutputRoute(kind: .airplay, device: "HomePod").headphones)
    }

    func testUSBNeedsHeadphoneInItsNameAndAnythingElseIsSpeakers() {
        XCTAssertEqual(kind(kAudioDeviceTransportTypeUSB, nil, "USB Headphones"), .wired)
        XCTAssertEqual(kind(kAudioDeviceTransportTypeUSB, nil, "Studio Display Speakers"), .speakers)
        XCTAssertEqual(kind(kAudioDeviceTransportTypeHDMI), .speakers)
        XCTAssertEqual(kind(0), .speakers)
    }

    func testHeadphonesFlag() {
        XCTAssertTrue(AudioRoute.OutputRoute(kind: .bluetooth, device: "AirPods Pro").headphones)
        XCTAssertTrue(AudioRoute.OutputRoute(kind: .wired, device: "Headphones").headphones)
        XCTAssertFalse(AudioRoute.OutputRoute(kind: .speakers, device: "MacBook Pro Speakers").headphones)
    }

    func testFocusActivityRecordCarriesLockAudioAndNullIdle() {
        let route = AudioRoute.OutputRoute(kind: .bluetooth, device: "AirPods Pro")
        let o = FocusActivityRecord.object(at: Date(timeIntervalSince1970: 0), app: "Claude", title: "t", bundleID: "com.x", idle: nil,
                                           locked: true, displayAsleep: false, enforcementAllowed: false, workApp: "Claude", route: route)
        XCTAssertTrue(o["idleSeconds"] is NSNull)
        XCTAssertEqual(o["idleValid"] as? Bool, false)
        XCTAssertEqual(o["locked"] as? Bool, true)
        XCTAssertEqual(o["displayAsleep"] as? Bool, false)
        let audio = o["audio"] as? [String: Any]
        XCTAssertEqual(audio?["route"] as? String, "bluetooth")
        XCTAssertEqual(audio?["device"] as? String, "AirPods Pro")
        XCTAssertEqual(audio?["headphones"] as? Bool, true)
        let valid = FocusActivityRecord.object(at: Date(), app: "a", title: "", bundleID: nil, idle: 12, locked: false, displayAsleep: false,
                                               enforcementAllowed: true, workApp: "", route: nil)
        XCTAssertEqual(valid["idleSeconds"] as? Double, 12)
        XCTAssertTrue(((valid["audio"] as? [String: Any])?["headphones"]) is NSNull)
    }
}
