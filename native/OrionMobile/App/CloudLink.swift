import CloudKit
import Foundation
import MobileCore
import UserNotifications

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
        /// Set on a message ORION started (a pushed nudge, ask or check-in): the id a reply carries back as `replyTo`.
        var askID: String? = nil
        /// The outreach id this message answered, kept so a retry stays in the same thread.
        var replyTo: String? = nil
        /// Whether iCloud has this message yet (a message the phone sent; a message from the feed is always saved).
        var upload: ChatUpload = .saved

        /// What ORION is doing right now, while status is `running` (the Mac's progress line); nil otherwise.
        var progress: String? = nil
        /// The Mac has acknowledged this message (delivered, not yet answered).
        var received: Bool { status == .received }

        /// Where this message is in its life: sending, delivered, thinking, answered, or stuck.
        func delivery(now: Date) -> ChatDelivery {
            ChatDelivery.state(status: status, upload: upload, sentAt: sentAt, now: now)
        }
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
    private var decodeProblem: String?
    /// False until one full pass of the feed has succeeded this launch: the thread is rebuilt from the start, not from the saved token.
    private var rebuilt = false

    private static var cacheURL: URL {
        URL.applicationSupportDirectory.appendingPathComponent("link-snapshot.json")
    }

    init() {
        // The last known Mac state, so Health and the rest open with data while iCloud catches up (or is unreachable).
        snapshot = LinkSnapshotCache.load(from: Self.cacheURL, now: Date())
    }

    /// Retry now, from a screen's Retry button: set the zone up again if it never was, then fetch.
    func retryNow() async {
        if !iCloudReady { await prepare() }
        await fetchStateDirect()
        await refresh()
    }

    /// The state record by id: one small request, so the screens fill in before the whole message history has been walked.
    private func fetchStateDirect() async {
        guard iCloudReady else { return }
        do {
            let record = try await database.record(for: CKRecord.ID(recordName: LinkSchema.stateName, zoneID: zoneID))
            absorb(record)
            if decodeProblem == nil { problem = nil }
        } catch let error as CKError where error.code == .unknownItem {
            // The Mac has never published.
        } catch {
            problem = describe(error)
        }
        lastChecked = Date()
    }

    func start() {
        guard loop == nil else { return }
        pushObserver = NotificationCenter.default.addObserver(forName: .orionLinkChanged, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                // A failed first setup (no signal at launch, an iCloud hiccup) used to leave the link dead until relaunch:
                // keep trying until the zone is ready, then fetch.
                if self?.iCloudReady == false { await self?.prepare() }
                if self?.rebuilt == false { await self?.fetchStateDirect() }
                await self?.refresh()
                // Quicker while a message is out (the Mac's acknowledgement and progress lines arrive as changes).
                let busy = self?.messages.contains { [.pending, .received, .running].contains($0.status) && $0.kind == .chat && $0.sentAt > Date().addingTimeInterval(-900) } ?? false
                try? await Task.sleep(for: .seconds(busy ? 2 : 4))
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
        // A CloudKit subscription has one fixed category: this is the default, and the notification
        // extension swaps in the record's own `category` ("orion.ask" gets a text-reply field).
        visible.category = PhoneAppDelegate.checkinCategory
        visible.shouldSendContentAvailable = true
        // Lets the notification extension mark an ignored check-in time-sensitive.
        visible.shouldSendMutableContent = true
        visible.desiredKeys = [LinkSchema.alertKind, "level", LinkSchema.alertCategory, LinkSchema.alertAskID]
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
        var token = rebuilt ? changeToken : nil
        do {
            var more = true
            while more {
                let changes = try await database.recordZoneChanges(inZoneWith: zoneID, since: token)
                for (_, result) in changes.modificationResultsByID {
                    guard case .success(let modification) = result else { continue }
                    absorb(modification.record)
                }
                for deletion in changes.deletions { byID[deletion.recordID.recordName] = nil }
                for id in retired { byID[id] = nil }
                token = changes.changeToken
                more = changes.moreComing
            }
            changeToken = token
            rebuilt = true
            publishMessages()
            problem = decodeProblem
        } catch let error as CKError where error.code == .changeTokenExpired {
            changeToken = nil
            byID = [:]
            rebuilt = false
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
            guard let json = record[LinkSchema.stateJSON] as? String else { break }
            let decoded: LinkSnapshot
            do { decoded = try LinkSnapshot.decode(Data(json.utf8)) } catch {
                // Never silent: an unreadable snapshot looks exactly like a Mac that is offline.
                decodeProblem = "The Mac's state could not be read (\(error)). Update ORION on both devices."
                break
            }
            decodeProblem = nil
            snapshot = decoded
            LinkSnapshotCache.save(Data(json.utf8), to: Self.cacheURL)
            do {
                PlaceMonitor.shared.update(places: decoded.knownPlaces)   // his confirmed places, for the geofences
                // The Mac is alive: it sends bedtime messages with context (2026-10-07).
                if Date().timeIntervalSince(decoded.generatedAt) < NightRoutine.macFreshSeconds {
                    NightRoutine.macTookOver(at: decoded.generatedAt)
                }
            }
        case LinkSchema.commandType:
            let kind = (record[LinkSchema.commandKind] as? String).flatMap(LinkCommandKind.init(rawValue:)) ?? .control
            let status = (record[LinkSchema.commandStatus] as? String).flatMap(LinkCommandStatus.init(rawValue:)) ?? .pending
            // While the Mac works, its reply field carries a progress line ("Rebuilding your evening"), not an answer.
            let line = record[LinkSchema.commandReply] as? String
            byID[record.recordID.recordName] = Message(
                id: record.recordID.recordName,
                text: record[LinkSchema.commandText] as? String ?? "",
                sentAt: record[LinkSchema.commandSentAt] as? Date ?? record.creationDate ?? .distantPast,
                kind: kind,
                status: status,
                reply: status == .running ? nil : line,
                repliedAt: record[LinkSchema.commandRepliedAt] as? Date, thinking: record[LinkSchema.commandThinking] as? String, conversationID: record[LinkSchema.commandConversation] as? String, model: record[LinkSchema.commandModel] as? String,
                askID: record[LinkSchema.commandAskID] as? String,
                replyTo: record[LinkSchema.commandReplyTo] as? String,
                progress: status == .running ? line : nil)
        default:
            break
        }
    }

    private func publishMessages() {
        let gone = Set(retired)
        let next = byID.values.filter { !gone.contains($0.id) }.sorted { ($0.sentAt, $0.id) < ($1.sentAt, $1.id) }.suffix(200).map { $0 }
        if next != messages { messages = next }
    }

    // MARK: - Sending

    /// Queue a message or command for the Mac. Shown at once as sending; the
    /// Mac's reply arrives through the change feed.
    /// `prelude` runs after the message is on screen and before it is saved (the lock state goes first so ORION
    /// knows it before reading "unlock my apps"): a slow prelude must never leave his message invisible.
    /// Saving the same id twice is safe: iCloud answers `serverRecordChanged`, which means "already delivered".
    /// Returns the command's id once iCloud has it, or nil if it was not sent.
    @discardableResult
    func send(_ text: String, kind: LinkCommandKind, id: String = UUID().uuidString, conversation: String? = nil, model: String? = nil, replyTo: String? = nil, prelude: (() async -> Void)? = nil) async -> String? {
        let command: String
        do { command = try LinkCommand.validate(text) } catch { problem = "That message is empty or too long."; return nil }
        let now = byID[id]?.sentAt ?? Date()
        let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: id, zoneID: zoneID))
        record[LinkSchema.commandConversation] = conversation as CKRecordValue?
        record[LinkSchema.commandModel] = model as CKRecordValue?
        record[LinkSchema.commandReplyTo] = replyTo as CKRecordValue?
        record[LinkSchema.commandText] = command as CKRecordValue
        record[LinkSchema.commandSentAt] = now as CKRecordValue
        record[LinkSchema.commandStatus] = LinkCommandStatus.pending.rawValue as CKRecordValue
        record[LinkSchema.commandDevice] = "iphone" as CKRecordValue
        record[LinkSchema.commandKind] = kind.rawValue as CKRecordValue
        byID[id] = Message(id: id, text: command, sentAt: now, kind: kind, status: .pending, conversationID: conversation, model: model,
                           replyTo: replyTo, upload: .uploading)
        publishMessages()
        await prelude?()
        do {
            let (results, _) = try await database.modifyRecords(saving: [record], deleting: [])
            for result in results.values {
                do { _ = try result.get() } catch let error as CKError where error.code == .serverRecordChanged { /* already there: delivered */ }
            }
            if byID[id]?.upload == .uploading { byID[id]?.upload = .saved; publishMessages() }
            return id
        } catch {
            byID[id]?.upload = .failed
            byID[id]?.reply = "Not sent: \(describe(error))"
            publishMessages()
            problem = describe(error)
            return nil
        }
    }

    /// A failed or stalled message he re-sent under a new id: this one leaves the thread, here and on the next full fetch.
    func retire(_ id: String) {
        var ids = retired.filter { $0 != id }
        ids.append(id)
        UserDefaults.standard.set(Array(ids.suffix(200)), forKey: "link.retiredCommands")
        byID[id] = nil
        publishMessages()
    }

    private var retired: [String] { UserDefaults.standard.stringArray(forKey: "link.retiredCommands") ?? [] }

    /// Send one entry without a running link: answers tapped on a notification,
    /// possibly with the app in the background, and the background location samples
    /// PhoneSignals queued. True once iCloud has it, so a caller can keep the entry for retry.
    @discardableResult
    static func sendNow(_ entry: LinkLog) async -> Bool {
        guard let text = try? entry.encoded() else { return true }   // never valid: nothing to retry
        let record = commandRecord(text: text, kind: .log)
        return await save(record)
    }

    /// A typed answer to a notification (the inline reply field), as a chat in the thread. `replyTo` is the outreach id.
    @discardableResult
    static func sendNowChat(_ text: String, replyTo: String?) async -> Bool {
        guard let command = try? LinkCommand.validate(text) else { return true }
        let record = commandRecord(text: command, kind: .chat)
        record[LinkSchema.commandConversation] = LinkSchema.threadID as CKRecordValue
        record[LinkSchema.commandReplyTo] = replyTo as CKRecordValue?
        return await save(record)
    }

    private static func commandRecord(text: String, kind: LinkCommandKind) -> CKRecord {
        let zone = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: UUID().uuidString, zoneID: zone))
        record[LinkSchema.commandText] = text as CKRecordValue
        record[LinkSchema.commandSentAt] = Date() as CKRecordValue
        record[LinkSchema.commandStatus] = LinkCommandStatus.pending.rawValue as CKRecordValue
        record[LinkSchema.commandDevice] = "iphone" as CKRecordValue
        record[LinkSchema.commandKind] = kind.rawValue as CKRecordValue
        return record
    }

    private static func save(_ record: CKRecord) async -> Bool {
        do {
            let (results, _) = try await CKContainer(identifier: LinkSchema.containerID).privateCloudDatabase.modifyRecords(saving: [record], deleting: [])
            for result in results.values { _ = try result.get() }
            return true
        } catch { return false }
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

/// Phone-only notifications into the chat thread (W10-E). A scheduled local notification fires with the app closed, so
/// it is mirrored whenever the app next sees it: on delivery (willPresent), on tap, and by sweeping what is already in
/// the notification center on foreground and background refresh. Deduped by the notification's id, kept only after
/// iCloud confirmed the save, so a failed send is retried by the next sweep. The Mac logs each as outreach.
enum PhoneNotificationMirror {
    @MainActor private static var inFlight = Set<String>()

    private static var ledger: PhoneMirror.Ledger {
        get { PhoneMirror.Ledger(ids: UserDefaults.standard.stringArray(forKey: PhoneMirror.ledgerKey) ?? []) }
        set { UserDefaults.standard.set(newValue.ids, forKey: PhoneMirror.ledgerKey) }
    }

    @MainActor
    static func mirror(_ notification: UNNotification) async {
        await mirror(identifier: notification.request.identifier, body: notification.request.content.body, at: notification.date)
    }

    /// Mirror every delivered ORION-phone notification not yet in the thread.
    @MainActor
    static func sweepDelivered() async {
        let delivered = await UNUserNotificationCenter.current().deliveredNotifications()
        // A pile of bedtime nudges is one message: only the newest of the pile is mirrored, and the older ones are marked seen
        // (2026-11-03: three arrived together at 22:44 for 22:18, 22:26 and 22:36).
        let pile = delivered.filter { PhoneMirror.isPhoneLocal(identifier: $0.request.identifier) && !$0.request.content.body.isEmpty }
            .map { PhoneMirror.Delivered(identifier: $0.request.identifier, body: $0.request.content.body, date: $0.date) }
        let (keep, superseded) = PhoneMirror.condense(pile.filter { !ledger.contains(PhoneMirror.id(forNotification: $0.identifier)) })
        for old in superseded { ledger = ledger.adding(PhoneMirror.id(forNotification: old.identifier)) }
        for note in keep { await mirror(identifier: note.identifier, body: note.body, at: note.date) }
    }

    @MainActor
    static func mirror(identifier: String, body: String, at date: Date) async {
        guard PhoneMirror.isPhoneLocal(identifier: identifier), !body.isEmpty else { return }
        let id = PhoneMirror.id(forNotification: identifier)
        guard !ledger.contains(id), inFlight.insert(id).inserted else { return }
        defer { inFlight.remove(id) }
        let shape = PhoneMirror.record(id: id, text: body)
        let zone = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: shape.recordName, zoneID: zone))
        for (key, value) in shape.fields { record[key] = value as CKRecordValue }
        record[LinkSchema.commandSentAt] = date as CKRecordValue
        do {
            let (results, _) = try await CKContainer(identifier: LinkSchema.containerID).privateCloudDatabase
                .modifyRecords(saving: [record], deleting: [], savePolicy: .allKeys)
            for result in results.values { _ = try result.get() }
            ledger = ledger.adding(id)
        } catch { /* left out of the ledger: the next sweep retries */ }
    }
}
