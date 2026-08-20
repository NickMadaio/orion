import XCTest
@testable import SessionDomain
@testable import SessionService

final class EnforcerInterventionTests: XCTestCase {
    private final class Frontmost: FrontmostAppSensing {
        var value: (bundleID: String, name: String)?
        func frontmost() -> (bundleID: String, name: String)? { value }
    }

    private final class Idle: IdleSensing {
        func idleSeconds() -> TimeInterval? { 0 }
    }

    private final class Screen: ScreenStateSensing {
        func isLockedOrAsleep() -> Bool { false }
    }

    private let start = Date(timeIntervalSince1970: 1_772_452_800)

    func testGuidedRestoresTheLastConfirmedWorkAppAfterRepeatDrift() {
        let front = Frontmost()
        var now = start
        var interventions: [EnforcementIntervention] = []
        let enforcer = makeEnforcer(front: front, now: { now }, interventions: { interventions.append($0) })
        enforcer.arm(Allowlist(bundleIDs: ["work.app"]),
                     policy: EnforcementPolicy(level: .guided, wrongAppGrace: 1,
                                               nudgeInterval: 1))

        front.value = ("work.app", "Work")
        enforcer.evaluate(sessionIsFocusing: true)
        front.value = ("chat.app", "Chat")
        now = start.addingTimeInterval(1.1)
        enforcer.evaluate(sessionIsFocusing: true)
        now = start.addingTimeInterval(2.2)
        enforcer.evaluate(sessionIsFocusing: true)
        now = start.addingTimeInterval(3.3)
        enforcer.evaluate(sessionIsFocusing: true)

        XCTAssertEqual(interventions, [.restore(bundleID: "work.app")])
    }

    func testFirmHidesButNeverQuitsTheDisallowedApp() {
        let front = Frontmost()
        var now = start
        var interventions: [EnforcementIntervention] = []
        let enforcer = makeEnforcer(front: front, now: { now }, interventions: { interventions.append($0) })
        enforcer.arm(Allowlist(bundleIDs: ["work.app"]),
                     policy: EnforcementPolicy(level: .firm, wrongAppGrace: 1,
                                               nudgeInterval: 1))

        front.value = ("work.app", "Work")
        enforcer.evaluate(sessionIsFocusing: true)
        front.value = ("chat.app", "Chat")
        now = start.addingTimeInterval(1.1)
        enforcer.evaluate(sessionIsFocusing: true)
        now = start.addingTimeInterval(2.2)
        enforcer.evaluate(sessionIsFocusing: true)
        now = start.addingTimeInterval(3.3)
        enforcer.evaluate(sessionIsFocusing: true)

        XCTAssertEqual(interventions, [.hide(bundleID: "chat.app", restoreBundleID: "work.app")])
    }

    func testShieldAppearsOnTheFirstRealDriftAndReleaseStopsEverything() {
        let front = Frontmost()
        var now = start
        var interventions: [EnforcementIntervention] = []
        let enforcer = makeEnforcer(front: front, now: { now }, interventions: { interventions.append($0) })
        enforcer.arm(Allowlist(bundleIDs: ["work.app"]),
                     policy: EnforcementPolicy(level: .shield, wrongAppGrace: 1,
                                               nudgeInterval: 1))

        front.value = ("work.app", "Work")
        enforcer.evaluate(sessionIsFocusing: true)
        front.value = ("chat.app", "Chat")
        now = start.addingTimeInterval(1.1)
        enforcer.evaluate(sessionIsFocusing: true)
        now = start.addingTimeInterval(2.2)
        enforcer.evaluate(sessionIsFocusing: true)

        XCTAssertEqual(interventions, [
            .shield(reason: "Chat can wait. Return to your focus block.",
                    restoreBundleID: "work.app")
        ])

        enforcer.release()
        now = start.addingTimeInterval(4)
        enforcer.evaluate(sessionIsFocusing: true)
        XCTAssertEqual(interventions.count, 1, "release is unconditional and prevents another Shield")
    }

    func testProgressiveMovesFromGentleThroughShieldAsDriftContinues() {
        let front = Frontmost()
        var now = start
        var interventions: [EnforcementIntervention] = []
        let enforcer = makeEnforcer(front: front, now: { now }, interventions: { interventions.append($0) })
        enforcer.arm(Allowlist(bundleIDs: ["work.app"]),
                     policy: EnforcementPolicy(level: .guided, wrongAppGrace: 1,
                                               nudgeInterval: 1),
                     progressive: true)

        front.value = ("work.app", "Work")
        enforcer.evaluate(sessionIsFocusing: true)
        front.value = ("chat.app", "Chat")

        for tick in 1...5 {
            now = start.addingTimeInterval(Double(tick) * 1.1)
            enforcer.evaluate(sessionIsFocusing: true)
        }

        XCTAssertEqual(interventions, [
            .restore(bundleID: "work.app"),
            .hide(bundleID: "chat.app", restoreBundleID: "work.app"),
            .shield(reason: "Chat can wait. Return to your focus block.",
                    restoreBundleID: "work.app")
        ])
        XCTAssertEqual(enforcer.effectiveLevel, .shield)
    }

    private func makeEnforcer(front: Frontmost, now: @escaping () -> Date,
                              interventions: @escaping (EnforcementIntervention) -> Void) -> Enforcer {
        Enforcer(
            hub: SensorHub(frontmost: front, idle: Idle(), screen: Screen()),
            clock: now,
            speak: { _ in },
            intervene: interventions,
            log: { _ in }
        )
    }
}
