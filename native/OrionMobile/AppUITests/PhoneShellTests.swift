import XCTest

final class PhoneShellTests: XCTestCase {
    private func openApproval() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--pairing-approval-test"]
        app.launch()
        app.tabBars.buttons["Control"].tap()
        XCTAssertTrue(app.buttons["reviewPairing"].waitForExistence(timeout: 10))
        app.buttons["reviewPairing"].tap()
        XCTAssertTrue(app.staticTexts["joiningDeviceID"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["joiningFingerprint"].label.count, 64)
        return app
    }

    func testPairingApprovalAccept() {
        let app = openApproval()
        XCTAssertFalse(app.buttons["approvePairing"].isEnabled)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Review exact device key before approval"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.switches["comparedPairingKey"].tap()
        XCTAssertTrue(app.buttons["approvePairing"].isEnabled)
        app.buttons["approvePairing"].tap()
        XCTAssertEqual(app.staticTexts["approvalStatus"].label, "Confirmation signed · awaiting service acceptance")
        XCTAssertFalse(app.buttons["approvePairing"].isEnabled)
        XCTAssertFalse(app.buttons["rejectPairing"].isEnabled)
    }

    func testPairingApprovalReject() {
        let app = openApproval()
        app.buttons["rejectPairing"].tap()
        XCTAssertEqual(app.staticTexts["approvalStatus"].label, "Pairing rejected · no confirmation signed")
        XCTAssertFalse(app.buttons["approvePairing"].isEnabled)
    }

    func testPairingApprovalExpired() {
        let app = XCUIApplication()
        app.launchArguments = ["--pairing-approval-test"]
        app.launch()
        app.tabBars.buttons["Control"].tap()
        XCTAssertTrue(app.staticTexts["approvalLoadStatus"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["approvalLoadStatus"].label, "Pairing request refused")
        XCTAssertFalse(app.buttons["reviewPairing"].exists)
    }

    func testPersistentKeyReadSessionProof() {
        let app = XCUIApplication()
        app.launchArguments = ["--read-session-test"]
        app.launch()
        app.tabBars.buttons["Control"].tap()
        XCTAssertTrue(app.staticTexts["deviceIdentityID"].waitForExistence(timeout: 10))
        app.buttons["signReadSession"].tap()
        XCTAssertEqual(app.staticTexts["readSessionProofStatus"].label, "Session proof signed · awaiting service acceptance")
        XCTAssertTrue(app.staticTexts["deviceIdentityStatus"].label.contains("not paired"))
    }

    func testPairingClaimProof() {
        let app = XCUIApplication()
        app.launchArguments = ["--pairing-proof-test"]
        app.launch()
        app.tabBars.buttons["Control"].tap()
        XCTAssertTrue(app.staticTexts["deviceIdentityID"].waitForExistence(timeout: 10))
        app.buttons["signTestPairing"].tap()
        XCTAssertEqual(app.staticTexts["pairingTestStatus"].label, "Test claim signed · no account paired")
        XCTAssertTrue(app.staticTexts["deviceIdentityStatus"].label.contains("not paired"))
    }

    func testDeviceIdentitySurvivesRelaunch() {
        let app = XCUIApplication()
        app.launch()
        app.tabBars.buttons["Control"].tap()
        let identifier = app.staticTexts["deviceIdentityID"]
        XCTAssertTrue(identifier.waitForExistence(timeout: 10))
        let first = identifier.label
        XCTAssertEqual(first.count, 64)
        XCTAssertTrue(app.staticTexts["deviceIdentityStatus"].label.contains("software-backed"))
        app.buttons["verifyDeviceKey"].tap()
        XCTAssertTrue(app.staticTexts["deviceKeyVerified"].waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        app.tabBars.buttons["Control"].tap()
        XCTAssertTrue(identifier.waitForExistence(timeout: 10))
        XCTAssertEqual(identifier.label, first)
        app.buttons["verifyDeviceKey"].tap()
        XCTAssertTrue(app.staticTexts["deviceKeyVerified"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Persistent Simulator identity — not paired"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testHTTPDisconnectDuringRefresh() {
        let app = XCUIApplication()
        app.launchArguments = ["--http-session-test"]
        app.launch()
        XCTAssertTrue(app.staticTexts["readingRevision"].waitForExistence(timeout: 15))
        app.buttons["refreshReading"].tap()
        app.tabBars.buttons["Control"].tap()
        app.buttons["disconnectReading"].tap()
        XCTAssertTrue(app.staticTexts["cancelledPendingRead"].waitForExistence(timeout: 2))
        app.tabBars.buttons["Today"].tap()
        XCTAssertEqual(app.staticTexts["connectionStatus"].label, "Reading disconnected")
        // The server delays the refresh response. Observe beyond that delay so
        // stale bytes or a cancellation error cannot restore the old reading.
        let end = Date().addingTimeInterval(7)
        while Date() < end {
            XCTAssertFalse(app.staticTexts["readingRevision"].exists)
            XCTAssertEqual(app.staticTexts["connectionStatus"].label, "Reading disconnected")
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertFalse(app.buttons["refreshReading"].exists)
    }

    func testHTTPPublishedPlanReadingAndRevocation() {
        checkPublishedPlan(arguments: ["--http-session-test"], revokedAfterRefresh: true)
    }

    func testPublishedPlanReading() {
        checkPublishedPlan(arguments: ["--local-today"], revokedAfterRefresh: false)
    }

    private func checkPublishedPlan(arguments: [String], revokedAfterRefresh: Bool) {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        let revision = app.staticTexts["readingRevision"]
        XCTAssertTrue(revision.waitForExistence(timeout: 15))
        XCTAssertTrue(revision.label.hasPrefix("Revision "))
        let initialRevision = revision.label
        XCTAssertFalse(app.staticTexts["sampleNotice"].exists)
        XCTAssertEqual(app.staticTexts["connectionStatus"].label, "Read from local development service")
        app.buttons["refreshReading"].tap()
        let ready = NSPredicate(format: "enabled == true")
        expectation(for: ready, evaluatedWith: app.buttons["refreshReading"])
        waitForExpectations(timeout: 15)
        XCTAssertEqual(app.staticTexts["connectionStatus"].label, "Read from local development service")
        XCTAssertEqual(revision.label, initialRevision)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Personal accepted plan — local read only"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        if revokedAfterRefresh {
            app.buttons["refreshReading"].tap()
            let denied = NSPredicate(format: "label == %@", "Access expired or revoked")
            expectation(for: denied, evaluatedWith: app.staticTexts["connectionStatus"])
            waitForExpectations(timeout: 10)
            XCTAssertFalse(revision.exists)
        }
    }

    func testHTTPFailureDoesNotUseLegacyToken() {
        let app = XCUIApplication()
        app.launchArguments = ["--http-session-test", "--local-today"]
        app.launch()
        let refused = NSPredicate(format: "label == %@", "Device session could not be verified")
        expectation(for: refused, evaluatedWith: app.staticTexts["connectionStatus"])
        waitForExpectations(timeout: 12)
        XCTAssertFalse(app.staticTexts["readingRevision"].exists)
        XCTAssertFalse(app.buttons["refreshReading"].exists)
    }

    func testHTTPDeviceSessionReadAndRevocation() {
        checkReadRecovery(arguments: ["--http-session-test"])
    }

    func testLocalReadRecoveryAndRevocation() {
        checkReadRecovery(arguments: ["--local-today"])
    }

    private func checkReadRecovery(arguments: [String]) {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        let revision = app.staticTexts["readingRevision"]
        XCTAssertTrue(revision.waitForExistence(timeout: 15))
        XCTAssertEqual(revision.label, "Revision 1")
        XCTAssertEqual(app.staticTexts["readingReason"].label, "Connection test fixture")
        XCTAssertTrue(app.staticTexts["readingFreshness"].label.contains("Stale"))
        app.buttons["refreshReading"].tap()
        let unavailable = NSPredicate(format: "label CONTAINS %@", "Source unavailable")
        expectation(for: unavailable, evaluatedWith: app.staticTexts["connectionStatus"])
        waitForExpectations(timeout: 10)
        XCTAssertTrue(revision.exists)
        app.buttons["refreshReading"].tap()
        let recovered = NSPredicate(format: "label == %@", "Read from local development service")
        expectation(for: recovered, evaluatedWith: app.staticTexts["connectionStatus"])
        waitForExpectations(timeout: 10)
        XCTAssertTrue(revision.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Local service reading — stale fixture"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["refreshReading"].tap()
        let revoked = NSPredicate(format: "label == %@", "Access expired or revoked")
        expectation(for: revoked, evaluatedWith: app.staticTexts["connectionStatus"])
        waitForExpectations(timeout: 10)
        XCTAssertFalse(revision.exists)
        XCTAssertFalse(app.staticTexts["readingReason"].exists)
    }

    func testDisconnectedAndSampleRoutes() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["connectionStatus"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["sampleNotice"].exists)
        app.buttons["openSample"].tap()
        XCTAssertTrue(app.staticTexts["sampleNotice"].exists)
        XCTAssertTrue(app.staticTexts["Outline a project idea"].exists)
        app.tabBars.buttons["Plan"].tap()
        XCTAssertTrue(app.staticTexts["sampleNotice"].exists)
        XCTAssertTrue(app.staticTexts["Wednesday, 9 September · London time"].exists)
        let planScreenshot = XCTAttachment(screenshot: app.screenshot())
        planScreenshot.name = "Sample plan — example data"
        planScreenshot.lifetime = .keepAlways
        add(planScreenshot)
        app.tabBars.buttons["Control"].tap()
        XCTAssertTrue(app.staticTexts["No personal records loaded"].exists)
        // Relaunch while the sample is still open: it must not become a saved day.
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["openSample"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["sampleNotice"].exists)
        app.buttons["openSample"].tap()
        let todayScreenshot = XCTAttachment(screenshot: app.screenshot())
        todayScreenshot.name = "Sample Today — example data"
        todayScreenshot.lifetime = .keepAlways
        add(todayScreenshot)
        app.swipeUp()
        app.buttons["closeSample"].tap()
        XCTAssertTrue(app.buttons["openSample"].exists)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["openSample"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["sampleNotice"].exists)
    }
}
