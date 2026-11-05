import XCTest
@testable import MouseKit

final class MouseLearnTests: XCTestCase {
    private let usb = AttachedMouse(vendorId: 5426, productId: 185, name: "Razer Basilisk V3 X HyperSpeed", transport: "USB",
                                    buttonCount: 5, keyboardInterface: true)
    private let ble = AttachedMouse(vendorId: 1678, productId: 186, name: "BSK V3 X HS", transport: "Bluetooth Low Energy", buttonCount: 5)
    private let other = AttachedMouse(vendorId: 1133, productId: 4093, name: "Logitech MX Anywhere", transport: "USB", buttonCount: 5)
    private let t0 = Date(timeIntervalSince1970: 1_000)

    // MARK: one mouse over two transports

    func testBasiliskNamesShareAFamily() {
        XCTAssertEqual(MouseFamily.key(name: "BSK V3 X HS"), MouseFamily.key(name: "Razer Basilisk V3 X HyperSpeed"))
        XCTAssertNotEqual(MouseFamily.key(name: "Logitech MX Anywhere"), MouseFamily.key(name: "BSK V3 X HS"))
    }

    func testBluetoothAloneStillOffersTheTopButton() {
        let f = DeviceRegistry.attached(ble, into: DevicesFile(), now: "t")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 113])
        XCTAssertEqual(DeviceRegistry.activeKeyButtons(in: f), [113])
    }

    func testOtherMiceDoNotGetTheTopButtonWithoutAKeyboardInterface() {
        let f = DeviceRegistry.attached(other, into: DevicesFile(), now: "t")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4])
    }

    func testUsbAndBluetoothEntriesShareButtons() {
        var f = DeviceRegistry.attached(usb, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.detached(id: usb.id, into: f, now: "t2")
        f = DeviceRegistry.attached(ble, into: f, now: "t3")
        XCTAssertEqual(f.devices.count, 2)
        XCTAssertTrue(f.devices.allSatisfy { $0.extraButtons == [3, 4, 113] })
        XCTAssertEqual(DeviceRegistry.activeKeyButtons(in: f), [113])
    }

    func testStaleConnectedFlagsClearOnLaunch() {
        var f = DeviceRegistry.attached(usb, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.allDisconnected(f)
        XCTAssertTrue(f.devices.allSatisfy { !$0.connected })
        XCTAssertEqual(DeviceRegistry.activeKeyButtons(in: f), [])
    }

    func testSetupModelMergesTheFamilyAndNamesItFully() {
        var f = DeviceRegistry.attached(usb, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.detached(id: usb.id, into: f, now: "t2")
        f = DeviceRegistry.attached(ble, into: f, now: "t3")
        let m = DeviceRegistry.setupModel(f, saved: [3, 4, 5])
        XCTAssertEqual(m.name, "Razer Basilisk V3 X HyperSpeed")
        XCTAssertEqual(m.buttons, [3, 4, 5, 113])
    }

    func testTopButtonFiresWhateverTheTransportAndPassesWhenUnboundOrInAGame() {
        let f = DeviceRegistry.attached(ble, into: DevicesFile(), now: "t")
        let active = DeviceRegistry.activeKeyButtons(in: f)
        XCTAssertEqual(KeyButtons.press(keyCode: 105, hasModifiers: false, active: active), 113)
        let bound = BindingsFile().settingDefault(113, .system("missionControl"))
        XCTAssertEqual(MouseResolver.resolve(button: 113, bundleId: "a.b", isGame: false, bindings: bound), .system("missionControl"))
        XCTAssertNil(MouseResolver.resolve(button: 113, bundleId: "a.b", isGame: false, bindings: BindingsFile()))
        XCTAssertNil(MouseResolver.resolve(button: 113, bundleId: "a.g", isGame: true, bindings: bound))
        XCTAssertNil(MouseResolver.resolve(button: 113, bundleId: "a.b", isGame: false, bindings: bound, gateOn: false))
    }

    // MARK: learning

    func testInputsFromKeysAndButtons() {
        XCTAssertEqual(LearnInput.from(keyCode: 105, hasModifiers: false), .button(113))
        XCTAssertEqual(LearnInput.from(keyCode: 90, hasModifiers: false), .button(120))
        XCTAssertEqual(LearnInput.from(keyCode: 53, hasModifiers: false), .cancel)
        XCTAssertNil(LearnInput.from(keyCode: 0, hasModifiers: false))        // a typing key
        XCTAssertNil(LearnInput.from(keyCode: 105, hasModifiers: true))       // a chord
        XCTAssertEqual(LearnInput.fromMouse(button: 5), .button(5))
        XCTAssertNil(LearnInput.fromMouse(button: 2))
        XCTAssertNil(LearnInput.fromMouse(button: 40))
    }

    func testArmCaptureAndDisarm() {
        var l = ButtonLearner()
        XCTAssertEqual(l.arm(now: t0, gameInFront: false), .listening)
        XCTAssertTrue(l.isListening)
        XCTAssertEqual(l.feed(.button(113), now: t0 + 3, gameInFront: false), .captured(113))
        XCTAssertFalse(l.isListening)
        XCTAssertEqual(l.feed(.button(5), now: t0 + 4, gameInFront: false), .ignored)
    }

    func testMouseButtonIsCaptured() {
        var l = ButtonLearner(); _ = l.arm(now: t0, gameInFront: false)
        XCTAssertEqual(l.feed(.button(7), now: t0 + 1, gameInFront: false), .captured(7))
    }

    func testTimesOutAfterTenSeconds() {
        var l = ButtonLearner(); _ = l.arm(now: t0, gameInFront: false)
        XCTAssertFalse(l.expire(now: t0 + 9))
        XCTAssertTrue(l.expire(now: t0 + 10.5))
        XCTAssertFalse(l.isListening)
        var late = ButtonLearner(); _ = late.arm(now: t0, gameInFront: false)
        XCTAssertEqual(late.feed(.button(113), now: t0 + 11, gameInFront: false), .timedOut)
    }

    func testEscapeCancels() {
        var l = ButtonLearner(); _ = l.arm(now: t0, gameInFront: false)
        XCTAssertEqual(l.feed(.cancel, now: t0 + 1, gameInFront: false), .cancelled)
        XCTAssertFalse(l.isListening)
    }

    func testNeverListensWhileAGameIsInFront() {
        var l = ButtonLearner()
        XCTAssertEqual(l.arm(now: t0, gameInFront: true), .refusedGame)
        XCTAssertFalse(l.isListening)
        _ = l.arm(now: t0, gameInFront: false)
        XCTAssertEqual(l.feed(.button(113), now: t0 + 1, gameInFront: true), .refusedGame)
        XCTAssertFalse(l.isListening)
    }

    func testLearnedButtonIsSavedForTheMouseAndSurvivesReconnect() {
        var f = DeviceRegistry.attached(other, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.learned(button: 114, into: f)
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 114])
        XCTAssertEqual(DeviceRegistry.activeKeyButtons(in: f), [114])
        f = DeviceRegistry.detached(id: other.id, into: f, now: "t2")
        f = DeviceRegistry.attached(other, into: f, now: "t3")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 114])
        XCTAssertEqual(DeviceRegistry.setupModel(f, saved: []).buttons, [3, 4, 114])
    }

    func testLearnedMouseButtonBeyondTheDescriptor() {
        var f = DeviceRegistry.attached(other, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.learned(button: 9, into: f)
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 9])
    }

    func testLearnedButtonReachesTheWholeFamily() {
        var f = DeviceRegistry.attached(usb, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.attached(ble, into: f, now: "t2")
        f = DeviceRegistry.learned(button: 115, into: f)
        XCTAssertTrue(f.devices.allSatisfy { $0.extraButtons.contains(115) })
    }

    func testDoneKeepsBindingsForLearnedButtons() {
        var f = DeviceRegistry.attached(other, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.learned(button: 114, into: f)
        let b = BindingsFile().settingDefault(114, .system("showDesktop"))
        let buttons = DeviceRegistry.setupModel(f, saved: b.default.keys.compactMap(Int.init)).buttons
        let after = MouseSetupPlan.finalized(b, buttons: buttons)
        XCTAssertEqual(after.default["114"], .system("showDesktop"))
        XCTAssertTrue(MouseSetupPlan.confirmation(after, buttons: buttons).contains("f14"))
    }

    func testWords() {
        XCTAssertEqual(LearnWords.captured(113, buttonCount: 5), "Got it: Button 6 (F13). Pick what it does below.")
        XCTAssertEqual(LearnWords.captured(7, buttonCount: 5), "Got it: Button 8. Pick what it does below.")
        XCTAssertTrue(LearnWords.armed.contains("10 seconds"))
        XCTAssertTrue(LearnWords.timedOut.lowercased().contains("didn't"))
    }

    func testLearnOpenOutreachLine() {
        XCTAssertTrue(OutreachTail.isLearnOpen(#"{"kind":"mouse","event":"learn-open","at":"x"}"#))
        XCTAssertFalse(OutreachTail.isSetupOpen(#"{"kind":"mouse","event":"learn-open","at":"x"}"#))
        XCTAssertFalse(OutreachTail.isLearnOpen(#"{"kind":"mouse","event":"setup-open"}"#))
    }
}
