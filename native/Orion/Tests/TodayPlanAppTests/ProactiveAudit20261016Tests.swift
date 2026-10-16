import XCTest
@testable import Orion

/// 2026-10-16 proactive-messaging audit: the idle reading (#3) and the
/// "you messaged him first" context (#5).
final class ProactiveAudit20261016Tests: XCTestCase {

    // MARK: Idle reading

    func testTheAuditedReadingOfElevenDaysIsInvalidWhenIdleIsReallyForty() {
        // 1,022,283 s with a machine that booted 1,021,037 s ago and an app launched an hour ago.
        XCTAssertNil(IdleReading.validated(raw: 1_022_283, sinceBoot: 1_021_037, sinceLaunch: 3_600))
    }

    func testARealReadingPassesThrough() {
        XCTAssertEqual(IdleReading.validated(raw: 40, sinceBoot: 1_000_000, sinceLaunch: 3_600), 40)
    }

    func testReadingLongerThanTheAppHasRunIsInvalid() {
        XCTAssertNil(IdleReading.validated(raw: 900, sinceBoot: 1_000_000, sinceLaunch: 120))
    }

    func testReadingLongerThanTimeSinceBootIsInvalid() {
        XCTAssertNil(IdleReading.validated(raw: 5_000, sinceBoot: 4_000, sinceLaunch: 10_000))
    }

    func testNegativeNaNAndAbsurdReadingsAreInvalid() {
        XCTAssertNil(IdleReading.validated(raw: -1, sinceBoot: 1_000_000, sinceLaunch: 10_000))
        XCTAssertNil(IdleReading.validated(raw: .nan, sinceBoot: 1_000_000, sinceLaunch: 10_000))
        XCTAssertNil(IdleReading.validated(raw: 2 * 86_400, sinceBoot: 9_000_000, sinceLaunch: 9_000_000))
    }

    func testTheSystemReadingIsPlausibleNow() {
        // The real source: with the wrong event type this was time since boot.
        let raw = IdleReading.systemIdleSeconds()
        XCTAssertLessThan(raw, ProcessInfo.processInfo.systemUptime)
    }

    func testLoginwindowAndTheLockScreenAreNeverTargets() {
        XCTAssertTrue(EnforcementGuard.isNeverATarget(name: "loginwindow", bundleID: nil))
        XCTAssertTrue(EnforcementGuard.isNeverATarget(name: "Anything", bundleID: "com.apple.loginwindow"))
        XCTAssertTrue(EnforcementGuard.isNeverATarget(name: "ScreenSaverEngine", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.isNeverATarget(name: "Safari", bundleID: "com.apple.Safari"))
    }

    func testEnforcementNeedsConsentAValidIdleAndASafeApp() {
        XCTAssertTrue(EnforcementGuard.allowed(consent: true, idleValid: true, name: "Safari", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.allowed(consent: false, idleValid: true, name: "Safari", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.allowed(consent: true, idleValid: false, name: "Safari", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.allowed(consent: true, idleValid: true, name: "loginwindow", bundleID: nil))
    }
}
