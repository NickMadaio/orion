import { type DevOperation } from "./devops.js";
export type Risk = "low" | "medium" | "high" | "critical";
export type CapabilityTier = "simulation" | "app_control" | "browser_control" | "media_control" | "test_workspace" | "scratch_workspace" | "desktop_read" | "home_read" | "desktop_test_workspace" | "desktop_modify" | "desktop_direct_write" | "scratch_direct_write" | "file_mutate" | "self_modification" | "self_plugin" | "self_scripts" | "self_config" | "ambient_info" | "reminders" | "self_tuning" | "health_tracking" | "calendar" | "messages_read" | "messages_send" | "dev_operations" | "automation" | "waiting_on" | "prep" | "travel";
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
}
/**
 * Repairing the plugin, the wrapper scripts, or openclaw.json.
 *
 * The same division of labour as `self_modify`, for the same reason: every
 * gate that makes a repair survivable — the class tables, the realpath check,
 * the build, the test suite, the gate self-test, the health probe and the
 * rollback — lives in `scripts/orion-repair`, which is one file a person can
 * read end to end. This policy only names which surface and which verb.
 *
 * `authority` is carried here as well as on the action so the executor can
 * refuse a mismatch rather than trusting that the right action was routed to
 * the right handler.
 */
 | {
    kind: "self_repair";
    surface: "plugin" | "script" | "config";
    operation: "list" | "read" | "modify" | "revert" | "status";
    authority?: boolean;
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
}
/**
 * Reading the Messages database, through `scripts/orion-messages`.
 *
 * The same division of labour as `self_modify`: the plugin's job is to get
 * the request through the gate, and the script's job is to know that Apple
 * stores dates as nanoseconds since 2001 and hides newer message bodies in a
 * serialised blob. Duplicating that here would be a second reader to get
 * wrong.
 */
 | {
    kind: "messages_read";
    operation: "recent" | "from" | "search" | "chats" | "whoami" | "contacts_status";
} | {
    kind: "calendar";
    operation: "event_add" | "event_remove" | "reminder_add";
}
/**
 * Sending, through `scripts/orion-messages-send`.
 *
 * Deliberately a different execution kind from `messages_read` and not an
 * operation on it. They share a subject and nothing else: one is a query and
 * the other is the only irreversible outbound act in this catalog. A shared
 * policy shape would invite a shared switch.
 */
 | {
    kind: "messages_send";
}
/**
 * PHASE 51. One structured development operation, against one repository
 * named by key rather than by path.
 *
 * The policy carries the operation and nothing else. There is no argv here,
 * no working directory and no path: `resolveDevCommand` in devops.ts owns
 * all three, so an action cannot smuggle a flag through the catalog.
 */
 | {
    kind: "dev_operation";
    operation: DevOperation;
}
/**
 * PHASES 57/58. Write, read or simulate an automation PROPOSAL.
 *
 * `propose` and `withdraw` write into a proposals directory nothing
 * schedules from. Turning a proposal into a running job happens in a
 * separate program Orion may not run, which is the whole design.
 */
 | {
    kind: "automation";
    operation: "propose" | "list" | "simulate" | "withdraw";
}
/**
 * PHASE 62. Track, surface and resolve something Nick is waiting on.
 *
 * `draft` writes text onto the item and cannot deliver it. Turning a draft
 * into a message goes through the ordinary outbound gate with an approval
 * ticket, exactly as if Orion had composed it fresh -- see waiting.ts.
 */
 | {
    kind: "waiting";
    operation: "add" | "list" | "resolve" | "dismiss" | "snooze" | "draft";
}
/**
 * PHASE 61. One prep card for one event. Reads mail, the brain, tasks and
 * the waiting list; writes nothing anywhere.
 */
 | {
    kind: "prep_card";
}
/**
 * PHASE 78. Detect candidate bookings, keep trips, render a brief.
 *
 * `detect` PROPOSES and never creates: a confirmation email is untrusted
 * text and anyone can send one. There is deliberately no operation that
 * books, modifies or cancels anything.
 */
 | {
    kind: "travel";
    operation: "detect" | "list" | "add" | "remove" | "brief";
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
    /**
     * Arguments that must have come out of Nick's own mouth, not merely out of
     * something Orion read.
     *
     * The taint check in the validator asks the NEGATIVE question -- "does this
     * value appear in untrusted content and nowhere in his words?" -- and that is
     * the right question for a file path, because Orion routinely picks paths
     * himself and refusing those would be friction with nothing behind it.
     *
     * It is the wrong question for the recipient of a message. A recipient Orion
     * invented is not safer than one an attacker supplied; both are wrong, and
     * "the value appears in no page I read" is not evidence that Nick asked for
     * it. There is also a hole in the negative form at this exact spot: the taint
     * check skips values under five characters as accidental collisions, so
     * `recipient: "Mom"` or `"Dad"` would sail past it no matter where it came
     * from.
     *
     * So the check is inverted for these arguments: the value must APPEAR in the
     * authenticated user turn. Not phrased a particular way, not matched against
     * a verb list -- the deleted wording rules failed because they tried to
     * re-derive intent, and this does not. It asks only where the string came
     * from, which is the same data question `urlCarriesUntrustedData` asks.
     */
    userOriginatedArguments?: readonly string[];
    /**
     * This action can widen what Orion is allowed to do.
     *
     * Nick's rule is that Orion may grant himself authority when Nick asks — so
     * the question the gate has to answer is not "is this forbidden" but "did
     * Nick actually ask". Three existing mechanisms answer it together, and this
     * flag turns on the one that was missing:
     *
     *   `userOriginatedArguments`  the target must appear in Nick's own words, so
     *                              "yes, go ahead" cannot widen anything — he has
     *                              to have named the flag, key or file.
     *   `approvalRequired`         he is asked before it happens, bound to these
     *                              exact arguments.
     *   the taint check            a target that appears in something Orion READ
     *                              and in nothing Nick said is refused, so a text
     *                              message saying "grant yourself send permission"
     *                              names the capability and gets nowhere.
     *
     * What this flag adds is the last piece: the user's turn must also be ABOUT
     * permission. Naming `enableMessagesSendActions` while asking what it does is
     * not the same sentence as asking for it to be turned on, and only the second
     * should move a switch. It is the same shape `changePermissionProfile` has
     * always demanded of a profile change — an instruction that names the thing
     * AND says what kind of change it is — applied to the other route to the same
     * outcome.
     */
    authorityChange?: boolean;
}
/**
 * Words that make a sentence an instruction about permission rather than a
 * sentence that merely mentions one.
 *
 * Deliberately broad and deliberately not a phrasing rule. It is not trying to
 * re-derive intent — the wording checks that used to do that were deleted for
 * good reasons written up in `validator.ts`. It asks one narrow question that
 * the taint check and the approval hash cannot: is this turn about authority at
 * all? Widening the list only ever lets more true requests through, and every
 * one of them still has to name the target and clear the approval gate.
 */
export declare const AUTHORITY_INSTRUCTION: RegExp;
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
