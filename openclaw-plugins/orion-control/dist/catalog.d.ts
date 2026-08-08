export type Risk = "low" | "medium" | "high" | "critical";
export type CapabilityTier = "simulation" | "app_control" | "browser_control" | "media_control" | "test_workspace" | "scratch_workspace" | "desktop_read" | "home_read" | "desktop_test_workspace" | "desktop_modify" | "desktop_direct_write" | "scratch_direct_write" | "file_mutate" | "self_modification" | "ambient_info" | "reminders" | "self_tuning" | "health_tracking";
/**
 * Roots Orion may write to. `home` is deliberately absent: home is a READ root
 * only, and every write policy below is typed against `MutableRoot` so a
 * home-directory write cannot be expressed, let alone executed.
 */
export type MutableRoot = "test_workspace" | "scratch_workspace" | "desktop";
export type ReadableRoot = "desktop" | "home";
export type ControlledRoot = MutableRoot | "home";
export declare const MUTABLE_ROOTS: readonly MutableRoot[];
export interface CreateOnlyTextPolicy {
    kind: "create_only_text";
    root: MutableRoot;
    subdirectory: string;
    nameArgument: string;
    contentArgument: string;
    fixedExtension?: string;
    extensionArgument?: string;
    allowedExtensions: readonly string[];
    maxBytes: number;
}
export interface DesktopTextMutationPolicy {
    kind: "mutate_text";
    operation: "create" | "append" | "replace";
    root: "desktop";
    relativePathArgument: string;
    contentArgument: string;
    expectedHashArgument: string;
    resultHashArgument: string;
    allowedExtensions: readonly string[];
    maxContentBytes: number;
    maxResultBytes: number;
}
export interface DesktopFileMutationPolicy {
    kind: "mutate_file";
    root: MutableRoot;
    relativePathArgument: string;
    operationArgument: string;
    encodingArgument: string;
    contentArgument: string;
    contentSourceArgument: string;
    expectedHashArgument: string;
    resultHashArgument: string;
    maxContentBytes: number;
    maxResultBytes: number;
}
/**
 * AppleScript-driven browser control. Same shape as `app_control`: the
 * application is resolved from /Applications and addressed by bundle id, never
 * by a caller-supplied script fragment.
 */
export interface BrowserControlPolicy {
    kind: "browser_control";
    operation: "open_url" | "new_tab" | "close_tab" | "list_tabs" | "switch_tab" | "read_page";
    /** Optional caller-chosen browser; otherwise auto-detected. */
    browserArgument: string;
    urlArgument?: string;
    /** Tab index (1-based) or a title/URL substring. */
    selectorArgument?: string;
    /** Hard ceiling on extracted page text. */
    maxBytes?: number;
    maxTabs?: number;
    /** True for actions that observe browser state rather than change it. */
    read: boolean;
}
export interface MediaControlPolicy {
    kind: "media_control";
    operation: "play_pause" | "next_track" | "previous_track" | "volume_set" | "volume_mute" | "volume_unmute" | "display_sleep";
    levelArgument?: string;
    playerArgument?: string;
    /** Nouns the user's own turn must mention for this control to be authorized. */
    targetWords: readonly string[];
}
/**
 * Move / rename / delete inside a mutable root. Delete means "move to Trash":
 * see `trashPath` in executors.ts. Nothing here unlinks.
 */
export interface FileMutationPolicy {
    kind: "file_mutate";
    operation: "move" | "rename" | "delete";
    rootArgument: string;
    relativePathArgument: string;
    /** `destinationPath` for move, `newName` for rename, absent for delete. */
    destinationArgument?: string;
}
export type ExecutionPolicy = {
    kind: "simulate";
}
/**
 * Rewrite one of Orion's own Swift sources, rebuild, reinstall, and prove the
 * result still launches.
 *
 * Everything dangerous lives in `scripts/orion-forge` rather than here, on
 * purpose: this is the single most powerful thing Orion can do and it should
 * be one file a person can read end to end, not logic threaded through a ten
 * thousand line plugin. The plugin's job is to get the request through the
 * gate; the script's job is to make the change survivable.
 *
 * Three gates in that script, none of which ask a human anything:
 * the path (only .swift inside the app target — Orion cannot edit the gate
 * that constrains him, nor the script itself), the build (it must compile),
 * and the launch (it must still start, verified by watching for a crash
 * report, with the previous bundle restored automatically if it does not).
 */
 | {
    kind: "self_modify";
}
/**
 * Reading Orion's own source, so that editing it is possible at all.
 *
 * These are not a convenience. A find/replace edit needs the exact existing
 * text, and Orion cannot quote a file he cannot open or name a file he cannot
 * see — asked to change the UI, he answered that he did not know where the
 * source was, which was true and was a missing capability rather than
 * confusion. Read-only, so they sit at the ordinary read tier: this is code
 * on the user's own disk, and hiding it from him buys nothing.
 */
 | {
    kind: "self_source";
    operation: "list" | "read";
} | {
    kind: "app_control";
    operation: "open" | "quit";
    applicationArgument: string;
} | BrowserControlPolicy | MediaControlPolicy | {
    kind: "ambient_read";
    operation: "weather" | "clock" | "system_status";
} | {
    kind: "reminder";
    operation: "timer_set" | "alarm_set" | "reminder_list" | "reminder_cancel";
} | {
    kind: "self_tuning";
    operation: "read" | "write";
} | {
    kind: "health_log";
    operation: "supplement_add" | "supplement_take" | "supplement_status" | "workout_log" | "workout_status";
} | FileMutationPolicy | CreateOnlyTextPolicy | DesktopTextMutationPolicy | DesktopFileMutationPolicy | {
    kind: "create_directory";
    root: MutableRoot;
    relativePathArgument: string;
} | {
    kind: "list_directory";
    root: ReadableRoot;
    relativePathArgument: string;
    maxEntries: number;
} | {
    kind: "path_metadata";
    root: ReadableRoot;
    relativePathArgument: string;
} | {
    kind: "read_text";
    root: ReadableRoot;
    relativePathArgument: string;
    allowedExtensions: readonly string[];
    maxBytes: number;
};
/** The read-only observation policies, shared by execution and verification. */
export type ObservationPolicy = Extract<ExecutionPolicy, {
    kind: "list_directory" | "path_metadata" | "read_text";
}>;
export declare function isObservationPolicy(policy: ExecutionPolicy): policy is ObservationPolicy;
/**
 * The closed set of things Orion may retune about himself.
 *
 * Deliberately a table and not a pass-through to `defaults write`. The ask was
 * "he should be able to fix himself"; the safe reading of that is a fixed list
 * of his own knobs with the bounds written down, not the ability to write any
 * key into any preference domain on the machine.
 *
 * `domain` is his own app bundle and nothing else. The ranges are the same ones
 * `VoiceTuning.swift` clamps to — duplicated rather than shared because the two
 * processes have no common language, and a value out of range here would be
 * silently clamped there, which reads as "the setting didn't take".
 */
export declare const ORION_APP_DOMAIN = "com.nickmadaio.orion.app";
export interface TunableSetting {
    /** The `UserDefaults` key, as spelled in `VoiceTuning.swift`. */
    key: string;
    min: number;
    max: number;
    integer: boolean;
    unit: string;
    description: string;
}
export declare const TUNABLE_SETTINGS: Record<string, TunableSetting>;
export interface ActionDefinition {
    risk: Risk;
    requiredArguments: string[];
    approvalRequired: boolean;
    verification: string;
    reversible: boolean;
    capabilityTier: CapabilityTier;
    execution: ExecutionPolicy;
    validateArguments?: (arguments_: Record<string, unknown>) => string[];
}
export declare function isSafeRelativePath(value: unknown, allowRoot?: boolean): value is string;
export declare function isVisibleNonSensitiveName(name: string): boolean;
/**
 * Home-directory reads: the shared path guard PLUS a denylist for directories
 * that hold credential material under an innocuous name.
 *
 * This composes `isSafeRelativePath` rather than replacing it, so every rule
 * that guards Desktop (no absolute paths, no `~`, no `..`, no dotfiles, no
 * credential-shaped names, length and segment caps) applies unchanged here and
 * this only ever refuses more.
 */
export declare function isSafeHomeRelativePath(value: unknown, allowRoot?: boolean): value is string;
/** A single path segment usable as a rename target. */
export declare function isSafeSegment(value: unknown): value is string;
export declare function isMutableRoot(value: unknown): value is MutableRoot;
/**
 * URL validation is a security boundary, not a formality.
 *
 * This is the surface where a malicious instruction would try to reach a local
 * file (`file:`), execute script in the page (`javascript:`), inline a payload
 * (`data:`), or smuggle credentials at a host (`user:pass@`). Anything that is
 * not a plain http/https URL of printable ASCII is refused outright rather than
 * normalized, and the character allowlist also makes AppleScript string
 * interpolation of the URL unambiguous.
 */
export declare const MAX_URL_LENGTH = 2048;
export declare function browserUrlIssues(value: unknown): string[];
export declare const SUPPORTED_BROWSERS: readonly ["Opera Air", "Opera", "Safari", "Google Chrome"];
export type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number];
export declare function resolveBrowserName(value: unknown): SupportedBrowser | undefined;
export declare const SUPPORTED_PLAYERS: readonly ["Spotify", "Music", "TV", "Podcasts"];
export type SupportedPlayer = (typeof SUPPORTED_PLAYERS)[number];
export declare function resolvePlayerName(value: unknown): SupportedPlayer | undefined;
export declare const MIN_VOLUME = 0;
export declare const MAX_VOLUME = 100;
/** Volume must be a real number in 0-100; strings and NaN are refused. */
export declare function volumeIssues(value: unknown): string[];
/** Defence in depth: the executor never emits an out-of-range volume. */
export declare function clampVolume(value: number): number;
/** Plain-text extensions readable from the home directory. */
export declare const HOME_TEXT_EXTENSIONS: readonly string[];
export declare const MAX_TAB_SELECTOR_LENGTH = 200;
/** A tab selector is a 1-based index or a title/URL substring. */
export declare function tabSelectorIssues(value: unknown): string[];
export declare const ACTION_CATALOG: Readonly<Record<string, ActionDefinition>>;
