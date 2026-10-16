import AVFAudio
import CoreLocation
import CoreMotion
import SwiftUI
import UIKit
import MobileCore

/*
 What the phone can tell ORION about Nick's state (2026-09-29).

 "he uses my phone's location, activity, and stuff like that to gauge my current
 state and compares that to what it should be." This is the observing half: a
 small sample — motion (still / walking / vehicle…), charging, and a coarse
 place — taken when ORION is opened and every ten minutes while it stays open,
 and sent to the Mac's history. The life loop reads the history; nothing acts
 on a single sample.

 Off until Nick turns it on (Control ▸ Signals). Location is rounded to about
 100 m before it leaves the phone. Background sampling needs "Always" location
 and is added with the live life loop, not before there is a use for it.
*/
@MainActor
final class PhoneSignals: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = PhoneSignals()

    @AppStorage("orion.signals.enabled") var enabled = false { didSet { if enabled { start() } else { stop() } } }
    @Published private(set) var last: String?

    /// Set by the foreground root view. While it is nil (a background relaunch), samples are queued, not dropped.
    var log: ((LinkLog) -> Void)? { didSet { if log != nil { flushQueued() } } }
    private let motion = CMMotionActivityManager()
    private let location = CLLocationManager()
    private var timer: Timer?
    private var latestPlace: CLLocation?
    private var routeObserver: NSObjectProtocol?

    private override init() {
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    func start() {
        guard enabled else { return }
        switch location.authorizationStatus {
        case .notDetermined: location.requestWhenInUseAuthorization()
        // "Always" lets arriving somewhere (home at 2 AM) wake ORION with the app
        // closed — that is how the alarm learns he was out late. Asked once, after
        // When-In-Use, which is how iOS wants it.
        case .authorizedWhenInUse: location.requestAlwaysAuthorization()
        default: break
        }
        if CLLocationManager.significantLocationChangeMonitoringAvailable() {
            location.startMonitoringSignificantLocationChanges()
        }
        location.requestLocation()
        sample()
        PlaceMonitor.shared.start { [weak self] entry in self?.deliver(entry) }
        // Connecting or disconnecting headphones is worth one extra sample (the phone's audio route).
        if routeObserver == nil {
            routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
                let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
                guard reason == .newDeviceAvailable || reason == .oldDeviceUnavailable else { return }
                Task { @MainActor in self?.sample() }
            }
        }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.location.requestLocation(); self?.sample() }
        }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        location.stopMonitoringSignificantLocationChanges()
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
        routeObserver = nil
        PlaceMonitor.shared.stop()
    }

    /// The phone's output route, from the ports iOS reports. Only readable while the app runs.
    static func audioRoute(for ports: [AVAudioSession.Port]) -> String {
        if ports.contains(where: { [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE].contains($0) }) { return "bluetooth" }
        if ports.contains(.headphones) { return "wired" }
        if ports.contains(where: { [.builtInSpeaker, .builtInReceiver, .airPlay].contains($0) }) { return "speaker" }
        return "unknown"
    }

    private func sample() {
        guard enabled, CMMotionActivityManager.isActivityAvailable() else { send(motion: "unknown"); return }
        let now = Date()
        motion.queryActivityStarting(from: now.addingTimeInterval(-300), to: now, to: .main) { [weak self] activities, _ in
            let latest = activities?.last { $0.confidence != .low }
            let kind: String
            if latest?.automotive == true { kind = "vehicle" }
            else if latest?.cycling == true { kind = "cycling" }
            else if latest?.running == true { kind = "running" }
            else if latest?.walking == true { kind = "walking" }
            else if latest?.stationary == true { kind = "still" }
            else { kind = "unknown" }
            Task { @MainActor in self?.send(motion: kind) }
        }
    }

    private func send(motion kind: String) {
        let charging = [.charging, .full].contains(UIDevice.current.batteryState)
        let place = latestPlace.flatMap { $0.timestamp.timeIntervalSinceNow > -900 ? $0.coordinate : nil }
        let route = Self.audioRoute(for: AVAudioSession.sharedInstance().currentRoute.outputs.map(\.portType))
        let entry = LinkLog.signal(at: ISO8601DateFormatter().string(from: Date()), motion: kind, charging: charging,
                                   latitude: place?.latitude, longitude: place?.longitude, audio: route)
        deliver(entry)
        last = "\(kind), \(charging ? "charging" : "on battery")\(place == nil ? "" : ", place known") · \(Date().formatted(date: .omitted, time: .shortened))"
    }

    /// Straight to the Mac's history while the app is in the foreground, else queued (and sent at once if iCloud takes it).
    private func deliver(_ entry: LinkLog) {
        if let log { log(entry); return }
        SignalQueue.enqueue(entry)
        flushQueued()
    }

    private var flushing = false
    /// Send what a background launch left behind; entries iCloud refuses stay for the next try.
    func flushQueued() {
        guard !flushing, !SignalQueue.pending().isEmpty else { return }
        flushing = true
        Task { @MainActor in
            defer { flushing = false }
            for item in SignalQueue.pending() {
                if let log { log(item.entry) } else if await CloudLink.sendNow(item.entry) == false { return }
                SignalQueue.remove(item.text)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let latest = locations.last
        Task { @MainActor in
            self.latestPlace = latest
            // Moving around after bedtime (the trip home from a night out) means awake.
            await NightRoutine.shared.noteAwake(at: latest?.timestamp ?? Date(), planner: PlannerStore())
            if UIApplication.shared.applicationState != .active { self.sample() }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in if self.enabled { self.start() } }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

/// Samples and place events taken while the app was not in the foreground (a significant-change
/// or geofence relaunch). Kept in the app group, like `NightRoutine.record`'s queue, so none is dropped.
enum SignalQueue {
    private static let key = "orion.signals.queued"
    private static let limit = 60
    private static var defaults: UserDefaults { UserDefaults(suiteName: "group.com.nickmadaio.orion") ?? .standard }

    static func enqueue(_ entry: LinkLog) {
        guard let text = try? entry.encoded() else { return }
        let all = ((defaults.array(forKey: key) as? [String]) ?? []) + [text]
        // Over the limit, plain samples go first; a place event outlives them (SignalQueuePolicy).
        let isPlace: (String) -> Bool = { (try? LinkLog.decode($0)).map(SignalQueuePolicy.isPlace) ?? false }
        defaults.set(SignalQueuePolicy.trim(all, limit: limit, isPlace: isPlace), forKey: key)
    }

    static func pending() -> [(text: String, entry: LinkLog)] {
        ((defaults.array(forKey: key) as? [String]) ?? []).compactMap { text in (try? LinkLog.decode(text)).map { (text, $0) } }
    }

    static func remove(_ text: String) {
        var queued = (defaults.array(forKey: key) as? [String]) ?? []
        if let index = queued.firstIndex(of: text) { queued.remove(at: index) }
        defaults.set(queued, forKey: key)
    }
}

/// Control ▸ Signals: the switch, what is shared, and the last sample.
struct SignalsSection: View {
    @ObservedObject var signals: PhoneSignals

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Signals", tint: Phone.soft)
            Toggle(isOn: $signals.enabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Share motion and location with ORION").font(.system(size: 15, weight: .medium))
                    Text("While ORION is open: whether you're still, walking or travelling, if the phone is charging, and roughly where you are (to ~100 m). Kept in your Mac's history so ORION can learn your real routine.")
                        .font(.system(size: 12)).foregroundStyle(Phone.dim)
                }
            }
            .tint(Phone.accent)
            if signals.enabled, let last = signals.last {
                Text("Last: \(last)").font(Phone.mono(11, .medium)).foregroundStyle(Phone.soft)
            }
        }
    }
}
