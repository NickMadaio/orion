import Foundation

/// Decides when a background wake may take a sample and send (PhoneSignals).
///
/// Two loops it prevents: a one-shot fix the app asked for must not itself trigger another capture
/// (capture -> requestLocation -> didUpdateLocations -> capture ...), and wakes that come in bursts
/// must not each cost a fix, a sample and an upload.
public struct CaptureGate: Sendable {
    public enum Reason: Sendable { case geofence, significantChange, backgroundRefresh }

    /// At most one non-geofence capture per this many seconds.
    public static let minInterval: TimeInterval = 5 * 60
    /// A requested fix that has not arrived by now is given up on, so it cannot swallow a later real update.
    public static let requestedFixWindow: TimeInterval = 15

    private var lastCapture: Date?
    private var requestedAt: Date?

    public init() {}

    /// Call just before `requestLocation()`.
    public mutating func noteRequestedFix(at now: Date) { requestedAt = now }

    /// True when this location update is the answer to our own request (and so must not start a capture).
    public mutating func consumeRequestedFix(at now: Date) -> Bool {
        defer { requestedAt = nil }
        guard let requestedAt else { return false }
        return now.timeIntervalSince(requestedAt) <= Self.requestedFixWindow
    }

    /// Geofence enter/exit always captures once; everything else at most once per `minInterval`.
    public mutating func allow(_ reason: Reason, at now: Date) -> Bool {
        if reason != .geofence, let lastCapture, now.timeIntervalSince(lastCapture) < Self.minInterval { return false }
        lastCapture = now
        return true
    }
}
