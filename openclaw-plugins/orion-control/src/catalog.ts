export type Risk = "low" | "medium" | "high" | "critical";
export type CapabilityTier =
  | "simulation"
  | "app_control"
  | "browser_control"
  | "media_control"
  | "test_workspace"
  | "scratch_workspace"
  | "desktop_read"
  | "home_read"
  | "desktop_test_workspace"
  | "desktop_modify"
  | "desktop_direct_write"
  | "scratch_direct_write"
  | "file_mutate"
  // Reads of the world rather than of the disk: weather, the clock, how the
  // machine is doing. No filesystem root, nothing mutable, and only the weather
  // leaves the machine — to one keyless endpoint given a place name.
  | "ambient_info"
  // Timers and alarms. Writes only to Orion's own reminder store, never to a
  // user file, and the worst outcome of a mistake is being told the time.
  | "reminders"
  // Orion adjusting Orion. Reads and writes a fixed, validated set of keys in
  // his own app's preference domain -- how long he waits before deciding you
  // stopped talking, and how long he may believe he is still speaking.
  //
  // This is the smallest honest version of "he should be able to fix himself".
  // The alternative on the table was a general "edit your own config" power,
  // which is really "write arbitrary preferences to any domain" and would have
  // included every other app on the machine. Here the key list is closed, every
  // value is range-checked against the same bounds the Swift side enforces, and
  // the blast radius of a mistake is that his ears are badly tuned until he is
  // told to put them back.
  | "self_tuning";

/**
 * Roots Orion may write to. `home` is deliberately absent: home is a READ root
 * only, and every write policy below is typed against `MutableRoot` so a
 * home-directory write cannot be expressed, let alone executed.
 */
export type MutableRoot = "test_workspace" | "scratch_workspace" | "desktop";
export type ReadableRoot = "desktop" | "home";
export type ControlledRoot = MutableRoot | "home";

export const MUTABLE_ROOTS: readonly MutableRoot[] = [
  "test_workspace",
  "scratch_workspace",
  "desktop",
];

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
  operation:
    | "open_url"
    | "new_tab"
    | "close_tab"
    | "list_tabs"
    | "switch_tab"
    | "read_page";
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
  operation:
    | "play_pause"
    | "next_track"
    | "previous_track"
    | "volume_set"
    | "volume_mute"
    | "volume_unmute"
    | "display_sleep";
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

export type ExecutionPolicy =
  | { kind: "simulate" }
  | {
      kind: "app_control";
      operation: "open" | "quit";
      applicationArgument: string;
    }
  | BrowserControlPolicy
  | MediaControlPolicy
  | {
      kind: "ambient_read";
      operation: "weather" | "clock" | "system_status";
    }
  | {
      kind: "reminder";
      operation: "timer_set" | "alarm_set" | "reminder_list" | "reminder_cancel";
    }
  | {
      kind: "self_tuning";
      operation: "read" | "write";
    }
  | FileMutationPolicy
  | CreateOnlyTextPolicy
  | DesktopTextMutationPolicy
  | DesktopFileMutationPolicy
  | {
      kind: "create_directory";
      root: MutableRoot;
      relativePathArgument: string;
    }
  | {
      kind: "list_directory";
      root: ReadableRoot;
      relativePathArgument: string;
      maxEntries: number;
    }
  | {
      kind: "path_metadata";
      root: ReadableRoot;
      relativePathArgument: string;
    }
  | {
      kind: "read_text";
      root: ReadableRoot;
      relativePathArgument: string;
      allowedExtensions: readonly string[];
      maxBytes: number;
    };

/** The read-only observation policies, shared by execution and verification. */
export type ObservationPolicy = Extract<
  ExecutionPolicy,
  { kind: "list_directory" | "path_metadata" | "read_text" }
>;

export function isObservationPolicy(
  policy: ExecutionPolicy,
): policy is ObservationPolicy {
  return (
    policy.kind === "list_directory" ||
    policy.kind === "path_metadata" ||
    policy.kind === "read_text"
  );
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

export interface TunableSetting {
  /** The `UserDefaults` key, as spelled in `VoiceTuning.swift`. */
  key: string;
  min: number;
  max: number;
  integer: boolean;
  unit: string;
  description: string;
}

export const TUNABLE_SETTINGS: Record<string, TunableSetting> = {
  endpointing_ms: {
    key: "OrionVoiceEndpointingMs",
    min: 100,
    max: 4000,
    integer: true,
    unit: "ms",
    description:
      "Silence before Orion decides you have finished a sentence. Raise it if he interrupts you mid-thought; lower it if he feels slow to answer.",
  },
  utterance_end_ms: {
    key: "OrionVoiceUtteranceEndMs",
    min: 1000,
    max: 8000,
    integer: true,
    unit: "ms",
    description:
      "Backstop for when the primary end-of-speech signal never arrives. Always held at least 600ms behind endpointing_ms.",
  },
  apple_final_grace: {
    key: "OrionVoiceAppleFinalGrace",
    min: 0.4,
    max: 4,
    integer: false,
    unit: "s",
    description:
      "How long the on-device recogniser may take to promote its last partial to a final result after the key comes up.",
  },
  speaking_stall_timeout: {
    key: "OrionSpeakingStallTimeout",
    min: 4,
    max: 60,
    integer: false,
    unit: "s",
    description:
      "Seconds of no audio before a speaking phase is presumed wedged and force-ended. This is the guard against Orion believing he is still talking when he is not.",
  },
};

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

const SAFE_NAME = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
/**
 * Credential-shaped names, refused everywhere a path is accepted.
 *
 * `credential` / `secret` / `password` / `keychain` match anywhere in the
 * segment (so `my-credentials.txt` and `work_secrets.md` are refused, not just
 * `credentials.txt`); the remaining forms stay anchored so ordinary words like
 * `tokenizer.js` are not swept up. Widening this only ever refuses more.
 */
const SENSITIVE_NAME = new RegExp(
  [
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
  ].join("|"),
  "i",
);
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

export function isSafeRelativePath(
  value: unknown,
  allowRoot = false,
): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return false;
  }
  if (value.length > MAX_RELATIVE_PATH_LENGTH) return false;
  if (allowRoot && value === ".") return true;
  if (value.startsWith("/") || value.startsWith("~") || value.includes("\\")) {
    return false;
  }
  const segments = value.split("/");
  if (segments.length > MAX_PATH_SEGMENTS) return false;
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment.length <= MAX_SEGMENT_LENGTH &&
      segment !== "." &&
      segment !== ".." &&
      !segment.startsWith(".") &&
      !SENSITIVE_NAME.test(segment),
  );
}

/**
 * Hashes are derived server-side from the exact bytes the executor is about to
 * write. A caller MAY still assert them, in which case the assertion is
 * enforced as an extra optimistic-concurrency check; omitting them is the
 * normal path and carries no security weight.
 */
function validateOptionalHashes(
  arguments_: Record<string, unknown>,
  operation: "create" | "append" | "replace" | undefined,
  expectedHashArgument: string,
  resultHashArgument: string,
): string[] {
  const issues: string[] = [];
  const expectedHash = arguments_[expectedHashArgument];
  const resultHash = arguments_[resultHashArgument];
  if (expectedHash !== undefined) {
    const valid =
      operation === "create"
        ? expectedHash === "absent"
        : typeof expectedHash === "string" && SHA256.test(expectedHash);
    if (!valid) {
      issues.push(
        operation === "create"
          ? `${expectedHashArgument} may be omitted, or must be exactly absent for create`
          : `${expectedHashArgument} may be omitted, or must be a lowercase SHA-256 hash`,
      );
    }
  }
  if (
    resultHash !== undefined &&
    (typeof resultHash !== "string" || !SHA256.test(resultHash))
  ) {
    issues.push(
      `${resultHashArgument} may be omitted, or must be a lowercase SHA-256 hash`,
    );
  }
  return issues;
}

export function isVisibleNonSensitiveName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith(".") &&
    !SENSITIVE_NAME.test(name)
  );
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
export function isSafeHomeRelativePath(
  value: unknown,
  allowRoot = false,
): value is string {
  if (!isSafeRelativePath(value, allowRoot)) return false;
  if (value === ".") return true;
  return value
    .split("/")
    .every((segment) => !HOME_DENIED_SEGMENT.test(segment));
}

/** A single path segment usable as a rename target. */
export function isSafeSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !value.includes("/") &&
    isSafeRelativePath(value)
  );
}

export function isMutableRoot(value: unknown): value is MutableRoot {
  return (
    typeof value === "string" &&
    (MUTABLE_ROOTS as readonly string[]).includes(value)
  );
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

export function browserUrlIssues(value: unknown): string[] {
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
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
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
] as const;
export type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number];

const BROWSER_ALIASES: Readonly<Record<string, SupportedBrowser>> = {
  "opera air": "Opera Air",
  "opera": "Opera",
  "safari": "Safari",
  "google chrome": "Google Chrome",
  "chrome": "Google Chrome",
};

export function resolveBrowserName(value: unknown): SupportedBrowser | undefined {
  if (typeof value !== "string") return undefined;
  return BROWSER_ALIASES[value.trim().toLowerCase()];
}

export const SUPPORTED_PLAYERS = ["Spotify", "Music", "TV", "Podcasts"] as const;
export type SupportedPlayer = (typeof SUPPORTED_PLAYERS)[number];

export function resolvePlayerName(value: unknown): SupportedPlayer | undefined {
  if (typeof value !== "string") return undefined;
  const wanted = value.trim().toLowerCase();
  return SUPPORTED_PLAYERS.find((player) => player.toLowerCase() === wanted);
}

export const MIN_VOLUME = 0;
export const MAX_VOLUME = 100;

/** Volume must be a real number in 0-100; strings and NaN are refused. */
export function volumeIssues(value: unknown): string[] {
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
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return MIN_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(value)));
}

/** Plain-text extensions readable from the home directory. */
export const HOME_TEXT_EXTENSIONS: readonly string[] = [
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
export function tabSelectorIssues(value: unknown): string[] {
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

function validateCreateOnlyText(
  policy: CreateOnlyTextPolicy,
  arguments_: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  const name = arguments_[policy.nameArgument];
  const content = arguments_[policy.contentArgument];
  const extension = policy.fixedExtension
    ? policy.fixedExtension
    : policy.extensionArgument
      ? arguments_[policy.extensionArgument]
      : undefined;
  if (typeof name !== "string" || !SAFE_NAME.test(name)) {
    issues.push(
      `${policy.nameArgument} must be 1-64 lowercase letters, digits, underscores, or hyphens`,
    );
  }
  if (
    typeof extension !== "string" ||
    !policy.allowedExtensions.includes(extension)
  ) {
    issues.push(
      `${policy.extensionArgument ?? "extension"} must be one of: ${policy.allowedExtensions.join(", ")}`,
    );
  }
  if (
    typeof content !== "string" ||
    content.length === 0 ||
    Buffer.byteLength(content, "utf8") > policy.maxBytes ||
    content.includes("\0")
  ) {
    issues.push(
      `${policy.contentArgument} must be 1-${policy.maxBytes} UTF-8 bytes and contain no NUL byte`,
    );
  }
  return issues;
}

function createOnlyText(
  definition: Omit<ActionDefinition, "validateArguments"> & {
    execution: CreateOnlyTextPolicy;
  },
): ActionDefinition {
  return {
    ...definition,
    validateArguments: (arguments_) =>
      validateCreateOnlyText(definition.execution, arguments_),
  };
}

function desktopTextMutation(
  operation: DesktopTextMutationPolicy["operation"],
): ActionDefinition {
  const execution: DesktopTextMutationPolicy = {
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
      const issues: string[] = [];
      const relativePath = arguments_.relativePath;
      const content = arguments_.content;
      if (!isSafeRelativePath(relativePath)) {
        issues.push(
          "relativePath must stay within Desktop and contain no hidden or sensitive path segment",
        );
      } else {
        const extension = relativePath.split(".").at(-1)?.toLowerCase();
        if (!execution.allowedExtensions.includes(extension ?? "")) {
          issues.push("relativePath extension must be one of: txt, md");
        }
      }
      if (
        typeof content !== "string" ||
        content.includes("\0") ||
        Buffer.byteLength(content, "utf8") > execution.maxContentBytes
      ) {
        issues.push(
          `content must be 0-${execution.maxContentBytes} UTF-8 bytes and contain no NUL byte`,
        );
      }
      issues.push(
        ...validateOptionalHashes(
          arguments_,
          operation,
          "expectedHash",
          "resultHash",
        ),
      );
      return issues;
    },
  };
}

function validateEncodedContent(
  content: unknown,
  encoding: unknown,
  maxBytes: number,
): string[] {
  if (typeof content !== "string") return ["content must be a string"];
  if (encoding === undefined || encoding === "utf8") {
    return Buffer.byteLength(content, "utf8") <= maxBytes
      ? []
      : [`content must not exceed ${maxBytes} bytes`];
  }
  if (encoding !== "base64") return ["encoding must be utf8 or base64"];
  if (
    content.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      content,
    )
  ) {
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
  root: MutableRoot,
  capabilityTier: CapabilityTier,
): ActionDefinition {
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
  root: MutableRoot,
  capabilityTier: CapabilityTier,
): ActionDefinition {
  const execution: DesktopFileMutationPolicy = {
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
      const issues: string[] = [];
      if (!isSafeRelativePath(arguments_.relativePath)) {
        issues.push(
          "relativePath must stay within the configured root and contain no hidden or sensitive path segment",
        );
      }
      const operation = arguments_.operation;
      if (!["create", "append", "replace"].includes(String(operation))) {
        issues.push("operation must be create, append, or replace");
      }
      if (
        arguments_.contentSource !== undefined &&
        arguments_.contentSource !== "inline_user_request"
      ) {
        issues.push("contentSource may be omitted, or must be inline_user_request");
      }
      issues.push(
        ...validateEncodedContent(
          arguments_.content,
          arguments_.encoding,
          execution.maxContentBytes,
        ),
      );
      issues.push(
        ...validateOptionalHashes(
          arguments_,
          operation === "create" || operation === "append" || operation === "replace"
            ? operation
            : undefined,
          "expectedHash",
          "resultHash",
        ),
      );
      return issues;
    },
  };
}

function browserArgumentIssues(arguments_: Record<string, unknown>): string[] {
  return arguments_.browser === undefined ||
    resolveBrowserName(arguments_.browser) !== undefined
    ? []
    : [
        `browser may be omitted, or must be one of: ${SUPPORTED_BROWSERS.join(", ")}`,
      ];
}

function browserAction(
  policy: BrowserControlPolicy,
  definition: {
    risk: Risk;
    requiredArguments: string[];
    verification: string;
    reversible: boolean;
    extraValidation?: (arguments_: Record<string, unknown>) => string[];
  },
): ActionDefinition {
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

function mediaAction(
  policy: MediaControlPolicy,
  definition: {
    requiredArguments: string[];
    verification: string;
    extraValidation?: (arguments_: Record<string, unknown>) => string[];
  },
): ActionDefinition {
  return {
    risk: "low",
    requiredArguments: definition.requiredArguments,
    approvalRequired: false,
    verification: definition.verification,
    reversible: true,
    capabilityTier: "media_control",
    execution: policy,
    validateArguments(arguments_) {
      const issues =
        arguments_.player === undefined ||
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
function fileMutation(
  operation: FileMutationPolicy["operation"],
  definition: {
    risk: Risk;
    approvalRequired: boolean;
    requiredArguments: string[];
    verification: string;
    destinationArgument?: string;
    extraValidation?: (arguments_: Record<string, unknown>) => string[];
  },
): ActionDefinition {
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
      const issues: string[] = [];
      if (!isMutableRoot(arguments_.root)) {
        issues.push(`root must be one of: ${MUTABLE_ROOTS.join(", ")}`);
      }
      if (!isSafeRelativePath(arguments_.relativePath)) {
        issues.push(
          "relativePath must stay within the configured root and contain no hidden or sensitive path segment",
        );
      }
      issues.push(...(definition.extraValidation?.(arguments_) ?? []));
      return issues;
    },
  };
}

export const ACTION_CATALOG: Readonly<Record<string, ActionDefinition>> = {
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
    validateArguments: (arguments_) =>
      typeof arguments_.application === "string" &&
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
    validateArguments: (arguments_) =>
      typeof arguments_.application === "string" &&
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
  browser_open_url: browserAction(
    {
      kind: "browser_control",
      operation: "open_url",
      browserArgument: "browser",
      urlArgument: "url",
      read: false,
    },
    {
      risk: "medium",
      requiredArguments: ["url"],
      verification: "browser_tab_shows_url",
      reversible: true,
      extraValidation: (arguments_) => browserUrlIssues(arguments_.url),
    },
  ),
  browser_new_tab: browserAction(
    {
      kind: "browser_control",
      operation: "new_tab",
      browserArgument: "browser",
      read: false,
    },
    {
      risk: "low",
      requiredArguments: [],
      verification: "browser_tab_count_increased",
      reversible: true,
    },
  ),
  browser_close_tab: browserAction(
    {
      kind: "browser_control",
      operation: "close_tab",
      browserArgument: "browser",
      read: false,
    },
    {
      risk: "low",
      requiredArguments: [],
      verification: "browser_tab_count_decreased",
      reversible: false,
    },
  ),
  browser_list_tabs: browserAction(
    {
      kind: "browser_control",
      operation: "list_tabs",
      browserArgument: "browser",
      maxTabs: 200,
      read: true,
    },
    {
      risk: "low",
      requiredArguments: [],
      verification: "browser_tab_list_matches",
      reversible: true,
    },
  ),
  browser_switch_tab: browserAction(
    {
      kind: "browser_control",
      operation: "switch_tab",
      browserArgument: "browser",
      selectorArgument: "tab",
      maxTabs: 200,
      read: false,
    },
    {
      risk: "low",
      requiredArguments: ["tab"],
      verification: "browser_active_tab_matches",
      reversible: true,
      extraValidation: (arguments_) => tabSelectorIssues(arguments_.tab),
    },
  ),
  browser_read_page: browserAction(
    {
      kind: "browser_control",
      operation: "read_page",
      browserArgument: "browser",
      // 100 KB ceiling on extracted text; the ledger records that a read
      // happened and of which URL.
      maxBytes: 102400,
      read: true,
    },
    {
      risk: "medium",
      requiredArguments: [],
      verification: "browser_active_tab_url_matches",
      reversible: true,
    },
  ),
  media_play_pause: mediaAction(
    {
      kind: "media_control",
      operation: "play_pause",
      playerArgument: "player",
      targetWords: [
        "music", "song", "songs", "track", "playback", "audio", "spotify",
        "player", "video", "podcast", "episode", "itunes", "tunes",
      ],
    },
    { requiredArguments: [], verification: "media_player_state_toggled" },
  ),
  media_next_track: mediaAction(
    {
      kind: "media_control",
      operation: "next_track",
      playerArgument: "player",
      targetWords: [
        "music", "song", "songs", "track", "playback", "audio", "spotify",
        "player", "podcast", "episode", "itunes", "tunes",
      ],
    },
    { requiredArguments: [], verification: "media_track_advanced" },
  ),
  media_previous_track: mediaAction(
    {
      kind: "media_control",
      operation: "previous_track",
      playerArgument: "player",
      targetWords: [
        "music", "song", "songs", "track", "playback", "audio", "spotify",
        "player", "podcast", "episode", "itunes", "tunes",
      ],
    },
    { requiredArguments: [], verification: "media_track_returned" },
  ),
  volume_set: mediaAction(
    {
      kind: "media_control",
      operation: "volume_set",
      levelArgument: "level",
      targetWords: ["volume", "loud", "louder", "quiet", "quieter", "sound"],
    },
    {
      requiredArguments: ["level"],
      verification: "system_volume_matches",
      extraValidation: (arguments_) => volumeIssues(arguments_.level),
    },
  ),
  volume_mute: mediaAction(
    {
      kind: "media_control",
      operation: "volume_mute",
      targetWords: ["volume", "sound", "audio", "mute", "silence", "quiet"],
    },
    { requiredArguments: [], verification: "system_volume_muted" },
  ),
  volume_unmute: mediaAction(
    {
      kind: "media_control",
      operation: "volume_unmute",
      targetWords: ["volume", "sound", "audio", "mute", "unmute"],
    },
    { requiredArguments: [], verification: "system_volume_unmuted" },
  ),
  display_sleep: mediaAction(
    {
      kind: "media_control",
      operation: "display_sleep",
      targetWords: ["display", "screen", "monitor", "displays", "screens"],
    },
    { requiredArguments: [], verification: "display_sleep_command_accepted" },
  ),
  file_move: fileMutation("move", {
    risk: "medium",
    approvalRequired: false,
    requiredArguments: ["root", "relativePath", "destinationPath"],
    verification: "file_present_at_destination",
    destinationArgument: "destinationPath",
    extraValidation: (arguments_) =>
      isSafeRelativePath(arguments_.destinationPath)
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
    extraValidation: (arguments_) =>
      isSafeSegment(arguments_.newName)
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
  desktop_folder_create_explicit: directFolderCreate(
    "desktop",
    "desktop_direct_write",
  ),
  desktop_file_write_explicit: directFileWrite(
    "desktop",
    "desktop_direct_write",
  ),
  scratch_folder_create_explicit: directFolderCreate(
    "scratch_workspace",
    "scratch_direct_write",
  ),
  scratch_file_write_explicit: directFileWrite(
    "scratch_workspace",
    "scratch_direct_write",
  ),
  // Reading only. There is no home write policy anywhere in this file, and the
  // write policy types cannot even name the home root.
  home_list: {
    risk: "low",
    requiredArguments: ["relativePath"],
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
      if (location.length > 120) return ["location is too long to be a place"];
      const days = arguments_.days;
      if (days !== undefined && (!Number.isInteger(days) || (days as number) < 0 || (days as number) > 7)) {
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
      if (!Number.isInteger(seconds) || (seconds as number) < 1) {
        return ["seconds must be a whole number of seconds, at least 1"];
      }
      // 24 hours. Past that it is an alarm, and an alarm survives a restart in
      // a way a countdown does not pretend to.
      if ((seconds as number) > 86400) {
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
      const spec = TUNABLE_SETTINGS[setting]!;
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
};
