import XCTest
@testable import MouseKit

/// A mouse button that the mouse's own memory turned into a keyboard key (Razer Synapse: sensitivity button -> F13).
final class KeyButtonTests: XCTestCase {
    private let dongle = AttachedMouse(vendorId: 5426, productId: 185, name: "Razer Basilisk V3 X HyperSpeed", transport: "USB",
                                       buttonCount: 6, keyboardInterface: true)
    private let plain = AttachedMouse(vendorId: 5426, productId: 185, name: "Razer Basilisk V3 X HyperSpeed", transport: "USB", buttonCount: 6)

    func testKeyCodesMapToVirtualButtonsF13ToF20() {
        let pairs: [(Int64, Int)] = [(105, 113), (107, 114), (113, 115), (106, 116), (64, 117), (79, 118), (80, 119), (90, 120)]
        for (code, id) in pairs { XCTAssertEqual(KeyButtons.id(forKeyCode: code), id, "keycode \(code)") }
        XCTAssertNil(KeyButtons.id(forKeyCode: 0))      // a
        XCTAssertNil(KeyButtons.id(forKeyCode: 96))     // F5
        XCTAssertNil(KeyButtons.id(forKeyCode: 111))    // F12
    }

    func testIdsAreKeyButtonsAndMouseButtonsAreNot() {
        XCTAssertTrue(KeyButtons.isKeyButton(113)); XCTAssertTrue(KeyButtons.isKeyButton(120))
        XCTAssertFalse(KeyButtons.isKeyButton(5)); XCTAssertFalse(KeyButtons.isKeyButton(112)); XCTAssertFalse(KeyButtons.isKeyButton(121))
        XCTAssertEqual(KeyButtons.defaultId, 113)
    }

    func testTitles() {
        XCTAssertEqual(MouseSetupPlan.title(113), "Top button")
        XCTAssertEqual(MouseSetupPlan.title(114), "Key button F14")
        XCTAssertEqual(MouseSetupPlan.title(5), "Button 6")
    }

    func testSuggestionsNeverCoverAKeyButton() {
        XCTAssertNil(MouseSetupPlan.suggested(113))
    }

    func testConfirmationNamesTheTopButton() {
        let b = BindingsFile().settingDefault(113, .system("missionControl"))
        XCTAssertEqual(MouseSetupPlan.confirmation(b, buttons: [113]), "Set. Top: Mission Control.")
    }

    // MARK: devices

    func testNewMouseWithAKeyboardInterfaceListsTheTopButton() {
        let f = DeviceRegistry.attached(dongle, into: DevicesFile(), now: "t")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 5, 113])
    }

    func testMouseWithoutAKeyboardInterfaceDoesNot() {
        let f = DeviceRegistry.attached(plain, into: DevicesFile(), now: "t")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 5])
    }

    func testReconnectAddsTheTopButtonToADeviceSavedBefore() {
        let old = DeviceRegistry.attached(plain, into: DevicesFile(), now: "t1")
        let f = DeviceRegistry.attached(dongle, into: old, now: "t2")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 5, 113])
    }

    func testButtonCountChangeFollowsTheDescriptorBothWays() {
        var f = DeviceRegistry.attached(dongle, into: DevicesFile(), now: "t1")
        var fewer = dongle; fewer.buttonCount = 5
        f = DeviceRegistry.attached(fewer, into: f, now: "t2")
        XCTAssertEqual(f.devices.first?.buttonCount, 5)
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 113])
        var more = dongle; more.buttonCount = 8
        f = DeviceRegistry.attached(more, into: f, now: "t3")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 5, 6, 7, 113])
    }

    func testReconnectKeepsAButtonOnlyObservedPastTheDescriptor() {
        var f = DeviceRegistry.attached(plain, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.observed(button: 9, into: f)
        f = DeviceRegistry.attached(plain, into: f, now: "t2")
        XCTAssertEqual(f.devices.first?.extraButtons, [3, 4, 5, 9])
    }

    func testObservingAKeyPressDoesNotWidenEveryMouse() {
        let f = DeviceRegistry.attached(plain, into: DevicesFile(), now: "t")
        XCTAssertEqual(DeviceRegistry.observed(button: 113, into: f), f)
    }

    func testActiveKeyButtonsComeFromConnectedDevicesOnly() {
        var f = DeviceRegistry.attached(dongle, into: DevicesFile(), now: "t")
        XCTAssertEqual(DeviceRegistry.activeKeyButtons(in: f), [113])
        f = DeviceRegistry.detached(id: "5426:185", into: f, now: "t2")
        XCTAssertEqual(DeviceRegistry.activeKeyButtons(in: f), [])
    }

    // MARK: resolving and gating

    func testTopButtonResolvesAndRespectsGameGateAndMaster() {
        let b = BindingsFile().settingDefault(113, .orion("type"))
        XCTAssertEqual(MouseResolver.resolve(button: 113, bundleId: "a.b", isGame: false, bindings: b), .orion("type"))
        XCTAssertNil(MouseResolver.resolve(button: 113, bundleId: "a.game", isGame: true, bindings: b))
        XCTAssertNil(MouseResolver.resolve(button: 113, bundleId: "a.b", isGame: false, bindings: b, gateOn: false))
        var off = b; off.enabled = false
        XCTAssertNil(MouseResolver.resolve(button: 113, bundleId: "a.b", isGame: false, bindings: off))
    }

    func testBindingRoundTripsThroughJSON() throws {
        let b = BindingsFile().settingDefault(113, .system("missionControl"))
        let back = MouseCodec.decodeBindings(try MouseCodec.encode(b))
        XCTAssertEqual(back.default["113"], .system("missionControl"))
    }

    // MARK: the tap's decision

    func testOnlyAPlainActiveKeyIsAButtonPress() {
        let active: Set<Int> = [113]
        XCTAssertEqual(KeyButtons.press(keyCode: 105, hasModifiers: false, active: active), 113)
        XCTAssertNil(KeyButtons.press(keyCode: 105, hasModifiers: true, active: active))     // shift+F13 is a keyboard chord
        XCTAssertNil(KeyButtons.press(keyCode: 105, hasModifiers: false, active: []))        // no mouse advertises it: a real keyboard
        XCTAssertNil(KeyButtons.press(keyCode: 107, hasModifiers: false, active: active))    // F14 is not advertised
        XCTAssertNil(KeyButtons.press(keyCode: 0, hasModifiers: false, active: active))
    }

    func testSwallowTrackerCanBeAskedAboutAHeldKey() {
        var t = SwallowTracker()
        t.swallowDown(113)
        XCTAssertTrue(t.isSwallowed(113))      // a key repeat while held
        XCTAssertTrue(t.shouldSwallowUp(113))
        XCTAssertFalse(t.isSwallowed(113))
    }
}
