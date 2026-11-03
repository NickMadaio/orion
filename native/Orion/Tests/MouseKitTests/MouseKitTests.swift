import XCTest
@testable import MouseKit

final class MouseKitTests: XCTestCase {
    private func bindings() -> BindingsFile {
        BindingsFile()
            .settingDefault(3, .system("stageManager"))
            .settingDefault(4, .shortcut("cmd+shift+4"))
            .settingApp("com.apple.Safari", button: 3, .system("missionControl"))
    }

    // MARK: lookup order

    func testDefaultResolvesOnDesktop() {
        XCTAssertEqual(MouseResolver.resolve(button: 3, bundleId: "com.apple.finder", isGame: false, bindings: bindings()), .system("stageManager"))
    }
    func testAppOverrideBeatsDefault() {
        XCTAssertEqual(MouseResolver.resolve(button: 3, bundleId: "com.apple.Safari", isGame: false, bindings: bindings()), .system("missionControl"))
    }
    func testOverrideOnlyCoversItsButton() {
        XCTAssertEqual(MouseResolver.resolve(button: 4, bundleId: "com.apple.Safari", isGame: false, bindings: bindings()), .shortcut("cmd+shift+4"))
    }
    func testGamePassesThrough() {
        XCTAssertNil(MouseResolver.resolve(button: 3, bundleId: "x.game", isGame: true, bindings: bindings()))
    }
    func testGameStillMappedWhenAutoOff() {
        var b = bindings(); b.autoPassthroughGames = false
        XCTAssertNotNil(MouseResolver.resolve(button: 3, bundleId: "x.game", isGame: true, bindings: b))
    }
    func testPassthroughAppListWinsOverOverride() {
        let b = bindings().settingApp("com.mojang.minecraftlauncher", button: 3, .system("showDesktop")).togglingPassthrough("com.mojang.minecraftlauncher")
        XCTAssertNil(MouseResolver.resolve(button: 3, bundleId: "com.mojang.minecraftlauncher", isGame: false, bindings: b))
    }
    func testUnboundAndBuiltinButtonsPass() {
        XCTAssertNil(MouseResolver.resolve(button: 7, bundleId: nil, isGame: false, bindings: bindings()))
        XCTAssertNil(MouseResolver.resolve(button: 2, bundleId: nil, isGame: false, bindings: bindings()))
    }
    func testDisabledPassesEverything() {
        var b = bindings(); b.enabled = false
        XCTAssertNil(MouseResolver.resolve(button: 3, bundleId: nil, isGame: false, bindings: b))
    }
    func testExplicitPassthroughActionPasses() {
        let b = bindings().settingApp("com.apple.Safari", button: 3, .passthrough)
        XCTAssertNil(MouseResolver.resolve(button: 3, bundleId: "com.apple.Safari", isGame: false, bindings: b))
    }

    // MARK: game classification

    func testGameCategory() {
        XCTAssertTrue(GameClassifier.isGame(.init(bundleId: "a.b", category: "public.app-category.action-games")))
    }
    func testMinecraftJava() {
        XCTAssertTrue(GameClassifier.isGame(.init(bundleId: "net.java", name: "java", isJavaProcess: true, windowTitle: "Minecraft 1.21")))
    }
    func testJavaIdeIsNotGame() {
        XCTAssertFalse(GameClassifier.isGame(.init(bundleId: "net.java", name: "java", isJavaProcess: true, windowTitle: "IntelliJ")))
    }
    func testFullscreenUnknownIsGame() {
        XCTAssertTrue(GameClassifier.isGame(.init(bundleId: "com.some.engine", isFullscreen: true)))
    }
    func testFullscreenSafariAndCategorisedAreNot() {
        XCTAssertFalse(GameClassifier.isGame(.init(bundleId: "com.apple.Safari", isFullscreen: true)))
        XCTAssertFalse(GameClassifier.isGame(.init(bundleId: "a.b", category: "public.app-category.productivity", isFullscreen: true)))
    }
    func testVSCodeWindowedIsNot() {
        XCTAssertFalse(GameClassifier.isGame(.init(bundleId: "com.microsoft.VSCode")))
    }
    func testMinecraftLauncherKnown() {
        XCTAssertTrue(GameClassifier.isGame(.init(bundleId: "com.mojang.minecraftlauncher")))
    }

    // MARK: contract encode/decode

    func testRoundTrip() throws {
        var b = bindings(); b.passthroughApps = ["com.mojang.minecraftlauncher"]
        let back = MouseCodec.decodeBindings(try MouseCodec.encode(b))
        XCTAssertEqual(back, b)
    }
    func testDecodesContractLiteral() {
        let json = #"{"version":1,"enabled":true,"default":{"3":{"kind":"system","name":"stageManager"},"4":{"kind":"orion","command":"summon"}},"apps":{"com.apple.Safari":{"3":{"kind":"openApp","bundleId":"com.apple.Notes"}}},"passthroughApps":["a"],"autoPassthroughGames":false}"#
        let b = MouseCodec.decodeBindings(Data(json.utf8))
        XCTAssertEqual(b.default["4"], .orion("summon"))
        XCTAssertEqual(b.apps["com.apple.Safari"]?["3"], .openApp("com.apple.Notes"))
        XCTAssertFalse(b.autoPassthroughGames)
    }
    func testGarbageDecodesToDefaults() {
        let b = MouseCodec.decodeBindings(Data("nope".utf8))
        XCTAssertTrue(b.enabled); XCTAssertTrue(b.default.isEmpty)
    }
    func testPartialFileKeepsDefaults() {
        let b = MouseCodec.decodeBindings(Data(#"{"default":{"3":{"kind":"passthrough"}}}"#.utf8))
        XCTAssertTrue(b.autoPassthroughGames); XCTAssertEqual(b.default["3"], .passthrough)
    }
    func testDevicesEncodeContractKeys() throws {
        let file = DeviceRegistry.attached(basilisk, into: DevicesFile(), now: "t")
        let text = String(data: try MouseCodec.encode(file), encoding: .utf8)!
        for key in ["\"vendorId\"", "\"extraButtons\"", "\"setupState\" : \"new\"", "\"firstSeen\""] { XCTAssertTrue(text.contains(key), key) }
    }

    // MARK: shortcuts

    func testShortcutParse() {
        XCTAssertEqual(ShortcutParser.parse("cmd+shift+4"), ParsedShortcut(keyCode: 21, flags: ShortcutParser.cmd | ShortcutParser.shift))
        XCTAssertEqual(ShortcutParser.parse("ctrl+left")?.keyCode, 123)
        XCTAssertEqual(ShortcutParser.parse(" Opt + Space ")?.flags, ShortcutParser.opt)
        XCTAssertEqual(ShortcutParser.parse("f3")?.flags, 0)
    }
    func testShortcutRejects() {
        for bad in ["", "cmd+", "cmd+shift", "a+b", "cmd+nonsense", "++"] { XCTAssertNil(ShortcutParser.parse(bad), bad) }
    }

    // MARK: devices

    private let basilisk = AttachedMouse(vendorId: 5426, productId: 153, name: "Razer Basilisk V3", transport: "USB", buttonCount: 11)

    func testNewDeviceIsNewWithExtras() {
        let f = DeviceRegistry.attached(basilisk, into: DevicesFile(), now: "t")
        XCTAssertEqual(f.devices.first?.setupState, .new)
        XCTAssertEqual(f.devices.first?.extraButtons, Array(3..<11))
        XCTAssertEqual(f.devices.first?.id, "5426:153")
    }
    func testThreeButtonMouseNotAsked() {
        let m = AttachedMouse(vendorId: 1, productId: 2, name: "Plain", transport: "USB", buttonCount: 3)
        XCTAssertEqual(DeviceRegistry.attached(m, into: DevicesFile(), now: "t").devices.first?.setupState, .configured)
    }
    func testReattachKeepsStateAndFirstSeen() {
        var f = DeviceRegistry.attached(basilisk, into: DevicesFile(), now: "t1")
        f = DeviceRegistry.setting(.declined, id: "5426:153", into: f)
        f = DeviceRegistry.detached(id: "5426:153", into: f, now: "t2")
        XCTAssertFalse(f.devices[0].connected)
        f = DeviceRegistry.attached(basilisk, into: f, now: "t3")
        XCTAssertEqual(f.devices[0].setupState, .declined); XCTAssertEqual(f.devices[0].firstSeen, "t1")
        XCTAssertTrue(f.devices[0].connected); XCTAssertEqual(f.devices.count, 1)
    }
    func testAppleTrackpadIgnored() {
        let t = AttachedMouse(vendorId: 1452, productId: 832, name: "Apple Internal Keyboard / Trackpad", transport: "SPI", buttonCount: 1)
        XCTAssertTrue(DeviceRegistry.attached(t, into: DevicesFile(), now: "t").devices.isEmpty)
        let magic = AttachedMouse(vendorId: 1452, productId: 804, name: "Magic Trackpad", transport: "Bluetooth", buttonCount: 1)
        XCTAssertTrue(DeviceRegistry.isIgnored(magic))
    }
    func testObservedButtonWidens() {
        var f = DeviceRegistry.attached(AttachedMouse(vendorId: 9, productId: 9, name: "M", transport: "USB", buttonCount: 5), into: DevicesFile(), now: "t")
        f = DeviceRegistry.observed(button: 9, into: f)
        XCTAssertEqual(f.devices[0].extraButtons, [3, 4, 9])
    }
    func testAskText() {
        let d = DeviceRegistry.attached(basilisk, into: DevicesFile(), now: "t").devices[0]
        XCTAssertTrue(DeviceRegistry.askText(for: d).contains("Razer Basilisk V3 with 8 extra buttons"))
    }

    func testLabels() {
        XCTAssertEqual(MouseActionLabel.label(.system("stageManager")), "Stage Manager")
        XCTAssertEqual(MouseActionLabel.label(nil), "Does nothing special")
        XCTAssertEqual(MouseActionLabel.label(.openApp("com.apple.Safari")), "Open Safari")
        XCTAssertEqual(MouseActionLabel.presets.count, 11)
    }

    func testSwallowTrackerOnlyUpsOfSwallowedDowns() {
        var t = SwallowTracker()
        t.swallowDown(3)
        XCTAssertTrue(t.shouldSwallowUp(3))
        XCTAssertFalse(t.shouldSwallowUp(3))          // one up per swallowed down
        t.swallowDown(4); t.reset()
        XCTAssertFalse(t.shouldSwallowUp(4))          // reset (stop / timeout) clears
        t.swallowDown(5); t.passDown(5)
        XCTAssertFalse(t.shouldSwallowUp(5))          // pass-through down forgets a stale entry
    }

    // MARK: setup popup

    func testSuggestedDefaultsAndEffective() {
        let b = BindingsFile()
        XCTAssertEqual(MouseSetupPlan.effective(4, in: b), .system("stageManager"))
        XCTAssertEqual(MouseSetupPlan.effective(3, in: b), .system("missionControl"))
        XCTAssertNil(MouseSetupPlan.effective(5, in: b))
        XCTAssertEqual(MouseSetupPlan.effective(4, in: b.settingDefault(4, .system("showDesktop"))), .system("showDesktop"))
    }
    func testFinalizeKeepsEditsAndFillsSuggestions() {
        let b = MouseSetupPlan.finalized(BindingsFile().settingDefault(3, .system("desktopLeft")), buttons: [3, 4, 5])
        XCTAssertEqual(b.default["3"], .system("desktopLeft"))
        XCTAssertEqual(b.default["4"], .system("stageManager"))
        XCTAssertNil(b.default["5"])
    }
    func testConfirmationLine() {
        XCTAssertEqual(MouseSetupPlan.confirmation(BindingsFile(), buttons: [3, 4]),
                       "Set. Back: Mission Control, front: Stage Manager.")
        XCTAssertEqual(MouseSetupPlan.confirmation(BindingsFile().settingDefault(3, .passthrough).settingDefault(4, .passthrough), buttons: [3, 4]),
                       "Okay, nothing set. The buttons stay as they were.")
    }
    func testKicker() { XCTAssertEqual(MouseSetupPlan.kicker(deviceName: "Razer Basilisk V3"), "MOUSE · RAZER BASILISK V3") }

    func testOutreachTailIgnoresOldAndPartialLines() {
        let old = Data("{\"kind\":\"mouse\",\"event\":\"setup-open\"}\n".utf8)
        var r = OutreachTail.newLines(in: old, after: old.count)
        XCTAssertTrue(r.lines.isEmpty)
        let more = old + Data("{\"kind\":\"info\"}\n{\"kind\":\"mouse\",\"event\":\"setup-open\",\"x\":1}".utf8)
        r = OutreachTail.newLines(in: more, after: old.count)
        XCTAssertEqual(r.lines.count, 1)
        XCTAssertFalse(OutreachTail.isSetupOpen(r.lines[0]))
        let done = more + Data("\n".utf8)
        r = OutreachTail.newLines(in: done, after: r.offset)
        XCTAssertEqual(r.lines.count, 1)
        XCTAssertTrue(OutreachTail.isSetupOpen(r.lines[0]))
        XCTAssertEqual(OutreachTail.newLines(in: Data("a\n".utf8), after: 99).lines, ["a"])
        XCTAssertFalse(OutreachTail.isSetupOpen("{\"kind\":\"mouse\",\"event\":\"asked\"}"))
    }

    // MARK: Control Center tree (names dumped live on macOS 26)

    func testControlCenterMatchers() {
        XCTAssertTrue(ControlCenterMatch.isMenuExtra(id: "com.apple.menuextra.controlcenter"))
        XCTAssertFalse(ControlCenterMatch.isMenuExtra(id: "com.apple.menuextra.wifi"))
        XCTAssertTrue(ControlCenterMatch.isStageManagerTile(role: "AXCheckBox",
            id: ":com.apple.WindowManager:com.apple.WindowManager.controls:com.apple.windowmanager.stagemanager:51A2", description: "Stage Manager"))
        XCTAssertTrue(ControlCenterMatch.isStageManagerTile(role: "AXCheckBox", id: "x", description: "Stage Manager"))
        XCTAssertFalse(ControlCenterMatch.isStageManagerTile(role: "AXCheckBox", id: "controlcenter-wifi", description: "Wi-Fi: eduroam"))
        XCTAssertFalse(ControlCenterMatch.isStageManagerTile(role: "AXStaticText", id: "", description: "Stage Manager"))
        XCTAssertTrue(ControlCenterMatch.isTurnOnButton(role: "AXButton", title: "Turn On Stage Manager", description: ""))
        XCTAssertFalse(ControlCenterMatch.isTurnOnButton(role: "AXButton", title: "Not Now", description: ""))
    }

    // MARK: store

    func testStoreAtomicRoundTripAndMerge() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("mousekit-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = MouseStore(controlledDir: dir)
        XCTAssertTrue(store.loadBindings().default.isEmpty)
        try store.updateBindings { $0.settingDefault(3, .system("stageManager")) }
        try store.updateBindings { $0.settingDefault(4, .orion("talk")) }   // re-reads: keeps button 3
        XCTAssertEqual(store.loadBindings().default.count, 2)
        try store.updateDevices { DeviceRegistry.attached(self.basilisk, into: $0, now: "t") }
        XCTAssertEqual(store.loadDevices().devices.count, 1)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: store.directory.path).filter { $0.hasSuffix(".tmp") }
        XCTAssertTrue(leftovers.isEmpty)
    }
}
