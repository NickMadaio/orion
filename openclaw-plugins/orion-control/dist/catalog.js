import { classifyConfigPath, classifyPluginFile, classifyScript, validateConfigValue, } from "./selfrepair.js";
import { DEV_REPOSITORIES } from "./devops.js";
import { NAME_RE, validateProposal } from "./automation.js";
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
export const ORION_APP_DOMAIN = "com.nickmadaio.orion.app";
export const TUNABLE_SETTINGS = {
    endpointing_ms: {
        key: "OrionVoiceEndpointingMs",
        min: 100,
        max: 4000,
        integer: true,
        unit: "ms",
        description: "Silence before Orion decides you have finished a sentence. Raise it if he interrupts you mid-thought; lower it if he feels slow to answer.",
    },
    utterance_end_ms: {
        key: "OrionVoiceUtteranceEndMs",
        min: 1000,
        max: 8000,
        integer: true,
        unit: "ms",
        description: "Backstop for when the primary end-of-speech signal never arrives. Always held at least 600ms behind endpointing_ms.",
    },
    apple_final_grace: {
        key: "OrionVoiceAppleFinalGrace",
        min: 0.4,
        max: 4,
        integer: false,
        unit: "s",
        description: "How long the on-device recogniser may take to promote its last partial to a final result after the key comes up.",
    },
    speaking_stall_timeout: {
        key: "OrionSpeakingStallTimeout",
        min: 4,
        max: 60,
        integer: false,
        unit: "s",
        description: "Seconds of no audio before a speaking phase is presumed wedged and force-ended. This is the guard against Orion believing he is still talking when he is not.",
    },
};
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
export const AUTHORITY_INSTRUCTION = /\b(?:enable|enabled|disable|disabled|allow|allowed|grant|granted|permission|permissions|permit|authority|authorise|authorize|capability|capabilities|profile|unlock|turn\s+(?:it\s+)?(?:on|off)|switch\s+(?:it\s+)?(?:on|off)|let\s+you|give\s+you|you\s+may|you\s+can\s+now)\b/i;
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
        // Reversible write into an approved root, recorded in the ledger. It used
        // to cost an approval round-trip AND require the user to name the file --
        // two gates on an action whose worst outcome is a file you did not want.
        approvalRequired: false,
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
/**
 * The find/replace pair, checked the same way `self_modify` checks it.
 *
 * Whole-file contents were the wrong interface there and are the wrong
 * interface here for the same measured reason: asking a small model to
 * reproduce two thousand lines of `catalog.ts` verbatim is slow, expensive and
 * one dropped brace from destroying it. A quoted fragment cannot truncate
 * anything, and the engine refuses a fragment that does not appear exactly once.
 */
function editFragmentIssues(arguments_) {
    const problems = [];
    if (typeof arguments_.find !== "string" || arguments_.find.trim().length === 0) {
        problems.push("find must be the exact existing text to replace, copied from the file including its whitespace, and must appear exactly once");
    }
    if (typeof arguments_.replace !== "string") {
        problems.push("replace must be the text to put in its place");
    }
    return problems;
}
/**
 * Refuse an edit routed to the wrong action.
 *
 * The check runs in BOTH directions, and the second direction is the one that
 * matters. An authority file arriving at the operational action is the attack —
 * it would skip the approval gate and the naming requirement — so it is refused
 * with the name of the action that does have those gates, which is also the
 * sentence Orion needs in order to ask Nick properly. An operational file
 * arriving at the authority action is only a mistake, but routing it back keeps
 * the two lists from quietly overlapping.
 */
function classIssues(klass, expected, reason, what, authorityAction) {
    if (klass === "forbidden") {
        return [reason ?? `${what} cannot be changed by Orion`];
    }
    if (klass === expected)
        return [];
    return klass === "authority"
        ? [
            `${what} decides what Orion is allowed to do, so it cannot be changed silently — ask for it by name and it goes through ${authorityAction}, which asks you first`,
        ]
        : [
            `${what} is ordinary behaviour rather than an authority change, so it does not need the approval gate — use the plain action instead`,
        ];
}
function pluginEditIssues(arguments_, expected) {
    const decision = classifyPluginFile(arguments_.pluginFile);
    return [
        ...classIssues(decision.klass, expected, decision.reason, `'${String(arguments_.pluginFile)}'`, "self_plugin_authority_modify"),
        ...editFragmentIssues(arguments_),
    ];
}
function scriptEditIssues(arguments_, expected) {
    const decision = classifyScript(arguments_.script);
    return [
        ...classIssues(decision.klass, expected, decision.reason, `'${String(arguments_.script)}'`, "self_script_authority_modify"),
        ...editFragmentIssues(arguments_),
    ];
}
function configSetIssues(arguments_, expected) {
    const decision = classifyConfigPath(arguments_.key);
    const issues = classIssues(decision.klass, expected, decision.reason, `'${String(arguments_.key)}'`, "self_config_authority_set");
    if (issues.length > 0)
        return issues;
    return decision.setting
        ? validateConfigValue(decision.setting, arguments_.value)
        : ["that setting has no validation rule, so it is refused"];
}
/**
 * One structured development operation.
 *
 * A builder rather than seven hand-written blocks, because the whole point of
 * the phase is that these differ ONLY in which operation they name: same tier,
 * same required argument, same closed repository table, same absence of a path.
 * Written out longhand, the seventh would eventually differ from the first in
 * some way nobody meant.
 */
function devAction(operation, risk, reversible, verification, extraValidators = {}) {
    return {
        risk,
        requiredArguments: ["repository"],
        approvalRequired: false,
        verification,
        reversible,
        capabilityTier: "dev_operations",
        execution: { kind: "dev_operation", operation },
        validateArguments(arguments_) {
            const repository = arguments_.repository;
            // Matched against the closed table, not against a shape. A key that does
            // not resolve is refused HERE with the list of keys that do, so the model
            // is told what exists rather than left to guess a path.
            if (typeof repository !== "string" || !DEV_REPOSITORIES.has(repository)) {
                return [
                    `repository must be one of: ${[...DEV_REPOSITORIES.keys()].join(", ")}`,
                ];
            }
            return Object.entries(extraValidators).flatMap(([key, check]) => check(arguments_[key]));
        },
    };
}
export const ACTION_CATALOG = {
    /**
     * `approvalRequired: false` is a decision, not an oversight.
     *
     * It was chosen explicitly: Orion edits, builds, installs and relaunches
     * without pausing for a diff. What makes that defensible is not trust, it is
     * that the verifier is mechanical and cannot be talked round — the code must
     * compile AND the app must still launch, or the previous bundle is restored
     * and the source reverted before anyone is looking at it. Every applied
     * change is a git commit, so undoing one is a single command.
     *
     * Direct user authorization is not a field here — it comes from the
     * validator, which mints `trusted_user` only from host provenance and refuses
     * an action whose target appears in something Orion READ rather than in
     * something the user SAID. That taint check is what stops an iMessage from
     * asking Orion to rewrite himself, and `risk: "high"` is what routes this
     * action through it.
     */
    self_source_list: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_source_listed",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: { kind: "self_source", operation: "list" },
    },
    self_source_read: {
        risk: "low",
        requiredArguments: ["file"],
        approvalRequired: false,
        verification: "self_source_read",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: { kind: "self_source", operation: "read" },
        validateArguments: (arguments_) => typeof arguments_.file === "string" &&
            /^[A-Za-z0-9_]+\.swift$/.test(arguments_.file)
            ? []
            : [
                "file must be a bare Swift filename from self_source_list, such as HomeTab.swift",
            ],
    },
    self_modify: {
        risk: "high",
        requiredArguments: ["file", "find", "replace"],
        approvalRequired: false,
        verification: "self_modify_applied",
        reversible: true,
        capabilityTier: "self_modification",
        execution: { kind: "self_modify" },
        validateArguments: (arguments_) => {
            const problems = [];
            const file = arguments_.file;
            const find = arguments_.find;
            const replace = arguments_.replace;
            if (typeof file !== "string" || !/^[A-Za-z0-9_]+\.swift$/.test(file)) {
                problems.push("file must be a bare Swift filename inside the app target, such as HealthTab.swift");
            }
            // A find/replace rather than whole-file contents, and that is not a
            // convenience. Asking a small model to reproduce a two hundred line file
            // verbatim is slow and one dropped brace away from destroying it; the
            // first end-to-end attempt burned six and a half minutes without ever
            // producing a call. A quoted fragment is a few hundred bytes and cannot
            // truncate anything.
            if (typeof find !== "string" || find.trim().length === 0) {
                problems.push("find must be the exact existing text to replace, copied from the file including its whitespace, and must appear exactly once");
            }
            if (typeof replace !== "string") {
                problems.push("replace must be the text to put in its place");
            }
            return problems;
        },
    },
    // ---------------------------------------------------------------------
    // Repairing the plugin, the wrappers and the config.
    //
    // Three surfaces, and each one appears twice on purpose: once for changes
    // that make Orion work better, and once for changes that make Orion allowed
    // to do more. Splitting them in the catalog rather than branching inside one
    // action is what lets `approvalRequired` and `userOriginatedArguments` differ
    // between the two, and it is what makes `orion-authority` classify the second
    // set at APPROVAL without being told to.
    //
    // The reads are at the ordinary read tier for the same reason `self_source_*`
    // is: Orion cannot quote a fragment he cannot open, and this is code on
    // Nick's own disk.
    // ---------------------------------------------------------------------
    self_plugin_list: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_repair_listed",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: { kind: "self_repair", surface: "plugin", operation: "list" },
    },
    self_plugin_read: {
        risk: "low",
        requiredArguments: ["pluginFile"],
        approvalRequired: false,
        verification: "self_repair_read",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: { kind: "self_repair", surface: "plugin", operation: "read" },
        validateArguments: (arguments_) => {
            const decision = classifyPluginFile(arguments_.pluginFile);
            return decision.klass === "forbidden"
                ? [decision.reason ?? "that is not a readable plugin source"]
                : [];
        },
    },
    self_plugin_modify: {
        risk: "high",
        requiredArguments: ["pluginFile", "find", "replace"],
        approvalRequired: false,
        verification: "self_repair_applied",
        reversible: true,
        capabilityTier: "self_plugin",
        execution: { kind: "self_repair", surface: "plugin", operation: "modify" },
        validateArguments: (arguments_) => pluginEditIssues(arguments_, "operational"),
    },
    /**
     * The same edit, aimed at the code that decides what Orion may do.
     *
     * Everything that distinguishes it from the action above is a gate: Nick has
     * to have named the file, the turn has to be about permission, and the
     * arguments have to carry an approval hash bound to exactly this change. The
     * engine then makes it prove itself — a change to an enforcement file has to
     * pass the gate self-test, which asserts that a forged anchor, an absent
     * anchor and a tainted target are all still refused by the code that was just
     * built. Fail that and it is rolled back before it is ever loaded.
     */
    self_plugin_authority_modify: {
        risk: "critical",
        requiredArguments: ["pluginFile", "find", "replace"],
        approvalRequired: true,
        verification: "self_repair_applied",
        reversible: true,
        capabilityTier: "self_plugin",
        execution: {
            kind: "self_repair",
            surface: "plugin",
            operation: "modify",
            authority: true,
        },
        authorityChange: true,
        userOriginatedArguments: ["pluginFile"],
        validateArguments: (arguments_) => pluginEditIssues(arguments_, "authority"),
    },
    self_plugin_revert: {
        risk: "medium",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_repair_reverted",
        reversible: true,
        capabilityTier: "self_plugin",
        execution: { kind: "self_repair", surface: "plugin", operation: "revert" },
    },
    self_script_list: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_repair_listed",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: { kind: "self_repair", surface: "script", operation: "list" },
    },
    self_script_read: {
        risk: "low",
        requiredArguments: ["script"],
        approvalRequired: false,
        verification: "self_repair_read",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: { kind: "self_repair", surface: "script", operation: "read" },
        validateArguments: (arguments_) => {
            const decision = classifyScript(arguments_.script);
            return decision.klass === "forbidden"
                ? [decision.reason ?? "that is not a readable wrapper script"]
                : [];
        },
    },
    self_script_modify: {
        risk: "high",
        requiredArguments: ["script", "find", "replace"],
        approvalRequired: false,
        verification: "self_repair_applied",
        reversible: true,
        capabilityTier: "self_scripts",
        execution: { kind: "self_repair", surface: "script", operation: "modify" },
        validateArguments: (arguments_) => scriptEditIssues(arguments_, "operational"),
    },
    self_script_authority_modify: {
        risk: "critical",
        requiredArguments: ["script", "find", "replace"],
        approvalRequired: true,
        verification: "self_repair_applied",
        reversible: true,
        capabilityTier: "self_scripts",
        execution: {
            kind: "self_repair",
            surface: "script",
            operation: "modify",
            authority: true,
        },
        authorityChange: true,
        userOriginatedArguments: ["script"],
        validateArguments: (arguments_) => scriptEditIssues(arguments_, "authority"),
    },
    self_script_revert: {
        risk: "medium",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_repair_reverted",
        reversible: true,
        capabilityTier: "self_scripts",
        execution: { kind: "self_repair", surface: "script", operation: "revert" },
    },
    self_config_list: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_repair_listed",
        reversible: true,
        capabilityTier: "self_config",
        execution: { kind: "self_repair", surface: "config", operation: "list" },
    },
    self_config_set: {
        risk: "medium",
        requiredArguments: ["key", "value"],
        approvalRequired: false,
        verification: "self_repair_applied",
        reversible: true,
        capabilityTier: "self_config",
        execution: { kind: "self_repair", surface: "config", operation: "modify" },
        validateArguments: (arguments_) => configSetIssues(arguments_, "operational"),
    },
    /**
     * The switch-flipping half. `enableMessagesSendActions`, `tools.exec.security`,
     * `plugins.allow` — everything that answers "what is Orion allowed to do".
     */
    self_config_authority_set: {
        risk: "critical",
        requiredArguments: ["key", "value"],
        approvalRequired: true,
        verification: "self_repair_applied",
        reversible: true,
        capabilityTier: "self_config",
        execution: {
            kind: "self_repair",
            surface: "config",
            operation: "modify",
            authority: true,
        },
        authorityChange: true,
        userOriginatedArguments: ["key"],
        validateArguments: (arguments_) => configSetIssues(arguments_, "authority"),
    },
    self_config_revert: {
        risk: "medium",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_repair_reverted",
        reversible: true,
        capabilityTier: "self_config",
        execution: { kind: "self_repair", surface: "config", operation: "revert" },
    },
    self_repair_status: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "self_repair_status",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: { kind: "self_repair", surface: "plugin", operation: "status" },
    },
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
        validateArguments: (arguments_) => typeof arguments_.application === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9 .&'()+_-]{0,79}$/.test(arguments_.application)
            ? []
            : ["application must be a plain installed app name"],
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
    // The one place a confirmation still earns its keep. Everything else in the
    // catalog is either reversible in place or trivially redone; a delete is the
    // action a person actually wants to be asked about, even with Trash behind it.
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
        requiredArguments: [],
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
            const relativePath = arguments_.relativePath ?? ".";
            return isSafeRelativePath(relativePath === "" ? "." : relativePath, true)
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
        requiredArguments: [],
        approvalRequired: false,
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
            const relativePath = arguments_.relativePath ?? ".";
            return isSafeHomeRelativePath(relativePath === "" ? "." : relativePath, true)
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
    // ---------------------------------------------------------- ambient reads
    //
    // No target-naming requirement on any of these. They read the world, not the
    // user's disk: there is no path to get wrong, nothing to overwrite, and the
    // worst a wrong answer costs is a wrong answer. Making someone say "weather"
    // twice to hear it once would be friction with nothing behind it.
    weather_now: {
        risk: "low",
        requiredArguments: ["location"],
        approvalRequired: false,
        verification: "weather_reported",
        reversible: true,
        capabilityTier: "ambient_info",
        execution: { kind: "ambient_read", operation: "weather" },
        validateArguments(arguments_) {
            const location = arguments_.location;
            if (typeof location !== "string" || location.trim().length === 0) {
                return ["location must be a non-empty place name"];
            }
            if (location.length > 120)
                return ["location is too long to be a place"];
            const days = arguments_.days;
            if (days !== undefined && (!Number.isInteger(days) || days < 0 || days > 7)) {
                return ["days must be a whole number from 0 to 7"];
            }
            return [];
        },
    },
    clock_now: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "clock_reported",
        reversible: true,
        capabilityTier: "ambient_info",
        execution: { kind: "ambient_read", operation: "clock" },
        validateArguments(arguments_) {
            const timezone = arguments_.timezone;
            if (timezone !== undefined && typeof timezone !== "string") {
                return ["timezone must be an IANA zone name such as America/New_York"];
            }
            return [];
        },
    },
    system_status: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "system_status_reported",
        reversible: true,
        capabilityTier: "ambient_info",
        execution: { kind: "ambient_read", operation: "system_status" },
    },
    // ------------------------------------------------------- timers and alarms
    //
    // These DO require a direct instruction, because they act later. Everything
    // else in the catalog happens while the user is present to see it; a timer
    // goes off in twenty minutes, possibly during something else, so it should
    // exist only because someone asked for it in as many words.
    timer_set: {
        risk: "low",
        requiredArguments: ["seconds"],
        approvalRequired: false,
        verification: "reminder_stored",
        reversible: true,
        capabilityTier: "reminders",
        execution: { kind: "reminder", operation: "timer_set" },
        validateArguments(arguments_) {
            const seconds = arguments_.seconds;
            if (!Number.isInteger(seconds) || seconds < 1) {
                return ["seconds must be a whole number of seconds, at least 1"];
            }
            // 24 hours. Past that it is an alarm, and an alarm survives a restart in
            // a way a countdown does not pretend to.
            if (seconds > 86400) {
                return ["seconds must be 86400 or fewer; use alarm_set for a time of day"];
            }
            const label = arguments_.label;
            if (label !== undefined && (typeof label !== "string" || label.length > 120)) {
                return ["label must be a short string"];
            }
            return [];
        },
    },
    alarm_set: {
        risk: "low",
        requiredArguments: ["at"],
        approvalRequired: false,
        verification: "reminder_stored",
        reversible: true,
        capabilityTier: "reminders",
        execution: { kind: "reminder", operation: "alarm_set" },
        validateArguments(arguments_) {
            const at = arguments_.at;
            if (typeof at !== "string" || at.trim().length === 0) {
                return ["at must be a time of day such as 7:30am, or an ISO timestamp"];
            }
            const label = arguments_.label;
            if (label !== undefined && (typeof label !== "string" || label.length > 120)) {
                return ["label must be a short string"];
            }
            return [];
        },
    },
    reminder_list: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "reminders_listed",
        reversible: true,
        capabilityTier: "reminders",
        execution: { kind: "reminder", operation: "reminder_list" },
    },
    reminder_cancel: {
        risk: "low",
        requiredArguments: ["id"],
        approvalRequired: false,
        verification: "reminder_absent",
        reversible: false,
        capabilityTier: "reminders",
        execution: { kind: "reminder", operation: "reminder_cancel" },
        validateArguments(arguments_) {
            const id = arguments_.id;
            return typeof id === "string" && id.trim().length > 0
                ? []
                : ["id must name a reminder from reminder_list"];
        },
    },
    // The self-tuning pair. See the `self_tuning` tier note for why the key list
    // is closed rather than general.
    voice_tuning_read: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "tuning_readback",
        reversible: true,
        capabilityTier: "self_tuning",
        execution: { kind: "self_tuning", operation: "read" },
    },
    voice_tuning_set: {
        risk: "low",
        requiredArguments: ["setting", "value"],
        approvalRequired: false,
        // Verified by reading the value back out of the preference domain, not by
        // trusting the write to have worked. `defaults` fails quietly often enough.
        verification: "tuning_readback",
        reversible: true,
        capabilityTier: "self_tuning",
        execution: { kind: "self_tuning", operation: "write" },
        validateArguments(arguments_) {
            const setting = arguments_.setting;
            if (typeof setting !== "string" || !(setting in TUNABLE_SETTINGS)) {
                return [
                    `setting must be one of: ${Object.keys(TUNABLE_SETTINGS).join(", ")}`,
                ];
            }
            const spec = TUNABLE_SETTINGS[setting];
            const value = arguments_.value;
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return ["value must be a number"];
            }
            if (spec.integer && !Number.isInteger(value)) {
                return [`${setting} must be a whole number`];
            }
            if (value < spec.min || value > spec.max) {
                return [`${setting} must be between ${spec.min} and ${spec.max}`];
            }
            return [];
        },
    },
    // Supplements and workouts. See the `health_tracking` tier note.
    supplement_take: {
        risk: "low",
        requiredArguments: ["name"],
        approvalRequired: false,
        verification: "health_log_readback",
        reversible: true,
        capabilityTier: "health_tracking",
        execution: { kind: "health_log", operation: "supplement_take" },
        validateArguments(arguments_) {
            const name = arguments_.name;
            return typeof name === "string" && name.trim().length > 0
                ? []
                : ["name must say which supplement was taken"];
        },
    },
    supplement_add: {
        risk: "low",
        requiredArguments: ["name"],
        approvalRequired: false,
        verification: "health_log_readback",
        reversible: true,
        capabilityTier: "health_tracking",
        execution: { kind: "health_log", operation: "supplement_add" },
        validateArguments(arguments_) {
            const issues = [];
            const name = arguments_.name;
            if (typeof name !== "string" || name.trim().length === 0) {
                issues.push("name is required");
            }
            const timeOfDay = arguments_.timeOfDay;
            if (timeOfDay !== undefined &&
                !["morning", "lunch", "evening", "anytime"].includes(String(timeOfDay))) {
                issues.push("timeOfDay must be morning, lunch, evening or anytime");
            }
            return issues;
        },
    },
    supplement_status: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "health_log_readback",
        reversible: true,
        capabilityTier: "health_tracking",
        execution: { kind: "health_log", operation: "supplement_status" },
    },
    workout_log: {
        risk: "low",
        requiredArguments: ["exercise", "sets"],
        approvalRequired: false,
        verification: "health_log_readback",
        reversible: true,
        capabilityTier: "health_tracking",
        execution: { kind: "health_log", operation: "workout_log" },
        validateArguments(arguments_) {
            const issues = [];
            const exercise = arguments_.exercise;
            if (typeof exercise !== "string" || exercise.trim().length === 0) {
                issues.push("exercise must name the movement, e.g. 'incline bench'");
            }
            const sets = arguments_.sets;
            if (!Array.isArray(sets) || sets.length === 0) {
                issues.push("sets must be a list like [{ weight: 135, reps: 8 }]");
                return issues;
            }
            if (sets.length > 20)
                issues.push("at most 20 sets in one call");
            for (const [index, set] of sets.entries()) {
                const weight = set?.weight;
                const reps = set?.reps;
                if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
                    issues.push(`set ${index + 1}: weight must be a number`);
                }
                if (!Number.isInteger(reps) || reps < 1) {
                    issues.push(`set ${index + 1}: reps must be a whole number of at least 1`);
                }
            }
            const unit = arguments_.unit;
            if (unit !== undefined && !["lb", "kg"].includes(String(unit))) {
                issues.push("unit must be lb or kg");
            }
            return issues;
        },
    },
    workout_status: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "health_log_readback",
        reversible: true,
        capabilityTier: "health_tracking",
        execution: { kind: "health_log", operation: "workout_status" },
    },
    // ---------------------------------------------------- Calendar + Reminders
    //
    // These are deliberately typed actions rather than subcommands on the
    // read-only `orion-agenda` exec wrapper. An allowlist can decide whether a
    // program may run; it cannot distinguish `today` from `remove`. Putting the
    // mutations here gives each one its own risk, origin and approval contract.
    calendar_event_add: {
        risk: "medium",
        requiredArguments: ["title", "start"],
        approvalRequired: false,
        verification: "calendar_event_present",
        reversible: true,
        capabilityTier: "calendar",
        execution: { kind: "calendar", operation: "event_add" },
        userOriginatedArguments: ["title"],
        validateArguments(arguments_) {
            const issues = [];
            const title = arguments_.title;
            if (typeof title !== "string" || title.trim().length === 0) {
                issues.push("title must name the event");
            }
            else if (title.length > 200) {
                issues.push("title must be 200 characters or fewer");
            }
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(arguments_.start ?? ""))) {
                issues.push("start must be local time in YYYY-MM-DDTHH:mm form");
            }
            const minutes = arguments_.minutes;
            if (minutes !== undefined &&
                (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440)) {
                issues.push("minutes must be a whole number from 5 to 1440");
            }
            return issues;
        },
    },
    calendar_event_remove: {
        risk: "high",
        requiredArguments: ["title"],
        approvalRequired: true,
        verification: "calendar_event_absent",
        reversible: false,
        capabilityTier: "calendar",
        execution: { kind: "calendar", operation: "event_remove" },
        userOriginatedArguments: ["title"],
        validateArguments(arguments_) {
            const title = arguments_.title;
            return typeof title === "string" && title.trim().length > 0 && title.length <= 200
                ? []
                : ["title must exactly name one event and be 200 characters or fewer"];
        },
    },
    apple_reminder_add: {
        risk: "medium",
        requiredArguments: ["title"],
        approvalRequired: false,
        verification: "apple_reminder_present",
        reversible: true,
        capabilityTier: "calendar",
        execution: { kind: "calendar", operation: "reminder_add" },
        userOriginatedArguments: ["title"],
        validateArguments(arguments_) {
            const issues = [];
            const title = arguments_.title;
            if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) {
                issues.push("title must name the reminder and be 200 characters or fewer");
            }
            const due = arguments_.due;
            if (due !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(due))) {
                issues.push("due must be local time in YYYY-MM-DDTHH:mm form");
            }
            return issues;
        },
    },
    // ------------------------------------------------------------- messages
    //
    // Orion used to answer "I don't have access to your text messages", which was
    // true of his toolbelt and false of the machine: chat.db was readable the
    // whole time and the app had been reading it for weeks. The capability was
    // missing from the CATALOG, so there was no amount of asking that would have
    // worked. These four reads are that gap closed.
    //
    // No target-naming requirement on the reads, for the same reason the ambient
    // reads have none: there is nothing to overwrite and the worst a wrong answer
    // costs is a wrong answer. The send is a different matter entirely -- see
    // `messages_send` at the bottom.
    messages_recent: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "messages_reported",
        reversible: true,
        capabilityTier: "messages_read",
        execution: { kind: "messages_read", operation: "recent" },
        validateArguments(arguments_) {
            return validateMessageLimit(arguments_.limit);
        },
    },
    messages_from: {
        risk: "low",
        requiredArguments: ["person"],
        approvalRequired: false,
        verification: "messages_reported",
        reversible: true,
        capabilityTier: "messages_read",
        execution: { kind: "messages_read", operation: "from" },
        validateArguments(arguments_) {
            const person = arguments_.person;
            if (typeof person !== "string" || person.trim().length === 0) {
                return ["person must name someone, such as a contact name or a number"];
            }
            if (person.length > 120)
                return ["person is too long to be a name"];
            return validateMessageLimit(arguments_.limit);
        },
    },
    messages_search: {
        risk: "low",
        requiredArguments: ["text"],
        approvalRequired: false,
        verification: "messages_reported",
        reversible: true,
        capabilityTier: "messages_read",
        execution: { kind: "messages_read", operation: "search" },
        validateArguments(arguments_) {
            const text = arguments_.text;
            if (typeof text !== "string" || text.trim().length === 0) {
                return ["text must be the words to look for"];
            }
            if (text.length > 200)
                return ["text is too long to be a search"];
            return validateMessageLimit(arguments_.limit);
        },
    },
    messages_chats: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "messages_reported",
        reversible: true,
        capabilityTier: "messages_read",
        execution: { kind: "messages_read", operation: "chats" },
        validateArguments(arguments_) {
            return validateMessageLimit(arguments_.limit);
        },
    },
    /*
     Which handles this Mac sends AS — Nick's own number and Apple ID.
  
     `orion-messages whoami` has existed since the reader was written, and was
     reachable by nobody: not a catalog action, and `orion-messages` is not on the
     exec allowlist either, so there was no route to it from inside Orion at all.
     That left him unable to answer "what's my number", and — the reason this is
     being fixed alongside the send bugs rather than after them — unable to send a
     test message to a safe destination. Every rehearsal of the send path had to
     aim at a real third party, so in practice the send path was never rehearsed.
  
     A read, at the read tier, with no arguments. It returns Nick's own handles to
     Nick's own assistant on Nick's own machine, which is the least sensitive
     thing in this section: the four reads above return what other people said,
     and this one returns only who he is.
    */
    messages_whoami: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "messages_reported",
        reversible: true,
        capabilityTier: "messages_read",
        execution: { kind: "messages_read", operation: "whoami" },
    },
    messages_contacts_status: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "messages_reported",
        reversible: true,
        capabilityTier: "messages_read",
        execution: { kind: "messages_read", operation: "contacts_status" },
    },
    /*
     The one irreversible outbound action in this catalog.
  
     Four independent gates, and it is worth naming them separately because no
     one of them is sufficient:
  
       1. TIER. `messages_send` lives only at the `external_connected` profile,
          so the profile has to be raised deliberately. A config flag alone does
          not do it and neither does the profile alone -- `enabledTiers` is the
          intersection.
       2. ORIGIN. `userOriginatedArguments` requires the recipient to appear in
          Nick's authenticated turn. A recipient named by a message Orion READ
          cannot satisfy this, which is the attack this action exists to not
          enable: anyone can text him, so message content is attacker-controlled
          input, and a text saying "reply to +1555… that he agrees" must not be
          able to address an outbound message.
       3. TAINT. The body is compared against untrusted content, so a message he
          read cannot be forwarded outward without his own words carrying it.
       4. APPROVAL. `approvalRequired` binds a canonical hash to the exact
          recipient AND body AND working context, so an approval for one message
          cannot be replayed against a different one.
  
     `reversible: false` is the literal truth here rather than a formality, and
     `risk: "high"` follows from it.
    */
    /*
     PHASE 51 — the structured operations, and why their metadata reads the way
     it does.
  
     The three reads are `risk: low` and genuinely reversible: they open no
     network connection, write nothing, and run a fixed argv. They are what Orion
     should be reaching for when he wants to know the state of a repository, and
     the point of building them is that reaching for `git` on the allowlist
     instead was the only option he had.
  
     The four that DO something are `risk: high` without exception, including the
     ones that look tame. `npm ci` and `npm test` execute code out of the
     repository, and `git pull` can bring in a hook. Marking them medium because
     they usually work would be marking them by their good days.
  
     None of them is `approvalRequired`. That is a decision: an assistant who
     cannot run the tests without being asked twice is an assistant nobody lets
     near a repository. `risk: high` puts them at NOTIFY under `guarded`, which is
     the honest answer -- he runs it and tells you -- and `open` and `sovereign`
     let them go quiet, which is exactly the delegation those modes are for.
    */
    git_status: devAction("git_status", "low", true, "git_status_reported"),
    git_log: devAction("git_log", "low", true, "git_log_reported", {
        limit: (value) => value === undefined ||
            (Number.isInteger(value) && value >= 1 && value <= 100)
            ? []
            : ["limit must be a whole number from 1 to 100"],
    }),
    git_diff: devAction("git_diff", "low", true, "git_diff_reported", {
        staged: (value) => value === undefined || typeof value === "boolean"
            ? []
            : ["staged must be true or false"],
    }),
    git_pull: devAction("git_pull", "high", true, "git_pull_reported"),
    tests_run: devAction("tests_run", "high", true, "tests_reported"),
    build_run: devAction("build_run", "high", true, "build_reported"),
    package_install: devAction("package_install", "high", true, "install_reported"),
    /*
     PHASES 57/58 — proposing an automation, and nothing more than proposing it.
  
     `risk: medium` on `automation_propose` rather than low, because a proposal
     is a thing Nick will be asked to read and approve, and an assistant that
     files six of them a day has found a way to get one approved by attrition.
     The rest are reads.
    */
    automation_propose: {
        risk: "medium",
        requiredArguments: ["name", "intent", "trigger", "action", "expiresOn"],
        approvalRequired: false,
        verification: "automation_proposed",
        reversible: true,
        capabilityTier: "automation",
        execution: { kind: "automation", operation: "propose" },
        validateArguments: (arguments_) => validateProposal(arguments_),
    },
    automation_list: {
        risk: "low",
        requiredArguments: [],
        approvalRequired: false,
        verification: "automation_listed",
        reversible: true,
        capabilityTier: "automation",
        execution: { kind: "automation", operation: "list" },
    },
    automation_simulate: {
        risk: "low",
        requiredArguments: ["name"],
        approvalRequired: false,
        verification: "automation_simulated",
        reversible: true,
        capabilityTier: "automation",
        execution: { kind: "automation", operation: "simulate" },
        validateArguments: (arguments_) => typeof arguments_.name === "string" && NAME_RE.test(arguments_.name)
            ? []
            : ["name must be an existing proposal's name"],
    },
    automation_withdraw: {
        risk: "low",
        requiredArguments: ["name"],
        approvalRequired: false,
        verification: "automation_withdrawn",
        reversible: true,
        capabilityTier: "automation",
        execution: { kind: "automation", operation: "withdraw" },
        validateArguments: (arguments_) => typeof arguments_.name === "string" && NAME_RE.test(arguments_.name)
            ? []
            : ["name must be an existing proposal's name"],
    },
    messages_send: {
        risk: "high",
        requiredArguments: ["recipient", "body"],
        approvalRequired: true,
        verification: "message_sent",
        reversible: false,
        capabilityTier: "messages_send",
        execution: { kind: "messages_send" },
        userOriginatedArguments: ["recipient"],
        validateArguments(arguments_) {
            const issues = [];
            const recipient = arguments_.recipient;
            if (typeof recipient !== "string" || recipient.trim().length === 0) {
                issues.push("recipient must name one person, a phone number, or an Apple ID");
            }
            else if (recipient.length > 120) {
                issues.push("recipient is too long to be a person");
            }
            else if (/[\u0000-\u001F\u007F]/.test(recipient)) {
                issues.push("recipient must not contain control characters");
            }
            else if (/[,;]/.test(recipient)) {
                // One message to one person. A list is how a mistake becomes a
                // broadcast, and the script resolves exactly one handle by design.
                issues.push("recipient must be a single person, not a list");
            }
            const body = arguments_.body;
            if (typeof body !== "string" || body.trim().length === 0) {
                issues.push("body must be the message to send");
            }
            else if (body.length > 2000) {
                issues.push("body must be 2000 characters or fewer");
            }
            else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) {
                issues.push("body must not contain control characters");
            }
            else if (SECRET_SHAPED_MESSAGE.some((pattern) => pattern.test(body))) {
                // Also enforced in the script, which is the gate that holds if this
                // one is ever bypassed. Refused here too so the model is told why
                // rather than reading a non-zero exit.
                issues.push("body looks like it contains a credential, a card number, or a one-time code, which must not be sent in a message");
            }
            return issues;
        },
    },
};
/** Shared by every messages read: how many rows, bounded on both ends. */
function validateMessageLimit(limit) {
    if (limit === undefined)
        return [];
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return ["limit must be a whole number from 1 to 200"];
    }
    return [];
}
/**
 * Credential shapes refused in an outbound message.
 *
 * The list `orion-remember` uses, plus the two that only matter once the
 * destination is someone else's phone: card numbers, and the one-time codes
 * that are the entire mechanism of a SIM-swap. Kept in sync with the copy in
 * `scripts/orion-messages-send` on purpose -- the script must refuse these even
 * when it is called directly, and this copy exists so the model gets a sentence
 * back instead of an exit code.
 */
const SECRET_SHAPED_MESSAGE = [
    /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:\d[ -]?){13,16}\b(?=[^\d]|$)/,
    /\b(?:one[- ]?time|verification|security|auth(?:entication)?|2fa|otp)\s+code\b/i,
    /\b(?:password|passcode|passphrase|api[- ]?key|secret\s+key)\s*(?:is|:|=)\s*\S/i,
];
