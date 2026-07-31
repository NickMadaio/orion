export const MUTABLE_ROOTS = [
    "test_workspace",
    "scratch_workspace",
    "desktop",
];
export function isObservationPolicy(policy) {
    return (policy.kind === "list_directory" ||
        policy.kind === "path_metadata" ||
        policy.kind === "read_text");
}
const SAFE_NAME = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
/**
 * Credential-shaped names, refused everywhere a path is accepted.
 *
 * `credential` / `secret` / `password` / `keychain` match anywhere in the
 * segment (so `my-credentials.txt` and `work_secrets.md` are refused, not just
 * `credentials.txt`); the remaining forms stay anchored so ordinary words like
 * `tokenizer.js` are not swept up. Widening this only ever refuses more.
 */
const SENSITIVE_NAME = new RegExp([
    "credential",
    "secret",
    "passwd",
    "password",
    "keychain",
    "^tokens?(?:\\.|$)",
    "^id_(?:rsa|dsa|ecdsa|ed25519)",
    "^authorized_keys(?:\\.|$)",
    "^known_hosts(?:\\.|$)",
    "\\.(?:pem|key|p12|pfx|keystore|jks|asc|gpg|ppk)$",
].join("|"), "i");
/**
 * Directory names inside $HOME that hold credential material even though their
 * own name is not credential-shaped. Dot-directories (`.ssh`, `.aws`,
 * `.config`, `.env*`) are already refused by the leading-dot rule.
 */
const HOME_DENIED_SEGMENT = /^(?:keychains|cookies|keychain)$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RELATIVE_PATH_LENGTH = 1024;
const MAX_PATH_SEGMENTS = 32;
const MAX_SEGMENT_LENGTH = 255;
export function isSafeRelativePath(value, allowRoot = false) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
        return false;
    }
    if (value.length > MAX_RELATIVE_PATH_LENGTH)
        return false;
    if (allowRoot && value === ".")
        return true;
    if (value.startsWith("/") || value.startsWith("~") || value.includes("\\")) {
        return false;
    }
    const segments = value.split("/");
    if (segments.length > MAX_PATH_SEGMENTS)
        return false;
    return segments.every((segment) => segment.length > 0 &&
        segment.length <= MAX_SEGMENT_LENGTH &&
        segment !== "." &&
        segment !== ".." &&
        !segment.startsWith(".") &&
        !SENSITIVE_NAME.test(segment));
}
/**
 * Hashes are derived server-side from the exact bytes the executor is about to
 * write. A caller MAY still assert them, in which case the assertion is
 * enforced as an extra optimistic-concurrency check; omitting them is the
 * normal path and carries no security weight.
 */
function validateOptionalHashes(arguments_, operation, expectedHashArgument, resultHashArgument) {
    const issues = [];
    const expectedHash = arguments_[expectedHashArgument];
    const resultHash = arguments_[resultHashArgument];
    if (expectedHash !== undefined) {
        const valid = operation === "create"
            ? expectedHash === "absent"
            : typeof expectedHash === "string" && SHA256.test(expectedHash);
        if (!valid) {
            issues.push(operation === "create"
                ? `${expectedHashArgument} may be omitted, or must be exactly absent for create`
                : `${expectedHashArgument} may be omitted, or must be a lowercase SHA-256 hash`);
        }
    }
    if (resultHash !== undefined &&
        (typeof resultHash !== "string" || !SHA256.test(resultHash))) {
        issues.push(`${resultHashArgument} may be omitted, or must be a lowercase SHA-256 hash`);
    }
    return issues;
}
export function isVisibleNonSensitiveName(name) {
    return (name.length > 0 &&
        name !== "." &&
        name !== ".." &&
        !name.startsWith(".") &&
        !SENSITIVE_NAME.test(name));
}
/**
 * Home-directory reads: the shared path guard PLUS a denylist for directories
 * that hold credential material under an innocuous name.
 *
 * This composes `isSafeRelativePath` rather than replacing it, so every rule
 * that guards Desktop (no absolute paths, no `~`, no `..`, no dotfiles, no
 * credential-shaped names, length and segment caps) applies unchanged here and
 * this only ever refuses more.
 */
export function isSafeHomeRelativePath(value, allowRoot = false) {
    if (!isSafeRelativePath(value, allowRoot))
        return false;
    if (value === ".")
        return true;
    return value
        .split("/")
        .every((segment) => !HOME_DENIED_SEGMENT.test(segment));
}
/** A single path segment usable as a rename target. */
export function isSafeSegment(value) {
    return (typeof value === "string" &&
        !value.includes("/") &&
        isSafeRelativePath(value));
}
export function isMutableRoot(value) {
    return (typeof value === "string" &&
        MUTABLE_ROOTS.includes(value));
}
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
export const MAX_URL_LENGTH = 2048;
const URL_PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
export function browserUrlIssues(value) {
    if (typeof value !== "string" || value.length === 0) {
        return ["url must be a non-empty string"];
    }
    if (value.length > MAX_URL_LENGTH) {
        return [`url must be at most ${MAX_URL_LENGTH} characters`];
    }
    if (!URL_PRINTABLE_ASCII.test(value)) {
        return ["url must be printable ASCII with no whitespace or control characters"];
    }
    if (/["'`\\<>{}^]/.test(value)) {
        return ["url must not contain quotes, backslashes, or angle brackets"];
    }
    if (!/^https?:\/\//i.test(value)) {
        return ["url must start with http:// or https://; other schemes are refused"];
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        return ["url must be a valid absolute URL"];
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return ["url scheme must be http or https"];
    }
    if (parsed.username !== "" || parsed.password !== "") {
        return ["url must not embed credentials"];
    }
    if (parsed.hostname.length === 0) {
        return ["url must name a host"];
    }
    return [];
}
export const SUPPORTED_BROWSERS = [
    "Opera Air",
    "Opera",
    "Safari",
    "Google Chrome",
];
const BROWSER_ALIASES = {
    "opera air": "Opera Air",
    "opera": "Opera",
    "safari": "Safari",
    "google chrome": "Google Chrome",
    "chrome": "Google Chrome",
};
export function resolveBrowserName(value) {
    if (typeof value !== "string")
        return undefined;
    return BROWSER_ALIASES[value.trim().toLowerCase()];
}
export const SUPPORTED_PLAYERS = ["Spotify", "Music", "TV", "Podcasts"];
export function resolvePlayerName(value) {
    if (typeof value !== "string")
        return undefined;
    const wanted = value.trim().toLowerCase();
    return SUPPORTED_PLAYERS.find((player) => player.toLowerCase() === wanted);
}
export const MIN_VOLUME = 0;
export const MAX_VOLUME = 100;
/** Volume must be a real number in 0-100; strings and NaN are refused. */
export function volumeIssues(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return ["level must be a number between 0 and 100"];
    }
    if (!Number.isInteger(value)) {
        return ["level must be a whole number between 0 and 100"];
    }
    if (value < MIN_VOLUME || value > MAX_VOLUME) {
        return ["level must be between 0 and 100"];
    }
    return [];
}
/** Defence in depth: the executor never emits an out-of-range volume. */
export function clampVolume(value) {
    if (!Number.isFinite(value))
        return MIN_VOLUME;
    return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(value)));
}
/** Plain-text extensions readable from the home directory. */
export const HOME_TEXT_EXTENSIONS = [
    "txt",
    "md",
    "json",
    "csv",
    "log",
    "yaml",
    "yml",
    "toml",
];
export const MAX_TAB_SELECTOR_LENGTH = 200;
/** A tab selector is a 1-based index or a title/URL substring. */
export function tabSelectorIssues(value) {
    if (typeof value === "number") {
        return Number.isInteger(value) && value >= 1 && value <= 500
            ? []
            : ["tab index must be a whole number between 1 and 500"];
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        return ["tab must be a 1-based index or a title/URL substring"];
    }
    return value.length <= MAX_TAB_SELECTOR_LENGTH
        ? []
        : [`tab substring must be at most ${MAX_TAB_SELECTOR_LENGTH} characters`];
}
function validateCreateOnlyText(policy, arguments_) {
    const issues = [];
    const name = arguments_[policy.nameArgument];
    const content = arguments_[policy.contentArgument];
    const extension = policy.fixedExtension
        ? policy.fixedExtension
        : policy.extensionArgument
            ? arguments_[policy.extensionArgument]
            : undefined;
    if (typeof name !== "string" || !SAFE_NAME.test(name)) {
        issues.push(`${policy.nameArgument} must be 1-64 lowercase letters, digits, underscores, or hyphens`);
    }
    if (typeof extension !== "string" ||
        !policy.allowedExtensions.includes(extension)) {
        issues.push(`${policy.extensionArgument ?? "extension"} must be one of: ${policy.allowedExtensions.join(", ")}`);
    }
    if (typeof content !== "string" ||
        content.length === 0 ||
        Buffer.byteLength(content, "utf8") > policy.maxBytes ||
        content.includes("\0")) {
        issues.push(`${policy.contentArgument} must be 1-${policy.maxBytes} UTF-8 bytes and contain no NUL byte`);
    }
    return issues;
}
function createOnlyText(definition) {
    return {
        ...definition,
        validateArguments: (arguments_) => validateCreateOnlyText(definition.execution, arguments_),
    };
}
function desktopTextMutation(operation) {
    const execution = {
        kind: "mutate_text",
        operation,
        root: "desktop",
        relativePathArgument: "relativePath",
        contentArgument: "content",
        expectedHashArgument: "expectedHash",
        resultHashArgument: "resultHash",
        allowedExtensions: ["txt", "md"],
        maxContentBytes: 4096,
        maxResultBytes: 65536,
    };
    return {
        risk: "medium",
        // expectedHash / resultHash are derived server-side from the exact bytes
        // written, so callers supply intent + target + content only.
        requiredArguments: ["relativePath", "content"],
        approvalRequired: true,
        // The canonical approval hash is computable by the caller, so on its own it
        // is not an authorization gate. The real user turn must also name the
        // operation and the exact target.
        directUserAuthorizationRequired: true,
        verification: "desktop_text_result_hash_matches",
        reversible: operation === "create",
        capabilityTier: "desktop_modify",
        execution,
        validateArguments(arguments_) {
            const issues = [];
            const relativePath = arguments_.relativePath;
            const content = arguments_.content;
            if (!isSafeRelativePath(relativePath)) {
                issues.push("relativePath must stay within Desktop and contain no hidden or sensitive path segment");
            }
            else {
                const extension = relativePath.split(".").at(-1)?.toLowerCase();
                if (!execution.allowedExtensions.includes(extension ?? "")) {
                    issues.push("relativePath extension must be one of: txt, md");
                }
            }
            if (typeof content !== "string" ||
                content.includes("\0") ||
                Buffer.byteLength(content, "utf8") > execution.maxContentBytes) {
                issues.push(`content must be 0-${execution.maxContentBytes} UTF-8 bytes and contain no NUL byte`);
            }
            issues.push(...validateOptionalHashes(arguments_, operation, "expectedHash", "resultHash"));
            return issues;
        },
    };
}
function validateEncodedContent(content, encoding, maxBytes) {
    if (typeof content !== "string")
        return ["content must be a string"];
    if (encoding === undefined || encoding === "utf8") {
        return Buffer.byteLength(content, "utf8") <= maxBytes
            ? []
            : [`content must not exceed ${maxBytes} bytes`];
    }
    if (encoding !== "base64")
        return ["encoding must be utf8 or base64"];
    if (content.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
        return ["content must be canonical base64"];
    }
    return Buffer.from(content, "base64").byteLength <= maxBytes
        ? []
        : [`decoded content must not exceed ${maxBytes} bytes`];
}
function directFolderCreate(
// MutableRoot, not ControlledRoot: "home" is readable but must never be
// writable, and this helper only ever produces a write policy. Keeping the
// parameter narrow is what makes that a compile error rather than a bug.
root, capabilityTier) {
    return {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: "scoped_directory_exists",
        reversible: true,
        capabilityTier,
        execution: {
            kind: "create_directory",
            root,
            relativePathArgument: "relativePath",
        },
        validateArguments(arguments_) {
            return isSafeRelativePath(arguments_.relativePath)
                ? []
                : [
                    "relativePath must stay within the configured root and contain no hidden or sensitive path segment",
                ];
        },
    };
}
function directFileWrite(
// See directFolderCreate: writes are confined to MutableRoot by type.
root, capabilityTier) {
    const execution = {
        kind: "mutate_file",
        root,
        relativePathArgument: "relativePath",
        operationArgument: "operation",
        encodingArgument: "encoding",
        contentArgument: "content",
        contentSourceArgument: "contentSource",
        expectedHashArgument: "expectedHash",
        resultHashArgument: "resultHash",
        maxContentBytes: 1048576,
        maxResultBytes: 8388608,
    };
    return {
        risk: "medium",
        // encoding defaults to utf8, contentSource defaults to inline_user_request,
        // and both hashes are derived server-side from the exact bytes written.
        requiredArguments: ["relativePath", "operation", "content"],
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: "scoped_file_result_hash_matches",
        reversible: false,
        capabilityTier,
        execution,
        validateArguments(arguments_) {
            const issues = [];
            if (!isSafeRelativePath(arguments_.relativePath)) {
                issues.push("relativePath must stay within the configured root and contain no hidden or sensitive path segment");
            }
            const operation = arguments_.operation;
            if (!["create", "append", "replace"].includes(String(operation))) {
                issues.push("operation must be create, append, or replace");
            }
            if (arguments_.contentSource !== undefined &&
                arguments_.contentSource !== "inline_user_request") {
                issues.push("contentSource may be omitted, or must be inline_user_request");
            }
            issues.push(...validateEncodedContent(arguments_.content, arguments_.encoding, execution.maxContentBytes));
            issues.push(...validateOptionalHashes(arguments_, operation === "create" || operation === "append" || operation === "replace"
                ? operation
                : undefined, "expectedHash", "resultHash"));
            return issues;
        },
    };
}
function browserArgumentIssues(arguments_) {
    return arguments_.browser === undefined ||
        resolveBrowserName(arguments_.browser) !== undefined
        ? []
        : [
            `browser may be omitted, or must be one of: ${SUPPORTED_BROWSERS.join(", ")}`,
        ];
}
function browserAction(policy, definition) {
    return {
        risk: definition.risk,
        requiredArguments: definition.requiredArguments,
        approvalRequired: false,
        // The user's own words must name the operation and be consistent with the
        // target site or tab. An instruction that only exists inside a page cannot
        // reach a new host.
        directUserAuthorizationRequired: true,
        verification: definition.verification,
        reversible: definition.reversible,
        capabilityTier: "browser_control",
        execution: policy,
        validateArguments(arguments_) {
            return [
                ...browserArgumentIssues(arguments_),
                ...(definition.extraValidation?.(arguments_) ?? []),
            ];
        },
    };
}
function mediaAction(policy, definition) {
    return {
        risk: "low",
        requiredArguments: definition.requiredArguments,
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: definition.verification,
        reversible: true,
        capabilityTier: "media_control",
        execution: policy,
        validateArguments(arguments_) {
            const issues = arguments_.player === undefined ||
                resolvePlayerName(arguments_.player) !== undefined
                ? []
                : [
                    `player may be omitted, or must be one of: ${SUPPORTED_PLAYERS.join(", ")}`,
                ];
            return [...issues, ...(definition.extraValidation?.(arguments_) ?? [])];
        },
    };
}
/**
 * Move / rename / delete inside a mutable root.
 *
 * Deliberately narrower than the read surface: reading widely is one thing,
 * mutating widely is another, so `$HOME` is not reachable here. Every one of
 * these is reversible and the executor records the exact inverse operation in
 * the ledger.
 */
function fileMutation(operation, definition) {
    return {
        risk: definition.risk,
        requiredArguments: definition.requiredArguments,
        approvalRequired: definition.approvalRequired,
        directUserAuthorizationRequired: true,
        verification: definition.verification,
        // Reversible because delete means "move to Trash" and every mutation
        // records its inverse; nothing here unlinks.
        reversible: true,
        capabilityTier: "file_mutate",
        execution: {
            kind: "file_mutate",
            operation,
            rootArgument: "root",
            relativePathArgument: "relativePath",
            ...(definition.destinationArgument
                ? { destinationArgument: definition.destinationArgument }
                : {}),
        },
        validateArguments(arguments_) {
            const issues = [];
            if (!isMutableRoot(arguments_.root)) {
                issues.push(`root must be one of: ${MUTABLE_ROOTS.join(", ")}`);
            }
            if (!isSafeRelativePath(arguments_.relativePath)) {
                issues.push("relativePath must stay within the configured root and contain no hidden or sensitive path segment");
            }
            issues.push(...(definition.extraValidation?.(arguments_) ?? []));
            return issues;
        },
    };
}
export const ACTION_CATALOG = {
    folder_create: {
        risk: "low",
        requiredArguments: ["path"],
        approvalRequired: false,
        verification: "folder_exists",
        reversible: true,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    app_open: {
        risk: "low",
        requiredArguments: ["application"],
        approvalRequired: false,
        verification: "application_is_open",
        reversible: true,
        capabilityTier: "app_control",
        execution: {
            kind: "app_control",
            operation: "open",
            applicationArgument: "application",
        },
        directUserAuthorizationRequired: true,
        validateArguments: (arguments_) => typeof arguments_.application === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9 .&'()+_-]{0,79}$/.test(arguments_.application)
            ? []
            : ["application must be a plain installed app name"],
    },
    app_quit: {
        risk: "low",
        requiredArguments: ["application"],
        approvalRequired: false,
        verification: "application_is_closed",
        reversible: true,
        capabilityTier: "app_control",
        execution: {
            kind: "app_control",
            operation: "quit",
            applicationArgument: "application",
        },
        directUserAuthorizationRequired: true,
        validateArguments: (arguments_) => typeof arguments_.application === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9 .&'()+_-]{0,79}$/.test(arguments_.application)
            ? []
            : ["application must be a plain installed app name"],
    },
    timer_set: {
        risk: "low",
        requiredArguments: ["minutes"],
        approvalRequired: false,
        verification: "timer_exists",
        reversible: true,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    reminder_create: {
        risk: "low",
        requiredArguments: ["title", "due"],
        approvalRequired: false,
        verification: "reminder_exists",
        reversible: true,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    email_send: {
        risk: "high",
        requiredArguments: ["to", "subject", "body"],
        approvalRequired: true,
        verification: "message_in_sent_mail",
        reversible: false,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    browser_open_url: browserAction({
        kind: "browser_control",
        operation: "open_url",
        browserArgument: "browser",
        urlArgument: "url",
        read: false,
    }, {
        risk: "medium",
        requiredArguments: ["url"],
        verification: "browser_tab_shows_url",
        reversible: true,
        extraValidation: (arguments_) => browserUrlIssues(arguments_.url),
    }),
    browser_new_tab: browserAction({
        kind: "browser_control",
        operation: "new_tab",
        browserArgument: "browser",
        read: false,
    }, {
        risk: "low",
        requiredArguments: [],
        verification: "browser_tab_count_increased",
        reversible: true,
    }),
    browser_close_tab: browserAction({
        kind: "browser_control",
        operation: "close_tab",
        browserArgument: "browser",
        read: false,
    }, {
        risk: "low",
        requiredArguments: [],
        verification: "browser_tab_count_decreased",
        reversible: false,
    }),
    browser_list_tabs: browserAction({
        kind: "browser_control",
        operation: "list_tabs",
        browserArgument: "browser",
        maxTabs: 200,
        read: true,
    }, {
        risk: "low",
        requiredArguments: [],
        verification: "browser_tab_list_matches",
        reversible: true,
    }),
    browser_switch_tab: browserAction({
        kind: "browser_control",
        operation: "switch_tab",
        browserArgument: "browser",
        selectorArgument: "tab",
        maxTabs: 200,
        read: false,
    }, {
        risk: "low",
        requiredArguments: ["tab"],
        verification: "browser_active_tab_matches",
        reversible: true,
        extraValidation: (arguments_) => tabSelectorIssues(arguments_.tab),
    }),
    browser_read_page: browserAction({
        kind: "browser_control",
        operation: "read_page",
        browserArgument: "browser",
        // 100 KB ceiling on extracted text; the ledger records that a read
        // happened and of which URL.
        maxBytes: 102400,
        read: true,
    }, {
        risk: "medium",
        requiredArguments: [],
        verification: "browser_active_tab_url_matches",
        reversible: true,
    }),
    media_play_pause: mediaAction({
        kind: "media_control",
        operation: "play_pause",
        playerArgument: "player",
        targetWords: [
            "music", "song", "songs", "track", "playback", "audio", "spotify",
            "player", "video", "podcast", "episode", "itunes", "tunes",
        ],
    }, { requiredArguments: [], verification: "media_player_state_toggled" }),
    media_next_track: mediaAction({
        kind: "media_control",
        operation: "next_track",
        playerArgument: "player",
        targetWords: [
            "music", "song", "songs", "track", "playback", "audio", "spotify",
            "player", "podcast", "episode", "itunes", "tunes",
        ],
    }, { requiredArguments: [], verification: "media_track_advanced" }),
    media_previous_track: mediaAction({
        kind: "media_control",
        operation: "previous_track",
        playerArgument: "player",
        targetWords: [
            "music", "song", "songs", "track", "playback", "audio", "spotify",
            "player", "podcast", "episode", "itunes", "tunes",
        ],
    }, { requiredArguments: [], verification: "media_track_returned" }),
    volume_set: mediaAction({
        kind: "media_control",
        operation: "volume_set",
        levelArgument: "level",
        targetWords: ["volume", "loud", "louder", "quiet", "quieter", "sound"],
    }, {
        requiredArguments: ["level"],
        verification: "system_volume_matches",
        extraValidation: (arguments_) => volumeIssues(arguments_.level),
    }),
    volume_mute: mediaAction({
        kind: "media_control",
        operation: "volume_mute",
        targetWords: ["volume", "sound", "audio", "mute", "silence", "quiet"],
    }, { requiredArguments: [], verification: "system_volume_muted" }),
    volume_unmute: mediaAction({
        kind: "media_control",
        operation: "volume_unmute",
        targetWords: ["volume", "sound", "audio", "mute", "unmute"],
    }, { requiredArguments: [], verification: "system_volume_unmuted" }),
    display_sleep: mediaAction({
        kind: "media_control",
        operation: "display_sleep",
        targetWords: ["display", "screen", "monitor", "displays", "screens"],
    }, { requiredArguments: [], verification: "display_sleep_command_accepted" }),
    file_move: fileMutation("move", {
        risk: "medium",
        approvalRequired: false,
        requiredArguments: ["root", "relativePath", "destinationPath"],
        verification: "file_present_at_destination",
        destinationArgument: "destinationPath",
        extraValidation: (arguments_) => isSafeRelativePath(arguments_.destinationPath)
            ? []
            : [
                "destinationPath must stay within the same configured root and contain no hidden or sensitive path segment",
            ],
    }),
    file_rename: fileMutation("rename", {
        risk: "medium",
        approvalRequired: false,
        requiredArguments: ["root", "relativePath", "newName"],
        verification: "file_present_at_destination",
        destinationArgument: "newName",
        extraValidation: (arguments_) => isSafeSegment(arguments_.newName)
            ? []
            : [
                "newName must be a single visible, non-sensitive filename with no path separator",
            ],
    }),
    // Delete means Trash. Unlinking is not recoverable and there is no reason to
    // do it here: the user keeps the undo Finder already provides.
    file_delete: fileMutation("delete", {
        risk: "high",
        approvalRequired: true,
        requiredArguments: ["root", "relativePath"],
        verification: "file_in_trash",
    }),
    test_marker_create: createOnlyText({
        risk: "low",
        requiredArguments: ["marker", "content"],
        approvalRequired: false,
        verification: "test_marker_content_matches",
        reversible: true,
        capabilityTier: "test_workspace",
        execution: {
            kind: "create_only_text",
            root: "test_workspace",
            subdirectory: "markers",
            nameArgument: "marker",
            contentArgument: "content",
            fixedExtension: "txt",
            allowedExtensions: ["txt"],
            maxBytes: 512,
        },
    }),
    scratch_text_create: createOnlyText({
        risk: "low",
        requiredArguments: ["name", "extension", "content"],
        approvalRequired: false,
        verification: "scratch_text_content_matches",
        reversible: true,
        capabilityTier: "scratch_workspace",
        execution: {
            kind: "create_only_text",
            root: "scratch_workspace",
            subdirectory: "artifacts",
            nameArgument: "name",
            extensionArgument: "extension",
            contentArgument: "content",
            allowedExtensions: ["txt", "md"],
            maxBytes: 4096,
        },
    }),
    desktop_list: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        verification: "desktop_listing_matches",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: {
            kind: "list_directory",
            root: "desktop",
            relativePathArgument: "relativePath",
            maxEntries: 100,
        },
        validateArguments(arguments_) {
            return isSafeRelativePath(arguments_.relativePath, true)
                ? []
                : ["relativePath must stay within Desktop and contain no hidden or sensitive path segment"];
        },
    },
    desktop_metadata: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        verification: "desktop_metadata_matches",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: {
            kind: "path_metadata",
            root: "desktop",
            relativePathArgument: "relativePath",
        },
        validateArguments(arguments_) {
            return isSafeRelativePath(arguments_.relativePath)
                ? []
                : ["relativePath must stay within Desktop and contain no hidden or sensitive path segment"];
        },
    },
    desktop_text_read: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        verification: "desktop_text_content_matches",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: {
            kind: "read_text",
            root: "desktop",
            relativePathArgument: "relativePath",
            allowedExtensions: ["txt", "md", "json"],
            maxBytes: 16384,
        },
        validateArguments(arguments_) {
            const relativePath = arguments_.relativePath;
            if (!isSafeRelativePath(relativePath)) {
                return ["relativePath must stay within Desktop and contain no hidden or sensitive path segment"];
            }
            const extension = relativePath.split(".").at(-1)?.toLowerCase();
            return ["txt", "md", "json"].includes(extension ?? "")
                ? []
                : ["relativePath extension must be one of: txt, md, json"];
        },
    },
    desktop_test_text_create: createOnlyText({
        risk: "low",
        requiredArguments: ["name", "extension", "content"],
        approvalRequired: false,
        verification: "desktop_test_text_content_matches",
        reversible: true,
        capabilityTier: "desktop_test_workspace",
        execution: {
            kind: "create_only_text",
            root: "desktop",
            subdirectory: "Orion Controlled Test Workspace/artifacts",
            nameArgument: "name",
            extensionArgument: "extension",
            contentArgument: "content",
            allowedExtensions: ["txt", "md"],
            maxBytes: 4096,
        },
    }),
    desktop_text_create_confirmed: desktopTextMutation("create"),
    desktop_text_append_confirmed: desktopTextMutation("append"),
    desktop_text_replace_confirmed: desktopTextMutation("replace"),
    desktop_folder_create_explicit: directFolderCreate("desktop", "desktop_direct_write"),
    desktop_file_write_explicit: directFileWrite("desktop", "desktop_direct_write"),
    scratch_folder_create_explicit: directFolderCreate("scratch_workspace", "scratch_direct_write"),
    scratch_file_write_explicit: directFileWrite("scratch_workspace", "scratch_direct_write"),
    // Reading only. There is no home write policy anywhere in this file, and the
    // write policy types cannot even name the home root.
    home_list: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: "home_listing_matches",
        reversible: true,
        capabilityTier: "home_read",
        execution: {
            kind: "list_directory",
            root: "home",
            relativePathArgument: "relativePath",
            maxEntries: 200,
        },
        validateArguments(arguments_) {
            return isSafeHomeRelativePath(arguments_.relativePath, true)
                ? []
                : [
                    "relativePath must stay within the home directory and name no hidden, credential, keychain, or cookie path segment",
                ];
        },
    },
    home_metadata: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: "home_metadata_matches",
        reversible: true,
        capabilityTier: "home_read",
        execution: {
            kind: "path_metadata",
            root: "home",
            relativePathArgument: "relativePath",
        },
        validateArguments(arguments_) {
            return isSafeHomeRelativePath(arguments_.relativePath)
                ? []
                : [
                    "relativePath must stay within the home directory and name no hidden, credential, keychain, or cookie path segment",
                ];
        },
    },
    home_read_text: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: "home_text_content_matches",
        reversible: true,
        capabilityTier: "home_read",
        execution: {
            kind: "read_text",
            root: "home",
            relativePathArgument: "relativePath",
            allowedExtensions: HOME_TEXT_EXTENSIONS,
            maxBytes: 65536,
        },
        validateArguments(arguments_) {
            const relativePath = arguments_.relativePath;
            if (!isSafeHomeRelativePath(relativePath)) {
                return [
                    "relativePath must stay within the home directory and name no hidden, credential, keychain, or cookie path segment",
                ];
            }
            const extension = relativePath.split(".").at(-1)?.toLowerCase();
            return HOME_TEXT_EXTENSIONS.includes(extension ?? "")
                ? []
                : [
                    `relativePath extension must be one of: ${HOME_TEXT_EXTENSIONS.join(", ")}`,
                ];
        },
    },
};
