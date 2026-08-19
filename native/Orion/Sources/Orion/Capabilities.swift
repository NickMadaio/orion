import Foundation

/*
 Orion's own capability switches, and where they actually live.

 Everything Orion is allowed to DO — as opposed to everything the Mac will let
 him see — is decided by two independent things, and this file exists because
 confusing them is the easiest mistake to make here:

 1. A capability flag in `~/.openclaw/openclaw.json`, under
    `plugins.entries.orion-control.config`. This is the switch in this UI.

 2. The permission PROFILE in
    `~/.openclaw/orion-controlled/permission-state.json`. This decides whether a
    capability runs silently, runs and tells you afterwards, or has to be
    approved first.

 A flag on its own enables nothing. Turning on `enableFileMutateActions` while
 the profile still holds `file_delete` behind approval means Orion can rename
 and move, and still has to ask before deleting. That is not a bug and the UI
 says so out loud, because a switch labelled "on" that quietly does nothing is
 exactly the kind of lie this project keeps trying not to tell.

 WRITES GO THROUGH THE CLI, NEVER THROUGH THIS FILE. `openclaw config set`
 validates against the schema and writes atomically. Hand-editing the JSON from
 here would skip that validation and could leave the gateway with a config it
 refuses to load — which would take Orion out entirely, from a Settings toggle.
 The config is backed up before every write and validated after it.
*/

/// How much a capability can cost you when it is wrong.
///
/// Not decoration: it decides how loudly the row is drawn. Burying the switch
/// that lets Orion rewrite his own source among fifteen other switches would be
/// a design choice about honesty, and the wrong one.
enum CapabilityGravity {
    /// Reads, or writes confined to a folder Orion owns.
    case ordinary
    /// Reaches outside Orion's own folders, or cannot be undone.
    case consequential
    /// Edits and rebuilds Orion's own source.
    case rewritesSelf
}

struct CapabilityFlag: Identifiable {
    /// The key under `plugins.entries.orion-control.config`.
    let key: String
    let title: String
    /// What turning it on actually grants, in the user's terms rather than the
    /// catalog's. Kept faithful to the plugin's own schema descriptions — if
    /// these two ever disagree, the plugin is right and this is a bug.
    let grants: String
    var gravity: CapabilityGravity = .ordinary
    /// The lowest permission profile whose tier set contains this capability.
    ///
    /// `nil` means every profile from `approved_root_edit` up allows it, so the
    /// flag is the only thing standing in the way. Where it is set, the flag
    /// and the profile are both required and the UI can say which one is
    /// missing — see `PermissionProfile` for why that is a ladder comparison
    /// and not a lookup table.
    var minimumProfile: PermissionProfile?

    var id: String { key }

    /// The dot path `openclaw config set` wants.
    var configPath: String { "\(CapabilityCatalog.configPrefix).\(key)" }
}

/// The profile ladder, lowest first.
///
/// Mirrors `PROFILES` in the orion-control plugin's permissions module. Kept as
/// an ordered enum because the plugin's own rule is an ordering: a capability
/// tier belongs to a profile and to every profile above it, so "is this allowed"
/// is "is the live profile at least this one".
///
/// This is the ONLY piece of the permission derivation reproduced here, and it
/// is reproduced because the alternative is a switch that reads "on" beside a
/// capability that cannot fire. `orion-authority` stays the authority for the
/// full answer — it also folds in the exec allowlist and per-action metadata,
/// which this cannot see.
enum PermissionProfile: String, CaseIterable, Comparable {
    case restrictedReadOnly = "restricted_read_only"
    case approvedRootEdit = "approved_root_edit"
    case broadLocalFilesystem = "broad_local_filesystem"
    case consequentialLocal = "consequential_local"
    case externalConnected = "external_connected"

    private var rank: Int {
        PermissionProfile.allCases.firstIndex(of: self) ?? 0
    }

    static func < (lhs: PermissionProfile, rhs: PermissionProfile) -> Bool {
        lhs.rank < rhs.rank
    }
}

struct CapabilityGroup: Identifiable {
    let title: String
    let blurb: String
    let flags: [CapabilityFlag]

    var id: String { title }
}

enum CapabilityCatalog {

    static let configPrefix = "plugins.entries.orion-control.config"

    /// Only the booleans. The same config block also holds paths — `homeRoot`,
    /// `desktopRoot`, the ledger and workshop files — and those are not
    /// switches. Showing a folder path as a toggle would invite someone to turn
    /// their home directory "off".
    static let groups: [CapabilityGroup] = [
        CapabilityGroup(
            title: "Seeing",
            blurb: "Reading only. Nothing in this group changes anything.",
            flags: [
                CapabilityFlag(
                    key: "enableAmbientInfoActions",
                    title: "Weather, clock and battery",
                    grants: "Time, battery, disk and uptime — and weather, which is the only action in this whole panel that leaves the machine: a keyless request to open-meteo.com carrying a place name."
                ),
                CapabilityFlag(
                    key: "enableHomeReadActions",
                    title: "Read your home folder",
                    grants: "Read-only listing, metadata and plain-text reads inside your home directory. Dotfiles, credential-shaped names, keychains, cookies, symlinks and anything outside home stay refused. Grants no write of any kind."
                ),
                CapabilityFlag(
                    key: "enableDesktopReadActions",
                    title: "Read your Desktop",
                    grants: "The same reads, narrowed to the Desktop, so it can stay readable while the rest of home is not. Does nothing unless desktopRoot is set in the config — it is."
                ),
                CapabilityFlag(
                    key: "enableMessagesReadActions",
                    title: "Read Messages",
                    grants: "Reading your iMessage and SMS history. Its own switch rather than part of the home read, because “read my home folder” and “read every conversation I have had” deserve separate answers."
                ),
                CapabilityFlag(
                    key: "enableHealthTrackingActions",
                    title: "Health log",
                    grants: "Recording supplements taken and workout sets into the health log this dashboard reads. Writes one JSON file Orion owns and nothing else."
                ),
            ]
        ),
        CapabilityGroup(
            title: "Driving the Mac",
            blurb: "Things you can see happen and undo yourself.",
            flags: [
                CapabilityFlag(
                    key: "enableAppControlActions",
                    title: "Open and quit apps",
                    grants: "Opening, or gracefully quitting, an app you name explicitly. A graceful quit still means the app decides what to do about unsaved work."
                ),
                CapabilityFlag(
                    key: "enableBrowserControlActions",
                    title: "Control the browser",
                    grants: "Opening an http/https URL in a new tab, opening, closing and switching tabs, listing them, and reading the active tab's visible text. Closing a tab is the one thing here with no undo."
                ),
                CapabilityFlag(
                    key: "enableMediaControlActions",
                    title: "Media and volume",
                    grants: "Play/pause, next and previous track, output volume, mute, and putting the display to sleep. Never system sleep, restart, shutdown or logout."
                ),
                CapabilityFlag(
                    key: "enableReminderActions",
                    title: "Timers and alarms",
                    grants: "Setting and cancelling timers and alarms. Writes only to Orion's own reminder store, which this app reads and announces — separate from Apple Reminders."
                ),
                CapabilityFlag(
                    key: "enableCalendarActions",
                    title: "Apple Calendar and Reminders",
                    grants: "Creating Calendar events and Apple Reminders through EventKit. Removing an event is a separate destructive action that still requires confirmation tied to the exact title.",
                    gravity: .consequential,
                    minimumProfile: .consequentialLocal
                ),
            ]
        ),
        CapabilityGroup(
            title: "Writing to your files",
            blurb: "Everything here changes something on disk. The first three are confined to folders Orion owns; the last three are not.",
            flags: [
                CapabilityFlag(
                    key: "enableScratchWorkspaceActions",
                    title: "Scratch workspace",
                    grants: "Free rein inside ~/.openclaw/orion-controlled/scratch-workspace. Nothing outside it, and nothing you own."
                ),
                CapabilityFlag(
                    key: "enableTestWorkspaceActions",
                    title: "Test workspace",
                    grants: "The same, in the test workspace Orion uses to try something before doing it for real."
                ),
                CapabilityFlag(
                    key: "enableScratchDirectWriteActions",
                    title: "Scratch, written outright",
                    grants: "One-step writes inside the scratch workspace, skipping the confirm-the-contents round trip. Still confined to Orion's own folder."
                ),
                CapabilityFlag(
                    key: "enableDesktopTestWorkspaceActions",
                    title: "Desktop test folder",
                    grants: "A sandbox on the Desktop itself, so you can watch a change happen where you can see it without it touching your real files."
                ),
                CapabilityFlag(
                    key: "enableDesktopModifyActions",
                    title: "Modify Desktop files",
                    grants: "Creating folders, and appending to or replacing files on your Desktop — each confirmed against the exact expected text first.",
                    gravity: .consequential
                ),
                CapabilityFlag(
                    key: "enableDesktopDirectWriteActions",
                    title: "Write Desktop files outright",
                    grants: "Writing a Desktop file in one step, with no confirm-the-contents round trip. Faster, and there is no undo — the previous contents are gone.",
                    gravity: .consequential
                ),
                CapabilityFlag(
                    key: "enableFileMutateActions",
                    title: "Move, rename and delete to Trash",
                    grants: "Moving, renaming and deleting-to-Trash inside the configured mutable roots. Deliberately held one rung higher than the other file switches, so it cannot arrive as a side effect of widening something else.",
                    gravity: .consequential,
                    minimumProfile: .consequentialLocal
                ),
            ]
        ),
        CapabilityGroup(
            title: "Learning",
            blurb: "Local memory capture. No model call and no cloud-token cost.",
            flags: [
                CapabilityFlag(
                    key: "enableEpisodicCapture",
                    title: "Automatic episodic memory",
                    grants: "At the end of a turn, records high-signal preferences, corrections and decisions in the daily journal. It is deterministic, deduplicated, skips credential-shaped text, and does not ask the model to decide whether to remember."
                ),
            ]
        ),
        CapabilityGroup(
            title: "Leaving this Mac",
            blurb: "The only group where something goes to another person. Nothing here is recallable.",
            flags: [
                CapabilityFlag(
                    key: "enableMessagesSendActions",
                    title: "Send messages",
                    grants: "Sending iMessage and SMS as you. Every profile below external_connected promises in writing that communications are not included, so this switch on its own is necessary and deliberately not sufficient.",
                    gravity: .consequential,
                    minimumProfile: .externalConnected
                ),
            ]
        ),
        CapabilityGroup(
            title: "Orion changing Orion",
            blurb: "Each self-change surface has its own switch, test gate and rollback path.",
            flags: [
                CapabilityFlag(
                    key: "enableSelfTuningActions",
                    title: "Tune his own voice timing",
                    grants: "Reading and adjusting how long he waits before deciding you have stopped talking, and the watchdog that ends a wedged speaking phase. A closed list of keys with range-checked values in his own preference domain; every change records its own inverse, and the numbers are the ones shown under Voice timing."
                ),
                CapabilityFlag(
                    key: "enableSelfConfigActions",
                    title: "Change his own settings",
                    grants: "Changing a closed, validated table of Orion settings. Permission switches still require you to name the setting, ask for the permission change and approve the exact value.",
                    gravity: .consequential,
                    minimumProfile: .consequentialLocal
                ),
                CapabilityFlag(
                    key: "enableSelfScriptsActions",
                    title: "Repair his wrapper tools",
                    grants: "Editing an orion-* wrapper, then syntax-checking and smoke-testing it before install. The prior script is restored automatically if the check fails.",
                    gravity: .consequential,
                    minimumProfile: .consequentialLocal
                ),
                CapabilityFlag(
                    key: "enableSelfPluginActions",
                    title: "Repair his control plugin",
                    grants: "Editing the plugin that supplies guarded actions, then compiling, running the full suite, restarting the gateway and rolling back automatically if health does not return.",
                    gravity: .consequential,
                    minimumProfile: .consequentialLocal
                ),
                CapabilityFlag(
                    key: "enableSelfModificationActions",
                    title: "Rewrite and rebuild his own source",
                    grants: "Editing the Swift and Python this assistant is built from, then compiling and installing the result. That includes the code deciding what he is allowed to do and when he asks you first, so the Orion that comes back is not necessarily the one you switched this on for. It is listed on its own rather than folded in with the file switches precisely so it can never arrive as a side effect of widening filesystem access.",
                    gravity: .rewritesSelf,
                    minimumProfile: .consequentialLocal
                ),
            ]
        ),
    ]

    static var all: [CapabilityFlag] { groups.flatMap(\.flags) }
}

// MARK: - Model

/// Loads the flags, and changes them the only way that is safe.
///
/// Every write is: back up the config, `openclaw config set`, then
/// `openclaw config validate`. If the validate fails the user is told, loudly,
/// and pointed at the backup — a config the gateway will not load is Orion
/// gone, and that must never be a thing a toggle can do quietly.
final class CapabilitiesModel: ObservableObject {

    @Published private(set) var values: [String: Bool] = [:]
    @Published private(set) var profile: String?
    @Published private(set) var profileUpdatedAt: Date?
    @Published private(set) var loaded = false
    /// Which switch is mid-write, so its row can show it rather than appearing
    /// to have already changed.
    @Published private(set) var busyKey: String?
    @Published private(set) var lastError: String?
    /// What the last successful write did, including where the backup went.
    @Published private(set) var lastNote: String?

    /// `orion-authority explain`, on demand. It derives the real answer from
    /// live state — flags, profile and the exec allowlist together — which is
    /// the one thing this UI cannot do from the config file alone.
    @Published private(set) var authority: String?
    @Published private(set) var authorityBusy = false

    private static let authorityPath = "/Users/nickmadaio/Desktop/ORION/scripts/orion-authority"
    private static let permissionStatePath =
        "/Users/nickmadaio/.openclaw/orion-controlled/permission-state.json"

    func value(_ flag: CapabilityFlag) -> Bool { values[flag.key] ?? false }

    var enabledCount: Int { CapabilityCatalog.all.filter { value($0) }.count }

    /// The live profile, if it is one this build knows about.
    var parsedProfile: PermissionProfile? { profile.flatMap(PermissionProfile.init(rawValue:)) }

    /// True when the flag is on and the profile still will not let it fire.
    ///
    /// This is the case the whole panel exists to make visible. Right now it is
    /// not hypothetical: `enableMessagesSendActions` is on, and the profile is
    /// `consequential_local`, which does not carry `messages_send`. Orion
    /// cannot send a message, and nothing else in this UI would have told you.
    func blockedByProfile(_ flag: CapabilityFlag) -> Bool {
        guard value(flag), let required = flag.minimumProfile else { return false }
        guard let live = parsedProfile else { return false }
        return live < required
    }

    var blockedCount: Int { CapabilityCatalog.all.filter { blockedByProfile($0) }.count }

    // MARK: Loading

    /// Reading the config is a plain file read, but it is still off the main
    /// thread: this runs from a view's `onAppear`, and the launch path is not
    /// the place to discover that a disk is busy. See SecretStore.queue for the
    /// version of this lesson that cost an afternoon.
    func load() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let flags = CapabilitiesModel.readAllFlags()
            let state = CapabilitiesModel.readPermissionState()
            DispatchQueue.main.async {
                guard let self else { return }
                self.values = flags
                self.profile = state.profile
                self.profileUpdatedAt = state.updatedAt
                self.loaded = true
            }
        }
    }

    private static func configRoot() -> [String: Any]? {
        guard let data = FileManager.default.contents(atPath: GatewayClient.configPath),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return root
    }

    private static func configBlock() -> [String: Any] {
        guard let root = configRoot(),
              let plugins = root["plugins"] as? [String: Any],
              let entries = plugins["entries"] as? [String: Any],
              let control = entries["orion-control"] as? [String: Any],
              let config = control["config"] as? [String: Any]
        else { return [:] }
        return config
    }

    private static func readAllFlags() -> [String: Bool] {
        let config = configBlock()
        var result: [String: Bool] = [:]
        for flag in CapabilityCatalog.all {
            // A key that is absent is off. The plugin treats a missing flag as
            // not granted, so showing it as anything else would misreport.
            result[flag.key] = config[flag.key] as? Bool ?? false
        }
        return result
    }

    static func readConfigString(_ key: String) -> String? {
        configBlock()[key] as? String
    }

    private static func readPermissionState() -> (profile: String?, updatedAt: Date?) {
        guard let data = FileManager.default.contents(atPath: permissionStatePath),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return (nil, nil) }
        let profile = root["profile"] as? String
        let stamp = (root["updatedAt"] as? String).flatMap {
            CapabilitiesModel.fractionalISO.date(from: $0) ?? ISO8601DateFormatter().date(from: $0)
        }
        return (profile, stamp)
    }

    // MARK: Writing

    /// Flip one flag.
    ///
    /// Deliberately not optimistic: the switch does not move until the CLI has
    /// written and revalidated. A toggle that snaps across and then silently
    /// fails to persist is how you end up believing a capability is off when it
    /// is on.
    func set(_ flag: CapabilityFlag, to next: Bool) {
        guard busyKey == nil else { return }
        busyKey = flag.key
        lastError = nil
        lastNote = nil

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let outcome = CapabilitiesModel.write(path: flag.configPath, value: next)
            let flags = CapabilitiesModel.readAllFlags()
            DispatchQueue.main.async {
                guard let self else { return }
                self.busyKey = nil
                self.values = flags
                switch outcome {
                case .success(let backup):
                    self.lastNote = "\(flag.title) → \(next ? "on" : "off"). "
                        + "Config validated. Backup: \(backup)"
                    OrionLog.write("[capability] \(flag.key)=\(next) — validated, backup at \(backup)")
                case .failure(let message):
                    self.lastError = message
                    OrionLog.write("[capability] \(flag.key)=\(next) FAILED — \(message)")
                }
            }
        }
    }

    private enum WriteOutcome {
        case success(String)
        case failure(String)
    }

    private static func write(path: String, value: Bool) -> WriteOutcome {
        guard FileManager.default.isExecutableFile(atPath: GatewayClient.binaryPath) else {
            return .failure("The openclaw CLI is not at \(GatewayClient.binaryPath).")
        }

        let backup: String
        do {
            backup = try backUpConfig()
        } catch {
            // No backup means no write. The whole point of the backup is that
            // the step after it can break Orion's config.
            return .failure("Could not back the config up, so nothing was changed: "
                            + error.localizedDescription)
        }

        // `--strict-json` so `true` is the boolean and never the string "true".
        // The schema would reject the string, but only after it had been
        // written; being explicit means it never gets that far.
        let set = run([ "config", "set", path, value ? "true" : "false", "--strict-json" ])
        guard set.status == 0 else {
            return .failure("openclaw config set failed: \(set.trimmedOutput). "
                            + "Your config is untouched; a backup is at \(backup).")
        }

        // Belt and braces. `set` validates its own change, but the file on disk
        // is what the gateway loads, and that is the thing worth confirming.
        let validate = run(["config", "validate"])
        guard validate.status == 0 else {
            return .failure("The config no longer validates: \(validate.trimmedOutput). "
                            + "Restore the backup at \(backup) before restarting the gateway.")
        }
        return .success(backup)
    }

    /// A timestamped copy beside the config, kept because the alternative is
    /// asking someone to reconstruct their gateway config by hand.
    private static func backUpConfig() throws -> String {
        let stamp = CapabilitiesModel.backupStamp.string(from: Date())
        // Its own subdirectory: `~/.openclaw/backups` already belongs to
        // OpenClaw (it keeps launch agents there), and mixing Orion's config
        // snapshots into somebody else's backup folder is how a cleanup script
        // eventually deletes the wrong thing.
        let directory = (GatewayClient.configPath as NSString).deletingLastPathComponent
            + "/backups/orion-config"
        try FileManager.default.createDirectory(atPath: directory,
                                                withIntermediateDirectories: true)
        let destination = "\(directory)/openclaw.\(stamp).json"
        if FileManager.default.fileExists(atPath: destination) {
            try FileManager.default.removeItem(atPath: destination)
        }
        try FileManager.default.copyItem(atPath: GatewayClient.configPath, toPath: destination)
        return destination
    }

    // MARK: Authority

    /// What Orion can actually do right now, derived from live state.
    func explain() {
        guard !authorityBusy else { return }
        authorityBusy = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = CapabilitiesModel.runScript(CapabilitiesModel.authorityPath, ["explain"])
            DispatchQueue.main.async {
                guard let self else { return }
                self.authorityBusy = false
                self.authority = result.status == 0
                    ? result.trimmedOutput
                    : "orion-authority could not answer: \(result.trimmedOutput)"
            }
        }
    }

    // MARK: Process

    private struct Run {
        let status: Int32
        let output: String
        var trimmedOutput: String {
            let text = output.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? "(no output)" : text
        }
    }

    private static func run(_ arguments: [String]) -> Run {
        runScript(GatewayClient.binaryPath, arguments)
    }

    /// Blocking. Every caller is already on a background queue.
    private static func runScript(_ path: String, _ arguments: [String]) -> Run {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments

        // Same reason as GatewayClient.ask: the CLI is a bash shim with a
        // `/usr/bin/env` shebang, and a GUI app inherits an environment with a
        // PATH that cannot resolve it.
        var environment = ProcessInfo.processInfo.environment
        let existing = environment["PATH"] ?? ""
        let required = "/usr/bin:/bin:/usr/sbin:/sbin:/Users/nickmadaio/.openclaw/bin"
        environment["PATH"] = existing.isEmpty ? required : existing + ":" + required
        process.environment = environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.standardInput = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            return Run(status: -1, output: error.localizedDescription)
        }
        // Read before waiting. `waitUntilExit` with a full pipe and nobody
        // draining it deadlocks — the same trap GatewayClient documents, and
        // the one behind the twelve-minute `.thinking` stall.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return Run(status: process.terminationStatus,
                   output: String(data: data, encoding: .utf8) ?? "")
    }
}

extension CapabilitiesModel {
    /// `permission-state.json` is written by Python, which stamps
    /// `updatedAt` with fractional seconds. The plain internet-date parser
    /// returns nil on those, which is why there are two formatters here and not
    /// one.
    static let fractionalISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Sortable, and with no colons in it — colons are legal in a macOS path
    /// and unpleasant in every shell that later has to touch the file.
    static let backupStamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()
}
