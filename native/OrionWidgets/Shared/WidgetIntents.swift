import AppIntents
import Foundation
import WidgetKit
import MobileCore
#if os(iOS)
import CloudKit
#endif

/*
 The buttons on ORION's widgets and on the lock screen: a bottle of water, and
 the answers to a check-in. Each one is the same entry the app's own buttons
 send, so the Mac treats a widget tap exactly like a tap in the app.

 iPhone: the entry goes straight into the private CloudKit zone as a phone
 command (the widget holds the same iCloud container as the app).
 Mac: the widget is sandboxed, so it leaves one line in the shared app group
 and ORION Link carries it out within seconds.
*/
enum WidgetAction: String, AppEnum {
    case water, started, snooze, done

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "ORION action"
    static var caseDisplayRepresentations: [WidgetAction: DisplayRepresentation] = [
        .water: "A bottle of water", .started: "Started", .snooze: "10 more minutes", .done: "Done",
    ]

    var entry: LinkLog {
        switch self {
        case .water: return .water(delta: 1)
        case .started: return .checkin(action: "started")
        case .snooze: return .checkin(action: "snooze")
        case .done: return .checkin(action: "done")
        }
    }

    /// The Mac's request vocabulary (LinkCore's WidgetRequests.Action).
    var macRequest: String {
        switch self {
        case .water: return "water"
        case .started: return "checkin.started"
        case .snooze: return "checkin.snooze"
        case .done: return "checkin.done"
        }
    }
}

/// iPhone: a LiveActivityIntent, so iOS runs it in the ORION app itself (launched
/// in the background if needed). Only the app can redraw the lock-screen card,
/// so a tap there now changes the card at once instead of waiting for the Mac.
#if os(iOS)
typealias OrionIntentBase = LiveActivityIntent
#else
typealias OrionIntentBase = AppIntent
#endif

/// Set by the ORION app at launch: what else to do after a tap (update the card,
/// release the Focus lock). Nil inside the widget extension.
@MainActor enum IntentHooks {
    static var afterTap: ((WidgetAction) -> Void)?
}

struct OrionWidgetIntent: OrionIntentBase {
    static var title: LocalizedStringResource = "Tell ORION"
    static var description = IntentDescription("Log water or answer ORION's check-in.")
    static var isDiscoverable = false

    @Parameter(title: "Action") var action: WidgetAction

    init() {}
    init(_ action: WidgetAction) { self.action = action }

    func perform() async throws -> some IntentResult {
        try await WidgetSender.send(action)
        WidgetSender.applyLocally(action)
        WidgetCenter.shared.reloadAllTimelines()
        await MainActor.run { IntentHooks.afterTap?(action) }
        return .result()
    }
}

enum WidgetSender {
    static func send(_ action: WidgetAction) async throws {
        #if os(iOS)
        let text = try action.entry.encoded()
        let zone = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: UUID().uuidString, zoneID: zone))
        record[LinkSchema.commandText] = text as CKRecordValue
        record[LinkSchema.commandSentAt] = Date() as CKRecordValue
        record[LinkSchema.commandStatus] = LinkCommandStatus.pending.rawValue as CKRecordValue
        record[LinkSchema.commandDevice] = "iphone-widget" as CKRecordValue
        record[LinkSchema.commandKind] = LinkCommandKind.log.rawValue as CKRecordValue
        let (results, _) = try await CKContainer(identifier: LinkSchema.containerID).privateCloudDatabase
            .modifyRecords(saving: [record], deleting: [])
        for result in results.values { _ = try result.get() }
        #else
        guard let directory = GlanceStore.directory else { return }
        let file = directory.appendingPathComponent(GlanceFile.requestsName)
        let object: [String: String] = ["id": UUID().uuidString, "action": action.macRequest,
                                        "at": ISO8601DateFormatter().string(from: Date())]
        var line = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        line.append(0x0A)
        if let handle = try? FileHandle(forWritingTo: file) {
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
        } else {
            try line.write(to: file, options: .atomic)
        }
        #endif
    }

    /// Show the tap at once: the next real glance replaces this within seconds.
    static func applyLocally(_ action: WidgetAction) {
        guard let directory = GlanceStore.directory else { return }
        let url = directory.appendingPathComponent(GlanceFile.fileName)
        guard var glance = GlanceFile.read(url) else { return }
        switch action {
        case .water: glance.tracking?.water += 1
        case .started: glance.checkin?.phase = "active"; glance.checkin?.level = 0
        case .snooze: glance.checkin?.phase = "deferred"
        case .done: glance.checkin = nil
        }
        _ = try? GlanceFile.write(glance, to: url)
    }
}
