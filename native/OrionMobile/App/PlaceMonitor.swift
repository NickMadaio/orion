import CoreLocation
import Foundation
import MobileCore

/*
 Geofences for the places Nick confirmed (WP5, 2026-10-16; home is Scape Shoreditch).

 The reliable "am I home" signal. Region monitoring wakes the app when he crosses a
 boundary even with it closed, so a place event arrives where a 10-minute sample never
 would. The Mac publishes his known places in the snapshot (known-places.json, C6); this
 watches up to 20 of them and reports each enter/exit as a `LinkLog.place`, through the same
 queue a background sample uses. Needs "Always" location, which PhoneSignals already asks for.
*/
@MainActor
final class PlaceMonitor {
    static let shared = PlaceMonitor()
    /// iOS allows 20 monitored regions per app.
    static let maxPlaces = 20

    /// The seed until the Mac has published his places: home, so the first leave/arrive works at once.
    static let home = LinkSnapshot.KnownPlace(id: "home", name: "Scape Shoreditch", lat: 51.5273608, lon: -0.0865265, radiusM: 120, kind: "home")

    private var emit: ((LinkLog) -> Void)?
    private var monitor: CLMonitor?
    private var events: Task<Void, Never>?
    private var watched: [String: LinkSnapshot.KnownPlace] = [:]

    func start(emit: @escaping (LinkLog) -> Void) {
        self.emit = emit
        guard events == nil else { return }
        events = Task { [weak self] in
            let monitor = await CLMonitor("orion.places")
            await MainActor.run { self?.monitor = monitor }
            // Re-adding the saved conditions is what lets iOS deliver the event that relaunched us.
            await self?.sync(places: self?.savedPlaces() ?? [Self.home])
            do {
                for try await event in await monitor.events {
                    await MainActor.run { self?.handle(event) }
                }
            } catch {}
        }
    }

    func stop() {
        events?.cancel(); events = nil
        if let monitor { for id in watched.keys { Task { await monitor.remove(id) } } }
        watched = [:]; monitor = nil
    }

    /// The Mac's latest list of places (from the snapshot). Replaces what is watched.
    func update(places: [LinkSnapshot.KnownPlace]?) {
        let next = places?.isEmpty == false ? places! : [Self.home]
        UserDefaults.standard.set(try? JSONEncoder().encode(next), forKey: "orion.places.known")
        Task { await sync(places: next) }
    }

    private func savedPlaces() -> [LinkSnapshot.KnownPlace]? {
        UserDefaults.standard.data(forKey: "orion.places.known").flatMap { try? JSONDecoder().decode([LinkSnapshot.KnownPlace].self, from: $0) }
    }

    private func sync(places: [LinkSnapshot.KnownPlace]) async {
        guard let monitor else { return }
        let wanted = Dictionary(uniqueKeysWithValues: places.prefix(Self.maxPlaces).map { ($0.id, $0) })
        for (id, place) in wanted where watched[id] != place {
            let center = CLLocationCoordinate2D(latitude: place.lat, longitude: place.lon)
            await monitor.add(CLMonitor.CircularGeographicCondition(center: center, radius: max(100, place.radiusM)), identifier: id)
        }
        for id in watched.keys where wanted[id] == nil { await monitor.remove(id) }
        watched = wanted
    }

    private func handle(_ event: CLMonitor.Event) {
        let name: String
        switch event.state {
        case .satisfied: name = "enter"
        case .unsatisfied: name = "exit"
        default: return
        }
        guard watched[event.identifier] != nil || event.identifier == Self.home.id else { return }
        // CLMonitor reports the current state when a place is added; only a change is a crossing.
        // The first time a place is seen it just records where he is.
        var states = UserDefaults.standard.dictionary(forKey: "orion.places.state") as? [String: String] ?? [:]
        let previous = states[event.identifier]
        states[event.identifier] = name
        UserDefaults.standard.set(states, forKey: "orion.places.state")
        guard let previous, previous != name else { return }
        emit?(.place(event: name, placeId: event.identifier, at: ISO8601DateFormatter().string(from: event.date)))
    }
}
