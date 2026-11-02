import Foundation
import MobileCore
#if canImport(ImageIO)
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
#endif

/*
 The food inbox (2026-11-02): where a photo from the phone's "Log food" lands
 for the Mac's estimator. The contract is FoodPhotoSchema's:

   <directory>/<id>.jpg   long side at most 1280 px, JPEG quality 0.8
   <directory>/<id>.json  {"id","at","note"}, `at` ISO-8601, note "" when none

 The photo is written first and the JSON last, each atomically, so a watcher
 that keys on the JSON never sees it before its photo. An id already in the
 inbox is left alone: CloudKit can hand the same record over twice.
*/
public struct FoodInbox {
    public struct Written: Equatable {
        public let photo: URL
        public let meta: URL
    }

    public let directory: URL

    public init(directory: URL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".openclaw/orion-controlled/food-inbox")) {
        self.directory = directory
    }

    public func contains(id: String) -> Bool {
        FileManager.default.fileExists(atPath: directory.appendingPathComponent("\(id).json").path)
    }

    @discardableResult
    public func write(image: Data, id: String, at: Date, note: String?) throws -> Written {
        guard FoodPhotoSchema.isValidID(id) else { throw LinkError.invalidCommand("not a photo id") }
        let written = Written(photo: directory.appendingPathComponent("\(id).jpg"),
                              meta: directory.appendingPathComponent("\(id).json"))
        if contains(id: id) { return written }
        let jpeg = try Self.downscaled(image)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try jpeg.write(to: written.photo, options: .atomic)
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(identifier: "UTC")
        let meta: [String: String] = ["id": id, "at": formatter.string(from: at), "note": FoodPhotoSchema.cleanNote(note)]
        try JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys]).write(to: written.meta, options: .atomic)
        return written
    }

    /// Any image ImageIO reads (JPEG, HEIC, PNG), as a JPEG fitted to 1280 px,
    /// orientation applied, so the estimator sees the plate the right way up.
    static func downscaled(_ data: Data) throws -> Data {
        #if canImport(ImageIO)
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int
        else { throw LinkError.invalidCommand("that photo could not be read") }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: min(max(width, height), FoodPhotoSchema.maxPixels),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw LinkError.invalidCommand("that photo could not be read")
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw LinkError.invalidCommand("the photo could not be saved")
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: FoodPhotoSchema.jpegQuality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw LinkError.invalidCommand("the photo could not be saved") }
        return output as Data
        #else
        throw LinkError.invalidCommand("photos need ImageIO")
        #endif
    }
}
