import Foundation
import MobileCore

/// The places the Mac publishes for the phone's geofences (contract C6).
public enum KnownPlacesReader {
    /// known-places.json when it holds places; otherwise Nick's seeded home (150 m), so the phone
    /// always watches the Mac's own idea of home instead of guessing its own.
    public static func places(fileData: Data?) -> [LinkSnapshot.KnownPlace] {
        guard let fileData, let object = try? JSONSerialization.jsonObject(with: fileData) as? [String: Any],
              let list = object["places"] as? [[String: Any]] else { return [.seededHome] }
        let places = list.compactMap { item -> LinkSnapshot.KnownPlace? in
            guard let id = item["id"] as? String, let lat = (item["lat"] as? NSNumber)?.doubleValue,
                  let lon = (item["lon"] as? NSNumber)?.doubleValue, (-90...90).contains(lat), (-180...180).contains(lon) else { return nil }
            return .init(id: id, name: item["name"] as? String ?? id, lat: lat, lon: lon,
                         radiusM: (item["radiusM"] as? NSNumber)?.doubleValue ?? 120, kind: item["kind"] as? String ?? "other")
        }
        return places.isEmpty ? [.seededHome] : Array(places.prefix(20))
    }
}
