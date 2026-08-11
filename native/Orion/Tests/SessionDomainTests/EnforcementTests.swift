//
//  Enforcement, as data.
//
//  The behaviours that matter here are the ones you would otherwise only
//  discover by living with the thing for an hour: does it stop nagging, does a
//  glance at Messages count, and can he always get out.
//

import XCTest
@testable import SessionDomain

final class EnforcementTests: XCTestCase {

    private let start = Date(timeIntervalSince1970: 1_772_452_800)

    private func allowlist(_ ids: Set<String> = ["com.apple.dt.Xcode"],
                           confirmed: Bool = true) -> Allowlist {
        Allowlist(bundleIDs: ids, confirmed: confirmed)
    }

    private func onTask(idle: TimeInterval = 0) -> Observation {
        Observation(frontmostBundleID: "com.apple.dt.Xcode", frontmostName: "Xcode",
                    idleFor: idle, screenLocked: false)
    }

    private func offTask(idle: TimeInterval = 0) -> Observation {
        Observation(frontmostBundleID: "com.apple.MobileSMS", frontmostName: "Messages",
                    idleFor: idle, screenLocked: false)
    }

    @discardableResult
    private func step(_ observation: Observation, _ state: inout EnforcementState,
                      at offset: TimeInterval, policy: EnforcementPolicy = .firm,
                      allowlist list: Allowlist? = nil,
                      focusing: Bool = true) -> EnforcementAction {
        let result = Enforcement.decide(
            observation: observation, allowlist: list ?? allowlist(), policy: policy,
            state: state, now: start.addingTimeInterval(offset), sessionIsFocusing: focusing
        )
        state = result.state
        return result.action
    }

    // MARK: On task

    func testWorkingInAnAllowedAppSaysNothing() {
        var state = EnforcementState()
        XCTAssertEqual(step(onTask(), &state, at: 0), .none)
        XCTAssertEqual(step(onTask(), &state, at: 300), .none)
    }

    func testAnUnreadableFrontmostAppIsNotTreatedAsDrift() {
        var state = EnforcementState()
        let unknown = Observation(frontmostBundleID: nil, frontmostName: nil,
                                  idleFor: 0, screenLocked: false)

        XCTAssertEqual(step(unknown, &state, at: 0), .none)
        XCTAssertEqual(step(unknown, &state, at: 600), .none,
                       "a sensor that cannot read must never cause nagging")
    }

    // MARK: The wrong app

    func testAGlanceAtTheWrongAppIsNotDrift() {
        var state = EnforcementState()

        XCTAssertEqual(step(offTask(), &state, at: 0), .none)
        XCTAssertEqual(step(offTask(), &state, at: 30), .none,
                       "thirty seconds in Messages is looking something up")
    }

    func testStayingInTheWrongAppPastTheGraceIsDrift() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0)

        let action = step(offTask(), &state, at: 61)

        XCTAssertEqual(action, .nudge(reason: .wrongApp(name: "Messages"), escalation: 1))
    }

    func testComingBackResetsTheLadder() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0)
        step(offTask(), &state, at: 61)
        step(offTask(), &state, at: 130)
        XCTAssertEqual(state.escalations, 2)

        step(onTask(), &state, at: 200)

        XCTAssertEqual(state.escalations, 0)
        XCTAssertNil(state.driftingSince)
    }

    func testAlwaysAllowedAppsAreNeverDrift() {
        var state = EnforcementState()
        let finder = Observation(frontmostBundleID: "com.apple.finder", frontmostName: "Finder",
                                 idleFor: 0, screenLocked: false)

        XCTAssertEqual(step(finder, &state, at: 0), .none)
        XCTAssertEqual(step(finder, &state, at: 600), .none,
                       "locking somebody out of Finder is not enforcement")
    }

    // MARK: Idle

    func testBeingIdlePastTheThresholdIsDrift() {
        var state = EnforcementState()

        let action = step(onTask(idle: 301), &state, at: 0)

        XCTAssertEqual(action, .nudge(reason: .inactive(seconds: 301), escalation: 1))
    }

    func testBriefInactivityIsNotDrift() {
        var state = EnforcementState()
        XCTAssertEqual(step(onTask(idle: 120), &state, at: 0), .none)
    }

    func testALockedScreenIsNotDrift() {
        var state = EnforcementState()
        let locked = Observation(frontmostBundleID: "com.apple.MobileSMS", frontmostName: "Messages",
                                 idleFor: 900, screenLocked: true)

        XCTAssertEqual(step(locked, &state, at: 0), .none)
        XCTAssertEqual(step(locked, &state, at: 600), .none,
                       "shouting at a locked screen helps nobody")
    }

    // MARK: Gentle vs Firm

    func testGentleSaysOneThingAndThenStops() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0, policy: .gentle)

        XCTAssertEqual(step(offTask(), &state, at: 61, policy: .gentle),
                       .nudge(reason: .wrongApp(name: "Messages"), escalation: 1))
        XCTAssertEqual(step(offTask(), &state, at: 200, policy: .gentle), .none)
        XCTAssertEqual(step(offTask(), &state, at: 900, policy: .gentle), .none)
    }

    func testFirmEscalates() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0)

        var escalations: [Int] = []
        for minute in 1...4 {
            if case .nudge(_, let n) = step(offTask(), &state, at: Double(minute) * 61) {
                escalations.append(n)
            }
        }

        XCTAssertEqual(escalations, [1, 2, 3, 4])
    }

    func testNudgesAreSpacedOut() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0)
        XCTAssertEqual(step(offTask(), &state, at: 61),
                       .nudge(reason: .wrongApp(name: "Messages"), escalation: 1))

        XCTAssertEqual(step(offTask(), &state, at: 70), .none,
                       "nine seconds later is haranguing, not reminding")
    }

    // MARK: The disengage cap

    func testAfterSixEscalationsItSaysSoOnceAndThenGoesQuiet() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0)

        var actions: [EnforcementAction] = []
        for minute in 1...9 {
            actions.append(step(offTask(), &state, at: Double(minute) * 61))
        }

        let nudges = actions.filter { if case .nudge = $0 { return true }; return false }
        let disengages = actions.filter { if case .disengage = $0 { return true }; return false }

        XCTAssertEqual(nudges.count, 6, "six escalations, then it stops")
        XCTAssertEqual(disengages.count, 1, "and it says so exactly once")
        XCTAssertTrue(state.disengaged)
    }

    func testOnceDisengagedItStaysQuietEvenIfHeComesBackAndDriftsAgain() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0)
        for minute in 1...9 { step(offTask(), &state, at: Double(minute) * 61) }
        XCTAssertTrue(state.disengaged)

        step(onTask(), &state, at: 700)
        step(offTask(), &state, at: 800)

        XCTAssertEqual(step(offTask(), &state, at: 900), .none,
                       "having said it is giving up, it does not start again")
    }

    // MARK: The escape

    func testTheLocalEscapeEndsEnforcementUnconditionally() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0)
        step(offTask(), &state, at: 61)

        state = Enforcement.release(state)

        XCTAssertEqual(step(offTask(), &state, at: 200), .none)
        XCTAssertEqual(step(offTask(idle: 9999), &state, at: 9999), .none,
                       "released means released, whatever the sensors say")
    }

    func testTheEscapeDependsOnNothingThatCanBeUnavailable() {
        // `release` takes only the state and returns the state. It cannot
        // consult a model, a gateway or a network, because there is nowhere for
        // one to be passed in. That is the guarantee, expressed as a signature.
        var state = EnforcementState()
        state = Enforcement.release(state)
        XCTAssertTrue(state.released)
    }

    // MARK: Authorization

    func testAnUnconfirmedAllowlistEnforcesNothing() {
        var state = EnforcementState()
        let proposed = allowlist(confirmed: false)

        step(offTask(), &state, at: 0, allowlist: proposed)
        XCTAssertEqual(step(offTask(), &state, at: 600, allowlist: proposed), .none,
                       "the model proposes; it never silently authorizes")
    }

    // MARK: Reverse lockdown

    /// The list inverts: being ON it is now the violation.
    func testReverseLockdownNudgesHimForBeingInTheListedApp() {
        var state = EnforcementState()
        let keepAwayFrom = Allowlist(bundleIDs: ["com.apple.dt.Xcode"], confirmed: true)

        step(onTask(), &state, at: 0, policy: .reverse(.firm), allowlist: keepAwayFrom)
        let action = step(onTask(), &state, at: 61, policy: .reverse(.firm),
                          allowlist: keepAwayFrom)

        XCTAssertEqual(action, .nudge(reason: .wrongApp(name: "Xcode"), escalation: 1),
                       "he asked to be kept away from Xcode this evening")
    }

    func testReverseLockdownSaysNothingAboutAnythingElse() {
        var state = EnforcementState()
        let keepAwayFrom = Allowlist(bundleIDs: ["com.apple.dt.Xcode"], confirmed: true)

        step(offTask(), &state, at: 0, policy: .reverse(.firm), allowlist: keepAwayFrom)
        XCTAssertEqual(step(offTask(), &state, at: 600, policy: .reverse(.firm),
                            allowlist: keepAwayFrom), .none,
                       "Messages is not what he asked to be kept away from")
    }

    /// Nagging somebody for sitting still while telling them to rest would be
    /// absurd. Idle is only drift when the point is to keep him working.
    func testReverseLockdownNeverNagsAboutBeingIdle() {
        var state = EnforcementState()
        let keepAwayFrom = Allowlist(bundleIDs: ["com.apple.dt.Xcode"], confirmed: true)
        let idleElsewhere = Observation(frontmostBundleID: "com.apple.MobileSMS",
                                        frontmostName: "Messages",
                                        idleFor: 3600, screenLocked: false)

        step(idleElsewhere, &state, at: 0, policy: .reverse(.firm), allowlist: keepAwayFrom)
        XCTAssertEqual(step(idleElsewhere, &state, at: 3600, policy: .reverse(.firm),
                            allowlist: keepAwayFrom), .none,
                       "sitting still IS the goal during a reverse lockdown")
    }

    func testTheNeverADistractionSetHoldsInReverseToo() {
        var state = EnforcementState()
        // Even if 1Password were somehow on the keep-away list.
        let keepAwayFrom = Allowlist(bundleIDs: ["com.1password.1password"], confirmed: true)
        let manager = Observation(frontmostBundleID: "com.1password.1password",
                                  frontmostName: "1Password", idleFor: 0, screenLocked: false)

        step(manager, &state, at: 0, policy: .reverse(.firm), allowlist: keepAwayFrom)
        XCTAssertEqual(step(manager, &state, at: 600, policy: .reverse(.firm),
                            allowlist: keepAwayFrom), .none,
                       "reverse lockdown must not lock him out of his password manager")
    }

    func testTheEscapeWorksInReverseToo() {
        var state = EnforcementState()
        let keepAwayFrom = Allowlist(bundleIDs: ["com.apple.dt.Xcode"], confirmed: true)
        step(onTask(), &state, at: 0, policy: .reverse(.firm), allowlist: keepAwayFrom)
        step(onTask(), &state, at: 61, policy: .reverse(.firm), allowlist: keepAwayFrom)

        state = Enforcement.release(state)

        XCTAssertEqual(step(onTask(), &state, at: 200, policy: .reverse(.firm),
                            allowlist: keepAwayFrom), .none)
    }

    func testReverseLockdownStillStopsAfterSixEscalations() {
        var state = EnforcementState()
        let keepAwayFrom = Allowlist(bundleIDs: ["com.apple.dt.Xcode"], confirmed: true)
        step(onTask(), &state, at: 0, policy: .reverse(.firm), allowlist: keepAwayFrom)

        var actions: [EnforcementAction] = []
        for minute in 1...9 {
            actions.append(step(onTask(), &state, at: Double(minute) * 61,
                                policy: .reverse(.firm), allowlist: keepAwayFrom))
        }

        XCTAssertEqual(actions.filter { if case .nudge = $0 { return true }; return false }.count, 6)
        XCTAssertTrue(state.disengaged, "the same cap, because it is the same machinery")
    }

    // MARK: Only during focus

    func testABreakIsNotDrift() {
        var state = EnforcementState()

        step(offTask(), &state, at: 0, focusing: false)
        XCTAssertEqual(step(offTask(), &state, at: 600, focusing: false), .none)
    }

    func testDriftDuringABreakDoesNotCarryIntoTheNextBlock() {
        var state = EnforcementState()
        step(offTask(), &state, at: 0, focusing: false)
        step(offTask(), &state, at: 300, focusing: false)

        // Focus resumes. The grace period starts now, not when the break began.
        XCTAssertEqual(step(offTask(), &state, at: 310), .none)
        XCTAssertEqual(step(offTask(), &state, at: 372),
                       .nudge(reason: .wrongApp(name: "Messages"), escalation: 1))
    }
}
