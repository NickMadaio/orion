import Foundation

/// Model output may select a current app-written fact, never supply its text.
enum NarrativeSelection {
    static func selectedID(_ response: String?, allowed: [String]) -> String? {
        guard let response, response.utf8.count <= 256,
              let data = response.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              object.count == 1, let id = object["highlight"], id != "none",
              allowed.contains(id) else { return nil }
        return id
    }
}
