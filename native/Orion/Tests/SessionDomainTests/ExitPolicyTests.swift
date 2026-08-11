//
//  Getting out.
//
//  The case that matters most is the one where everything is broken: the model
//  is down, the gateway is down, and he still has to be able to leave.
//

import XCTest
@testable import SessionDomain

final class ExitPolicyTests: XCTestCase {

    private let start = Date(timeIntervalSince1970: 1_772_452_800)

    private func request(_ offset: TimeInterval, unreachable: Bool = true) -> ExitRequest {
        ExitRequest(at: start.addingTimeInterval(offset), reason: "the build is running",
                    modelUnreachable: unreachable)
    }

    // MARK: With a model

    func testAModelThatAgreesLetsHimOut() {
        let verdict = ExitPolicy.decide(
            requests: [request(0, unreachable: false)],
            modelVerdict: ModelVerdict(agreed: true, reason: "fair enough"),
            now: start
        )

        XCTAssertEqual(verdict, .granted(because: "fair enough"))
        XCTAssertTrue(verdict.allowsExit)
        XCTAssertFalse(verdict.isFallback)
    }

    func testAModelThatRefusesKeepsHimIn() {
        let verdict = ExitPolicy.decide(
            requests: [request(0, unreachable: false)],
            modelVerdict: ModelVerdict(agreed: false, reason: "you have twelve minutes left"),
            now: start
        )

        XCTAssertFalse(verdict.allowsExit)
        XCTAssertEqual(verdict, .refused(because: "you have twelve minutes left"))
    }

    // MARK: Without a model

    /// "I can't reach the model" is a different sentence from "no", and saying
    /// the second when the first is true is how somebody comes to distrust it.
    func testAnUnreachableModelIsUndecidedNotRefused() {
        let verdict = ExitPolicy.decide(requests: [request(0)], modelVerdict: nil, now: start)

        guard case .undecided(let because) = verdict else {
            return XCTFail("expected .undecided, got \(verdict)")
        }
        XCTAssertTrue(because.contains("can't reach"), because)
        XCTAssertFalse(verdict.allowsExit)
    }

    func testItTellsHimHowManyMoreTriesItWillTake() {
        XCTAssertEqual(ExitPolicy.remainingAttempts(requests: [], now: start), 3)
        XCTAssertEqual(ExitPolicy.remainingAttempts(requests: [request(0)], now: start), 2)
        XCTAssertEqual(
            ExitPolicy.remainingAttempts(requests: [request(0), request(30)], now: start), 1)
    }

    // MARK: The fail-closed hatch

    func testThreeIgnoredRequestsInsideTheWindowOpenTheHatch() {
        let requests = [request(0), request(60), request(120)]

        let verdict = ExitPolicy.decide(requests: requests, modelVerdict: nil,
                                        now: start.addingTimeInterval(120))

        XCTAssertEqual(verdict, .releasedByFallback(after: 3, within: 5 * 60))
        XCTAssertTrue(verdict.allowsExit)
        XCTAssertTrue(verdict.isFallback, "the archive has to record that this was not argued for")
    }

    func testRequestsOutsideTheWindowDoNotCount() {
        // Three tries, but spread over twenty minutes. That is not a system
        // failing to answer, it is somebody who keeps changing their mind.
        let requests = [request(0), request(600), request(1200)]

        let verdict = ExitPolicy.decide(requests: requests, modelVerdict: nil,
                                        now: start.addingTimeInterval(1200))

        XCTAssertFalse(verdict.allowsExit)
    }

    /// The ordering that makes the hatch trustworthy: it opens even when the
    /// model IS answering, and answering no. A model that is wrong, slow or
    /// adversarial cannot hold it shut.
    func testTheHatchOpensEvenWhenTheModelSaysNo() {
        let requests = [request(0), request(60), request(120)]

        let verdict = ExitPolicy.decide(
            requests: requests,
            modelVerdict: ModelVerdict(agreed: false, reason: "absolutely not"),
            now: start.addingTimeInterval(120)
        )

        XCTAssertTrue(verdict.allowsExit,
                      "the deterministic check runs before the model is consulted")
        XCTAssertTrue(verdict.isFallback)
    }

    func testRequestsThatReachedTheModelDoNotCountTowardsTheHatch() {
        // He asked three times and got three real answers. That is the system
        // working, not failing, so the hatch stays shut.
        let requests = [request(0, unreachable: false),
                        request(60, unreachable: false),
                        request(120, unreachable: false)]

        let verdict = ExitPolicy.decide(
            requests: requests,
            modelVerdict: ModelVerdict(agreed: false, reason: "not yet"),
            now: start.addingTimeInterval(120)
        )

        XCTAssertFalse(verdict.allowsExit)
    }

    // MARK: Everything unavailable at once

    func testWithNothingWorkingAtAllHeStillGetsOut() {
        // No model, no gateway, no network. Three tries.
        var requests: [ExitRequest] = []
        var verdict = ExitPolicy.decide(requests: requests, modelVerdict: nil, now: start)
        XCTAssertFalse(verdict.allowsExit)

        for attempt in 1...3 {
            requests.append(request(Double(attempt) * 30))
            verdict = ExitPolicy.decide(requests: requests, modelVerdict: nil,
                                        now: start.addingTimeInterval(Double(attempt) * 30))
        }

        XCTAssertTrue(verdict.allowsExit, "there is no state of the world where he is stuck")
    }
}
