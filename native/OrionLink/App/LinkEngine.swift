import CloudKit
import Foundation
import LinkCore
import MobileCore
import WidgetKit

/*
 The Mac end of the phone link.

 Every 30 seconds (sooner when something changed) it publishes ORION's state
 as one `MacState` record in the private `OrionLink` zone. Every few seconds it
 fetches the zone's changes and runs each new `LinkCommand` through
 orion-remote as the sender "phone", then writes the reply back onto the same
 record. A new approval request also becomes a `LinkAlert`, which the phone
 turns into a notification.

 The private database belongs to Nick's Apple ID: only his devices can write a
 command here, and orion-remote still applies every rule it applies to Discord.
*/
@MainActor
final class LinkEngine: ObservableObject {
    @Published private(set) var status = "Starting…"
    @Published private(set) var problem: String?
    @Published private(set) var lastPublished: Date?
    @Published private(set) var lastCommand: String?
    @Published private(set) var commandsHandled = 0
    /// For diagnostics: when the widgets last got new content, and a summary of it.
    private var widgetsUpdated: Date?
    private var widgetSummary = "not written"

    private let container = CKContainer(identifier: LinkSchema.containerID)
    private var database: CKDatabase { container.privateCloudDatabase }
    private let zoneID = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
    private let reader = SnapshotReader()
    private let runner = CommandRunner()
    private let defaults = UserDefaults.standard

    private var lastPayload: Data?
    private var ticks = 0
    private var busy = false
    private var started = false

    /// Commands older than this are not run: whoever sent them has moved on.
    private let staleAfter: TimeInterval = 10 * 60

    func start() {
        guard !started else { return }
        started = true
        Task { await boot() }
    }

    private func boot() async {
        do {
            let account = try await container.accountStatus()
            guard account == .available else {
                problem = account == .noAccount ? "Sign in to iCloud on this Mac to connect your phone." : "iCloud is not available (\(account.rawValue))."
                status = "Waiting for iCloud"
                writeStatusFile()
                try? await Task.sleep(for: .seconds(30))
                started = false; start(); return
            }
            let (zones, _) = try await database.modifyRecordZones(saving: [CKRecordZone(zoneID: zoneID)], deleting: [])
            for result in zones.values { _ = try result.get() }
            try await ensureAlertType()
            problem = nil
            status = "Connected"
        } catch {
            problem = "Could not reach iCloud: \(error.localizedDescription)"
            status = "Retrying"
            writeStatusFile()
            try? await Task.sleep(for: .seconds(30))
            started = false; start(); return
        }
        while true {
            await tick()
            try? await Task.sleep(for: .seconds(4))
        }
    }

    private func tick() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        ticks += 1
        await pollCommands()
        await publishChats()
        handleWidgetRequests()
        // Check-ins: every ~30 s, advance ORION's follow-ups and send what is due.
        if ticks % 8 == 0 { await deliverCheckins() }
        await deliverOutreach()
        // Publish when state changed, and at least every 30 seconds as the heartbeat.
        await publishState(force: ticks % 8 == 1)
        writeStatusFile()
    }

    /// ~/Library/Application Support/ORION Link/status.json: what the menu shows,
    /// readable without opening the menu (diagnostics, and the ORION app later).
    private func writeStatusFile() {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ORION Link")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let iso = ISO8601DateFormatter()
        let object: [String: Any] = [
            "status": status, "problem": problem ?? NSNull(),
            "lastPublished": lastPublished.map { iso.string(from: $0) } ?? NSNull(),
            "commandsHandled": commandsHandled, "lastCommand": lastCommand ?? NSNull(),
            "widgetsUpdated": widgetsUpdated.map { iso.string(from: $0) } ?? NSNull(), "widgets": widgetSummary,
            "writtenAt": iso.string(from: Date()),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: dir.appendingPathComponent("status.json"), options: .atomic)
        }
    }


    /// `modifyRecords` does not throw when individual records fail; this does.
    @discardableResult
    private func save(_ records: [CKRecord], policy: CKModifyRecordsOperation.RecordSavePolicy) async throws -> [CKRecord] {
        let (results, _) = try await database.modifyRecords(saving: records, deleting: [], savePolicy: policy)
        return try results.values.map { try $0.get() }
    }

    /// CloudKit's development schema creates a record type on its first write,
    /// and the phone cannot subscribe to approval alerts until the type exists.
    /// Write and delete one placeholder, once, so notifications work before the
    /// first real approval.
    private func ensureAlertType() async throws {
        guard !defaults.bool(forKey: "link.alertTypeReady") else { return }
        let id = CKRecord.ID(recordName: "schema-placeholder", zoneID: zoneID)
        let record = CKRecord(recordType: LinkSchema.alertType, recordID: id)
        record[LinkSchema.alertText] = "" as CKRecordValue
        record[LinkSchema.alertKind] = "schema" as CKRecordValue
        record[LinkSchema.alertAt] = Date() as CKRecordValue
        try await save([record], policy: .allKeys)
        _ = try? await database.modifyRecords(saving: [], deleting: [id])
        defaults.set(true, forKey: "link.alertTypeReady")
    }

    // MARK: - Check-ins

    /// `orion-checkin tick --json` (the installed copy, which launchd-started
    /// processes can reach) advances every follow-up that is due and prints the
    /// messages to send; each becomes a LinkAlert, which the phone shows as a
    /// notification with the message itself as its text.
    private func deliverCheckins() async {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let node = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        let script = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-checkin")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: script.path) else { return }
        let output: Data? = await Task.detached {
            let process = Process()
            process.executableURL = node
            process.arguments = [script.path, "tick", "--json"]
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = FileHandle.nullDevice
            guard (try? process.run()) != nil else { return nil }
            process.waitUntilExit()
            return pipe.fileHandleForReading.readDataToEndOfFile()
        }.value
        var alerts = (output.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] }) ?? []
        // Messages the ORION app's watcher left (it asks about an empty day, reports a reshaped morning).
        let outbox = home.appendingPathComponent(".openclaw/orion-controlled/alerts-outbox.jsonl")
        if let text = try? String(contentsOf: outbox, encoding: .utf8), !text.isEmpty {
            try? "".write(to: outbox, atomically: true, encoding: .utf8)
            alerts += text.split(separator: "\n").compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
        }
        guard !alerts.isEmpty else { return }
        let records = alerts.compactMap { alert -> CKRecord? in
            guard let text = alert["text"] as? String, let id = alert["id"] as? String else { return nil }
            let record = CKRecord(recordType: LinkSchema.alertType,
                                  recordID: CKRecord.ID(recordName: "checkin-\(id)-\(UUID().uuidString.prefix(8))", zoneID: zoneID))
            record[LinkSchema.alertText] = String(text.prefix(240)) as CKRecordValue
            record[LinkSchema.alertKind] = "checkin" as CKRecordValue
            record["level"] = ((alert["level"] as? Int) ?? 1) as CKRecordValue
            record[LinkSchema.alertAt] = Date() as CKRecordValue
            return record
        }
        do { try await save(records, policy: .allKeys) } catch { problem = "Could not send a check-in: \(error.localizedDescription)" }
    }

    // MARK: - Outreach

    /// ORION starting the conversation (scripts/orion-reach, 2026-10-07): each
    /// line of outreach-outbox.jsonl becomes a message in his ORION chat thread
    /// (a LinkCommand with no words from him, already answered), and a
    /// notification on his phone when the phone is how he is being reached.
    private func deliverOutreach() async {
        let outbox = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/outreach-outbox.jsonl")
        guard let text = try? String(contentsOf: outbox, encoding: .utf8), !text.isEmpty else { return }
        try? "".write(to: outbox, atomically: true, encoding: .utf8)
        let items = text.split(separator: "\n").compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
        var records: [CKRecord] = []
        for item in items {
            guard let id = item["id"] as? String, let message = item["text"] as? String else { continue }
            let chat = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: id, zoneID: zoneID))
            chat[LinkSchema.commandText] = "" as CKRecordValue
            chat[LinkSchema.commandSentAt] = Date() as CKRecordValue
            chat[LinkSchema.commandDevice] = "orion" as CKRecordValue
            chat[LinkSchema.commandKind] = LinkCommandKind.chat.rawValue as CKRecordValue
            chat[LinkSchema.commandStatus] = LinkCommandStatus.done.rawValue as CKRecordValue
            chat[LinkSchema.commandReply] = message as CKRecordValue
            records.append(chat)
            if item["push"] as? Bool == true {
                let alert = CKRecord(recordType: LinkSchema.alertType,
                                     recordID: CKRecord.ID(recordName: "reach-\(id)", zoneID: zoneID))
                alert[LinkSchema.alertText] = String(message.prefix(240)) as CKRecordValue
                alert[LinkSchema.alertKind] = "orion" as CKRecordValue
                alert["level"] = 1 as CKRecordValue
                alert[LinkSchema.alertAt] = Date() as CKRecordValue
                records.append(alert)
            }
        }
        guard !records.isEmpty else { return }
        do { _ = try await save(records, policy: .allKeys) }
        catch {
            // Put them back so the next tick retries rather than losing what ORION said.
            if let handle = try? FileHandle(forWritingTo: outbox) { handle.seekToEndOfFile(); handle.write(Data(text.utf8)); try? handle.close() }
            problem = "Could not send ORION's message: \(error.localizedDescription)"
        }
    }

    // MARK: - State

    private func publishState(force: Bool) async {
        let now = Date()
        let approvals = reader.approvals(now: now)
        let calendar = reader.glanceCalendar(now: now)
        let snapshot = LinkSnapshot(generatedAt: now, mac: MacFacts.snapshotMac(locked: reader.locked()),
                                    runs: reader.runs(now: now), approvals: approvals,
                                    running: reader.running(), attention: reader.attention(), health: reader.health(),
                                    tracking: reader.tracking(now: now), plan: reader.plan(now: now),
                                    planRequest: reader.planRequest(now: now), wakeRequest: reader.wakeRequest(now: now),
                                    checkin: reader.checkin(now: now), deadlines: calendar?.deadlines,
                                    lastInputAt: MacFacts.lastInput(now: now).map { Self.minute($0) },
                                    screenGrant: reader.screenGrant(now: now), night: reader.night(), earlyFinish: earlyFinishContext(), chatModels: chatModelChoices(), focusLists: focusListsDirective())
        publishGlance(snapshot, now: now)
        // Compare without the clock, so an unchanged Mac is not re-sent every tick.
        var probe = snapshot; probe.generatedAt = .distantPast
        guard let probeData = try? LinkSnapshot.encode(probe), let data = try? LinkSnapshot.encode(snapshot) else { return }
        if !force && probeData == lastPayload { return }
        let record = CKRecord(recordType: LinkSchema.stateType,
                              recordID: CKRecord.ID(recordName: LinkSchema.stateName, zoneID: zoneID))
        record[LinkSchema.stateJSON] = String(decoding: data, as: UTF8.self) as CKRecordValue
        record[LinkSchema.stateUpdatedAt] = now as CKRecordValue
        do {
            try await save([record], policy: .allKeys)
            lastPayload = probeData
            lastPublished = now
            if problem?.hasPrefix("Publishing") == true { problem = nil }
            await alertNewApprovals(approvals)
        } catch {
            problem = "Publishing failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Widgets

    /// The Mac's widgets read `glance.json` in the shared app group; they are
    /// reloaded only when what they would draw changed.
    private var groupDirectory: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: GlanceFile.macGroup)
    }

    private func publishGlance(_ snapshot: LinkSnapshot, now: Date) {
        guard let directory = groupDirectory else { widgetSummary = "no app group"; return }
        let glance = reader.glance(from: snapshot, now: now)
        do {
            if try GlanceFile.write(glance, to: directory.appendingPathComponent(GlanceFile.fileName)) {
                WidgetCenter.shared.reloadAllTimelines()
                widgetsUpdated = now
            }
            widgetSummary = "\(glance.blocks.count) blocks, \(glance.todos.count) to-dos, \(glance.projects.count) projects, "
                + "\(glance.deadlines.count) deadlines, check-in \(glance.checkin?.phase ?? "none"); says: \(glance.line(at: now))"
        } catch {
            widgetSummary = "write failed: \(error.localizedDescription)"
        }
    }

    /// "+1 water", "Started", "Done" tapped on a Mac widget.
    private func handleWidgetRequests() {
        guard let directory = groupDirectory else { return }
        let requests = WidgetRequests(file: directory.appendingPathComponent(GlanceFile.requestsName)).take()
        guard !requests.isEmpty else { return }
        for request in requests {
            guard let text = try? request.action.entry.encoded() else { continue }
            let result = request.action == .water ? Self.logTracking(text, at: request.at) : Self.answerCheckin(text)
            lastCommand = "widget: \(request.action.rawValue) — \(result.reply)"
        }
        Task { await publishState(force: true) }
    }

    /// Whole minutes, so the snapshot does not change (and re-publish) every tick.
    nonisolated static func minute(_ date: Date) -> Date {
        Date(timeIntervalSince1970: (date.timeIntervalSince1970 / 60).rounded(.down) * 60)
    }

    /// One notification per approval request, the first time it is seen.
    private func alertNewApprovals(_ approvals: [LinkSnapshot.Approval]) async {
        let known = Set(defaults.stringArray(forKey: "link.alertedApprovals") ?? [])
        let fresh = approvals.filter { !known.contains($0.id) }
        guard !fresh.isEmpty else {
            defaults.set(Array(known.intersection(approvals.map(\.id))), forKey: "link.alertedApprovals")
            return
        }
        let records = fresh.map { approval -> CKRecord in
            let record = CKRecord(recordType: LinkSchema.alertType, recordID: CKRecord.ID(recordName: "alert-\(approval.id)", zoneID: zoneID))
            record[LinkSchema.alertText] = "ORION wants to \(approval.action): \(String(approval.summary.prefix(140)))" as CKRecordValue
            record[LinkSchema.alertKind] = "approval" as CKRecordValue
            record[LinkSchema.alertAt] = Date() as CKRecordValue
            return record
        }
        if (try? await save(records, policy: .allKeys)) != nil {
            defaults.set(Array(known.union(fresh.map(\.id))), forKey: "link.alertedApprovals")
        }
    }

    // MARK: - Commands

    private var changeToken: CKServerChangeToken? {
        get {
            guard let data = defaults.data(forKey: "link.changeToken") else { return nil }
            return try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
        }
        set {
            let data = newValue.flatMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true) }
            defaults.set(data, forKey: "link.changeToken")
        }
    }

    private func pollCommands() async {
        var pending: [CKRecord] = []
        var token = changeToken
        do {
            var more = true
            while more {
                let changes = try await database.recordZoneChanges(inZoneWith: zoneID, since: token)
                for (_, result) in changes.modificationResultsByID {
                    guard case .success(let modification) = result else { continue }
                    let record = modification.record
                    if record.recordType == LinkSchema.commandType,
                       (record[LinkSchema.commandStatus] as? String) == LinkCommandStatus.pending.rawValue {
                        pending.append(record)
                    }
                }
                token = changes.changeToken
                more = changes.moreComing
            }
        } catch let error as CKError where error.code == .changeTokenExpired {
            changeToken = nil
            return
        } catch {
            let ck = error as? CKError
            var detail = "code \(ck?.code.rawValue ?? -1)"
            if let underlying = (error as NSError).userInfo[NSUnderlyingErrorKey] as? NSError { detail += ", underlying \(underlying.domain) \(underlying.code)" }
            // Probe: can this app read a record by id at all?
            let probe = CKRecord.ID(recordName: LinkSchema.stateName, zoneID: zoneID)
            let readable = (try? await database.record(for: probe)) != nil
            problem = "Could not read commands (\(detail); read-by-id \(readable ? "works" : "fails")): \(error.localizedDescription)"
            return
        }
        let ordered = pending.sorted { ($0[LinkSchema.commandSentAt] as? Date ?? .distantPast) < ($1[LinkSchema.commandSentAt] as? Date ?? .distantPast) }
        for record in ordered { await handle(record) }
        // Advanced only after every fetched command was handled: quitting
        // mid-command means it is fetched again, never silently skipped.
        // (orion-remote's replay guard refuses a second run of the same id.)
        changeToken = token
    }

    private func handle(_ record: CKRecord) async {
        let text = record[LinkSchema.commandText] as? String ?? ""
        let sentAt = record[LinkSchema.commandSentAt] as? Date ?? .distantPast
        lastCommand = text
        let result: CommandRunner.Result
        let kind = (record[LinkSchema.commandKind] as? String).flatMap(LinkCommandKind.init(rawValue:)) ?? .control
        // A glass of water drunk while the Mac slept still happened, on the day it
        // was logged; only commands expire.
        let limit = kind == .log ? 36 * 3600 : staleAfter
        if Date().timeIntervalSince(sentAt) > limit {
            result = .init(ok: false, reply: "Not run: this was sent more than ten minutes ago. Send it again if you still want it.")
        } else {
            record[LinkSchema.commandStatus] = LinkCommandStatus.running.rawValue as CKRecordValue
            _ = try? await save([record], policy: .changedKeys)
            let runner = self.runner
            let id = record.recordID.recordName
            switch kind {
            case .chat, .control:
                let chat = kind == .chat
                result = await Task.detached(priority: .userInitiated) { runner.run(text: text, id: id, sentAt: sentAt, chat: chat, conversation: record[LinkSchema.commandConversation] as? String, model: record[LinkSchema.commandModel] as? String) }.value
            case .log where (try? LinkLog.decode(text)).map({ if case .note = $0 { return true }; return false }) == true:
                if case .note(let body, let at)? = try? LinkLog.decode(text),
                   (try? MemoryNote().append(body, at: ISO8601DateFormatter().date(from: at) ?? sentAt)) != nil {
                    result = .init(ok: true, reply: "Saved to ORION's memory.")
                } else {
                    result = .init(ok: false, reply: "The note could not be saved.")
                }
            case .log where (try? LinkLog.decode(text)).map({ if case .checkin = $0 { return true }; return false }) == true:
                result = Self.answerCheckin(text)
            case .log:
                // orion-remote's replay guard does not see these, so keep our own:
                // a crash between writing and replying must not log the water twice.
                var applied = defaults.stringArray(forKey: "link.appliedLogs") ?? []
                if applied.contains(id) {
                    result = .init(ok: true, reply: "Already logged.")
                } else {
                    result = Self.logTracking(text, at: sentAt)
                    if result.ok { applied.append(id); defaults.set(Array(applied.suffix(300)), forKey: "link.appliedLogs") }
                }
            case .plan:
                result = Self.requestPlan(text, id: id)
            }
        }
        record[LinkSchema.commandStatus] = (result.ok ? LinkCommandStatus.done : .failed).rawValue as CKRecordValue
        if kind == .chat { archiveChat(record, text: text, sentAt: sentAt, result: result) }
        record[LinkSchema.commandThinking] = result.thinking as CKRecordValue?
        record[LinkSchema.commandReply] = result.reply as CKRecordValue
        record[LinkSchema.commandRepliedAt] = Date() as CKRecordValue
        do {
            try await save([record], policy: .changedKeys)
            commandsHandled += 1
        } catch {
            problem = "Could not send a reply: \(error.localizedDescription)"
        }
        // The state probably changed (a pause, an approval): publish promptly.
        await publishState(force: true)
    }

    /// Water, meals and supplements go straight into the health log: data the
    /// phone records, not an action ORION takes, so orion-remote is not involved.
    nonisolated static func logTracking(_ text: String, at sentAt: Date) -> CommandRunner.Result {
        do {
            return .init(ok: true, reply: try TrackingLog().apply(try LinkLog.decode(text), now: min(sentAt, Date())))
        } catch let error as LinkError {
            if case .invalidCommand(let why) = error { return .init(ok: false, reply: "Not logged: \(why).") }
            return .init(ok: false, reply: "Not logged.")
        } catch {
            return .init(ok: false, reply: "Not logged: the health log could not be saved.")
        }
    }

    /// "Started" / "10 more min" / "Done" tapped on a check-in notification.
    nonisolated static func answerCheckin(_ text: String) -> CommandRunner.Result {
        guard case .checkin(let action)? = try? LinkLog.decode(text) else { return .init(ok: false, reply: "Not a check-in answer.") }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let process = Process()
        process.executableURL = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        let script = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-checkin").path
        switch action {
        case "started": process.arguments = [script, "started"]
        case "done": process.arguments = [home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-reschedule").path, "early", "block"]
        case "early-block", "early-out-of-class": process.arguments = [home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-reschedule").path, "early", String(action.dropFirst(6))]
        default: process.arguments = [script, "defer", "10", "--snooze", "--because", "asked for ten more minutes from the phone"]
        }
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        guard (try? process.run()) != nil else { return .init(ok: false, reply: "Could not reach the check-ins.") }
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let out = String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if process.terminationStatus == 0 && (action == "done" || action == "early-block") {
            let close = Process(); close.executableURL = process.executableURL
            close.arguments = [script, "done"]
            close.standardOutput = FileHandle.nullDevice; close.standardError = FileHandle.nullDevice
            if (try? close.run()) != nil { close.waitUntilExit() }
        }
        return .init(ok: process.terminationStatus == 0, reply: out.isEmpty ? "Noted." : String(out.prefix(300)))
    }

    private func focusListsDirective() -> [String]? {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/focus-phone.json")
        guard let data = try? Data(contentsOf: file), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let at = object["at"] as? String, let date = ISO8601DateFormatter().date(from: at), Date().timeIntervalSince(date) < 90 else { return nil }
        return object["block"] as? [String]
    }
    private var chatArchive: ChatStore? { try? ChatStore(directory: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/chats")) }
    private func chatModelChoices() -> [ModelChoice] {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/model-roles.json")
        return (try? Data(contentsOf: file)).map(ChatModels.choices(fromModelRoles:)) ?? []
    }
    private var lastEarlyContextAt = Date.distantPast
    private var cachedEarlyContext: EarlyFinishContext?
    private func earlyFinishContext() -> EarlyFinishContext? {
        if Date().timeIntervalSince(lastEarlyContextAt) < 30 { return cachedEarlyContext }
        lastEarlyContextAt = Date()
        let home = FileManager.default.homeDirectoryForCurrentUser
        let process = Process(); process.executableURL = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        process.arguments = [home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-reschedule").path, "early", "--check", "--dry-run"]
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        cachedEarlyContext = try? JSONDecoder().decode(EarlyFinishContext.self, from: data)
        return cachedEarlyContext
    }
    private func archiveChat(_ record: CKRecord, text: String, sentAt: Date, result: CommandRunner.Result) {
        guard let store = chatArchive else { return }
        let id = record[LinkSchema.commandConversation] as? String ?? "phone-history"
        if (try? store.load(id)) == nil { try? store.save(ChatConversation(id: id, title: String(text.prefix(48)), createdAt: sentAt, updatedAt: sentAt, model: record[LinkSchema.commandModel] as? String, messages: [])) }
        let user = ChatMessage(id: record.recordID.recordName, role: .user, text: text, at: sentAt, device: "phone", model: record[LinkSchema.commandModel] as? String)
        let answer = ChatMessage(id: record.recordID.recordName + "-reply", role: .orion, text: result.reply, thinking: result.thinking, at: Date(), device: "mac", model: user.model)
        _ = try? store.merge([user, answer], into: id)
        record[LinkSchema.commandConversation] = id as CKRecordValue
    }
    private func publishChats() async {
        guard let store = chatArchive, let summaries = try? store.list() else { return }
        var fingerprints = defaults.dictionary(forKey: "link.chatExports") as? [String: String] ?? [:]
        var records: [CKRecord] = []
        for summary in summaries {
            guard let conversation = try? store.load(summary.id) else { continue }
            for (index, message) in conversation.messages.enumerated() where message.role == .user && message.device == "mac" {
                let reply = conversation.messages.dropFirst(index + 1).prefix(while: { $0.role != .user }).first { $0.role == .orion }
                let fingerprint = message.text + (reply?.text ?? "") + (reply?.thinking ?? "") + conversation.title
                guard fingerprints[message.id] != fingerprint else { continue }
                let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: message.id, zoneID: zoneID))
                record[LinkSchema.commandText] = message.text as CKRecordValue
                record[LinkSchema.commandSentAt] = message.at as CKRecordValue
                record[LinkSchema.commandDevice] = "mac-chat" as CKRecordValue
                record[LinkSchema.commandKind] = LinkCommandKind.chat.rawValue as CKRecordValue
                record[LinkSchema.commandStatus] = (reply == nil ? LinkCommandStatus.running : .done).rawValue as CKRecordValue
                record[LinkSchema.commandReply] = reply?.text as CKRecordValue?
                record[LinkSchema.commandThinking] = reply?.thinking as CKRecordValue?
                record[LinkSchema.commandConversation] = conversation.id as CKRecordValue
                record[LinkSchema.commandModel] = conversation.model as CKRecordValue?
                record["conversationTitle"] = conversation.title as CKRecordValue
                records.append(record)
            }
        }
        guard !records.isEmpty else { return }
        do {
            _ = try await save(Array(records.prefix(100)), policy: .changedKeys)
            for record in records.prefix(100) {
                fingerprints[record.recordID.recordName] = (record[LinkSchema.commandText] as? String ?? "") + (record[LinkSchema.commandReply] as? String ?? "") + (record[LinkSchema.commandThinking] as? String ?? "") + (record["conversationTitle"] as? String ?? "")
            }
            defaults.set(fingerprints, forKey: "link.chatExports")
        } catch { problem = "Chat history sync will retry: " + error.localizedDescription }
    }

    /// Left for the ORION app, which owns the planner; it reports back through the same file.
    nonisolated static func requestPlan(_ text: String, id: String) -> CommandRunner.Result {
        guard let action = LinkPlanAction(rawValue: text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) else {
            return .init(ok: false, reply: "Unknown plan request.")
        }
        do {
            try PlanRequestFile.write(.init(id: id, action: action.rawValue, state: .waiting, message: nil, at: Date()))
            return .init(ok: true, reply: "Asked your Mac to \(action == .undo ? "undo the last plan change" : "plan your day").")
        } catch {
            return .init(ok: false, reply: "The request could not be left for the ORION app.")
        }
    }
}
