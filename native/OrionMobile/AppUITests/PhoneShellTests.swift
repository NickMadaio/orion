import XCTest

final class PhoneShellTests: XCTestCase {
    func testLocalReadRecoveryAndRevocation() {
        let app = XCUIApplication()
        app.launchArguments = ["--local-today"]
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
