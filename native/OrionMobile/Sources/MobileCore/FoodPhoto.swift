import Foundation

/*
 "Log food" with a photo (2026-11-02).

 The phone takes or picks a photo, adds an optional note, and saves one
 `FoodPhoto` record with the photo as a CKAsset into the link's private zone.
 ORION Link on the Mac fetches it with the zone's other changes and writes the
 food inbox the Mac's estimator reads:

   ~/.openclaw/orion-controlled/food-inbox/<id>.jpg   max 1280 px, JPEG q0.8
   ~/.openclaw/orion-controlled/food-inbox/<id>.json  {"id","at","note"}, `at` ISO-8601

 then marks the record done and drops the asset, so iCloud does not keep it.
 The record name is the id, so a retried save can never make a second entry.
*/
public enum FoodPhotoSchema {
    public static let recordType = "FoodPhoto"
    public static let photo = "photo"
    public static let at = "at"
    public static let note = "note"
    /// "pending" from the phone, "done" or "failed" once the Mac has looked.
    public static let status = "status"
    public static let reply = "reply"
    public static let device = "device"

    /// Both ends downscale to this on the long side.
    public static let maxPixels = 1280
    public static let jpegQuality = 0.8
    public static let noteLimit = 280
    /// The phone refuses to send anything bigger; a 1280 px JPEG is far smaller.
    public static let maxBytes = 8_000_000

    /// What the phone shows in the chat once the photo is on its way.
    public static let sentLine = "Sent to your Mac for an estimate…"

    /// Trimmed, single-spaced, cut to the limit. Empty when there is no note.
    public static func cleanNote(_ note: String?) -> String {
        let collapsed = (note ?? "").split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        return String(collapsed.prefix(noteLimit))
    }

    /// Ids are what the phone makes (a UUID): letters, digits, - and _, 1-64.
    public static func isValidID(_ id: String) -> Bool {
        (1...64).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    /// The long side scaled to `maxPixels`, never upscaled.
    public static func fittedSize(width: Int, height: Int) -> (width: Int, height: Int) {
        let long = max(width, height)
        guard long > maxPixels, long > 0 else { return (width, height) }
        let scale = Double(maxPixels) / Double(long)
        return (max(1, Int((Double(width) * scale).rounded())), max(1, Int((Double(height) * scale).rounded())))
    }
}
