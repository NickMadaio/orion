import CloudKit
import Foundation
import MobileCore

/*
 The phone end of the link (2026-09-28).

 One change feed carries everything: the Mac's `MacState` snapshot, every
 `LinkCommand` with ORION's reply, and so the whole conversation history. It is
 all in Nick's private iCloud database: no server, no pairing code — the same
 Apple ID on both devices is the pairing.

 Refreshes every few seconds while the app is open, and immediately on a push.
*/
@MainActor
final class CloudLink: ObservableObject {
    struct Message: Identifiable, Equatable {
        let id: String
        let text: String
        let sentAt: Date
        let kind: LinkCommandKind
        var status: LinkCommandStatus
        var reply: String?
        var repliedAt: Date?
        var thinking: String? = nil
        var conversationID: String? = nil
        var model: String? = nil
    }

    @Published private(set) var snapshot: LinkSnapshot?
    @Published private(set) var problem: String?
    @Published private(set) var lastChecked: Date?
    /// Every command this iCloud account has sent, oldest first.
    @Published private(set) var messages: [Message] = []
    @Published private(set) var iCloudReady = false

    var conversation: [Message] { messages.filter { $0.kind == .chat } }
    var controlHistory: [Message] { messages.filter { $0.kind == .control } }

    private let container = CKContainer(identifier: LinkSchema.containerID)
    private var database: CKDatabase { container.privateCloudDatabase }
    private let zoneID = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
    private var loop: Task<Void, Never>?
    private var pushObserver: NSObjectProtocol?
    private var byID: [String: Message] = [:]
    private var subscribed = false
    private var lastSubscribeAttempt = Date.distantPast
    private var fetching = false

    func start() {
        guard loop == nil else { return }
        pushObserver = NotificationCenter.default.addObserver(forName: .orionLinkChanged, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        loop = Task { [weak self] in
            await self?.prepare()
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    private func prepare() async {
        do {
            let account = try await container.accountStatus()
            guard account == .available else {
                problem = "Sign in to iCloud on this iPhone with the same Apple ID as your Mac."
                return
            }
            let (zones, _) = try await database.modifyRecordZones(saving: [CKRecordZone(zoneID: zoneID)], deleting: [])
            for result in zones.values { _ = try result.get() }
            iCloudReady = true
            lastSubscribeAttempt = Date()
            await subscribe()
        } catch {
            problem = describe(error)
        }
    }

    /// Silent pushes when anything in the zone changes, and a visible alert for approvals.
    private func subscribe() async {
        let zoneSub = CKRecordZoneSubscription(zoneID: zoneID, subscriptionID: "orion-link-zone")
        let silent = CKSubscription.NotificationInfo()
        silent.shouldSendContentAvailable = true
        zoneSub.notificationInfo = silent

        let alertSub = CKQuerySubscription(recordType: LinkSchema.alertType, predicate: NSPredicate(value: true),
                                           subscriptionID: "orion-link-alerts", options: [.firesOnRecordCreation])
        alertSub.zoneID = zoneID
        let visible = CKSubscription.NotificationInfo()
        visible.title = "ORION"
        // The alert's own text is the notification: check-ins ("Okay, you ate.
        // Now we're starting…") and approval requests both carry their words.
        visible.alertLocalizationKey = "%1$@"
        visible.alertLocalizationArgs = [LinkSchema.alertText]
        // Buttons on the notification, and the fields the app needs to act on it
        // in the background (a level-3 check-in can lock distracting apps).
        visible.category = PhoneAppDelegate.checkinCategory
        visible.shouldSendContentAvailable = true
        // Lets the notification extension mark an ignored check-in time-sensitive.
        visible.shouldSendMutableContent = true
        visible.desiredKeys = [LinkSchema.alertKind, "level"]
        visible.soundName = "default"
        visible.shouldBadge = true
        alertSub.notificationInfo = visible
        do {
            let (results, _) = try await database.modifySubscriptions(saving: [zoneSub, alertSub], deleting: [])
            for result in results.values { _ = try result.get() }
            subscribed = true
        } catch {
            subscribed = false
        }
    }

    // MARK: - The change feed

    private var changeToken: CKServerChangeToken? {
        get {
            guard let data = UserDefaults.standard.data(forKey: "link.phoneToken") else { return nil }
            return try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
        }
        set {
            let data = newValue.flatMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true) }
            UserDefaults.standard.set(data, forKey: "link.phoneToken")
        }
    }

    func refresh() async {
        guard iCloudReady, !fetching else { return }
        fetching = true
        defer { fetching = false }
        // The first fetch after launch starts from the beginning, so the full
        // history is rebuilt in memory; later fetches are incremental.
        var token = byID.isEmpty && snapshot == nil ? nil : changeToken
        do {
            var more = true
            while more {
                let changes = try await database.recordZoneChanges(inZoneWith: zoneID, since: token)
                for (_, result) in changes.modificationResultsByID {
                    guard case .success(let modification) = result else { continue }
                    absorb(modification.record)
                }
                for deletion in changes.deletions { byID[deletion.recordID.recordName] = nil }
                token = changes.changeToken
                more = changes.moreComing
            }
            changeToken = token
            publishMessages()
            problem = nil
        } catch let error as CKError where error.code == .changeTokenExpired {
            changeToken = nil
            byID = [:]
        } catch {
            problem = describe(error)
        }
        lastChecked = Date()
        if !subscribed && Date().timeIntervalSince(lastSubscribeAttempt) > 60 {
            lastSubscribeAttempt = Date()
            await subscribe()
        }
    }

    private func absorb(_ record: CKRecord) {
        switch record.recordType {
        case LinkSchema.stateType:
            if let json = record[LinkSchema.stateJSON] as? String, let decoded = try? LinkSnapshot.decode(Data(json.utf8)) {
                snapshot = decoded
            }
        case LinkSchema.commandType:
            let kind = (record[LinkSchema.commandKind] as? String).flatMap(LinkCommandKind.init(rawValue:)) ?? .control
            byID[record.recordID.recordName] = Message(
                id: record.recordID.recordName,
                text: record[LinkSchema.commandText] as? String ?? "",
                sentAt: record[LinkSchema.commandSentAt] as? Date ?? record.creationDate ?? .distantPast,
                kind: kind,
                status: (record[LinkSchema.commandStatus] as? String).flatMap(LinkCommandStatus.init(rawValue:)) ?? .pending,
                reply: record[LinkSchema.commandReply] as? String,
                repliedAt: record[LinkSchema.commandRepliedAt] as? Date, thinking: record[LinkSchema.commandThinking] as? String, conversationID: record[LinkSchema.commandConversation] as? String, model: record[LinkSchema.commandModel] as? String)
        default:
            break
        }
    }

    private func publishMessages() {
        let next = byID.values.sorted { $0.sentAt < $1.sentAt }.suffix(200).map { $0 }
        if next != messages { messages = next }
    }

    // MARK: - Sending

    /// Queue a message or command for the Mac. Shown at once as waiting; the
    /// Mac's reply arrives through the change feed.
    /// Returns the command's id once iCloud has it, or nil if it was not sent.
    @discardableResult
    func send(_ text: String, kind: LinkCommandKind, id: String = UUID().uuidString, conversation: String? = nil, model: String? = nil) async -> String? {
        let command: String
        do { command = try LinkCommand.validate(text) } catch { problem = "That message is empty or too long."; return nil }
        let now = Date()
        let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: id, zoneID: zoneID))
        record[LinkSchema.commandConversation] = conversation as CKRecordValue?
        record[LinkSchema.commandModel] = model as CKRecordValue?
        record[LinkSchema.commandText] = command as CKRecordValue
        record[LinkSchema.commandSentAt] = now as CKRecordValue
        record[LinkSchema.commandStatus] = LinkCommandStatus.pending.rawValue as CKRecordValue
        record[LinkSchema.commandDevice] = "iphone" as CKRecordValue
        record[LinkSchema.commandKind] = kind.rawValue as CKRecordValue
        byID[id] = Message(id: id, text: command, sentAt: now, kind: kind, status: .pending)
        publishMessages()
        do {
            let (results, _) = try await database.modifyRecords(saving: [record], deleting: [])
            for result in results.values { _ = try result.get() }
            return id
        } catch {
            byID[id]?.status = .failed
            byID[id]?.reply = "Not sent: \(describe(error))"
            publishMessages()
            problem = describe(error)
            return nil
        }
    }

    /// Send one entry without a running link: answers tapped on a notification,
    /// possibly with the app in the background.
    static func sendNow(_ entry: LinkLog) async {
        guard let text = try? entry.encoded() else { return }
        let zone = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: UUID().uuidString, zoneID: zone))
        record[LinkSchema.commandText] = text as CKRecordValue
        record[LinkSchema.commandSentAt] = Date() as CKRecordValue
        record[LinkSchema.commandStatus] = LinkCommandStatus.pending.rawValue as CKRecordValue
        record[LinkSchema.commandDevice] = "iphone" as CKRecordValue
        record[LinkSchema.commandKind] = LinkCommandKind.log.rawValue as CKRecordValue
        _ = try? await CKContainer(identifier: LinkSchema.containerID).privateCloudDatabase.modifyRecords(saving: [record], deleting: [])
    }

    private func describe(_ error: Error) -> String {
        if let ck = error as? CKError {
            switch ck.code {
            case .notAuthenticated: return "Sign in to iCloud on this iPhone."
            case .networkUnavailable, .networkFailure: return "No connection to iCloud right now."
            case .quotaExceeded: return "Your iCloud storage is full."
            default: return "iCloud error \(ck.code.rawValue): \(ck.localizedDescription)"
            }
        }
        return error.localizedDescription
    }
}
