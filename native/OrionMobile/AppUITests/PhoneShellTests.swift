import XCTest

final class PhoneShellTests: XCTestCase {
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
