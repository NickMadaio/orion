import XCTest
import MobileCore
@testable import LinkCore
#if canImport(ImageIO)
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
#endif

/// The food inbox: the contract g-food's estimator reads.
/// `<id>.jpg` (max 1280 px, JPEG q0.8) and `<id>.json` = {"id","at","note"}.
final class FoodInboxTests: XCTestCase {
    private var dir: URL!
    private let at = Date(timeIntervalSince1970: 1_793_620_800)   // 2026-11-02T12:00:00Z

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    #if canImport(ImageIO)
    private func jpeg(width: Int, height: Int) throws -> Data {
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red: 0.9, green: 0.4, blue: 0.1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try XCTUnwrap(context.makeImage())
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }

    private func size(of url: URL) throws -> (Int, Int) {
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        return (properties[kCGImagePropertyPixelWidth] as? Int ?? 0, properties[kCGImagePropertyPixelHeight] as? Int ?? 0)
    }

    func testWritesTheJpegAndTheJsonUnderTheId() throws {
        let inbox = FoodInbox(directory: dir)
        let written = try inbox.write(image: try jpeg(width: 400, height: 300), id: "food-1", at: at, note: "  half a burrito ")
        XCTAssertEqual(written.photo.lastPathComponent, "food-1.jpg")
        XCTAssertEqual(written.meta.lastPathComponent, "food-1.json")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: written.meta)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["id", "at", "note"])
        XCTAssertEqual(object["id"] as? String, "food-1")
        XCTAssertEqual(object["at"] as? String, "2026-11-02T12:00:00Z")
        XCTAssertEqual(object["note"] as? String, "half a burrito")
        XCTAssertEqual(try size(of: written.photo).0, 400)
    }

    func testANoteIsAlwaysPresentEvenWhenEmpty() throws {
        let written = try FoodInbox(directory: dir).write(image: try jpeg(width: 64, height: 64), id: "food-2", at: at, note: nil)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: written.meta)) as? [String: Any])
        XCTAssertEqual(object["note"] as? String, "")
    }

    func testABigPhotoIsDownscaledToTwelveEightyOnTheLongSide() throws {
        let written = try FoodInbox(directory: dir).write(image: try jpeg(width: 4032, height: 3024), id: "big", at: at, note: nil)
        let (width, height) = try size(of: written.photo)
        XCTAssertEqual(width, 1280)
        XCTAssertEqual(height, 960)
        let portrait = try FoodInbox(directory: dir).write(image: try jpeg(width: 1500, height: 3000), id: "tall", at: at, note: nil)
        XCTAssertEqual(try size(of: portrait.photo).1, 1280)
    }

    func testTheSameIdTwiceDoesNotRewrite() throws {
        let inbox = FoodInbox(directory: dir)
        let first = try inbox.write(image: try jpeg(width: 64, height: 64), id: "same", at: at, note: "first")
        _ = try inbox.write(image: try jpeg(width: 64, height: 64), id: "same", at: at, note: "second")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: first.meta)) as? [String: Any])
        XCTAssertEqual(object["note"] as? String, "first")
        XCTAssertTrue(inbox.contains(id: "same"))
    }

    func testRefusesABadIdAndDataThatIsNotAnImage() throws {
        let inbox = FoodInbox(directory: dir)
        XCTAssertThrowsError(try inbox.write(image: try jpeg(width: 8, height: 8), id: "../escape", at: at, note: nil))
        XCTAssertThrowsError(try inbox.write(image: Data("nope".utf8), id: "ok", at: at, note: nil))
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("ok.json").path))
    }

    func testALongNoteIsCut() throws {
        let written = try FoodInbox(directory: dir).write(image: try jpeg(width: 8, height: 8), id: "n", at: at,
                                                          note: String(repeating: "a", count: 2000))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: written.meta)) as? [String: Any])
        XCTAssertEqual((object["note"] as? String)?.count, FoodPhotoSchema.noteLimit)
    }
    #endif

    func testEstimatorKickRunsTheInstalledInboxCommand() {
        let home = URL(fileURLWithPath: "/home/x")
        let command = FoodInbox.estimatorCommand(home: home)
        XCTAssertTrue(command.executable.path.hasSuffix(".openclaw/tools/node-v24.15.0/bin/node"))
        XCTAssertEqual(command.arguments, ["/home/x/.openclaw/orion-remote/scripts/orion-food-estimate", "inbox"])
    }
}
