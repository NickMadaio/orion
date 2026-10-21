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
    private var fixCount = 0
    /// Also sends the root view's outbox (entries iCloud refused earlier); set by the foreground root view.
    var flushOutbox: (() async -> Void)?
    private var routeObserver: NSObjectProtocol?

    private override init() {
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
        // Needs the "location" background mode (Info.plist): lets a one-shot fix finish after a
        // geofence or significant-change wake, when the app is not in the foreground.
        location.allowsBackgroundLocationUpdates = true
        location.pausesLocationUpdatesAutomatically = false
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
        // A geofence crossing is sent now, with a sample, rather than waiting for the next foreground.
        PlaceMonitor.shared.start { [weak self] entry in
            self?.deliver(entry)
            self?.captureAndFlush()
        }
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

    private func sample() { Task { await takeSample() } }

    private func takeSample() async {
        guard enabled, CMMotionActivityManager.isActivityAvailable() else { send(motion: "unknown"); return }
        let now = Date()
        let kind: String = await withCheckedContinuation { continuation in
            motion.queryActivityStarting(from: now.addingTimeInterval(-300), to: now, to: .main) { activities, _ in
                let latest = activities?.last { $0.confidence != .low }
                if latest?.automotive == true { continuation.resume(returning: "vehicle") }
                else if latest?.cycling == true { continuation.resume(returning: "cycling") }
                else if latest?.running == true { continuation.resume(returning: "running") }
                else if latest?.walking == true { continuation.resume(returning: "walking") }
                else if latest?.stationary == true { continuation.resume(returning: "still") }
                else { continuation.resume(returning: "unknown") }
            }
        }
        send(motion: kind)
    }

    /// What a background wake does (geofence, significant change, background refresh): take a fresh
    /// fix and a sample, then send the queue and the outbox at once. Held open with a background-task
    /// assertion so iOS does not suspend the app between the sample and the upload.
    func captureAndFlush() {
        BackgroundAssertion.run("orion.capture") { await self.captureAndFlushNow() }
    }

    func captureAndFlushNow() async {
        guard enabled else { await flushQueuedNow(); return }
        await refreshFix(timeout: 5)
        await takeSample()
        await flushQueuedNow()
        await flushOutbox?()
    }

    /// Ask for one fix and wait (briefly) for it, so the sample carries where he is now.
    private func refreshFix(timeout: TimeInterval) async {
        let before = fixCount
        location.requestLocation()
        var waited = 0.0
        while fixCount == before, waited < timeout {
            try? await Task.sleep(nanoseconds: 250_000_000); waited += 0.25
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
    /// Only the foreground view's `log` is used while the app is active; in the background the view's
    /// outbox would sit until the next foreground, so the entry is queued and sent straight away.
    func deliver(_ entry: LinkLog) {
        if let log, UIApplication.shared.applicationState == .active { log(entry); return }
        SignalQueue.enqueue(entry)
        flushQueued()
    }

    private var flushing = false
    /// Send what a background launch left behind; entries iCloud refuses stay for the next try.
    func flushQueued() {
        guard !SignalQueue.pending().isEmpty else { return }
        BackgroundAssertion.run("orion.flush") { await self.flushQueuedNow() }
    }

    func flushQueuedNow() async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        // Re-read each time: entries queued while this runs go out in the same pass.
        while let item = SignalQueue.pending().first {
            if let log, UIApplication.shared.applicationState == .active { log(item.entry) }
            else if await CloudLink.sendNow(item.entry) == false { return }
            SignalQueue.remove(item.text)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let latest = locations.last
        Task { @MainActor in
            self.latestPlace = latest
            self.fixCount += 1
            // Moving around after bedtime (the trip home from a night out) means awake.
            await NightRoutine.shared.noteAwake(at: latest?.timestamp ?? Date(), planner: PlannerStore())
            // A significant change in the background: sample and send now, not at the next foreground.
            if UIApplication.shared.applicationState != .active { self.captureAndFlush() }
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

/// Keeps the app running long enough to finish a send after a background wake (geofence, significant
/// change, background refresh). iOS gives roughly 30 seconds; the expiry handler ends it cleanly.
@MainActor
enum BackgroundAssertion {
    private final class Box { var id = UIBackgroundTaskIdentifier.invalid }

    static func run(_ name: String, _ work: @escaping @MainActor () async -> Void) {
        let box = Box()
        let end = { if box.id != .invalid { UIApplication.shared.endBackgroundTask(box.id); box.id = .invalid } }
        box.id = UIApplication.shared.beginBackgroundTask(withName: name) { end() }
        Task { @MainActor in await work(); end() }
    }
}
