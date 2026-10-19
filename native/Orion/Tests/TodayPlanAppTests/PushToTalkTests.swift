import XCTest
import AppKit
@testable import Orion

private func flags(_ f: NSEvent.ModifierFlags...) -> NSEvent.ModifierFlags {
    f.reduce(into: []) { $0.formUnion($1) }
}

private func engine(_ configure: (inout PushToTalkConfig) -> Void = { _ in }) -> PushToTalkEngine {
    var config = PushToTalkConfig.default
    configure(&config)
    return PushToTalkEngine(config: config)
}

private func flagsEvent(_ code: UInt16, _ f: NSEvent.ModifierFlags) -> PTTEvent {
    PTTEvent(kind: .flagsChanged, keyCode: code, flags: f)
}

private func keyEvent(_ kind: PTTEvent.Kind, _ code: UInt16, _ f: NSEvent.ModifierFlags = [],
                      isRepeat: Bool = false) -> PTTEvent {
    PTTEvent(kind: kind, keyCode: code, flags: f, isRepeat: isRepeat)
}

final class PushToTalkEngineTests: XCTestCase {

    // MARK: Modifier alone

    func testRightOptionWithoutDelayPressesAndReleasesImmediately() {
        var e = engine { $0.holdDelayEnabled = false }
        XCTAssertEqual(e.handle(flagsEvent(61, .option)), .press)
        XCTAssertEqual(e.handle(flagsEvent(61, [])), .release)
    }

    func testDefaultHoldDelayIsOnAndStartsPending() {
        var e = engine()
        XCTAssertEqual(e.handle(flagsEvent(61, .option)), .startPending(PushToTalkConfig.defaultDelay))
        XCTAssertFalse(e.isHeld)
        XCTAssertEqual(e.pendingElapsed(), .press)
        XCTAssertEqual(e.handle(flagsEvent(61, [])), .release)
    }

    func testDuplicateReportOfTheSameTransitionIsIgnored() {
        var e = engine { $0.holdDelayEnabled = false }
        XCTAssertEqual(e.handle(flagsEvent(61, .option)), .press)
        XCTAssertEqual(e.handle(flagsEvent(61, .option)), .none)
        XCTAssertTrue(e.isHeld)
        XCTAssertEqual(e.handle(flagsEvent(61, [])), .release)
        XCTAssertEqual(e.handle(flagsEvent(61, [])), .none)
    }

    func testQuickTapNeverPressesOrReleases() {
        var e = engine()
        _ = e.handle(flagsEvent(61, .option))
        XCTAssertEqual(e.handle(flagsEvent(61, [])), .cancelPending)
        XCTAssertEqual(e.pendingElapsed(), .none)
    }

    func testOptionPlusLetterNeverTriggers() {
        var e = engine()
        _ = e.handle(flagsEvent(61, .option))
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 0, .option)), .cancelPending)
        XCTAssertEqual(e.pendingElapsed(), .none)
        XCTAssertEqual(e.handle(flagsEvent(61, [])), .none)
        XCTAssertFalse(e.isHeld)
    }

    func testAnotherModifierWhilePendingCancels() {
        var e = engine()
        _ = e.handle(flagsEvent(61, .option))
        XCTAssertEqual(e.handle(flagsEvent(56, flags(.option, .shift))), .cancelPending)
        XCTAssertEqual(e.pendingElapsed(), .none)
    }

    func testOptionPressedWithCommandAlreadyHeldIsIgnored() {
        var e = engine()
        XCTAssertEqual(e.handle(flagsEvent(61, flags(.option, .command))), .none)
    }

    func testLetterTypedAfterTheHoldStartedDoesNotEndIt() {
        var e = engine()
        _ = e.handle(flagsEvent(61, .option))
        _ = e.pendingElapsed()
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 0, .option)), .none)
        XCTAssertTrue(e.isHeld)
    }

    func testLeftOptionAlsoCountsForRightOptionChoiceAndOtherKeyCannotEndIt() {
        var e = engine { $0.holdDelayEnabled = false }
        XCTAssertEqual(e.handle(flagsEvent(58, .option)), .press)
        XCTAssertEqual(e.handle(flagsEvent(61, .option)), .none)
        XCTAssertEqual(e.handle(flagsEvent(58, .option)), .release, "release even though the right key keeps the flag set")
    }

    func testDelayIsClampedToRange() {
        var config = PushToTalkConfig.default
        config.holdDelay = 5
        XCTAssertEqual(config.effectiveHoldDelay, PushToTalkConfig.delayRange.upperBound)
        config.holdDelay = 0
        XCTAssertEqual(config.effectiveHoldDelay, PushToTalkConfig.delayRange.lowerBound)
        config.holdDelayEnabled = false
        XCTAssertEqual(config.effectiveHoldDelay, 0)
    }

    func testOtherModifierChoicesUseTheirOwnKeyCodes() {
        var command = engine { $0.choice = .rightCommand; $0.holdDelayEnabled = false }
        XCTAssertEqual(command.handle(flagsEvent(61, .option)), .none)
        XCTAssertEqual(command.handle(flagsEvent(54, .command)), .press)
        var control = engine { $0.choice = .rightControl; $0.holdDelayEnabled = false }
        XCTAssertEqual(control.handle(flagsEvent(62, .control)), .press)
        var fn = engine { $0.choice = .fn; $0.holdDelayEnabled = false }
        XCTAssertEqual(fn.handle(flagsEvent(63, .function)), .press)
        XCTAssertEqual(fn.handle(flagsEvent(63, [])), .release)
    }

    func testLeftCommandDoesNotTriggerRightCommand() {
        var e = engine { $0.choice = .rightCommand; $0.holdDelayEnabled = false }
        XCTAssertEqual(e.handle(flagsEvent(55, .command)), .none)
    }

    func testModeIsAlwaysHoldForModifierOnlyKeys() {
        var config = PushToTalkConfig.default
        config.mode = .toggle
        XCTAssertEqual(config.effectiveMode, .hold)
        XCTAssertGreaterThan(config.effectiveHoldDelay, 0)
    }

    // MARK: Function keys and combos

    func testFunctionKeyHoldToTalk() {
        var e = engine { $0.choice = .f13 }
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 105)), .press)
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 105, isRepeat: true)), .none)
        XCTAssertEqual(e.handle(keyEvent(.keyUp, 105)), .release)
    }

    func testFunctionKeyCodesAreDistinct() {
        let codes = PTTKeyChoice.allCases.compactMap(\.functionKeyCode)
        XCTAssertEqual(codes.count, 7)
        XCTAssertEqual(Set(codes).count, 7)
        var e = engine { $0.choice = .f19 }
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 105)), .none)
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 80)), .press)
    }

    func testFunctionKeyWithModifierDoesNotTrigger() {
        var e = engine { $0.choice = .f14 }
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 107, .command)), .none)
    }

    func testToggleModeStartsAndStopsOnPresses() {
        var e = engine { $0.choice = .f15; $0.mode = .toggle }
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 113)), .press)
        XCTAssertEqual(e.handle(keyEvent(.keyUp, 113)), .none)
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 113)), .release)
        XCTAssertEqual(e.handle(keyEvent(.keyUp, 113)), .none)
    }

    func testCustomComboNeedsExactModifiers() {
        let shortcut = try! PTTCustomShortcut.make(keyCode: 49, flags: flags(.control, .option)).get()
        var e = engine { $0.choice = .custom; $0.custom = shortcut }
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 49, .control)), .none)
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 49, flags(.control, .option, .shift))), .none)
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 49, flags(.control, .option))), .press)
        XCTAssertEqual(e.handle(keyEvent(.keyUp, 49, flags(.control, .option))), .release)
    }

    func testReleasingComboModifiersFirstEndsTheHold() {
        let shortcut = try! PTTCustomShortcut.make(keyCode: 49, flags: flags(.control, .option)).get()
        var e = engine { $0.choice = .custom; $0.custom = shortcut }
        _ = e.handle(keyEvent(.keyDown, 49, flags(.control, .option)))
        XCTAssertEqual(e.handle(flagsEvent(61, .control)), .release)
        XCTAssertEqual(e.handle(keyEvent(.keyUp, 49)), .none)
    }

    func testCustomWithoutRecordedShortcutNeverTriggers() {
        var e = engine { $0.choice = .custom }
        XCTAssertNil(e.config.binding)
        XCTAssertEqual(e.handle(keyEvent(.keyDown, 49, .control)), .none)
        XCTAssertFalse(e.config.isActive)
    }

    func testPlainOptionLetterIsNeverARecordableTrigger() {
        // The recorder demands a real modifier, and a bare letter is rejected.
        XCTAssertEqual(PTTCustomShortcut.make(keyCode: 0, flags: []), .failure(.needsModifier))
        XCTAssertEqual(PTTCustomShortcut.make(keyCode: 0, flags: .shift), .failure(.needsModifier))
        XCTAssertEqual(PTTCustomShortcut.make(keyCode: 61, flags: .option), .failure(.modifierOnly))
        XCTAssertEqual(PTTCustomShortcut.make(keyCode: 53, flags: .command), .failure(.escape))
    }

    // MARK: Disabled and reconfigure

    func testDisabledEngineIgnoresEverything() {
        var e = engine { $0.enabled = false }
        XCTAssertEqual(e.handle(flagsEvent(61, .option)), .none)
        XCTAssertFalse(e.isPending)
    }

    func testReconfigureWhileHeldReleases() {
        var e = engine { $0.holdDelayEnabled = false }
        _ = e.handle(flagsEvent(61, .option))
        var off = e.config
        off.enabled = false
        XCTAssertEqual(e.reconfigure(off), .release)
        XCTAssertFalse(e.isHeld)
    }

    // MARK: Clashes

    func testClashWarnings() {
        XCTAssertNil(PushToTalkClashFixture.warning { _ in })
        XCTAssertNotNil(PushToTalkClashFixture.warning { $0.choice = .fn })
        XCTAssertNotNil(PushToTalkClashFixture.warning { $0.holdDelayEnabled = false })
        let spotlight = try! PTTCustomShortcut.make(keyCode: 49, flags: .command).get()
        XCTAssertTrue(PushToTalkClashFixture.warning { $0.choice = .custom; $0.custom = spotlight }!.contains("Spotlight"))
        let optionLetter = try! PTTCustomShortcut.make(keyCode: 0, flags: .option).get()
        XCTAssertNotNil(PushToTalkClashFixture.warning { $0.choice = .custom; $0.custom = optionLetter })
        let safe = try! PTTCustomShortcut.make(keyCode: 49, flags: flags(.control, .option)).get()
        XCTAssertNil(PushToTalkClashFixture.warning { $0.choice = .custom; $0.custom = safe })
        XCTAssertNil(PushToTalkClashFixture.warning { $0.enabled = false; $0.choice = .fn })
    }
}

private enum PushToTalkClashFixture {
    static func warning(_ configure: (inout PushToTalkConfig) -> Void) -> String? {
        var config = PushToTalkConfig.default
        configure(&config)
        return PTTClash.warning(for: config)
    }
}

// MARK: - Persistence

final class PushToTalkSettingsTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suite: String!

    override func setUp() {
        super.setUp()
        suite = "PTTTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testDefaultsPreserveOldBehaviourPlusDelay() {
        let config = PushToTalkSettings.load(defaults)
        XCTAssertTrue(config.enabled)
        XCTAssertEqual(config.choice, .rightOption)
        XCTAssertEqual(config.mode, .hold)
        XCTAssertTrue(config.holdDelayEnabled)
        XCTAssertEqual(config.holdDelay, PushToTalkConfig.defaultDelay)
        XCTAssertNil(config.custom)
        XCTAssertEqual(config, .default)
    }

    func testRoundTrip() {
        var config = PushToTalkConfig.default
        config.enabled = false
        config.choice = .custom
        config.custom = try! PTTCustomShortcut.make(keyCode: 49, flags: flags(.control, .option)).get()
        config.mode = .toggle
        config.holdDelayEnabled = false
        config.holdDelay = 0.4
        PushToTalkSettings.save(config, to: defaults)
        XCTAssertEqual(PushToTalkSettings.load(defaults), config)
    }

    func testGarbageFallsBackToDefaults() {
        defaults.set("nonsense", forKey: PushToTalkSettings.choiceKey)
        defaults.set("nonsense", forKey: PushToTalkSettings.modeKey)
        defaults.set(99.0, forKey: PushToTalkSettings.delayKey)
        let config = PushToTalkSettings.load(defaults)
        XCTAssertEqual(config.choice, .rightOption)
        XCTAssertEqual(config.mode, .hold)
        XCTAssertEqual(config.holdDelay, PushToTalkConfig.delayRange.upperBound)
    }

    func testClearingCustomRemovesStoredKeys() {
        var config = PushToTalkConfig.default
        config.custom = PTTCustomShortcut(keyCode: 49, modifiersRaw: NSEvent.ModifierFlags.control.rawValue)
        PushToTalkSettings.save(config, to: defaults)
        config.custom = nil
        PushToTalkSettings.save(config, to: defaults)
        XCTAssertNil(PushToTalkSettings.load(defaults).custom)
    }

    func testIdleHintAndLabels() {
        XCTAssertEqual(PushToTalkConfig.default.idleHint, "Hold Right Option to talk")
        var config = PushToTalkConfig.default
        config.enabled = false
        XCTAssertEqual(config.idleHint, "Push-to-talk is off")
        config = PushToTalkConfig(choice: .custom,
                                  custom: PTTCustomShortcut(keyCode: 49, modifiersRaw: flags(.control, .option).rawValue),
                                  mode: .toggle)
        XCTAssertEqual(config.keyLabel, "⌃⌥Space")
        XCTAssertEqual(config.idleHint, "Press ⌃⌥Space to talk")
    }
}

// MARK: - Monitor installation

private final class FakeSource: PTTEventSource {
    struct Entry { let id: Int; let kinds: Set<PTTEvent.Kind>; let global: Bool; let handler: (PTTEvent) -> Bool }
    private(set) var entries: [Entry] = []
    private var next = 0

    func addGlobal(_ kinds: Set<PTTEvent.Kind>, handler: @escaping (PTTEvent) -> Void) -> Any? {
        next += 1
        entries.append(Entry(id: next, kinds: kinds, global: true, handler: { handler($0); return false }))
        return next
    }

    func addLocal(_ kinds: Set<PTTEvent.Kind>, handler: @escaping (PTTEvent) -> Bool) -> Any? {
        next += 1
        entries.append(Entry(id: next, kinds: kinds, global: false, handler: handler))
        return next
    }

    func remove(_ token: Any) { entries.removeAll { $0.id == token as? Int } }

    var flagsMonitors: Int { entries.filter { $0.kinds.contains(.flagsChanged) }.count }
    var globalMonitors: Int { entries.filter(\.global).count }

    func deliver(_ event: PTTEvent) {
        for entry in entries where entry.kinds.contains(event.kind) { _ = entry.handler(event) }
    }
}

final class PushToTalkMonitorTests: XCTestCase {
    private var source: FakeSource!
    private var scheduled: [(delay: TimeInterval, work: () -> Void, cancelled: Box)] = []
    private var presses = 0
    private var releases = 0

    private final class Box { var value = false }

    private func makeMonitor() -> PushToTalkMonitor {
        source = FakeSource()
        scheduled = []
        presses = 0
        releases = 0
        let monitor = PushToTalkMonitor(source: source) { [unowned self] delay, work in
            let box = Box()
            self.scheduled.append((delay, work, box))
            return { box.value = true }
        }
        monitor.onPressed = { [unowned self] in presses += 1 }
        monitor.onReleased = { [unowned self] in releases += 1 }
        return monitor
    }

    private func fireTimer() {
        guard let last = scheduled.last, !last.cancelled.value else { return }
        last.work()
    }

    func testDisabledInstallsNoKeyMonitors() {
        let monitor = makeMonitor()
        var config = PushToTalkConfig.default
        config.enabled = false
        monitor.apply(config)
        XCTAssertFalse(monitor.isRunning)
        XCTAssertEqual(source.flagsMonitors, 0)
        XCTAssertEqual(source.globalMonitors, 0, "nothing may observe other apps")
        source.deliver(flagsEvent(61, .option))
        XCTAssertEqual(presses, 0)
    }

    func testEnabledInstallsFlagsMonitorsOnly() {
        let monitor = makeMonitor()
        monitor.apply(.default)
        XCTAssertTrue(monitor.isRunning)
        XCTAssertEqual(source.globalMonitors, 1)
        XCTAssertFalse(source.entries.contains { $0.global && $0.kinds.contains(.keyDown) },
                       "no global keystroke watch until a hold is pending")
    }

    func testDisablingLiveRemovesMonitorsAndReleasesAHeldKey() {
        let monitor = makeMonitor()
        var config = PushToTalkConfig.default
        config.holdDelayEnabled = false
        monitor.apply(config)
        source.deliver(flagsEvent(61, .option))
        XCTAssertEqual(presses, 1)
        config.enabled = false
        monitor.apply(config)
        XCTAssertEqual(releases, 1)
        XCTAssertFalse(monitor.isRunning)
        XCTAssertEqual(source.globalMonitors, 0)
    }

    func testReEnablingInstallsAgain() {
        let monitor = makeMonitor()
        var config = PushToTalkConfig.default
        config.enabled = false
        monitor.apply(config)
        config.enabled = true
        monitor.apply(config)
        XCTAssertTrue(monitor.isRunning)
    }

    func testHoldDelayThroughTheMonitor() {
        let monitor = makeMonitor()
        monitor.apply(.default)
        source.deliver(flagsEvent(61, .option))
        XCTAssertEqual(presses, 0)
        XCTAssertEqual(scheduled.last?.delay, PushToTalkConfig.defaultDelay)
        XCTAssertTrue(source.entries.contains { $0.global && $0.kinds == [.keyDown] }, "watching for a shortcut while pending")
        fireTimer()
        XCTAssertEqual(presses, 1)
        XCTAssertFalse(source.entries.contains { $0.global && $0.kinds == [.keyDown] }, "watch removed once talking")
        source.deliver(flagsEvent(61, []))
        XCTAssertEqual(releases, 1)
    }

    func testOptionPlusLetterThroughTheMonitorNeverPresses() {
        let monitor = makeMonitor()
        monitor.apply(.default)
        source.deliver(flagsEvent(61, .option))
        source.deliver(keyEvent(.keyDown, 0, .option))
        XCTAssertTrue(scheduled.last?.cancelled.value ?? false)
        fireTimer()
        source.deliver(flagsEvent(61, []))
        XCTAssertEqual(presses, 0)
        XCTAssertEqual(releases, 0)
    }

    func testKeyChoiceInstallsKeyMonitorsAndSwitchesLive() {
        let monitor = makeMonitor()
        var config = PushToTalkConfig.default
        config.choice = .f16
        monitor.apply(config)
        XCTAssertTrue(source.entries.contains { $0.global && $0.kinds.contains(.keyUp) })
        source.deliver(keyEvent(.keyDown, 106))
        source.deliver(keyEvent(.keyUp, 106))
        XCTAssertEqual(presses, 1)
        XCTAssertEqual(releases, 1)
        monitor.apply(.default)
        source.deliver(keyEvent(.keyDown, 106))
        XCTAssertEqual(presses, 1, "old key no longer listened for")
    }

    func testEscapeStillWorksLocallyWhenDisabled() {
        let monitor = makeMonitor()
        var escapes = 0
        monitor.onEscape = { escapes += 1 }
        var config = PushToTalkConfig.default
        config.enabled = false
        monitor.apply(config)
        source.deliver(keyEvent(.keyDown, 53))
        XCTAssertEqual(escapes, 1)
    }
}
