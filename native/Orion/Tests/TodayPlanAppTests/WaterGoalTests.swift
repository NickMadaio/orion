import XCTest
import MobileCore
@testable import Orion

/// The water goal (2026-11-04): one setting inside `nutritionGoals`, read by the Health tab and written by its right-click menu.
@MainActor
final class WaterGoalTests: XCTestCase {
    private var dir: URL!
    private var file: URL { dir.appendingPathComponent("health-log.json") }

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("watergoal-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        setenv("ORION_HEALTH_LOG", file.path, 1)
        let seed: [String: Any] = ["schema": "orion.health.v3", "updatedAt": "", "supplements": [Any](), "supplementLog": [String: Any](),
                                   "workouts": [Any](), "phoneScreen": ["locked": true]]
        try JSONSerialization.data(withJSONObject: seed).write(to: file)
    }

    override func tearDownWithError() throws {
        unsetenv("ORION_HEALTH_LOG")
        try? FileManager.default.removeItem(at: dir)
    }

    private func goals(_ json: String) throws -> NutritionGoals {
        try JSONDecoder().decode(NutritionGoals.self, from: Data(json.utf8))
    }

    func testAGoalsObjectWithoutWaterReadsAsNine() throws {
        XCTAssertEqual(try goals(#"{"calories":2600,"protein":180,"carbohydrates":250,"fat":70,"fiber":30}"#).water, 9)
        XCTAssertEqual(try goals(#"{"water":7}"#).water, 7, "Link may write only what it knows; the rest take defaults")
        XCTAssertEqual(try goals(#"{"water":7}"#).calories, 2_200)
        XCTAssertEqual(NutritionGoals().water, 9)
    }

    func testAStoredGoalOutOfRangeIsClamped() throws {
        XCTAssertEqual(try goals(#"{"water":0}"#).water, 1)
        XCTAssertEqual(try goals(#"{"water":-4}"#).water, 1)
        XCTAssertEqual(try goals(#"{"water":500}"#).water, 30)
    }

    func testSettingTheGoalWritesTheFileClampsAndKeepsEverythingElse() throws {
        let health = HealthLog()
        health.start()
        XCTAssertEqual(health.waterGoal, 9)
        health.setWaterGoal(12)
        XCTAssertEqual(health.waterGoal, 12, "the UI sees it at once")
        health.setWaterGoal(99)
        XCTAssertEqual(health.waterGoal, 30)
        health.setWaterGoal(-2)
        XCTAssertEqual(health.waterGoal, 1)
        health.setWaterGoal(8)
        let stored = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual((stored["nutritionGoals"] as? [String: Any])?["water"] as? Int, 8)
        XCTAssertEqual((stored["nutritionGoals"] as? [String: Any])?["calories"] as? Int, 2_200)
        XCTAssertEqual((stored["phoneScreen"] as? [String: Any])?["locked"] as? Bool, true, "fields the app does not know survive")
    }

    func testSavingCalorieGoalsKeepsTheWaterGoal() throws {
        let health = HealthLog()
        health.start()
        health.setWaterGoal(11)
        var changed = health.nutritionGoals
        changed.calories = 2_500
        health.setNutritionGoals(changed)
        XCTAssertEqual(health.waterGoal, 11)
        XCTAssertEqual(health.nutritionGoals.calories, 2_500)
    }

    func testTheSectionsModelDefaultsToTheSharedGoal() {
        XCTAssertEqual(HealthSectionsModel.Inputs().waterTarget, WaterGoal.default)
    }
}
