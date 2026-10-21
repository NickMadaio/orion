import BackgroundTasks
import CloudKit
import CoreMotion
import Foundation
import UIKit
import MobileCore

/*
 Keeping ORION current with the app closed (2026-09-29).

 Two things wake the app in the background: a CloudKit push (the Mac changed
 something) and the night check this schedules for after bedtime. Each run
 reads the Mac's latest snapshot straight from iCloud, looks for signs he is
 still up, rewrites the widgets' glance and updates the lock screen.

 The late-night alarm used to move only if the phone saw him awake — ORION
 opened, a notification answered, or a location change with Signals on. Now
 three more signals count, none of which needs him to do anything:
   · the phone's own motion history: walking or travelling after bedtime;
   · the phone being unlocked when the night check runs;
   · the Mac in use after bedtime (its last keyboard or mouse input).
*/
@MainActor
enum BackgroundRefresh {
    static let nightTask = "com.nickmadaio.orion.phone.night"
    private static var lastRun = Date.distantPast
    private static var running = false

    /// Called from `didFinishLaunching`: the handler must be registered before launch ends.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: nightTask, using: .main) { task in
            let work = Task { @MainActor in
                await run(force: true)
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    /// Ask for the next background refresh; iOS decides exactly when. At night it
    /// is the awake check after bedtime; in the day, about every half hour, so the
    /// widgets and lock screen stay current when ORION is never opened.
    static func scheduleNightCheck(bed: Date, wake: Date, now: Date = Date()) {
        let request = BGAppRefreshTaskRequest(identifier: nightTask)
        if now < wake.addingTimeInterval(-30 * 60) && now >= bed.addingTimeInterval(-60 * 60) {
            request.earliestBeginDate = max(now.addingTimeInterval(20 * 60), bed.addingTimeInterval(30 * 60))
        } else {
            request.earliestBeginDate = now.addingTimeInterval(30 * 60)
        }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: nightTask)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// At most every five minutes unless forced; pushes can arrive every thirty seconds.
    static func run(force: Bool = false, now: Date = Date()) async {
        guard !running, force || now.timeIntervalSince(lastRun) > 5 * 60 else { return }
        running = true
        defer { running = false; lastRun = Date() }
        let planner = PlannerStore()
        await planner.loadTodos()
        let snapshot = await fetchSnapshot() ?? SnapshotCache.load()
        // Extra phone time ORION granted while the app was in the background.
        if let grant = snapshot?.screenGrant, grant.until > now {
            FocusLock.shared.grant(grant, now: now)
            await CloudLink.sendNow(FocusLock.screenState(now: now))
        }
        // Up, by WHOOP or the phone's signals as the Mac reads them: the night lock
        // comes off even if he never opens ORION. A lock past its end comes off too.
        FocusLock.shared.releaseIfExpired(now: now)
        let today: String = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: now) }()
        if snapshot?.night?.first(where: { $0.date == today })?.woke == true { FocusLock.shared.releaseNightLock(awakeAt: now) }
        let routine = NightRoutine.shared
        if routine.plan == nil { await routine.refresh(planner: planner, wakeRequest: snapshot?.wakeRequest, now: now) }
        await routine.checkNightSignals(planner: planner, macLastInput: snapshot?.lastInputAt, now: now)
        GlanceWriter.publish(planner: planner, snapshot: snapshot, night: routine.plan, now: now)
        // A wake is also the moment to take a location sample and send everything waiting (wake signals included).
        await PhoneSignals.shared.captureAndFlushNow(.backgroundRefresh)
        // Keep the chain going: through the night until the alarm, and every half hour by day.
        if let plan = routine.plan { scheduleNightCheck(bed: plan.bed, wake: plan.wake, now: now) }
    }

    private static func fetchSnapshot() async -> LinkSnapshot? {
        let zone = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
        let id = CKRecord.ID(recordName: LinkSchema.stateName, zoneID: zone)
        guard let record = try? await CKContainer(identifier: LinkSchema.containerID).privateCloudDatabase.record(for: id),
              let json = record[LinkSchema.stateJSON] as? String,
              let snapshot = try? LinkSnapshot.decode(Data(json.utf8)) else { return nil }
        SnapshotCache.save(snapshot)
        return snapshot
    }
}

/// The last snapshot seen, kept in the app group for runs without a network.
enum SnapshotCache {
    private static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: GlanceFile.phoneGroup)?
            .appendingPathComponent("last-snapshot.json")
    }
    static func save(_ snapshot: LinkSnapshot) {
        guard let url, let data = try? LinkSnapshot.encode(snapshot) else { return }
        try? data.write(to: url, options: .atomic)
    }
    static func load() -> LinkSnapshot? {
        url.flatMap { try? Data(contentsOf: $0) }.flatMap { try? LinkSnapshot.decode($0) }
    }
}

extension NightRoutine {
    /// Awake after bedtime, seen without him opening anything. The latest sign wins,
    /// and `noteAwake` moves the alarm for it.
    func checkNightSignals(planner: PlannerStore, macLastInput: Date?, now: Date = Date()) async {
        guard let plan, now >= plan.bed, now < plan.wake else { return }
        var seen: [Date] = []
        if let mac = macLastInput, mac >= plan.bed, mac <= now { seen.append(mac) }
        if UIApplication.shared.applicationState != .active, UIApplication.shared.isProtectedDataAvailable { seen.append(now) }
        if let moving = await Motion.lastMovement(since: plan.bed, until: now) { seen.append(moving) }
        guard let latest = seen.max() else { return }
        await noteAwake(at: latest, planner: planner)
    }
}

/// The phone's motion history (kept by iOS for a week, whether or not ORION ran).
enum Motion {
    private static let manager = CMMotionActivityManager()

    static func lastMovement(since: Date, until: Date) async -> Date? {
        guard CMMotionActivityManager.isActivityAvailable(), CMMotionActivityManager.authorizationStatus() == .authorized else { return nil }
        return await withCheckedContinuation { continuation in
            manager.queryActivityStarting(from: since, to: until, to: .main) { activities, _ in
                let moving = (activities ?? []).filter { activity in
                    activity.confidence != .low && (activity.walking || activity.running || activity.automotive || activity.cycling)
                }
                continuation.resume(returning: moving.last?.startDate)
            }
        }
    }
}

