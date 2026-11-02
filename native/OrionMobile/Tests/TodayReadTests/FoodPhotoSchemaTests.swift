import XCTest
@testable import MobileCore

final class FoodPhotoSchemaTests: XCTestCase {
    func testNotesAreTrimmedCollapsedAndCut() {
        XCTAssertEqual(FoodPhotoSchema.cleanNote("  two\n slices   of pizza "), "two slices of pizza")
        XCTAssertEqual(FoodPhotoSchema.cleanNote(nil), "")
        XCTAssertEqual(FoodPhotoSchema.cleanNote(String(repeating: "x", count: 900)).count, FoodPhotoSchema.noteLimit)
    }

    func testIdsAreSafeFileNames() {
        XCTAssertTrue(FoodPhotoSchema.isValidID(UUID().uuidString))
        XCTAssertFalse(FoodPhotoSchema.isValidID("../x"))
        XCTAssertFalse(FoodPhotoSchema.isValidID(""))
        XCTAssertFalse(FoodPhotoSchema.isValidID("a/b"))
    }

    func testTheLongSideFitsTwelveEightyAndSmallPhotosStay() {
        XCTAssertTrue(FoodPhotoSchema.fittedSize(width: 4032, height: 3024) == (1280, 960))
        XCTAssertTrue(FoodPhotoSchema.fittedSize(width: 1000, height: 3000) == (427, 1280))
        XCTAssertTrue(FoodPhotoSchema.fittedSize(width: 640, height: 480) == (640, 480))
    }
}
