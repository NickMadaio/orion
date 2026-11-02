import AppIntents
import CloudKit
import Foundation
import WidgetKit
import MobileCore

/*
 "Add water", from anywhere on the phone (2026-11-02).

 One intent behind the home-screen Water widget, the lock-screen ring, the
 Control Center / lock-screen control and the Siri phrase "Log water in ORION".
 Compiled into the app and the widget extension, so it runs wherever iOS starts
 it, never opening the app.

 WaterTap (MobileCore) queues the tap with an id in the app group and moves the
 ring at once; WaterCourier then sends every queued tap to the Mac as a `log`
 LinkCommand whose record name IS the event id. A retry can therefore never
 create a second command, and the Mac's health log refuses an id it has seen.
 Whatever cannot be sent now (no signal) waits in the outbox until the next tap
 or the next time the app comes to the front.
*/
struct AddWaterIntent: AppIntent {
    static var title: LocalizedStringResource = "Add water"
    static var description = IntentDescription("Log a bottle of water in ORION. It reaches your Mac's health log.")
    static var openAppWhenRun = false

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let directory = GlanceStore.directory else {
            return .result(dialog: "ORION's shared storage isn't available. Open ORION once, then try again.")
        }
        try WaterTap.record(in: directory)
        WaterCourier.reloadSurfaces()
        await WaterCourier.flush(directory: directory)
        if let today = WaterTap.today(in: directory) {
            return .result(dialog: "Logged a bottle. \(today.water) of \(today.goal) today.")
        }
        return .result(dialog: "Logged a bottle of water.")
    }
}

enum WaterCourier {
    static let controlKind = "orion.water.control"
    static let device = "iphone-water"

    /// The ring on every widget and the control's label follow the tap.
    static func reloadSurfaces() {
        WidgetCenter.shared.reloadAllTimelines()
        if #available(iOS 18.0, *) { ControlCenter.shared.reloadControls(ofKind: controlKind) }
    }

    /// Send what is queued. Safe to call often and from two processes at once:
    /// the record name is the event id, so a duplicate save is refused by
    /// CloudKit (serverRecordChanged), which here means "already delivered".
    static func flush(directory: URL? = GlanceStore.directory) async {
        guard let directory else { return }
        let pending = WaterTap.pending(in: directory)
        guard !pending.isEmpty else { return }
        let records = pending.compactMap(record)
        guard !records.isEmpty else { return }
        var delivered = Set<String>()
        do {
            let (results, _) = try await CKContainer(identifier: LinkSchema.containerID).privateCloudDatabase
                .modifyRecords(saving: records, deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: false)
            for (id, result) in results {
                switch result {
                case .success: delivered.insert(id.recordName)
                case .failure(let error as CKError) where error.code == .serverRecordChanged: delivered.insert(id.recordName)
                case .failure: continue
                }
            }
        } catch {
            return   // offline or iCloud unavailable: everything stays queued
        }
        try? WaterTap.delivered(delivered, in: directory)
    }

    static func record(_ event: WaterEvent) -> CKRecord? {
        guard let text = try? event.commandText() else { return nil }
        let zone = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: event.id, zoneID: zone))
        record[LinkSchema.commandText] = text as CKRecordValue
        // When he drank it, not when it reached iCloud: the Mac logs it on that day.
        record[LinkSchema.commandSentAt] = event.at as CKRecordValue
        record[LinkSchema.commandStatus] = LinkCommandStatus.pending.rawValue as CKRecordValue
        record[LinkSchema.commandDevice] = device as CKRecordValue
        record[LinkSchema.commandKind] = LinkCommandKind.log.rawValue as CKRecordValue
        return record
    }
}
