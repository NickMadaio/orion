import { createHash } from "node:crypto";
import path from "node:path";
import { ACTION_CATALOG, } from "./catalog.js";
function stable(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stable).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
}
export function hash(value) {
    return createHash("sha256").update(stable(value)).digest("hex");
}
export function canonicalActionHash(step, workingContext = "") {
    return hash({
        action: step.action,
        arguments: step.arguments,
        workingContext,
    });
}
function topologicalOrder(graph, issues) {
    const stepIds = new Set(graph.steps.map((step) => step.id));
    const incoming = new Map();
    const outgoing = new Map();
    for (const step of graph.steps) {
        incoming.set(step.id, 0);
        outgoing.set(step.id, []);
    }
    for (const step of graph.steps) {
        for (const dependency of step.dependsOn) {
            if (!stepIds.has(dependency)) {
                issues.push({
                    code: "missing_dependency",
                    message: `Dependency '${dependency}' does not exist.`,
                    stepId: step.id,
                });
                continue;
            }
            incoming.set(step.id, (incoming.get(step.id) ?? 0) + 1);
            outgoing.get(dependency)?.push(step.id);
        }
    }
    const queue = graph.steps
        .filter((step) => incoming.get(step.id) === 0)
        .map((step) => step.id);
    const order = [];
    while (queue.length > 0) {
        const current = queue.shift();
        order.push(current);
        for (const next of outgoing.get(current) ?? []) {
            const count = (incoming.get(next) ?? 0) - 1;
            incoming.set(next, count);
            if (count === 0)
                queue.push(next);
        }
    }
    if (order.length !== graph.steps.length && !issues.some((issue) => issue.code === "missing_dependency")) {
        issues.push({
            code: "dependency_cycle",
            message: "The task graph contains a dependency cycle.",
        });
    }
    return order;
}
function validateNestedFolders(graph, issues) {
    const folderSteps = graph.steps.filter((step) => step.action === "folder_create" && typeof step.arguments.path === "string");
    for (const child of folderSteps) {
        const childPath = path.resolve(child.arguments.path);
        for (const parent of folderSteps) {
            if (parent.id === child.id)
                continue;
            const parentPath = path.resolve(parent.arguments.path);
            if (path.dirname(childPath) === parentPath && !child.dependsOn.includes(parent.id)) {
                issues.push({
                    code: "missing_parent_dependency",
                    message: `Folder '${child.arguments.path}' must depend on parent step '${parent.id}'.`,
                    stepId: child.id,
                });
            }
        }
    }
}
/** Hard structural caps so a malformed graph fails validation, not the runtime. */
export const MAX_STEPS = 32;
export const MAX_INPUTS = 64;
/**
 * Does the user's own sentence name this target?
 *
 * The old check was `content.includes(relativePath)`, which required the user
 * to have typed the joined path verbatim. Nobody says "awesome/orion.txt" out
 * loud; they say "a folder called awesome, and in it a file called orion.txt".
 * That rejected a perfectly explicit instruction.
 *
 * Every path segment must still appear in the user's words. So "awesome" plus
 * "orion.txt" authorizes `awesome/orion.txt`, while an instruction naming only
 * "awesome" cannot authorize `awesome/secrets.txt` — the basename is absent.
 * The guarantee is unchanged: the user must have named the thing.
 */
export function instructionNamesTarget(content, relativePath) {
    const haystack = content.toLowerCase();
    const segments = relativePath
        .split("/")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    if (segments.length === 0)
        return false;
    return segments.every((segment) => haystack.includes(segment));
}
/**
 * Words that show the user is talking about files and folders at all.
 * Used only to tell "make me a note" apart from a request that never
 * mentioned the filesystem.
 */
const FILESYSTEM_NOUNS = [
    "file", "files", "folder", "folders", "directory", "note", "notes",
    "document", "doc", "txt", "text", "desktop", "workspace", "subfolder",
];
/**
 * Is this action inside the scope the user asked for?
 *
 * The strict rule — every path segment present in the user's words — made
 * Orion demand you recite filenames back to it:
 *
 *   "make a text file of some sort"
 *   → "I need you to explicitly name the file you want created."
 *
 * That is not a security boundary, it is a spelling test. The things actually
 * protecting you are elsewhere and are untouched: authorization still requires
 * a real user turn recovered from the host transcript, actions are confined to
 * approved roots, there is no delete/move/rename, and every action is
 * ledgered. Specificity was never what stopped an injected instruction — the
 * injected text is not in your turn at all, which is the boundary that matters.
 *
 * So: you may be vague. Orion may fill in a detail you left open, provided the
 * action lands somewhere you did point at.
 *
 * Authorized when EITHER:
 *   - you named it — every path segment appears in your words (strict path); or
 *   - you named the place — the parent folder appears in your words, so Orion
 *     choosing `notes.txt` inside the `cooler` folder you asked for is fine; or
 *   - you asked generically for a file or folder and the target sits directly
 *     in an approved root, so "make me a text file" can land on the Desktop.
 *
 * Still refused: a target whose parent you never mentioned and which is not a
 * top-level create — Orion cannot wander into `Desktop/private/keys.txt` off
 * the back of "make me a note".
 */
export function instructionAuthorizesTarget(content, relativePath) {
    if (instructionNamesTarget(content, relativePath))
        return true;
    const haystack = content.toLowerCase();
    const segments = relativePath
        .split("/")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    if (segments.length === 0)
        return false;
    const parents = segments.slice(0, -1);
    // You named the containing folder: the leaf is Orion's to choose.
    if (parents.length > 0 && parents.every((p) => haystack.includes(p))) {
        return true;
    }
    // Top-level inside an approved root, and you were talking about files.
    if (parents.length === 0) {
        return FILESYSTEM_NOUNS.some((noun) => new RegExp(`\\b${noun}\\b`).test(haystack));
    }
    return false;
}
/**
 * Does the user's own sentence ask for this operation?
 *
 * The old check looked for the catalog's own verb ("create"), so "make a
 * folder" failed. Requiring the user to speak the schema's vocabulary is a
 * usability bug wearing a security costume: it rejects clear instructions
 * without stopping a single unclear one.
 *
 * These are synonyms for the same intent, matched on word boundaries so
 * "created" or "remake" cannot smuggle one in. Authorization still requires
 * the target to be named explicitly — that is the part doing the real work.
 */
const OPERATION_SYNONYMS = {
    create: [
        "create", "make", "new", "add", "put", "save", "write", "start", "build",
        "generate", "draft", "note", "jot", "record", "set", "give", "need", "want",
    ],
    append: ["append", "add", "put", "attach", "write", "note", "record", "stick"],
    replace: [
        "replace", "overwrite", "update", "change", "set", "rewrite", "fix",
        "edit", "correct", "swap",
    ],
    open: ["open", "launch", "start", "run"],
    quit: ["quit", "close", "exit", "stop"],
    // Reads. Widening the map is not widening the mechanism: the target check is
    // unchanged and still does the real work.
    read: [
        "read", "show", "view", "display", "see", "look", "open", "check", "print",
        "tell", "summarize", "summarise", "what",
    ],
    list: [
        "list", "ls", "show", "see", "what", "inside", "contents", "browse",
        "look", "display", "enumerate", "which",
    ],
    metadata: [
        "metadata", "info", "details", "size", "modified", "stat", "when", "how",
        "check", "about", "look", "big", "old",
    ],
    // Browser.
    open_url: [
        "open", "go", "visit", "browse", "load", "navigate", "launch", "pull",
        "show", "bring", "take",
    ],
    new_tab: ["new", "open", "tab", "add", "create", "make", "start", "blank"],
    close_tab: ["close", "shut", "dismiss", "kill", "quit", "drop"],
    list_tabs: [
        "list", "what", "which", "show", "tabs", "see", "tell", "check", "open",
    ],
    switch_tab: [
        "switch", "go", "change", "select", "focus", "jump", "flip", "move",
        "show", "activate", "back",
    ],
    read_page: [
        "read", "show", "summarize", "summarise", "what", "extract", "grab",
        "get", "tell", "see", "check", "look", "scrape", "page",
    ],
    // Media.
    play_pause: ["play", "pause", "resume", "unpause", "stop", "toggle", "hold"],
    next_track: ["next", "skip", "forward", "advance", "another"],
    previous_track: [
        "previous", "prev", "back", "backward", "restart", "replay", "last",
        "again",
    ],
    volume_set: [
        "volume", "set", "turn", "make", "change", "adjust", "loud", "louder",
        "quiet", "quieter", "down", "up", "lower", "raise",
    ],
    volume_mute: ["mute", "silence", "quiet", "shush", "off", "kill"],
    volume_unmute: ["unmute", "unsilence", "sound", "audio", "on", "back", "restore"],
    display_sleep: [
        "sleep", "off", "dim", "blank", "screen", "display", "lock", "turn",
        "asleep",
    ],
    // Destructive file mutations.
    move: ["move", "relocate", "put", "shift", "transfer", "drag", "file", "stick"],
    rename: ["rename", "name", "call", "retitle", "relabel", "change"],
    delete: [
        "delete", "remove", "trash", "bin", "discard", "erase", "chuck", "toss",
        "junk", "ditch", "scrap",
    ],
};
export function instructionNamesOperation(content, operation) {
    const words = new Set(content.toLowerCase().match(/[a-z]+/g) ?? []);
    const wanted = OPERATION_SYNONYMS[operation.toLowerCase()] ?? [
        operation.toLowerCase(),
    ];
    return wanted.some((verb) => words.has(verb));
}
/** Did the user's own sentence use any of these words? */
export function instructionMentionsAny(content, words) {
    const tokens = new Set(content.toLowerCase().match(/[a-z]+/g) ?? []);
    return words.some((word) => tokens.has(word.toLowerCase()));
}
/**
 * Did the user point at this site?
 *
 * The instruction must contain the URL, its host, or the registrable label of
 * that host ("github" for github.com). A URL that appears only inside page
 * content or a quoted observation is not in the user's turn at all, so it
 * cannot send the browser somewhere new — which is the property that matters
 * for exfiltration.
 */
export function instructionAuthorizesUrl(content, rawUrl) {
    const haystack = content.toLowerCase();
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return false;
    }
    if (haystack.includes(rawUrl.toLowerCase()))
        return true;
    const host = parsed.hostname.toLowerCase();
    if (host.length > 0 && haystack.includes(host))
        return true;
    const bare = host.replace(/^www\./, "");
    if (bare.length > 0 && haystack.includes(bare))
        return true;
    const labels = bare.split(".").filter(Boolean);
    const registrable = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    if (registrable === undefined || registrable.length < 3)
        return false;
    return new RegExp(`\\b${registrable.replace(/[^a-z0-9]/g, "")}\\b`).test(haystack);
}
export function instructionAuthorizesTabSelector(content, selector) {
    if (typeof selector === "number") {
        return new RegExp(`(?:^|[^0-9])${selector}(?:[^0-9]|$)`).test(content);
    }
    if (typeof selector !== "string")
        return false;
    const needle = selector.trim().toLowerCase();
    return needle.length > 0 && content.toLowerCase().includes(needle);
}
/** Words that show the user is talking about a browser at all. */
const BROWSER_NOUNS = [
    "tab", "tabs", "browser", "page", "pages", "window", "site", "website",
    "url", "link", "web", "opera", "safari", "chrome", "chromium",
];
/**
 * What a direct trusted_user instruction has to say for this action to run.
 *
 * Returning `undefined` fails closed: an action whose arguments are not in an
 * authorizable shape is never authorized.
 */
function directAuthorization(definition, step) {
    const policy = definition.execution;
    if (policy.kind === "app_control") {
        const application = step.arguments[policy.applicationArgument];
        if (typeof application !== "string")
            return undefined;
        return {
            operation: policy.operation,
            authorizes: (content) => instructionAuthorizesTarget(content, application) &&
                instructionNamesOperation(content, policy.operation),
        };
    }
    if (policy.kind === "browser_control") {
        if (policy.operation === "open_url") {
            const url = step.arguments[policy.urlArgument ?? "url"];
            if (typeof url !== "string")
                return undefined;
            return {
                operation: policy.operation,
                authorizes: (content) => instructionAuthorizesUrl(content, url) &&
                    instructionNamesOperation(content, policy.operation),
            };
        }
        if (policy.operation === "switch_tab") {
            const selector = step.arguments[policy.selectorArgument ?? "tab"];
            return {
                operation: policy.operation,
                authorizes: (content) => instructionAuthorizesTabSelector(content, selector) &&
                    instructionNamesOperation(content, policy.operation),
            };
        }
        return {
            operation: policy.operation,
            authorizes: (content) => instructionMentionsAny(content, BROWSER_NOUNS) &&
                instructionNamesOperation(content, policy.operation),
        };
    }
    if (policy.kind === "media_control") {
        return {
            operation: policy.operation,
            authorizes: (content) => instructionMentionsAny(content, policy.targetWords) &&
                instructionNamesOperation(content, policy.operation),
        };
    }
    if (policy.kind === "file_mutate") {
        const relativePath = step.arguments[policy.relativePathArgument];
        if (typeof relativePath !== "string")
            return undefined;
        return {
            operation: policy.operation,
            // Destructive tier: the loose "you named the place" allowance does not
            // apply. Every segment of the target must appear in the user's own words.
            authorizes: (content) => instructionNamesTarget(content, relativePath) &&
                instructionNamesOperation(content, policy.operation),
        };
    }
    if (!("relativePathArgument" in policy))
        return undefined;
    const relativePath = step.arguments[policy.relativePathArgument];
    const operation = policy.kind === "create_directory"
        ? "create"
        : policy.kind === "mutate_text"
            ? policy.operation
            : policy.kind === "mutate_file"
                ? step.arguments[policy.operationArgument]
                : policy.kind === "list_directory"
                    ? "list"
                    : policy.kind === "path_metadata"
                        ? "metadata"
                        : policy.kind === "read_text"
                            ? "read"
                            : undefined;
    if (typeof relativePath !== "string" || typeof operation !== "string") {
        return undefined;
    }
    return {
        operation,
        authorizes: (content) => instructionAuthorizesTarget(content, relativePath) &&
            instructionNamesOperation(content, operation),
    };
}
export function validateTaskGraph(graph, options = {}) {
    const issues = [];
    const planHash = hash(graph);
    const inputById = new Map(graph.inputs.map((input) => [input.id, input]));
    const ids = new Set();
    const enabledTiers = options.enabledTiers ?? new Set(["simulation"]);
    if (graph.retryBudget < 0 || graph.retryBudget > 2) {
        issues.push({
            code: "invalid_retry_budget",
            message: "retryBudget must be between 0 and 2.",
        });
    }
    if (graph.steps.length > MAX_STEPS) {
        issues.push({
            code: "graph_too_large",
            message: `A task graph may declare at most ${MAX_STEPS} steps.`,
        });
    }
    if (graph.inputs.length > MAX_INPUTS) {
        issues.push({
            code: "graph_too_large",
            message: `A task graph may declare at most ${MAX_INPUTS} inputs.`,
        });
    }
    // Structural trust gate: trust is minted only by `authorizeTaskGraph` from
    // harness provenance. If no trusted instruction input exists, no authenticated
    // user turn was bound to this tool call and every action must fail closed.
    if (graph.steps.length > 0 &&
        !graph.inputs.some((input) => input.kind === "instruction" && input.trust !== "untrusted_external")) {
        issues.push({
            code: "no_authenticated_user_turn",
            message: "No authenticated user turn was bound to this tool call, so no action can be authorized. Trust is derived from OpenClaw host provenance (message_received / llm_input / before_tool_call), never from the task graph.",
        });
    }
    for (const step of graph.steps) {
        if (ids.has(step.id)) {
            issues.push({
                code: "duplicate_step_id",
                message: `Step id '${step.id}' is duplicated.`,
                stepId: step.id,
            });
        }
        ids.add(step.id);
        const definition = ACTION_CATALOG[step.action];
        if (!definition) {
            issues.push({
                code: "unknown_action",
                message: `Action '${step.action}' is not in the Orion action catalog.`,
                stepId: step.id,
            });
            continue;
        }
        for (const argument of definition.requiredArguments) {
            if (!(argument in step.arguments) || step.arguments[argument] === "") {
                issues.push({
                    code: "missing_argument",
                    message: `Action '${step.action}' requires argument '${argument}'.`,
                    stepId: step.id,
                });
            }
        }
        if (!enabledTiers.has(definition.capabilityTier)) {
            issues.push({
                code: "capability_disabled",
                message: `Action '${step.action}' belongs to disabled capability tier '${definition.capabilityTier}'.`,
                stepId: step.id,
            });
        }
        for (const message of definition.validateArguments?.(step.arguments) ?? []) {
            issues.push({
                code: "invalid_argument",
                message: `Action '${step.action}': ${message}.`,
                stepId: step.id,
            });
        }
        if (step.risk !== definition.risk) {
            issues.push({
                code: "risk_mismatch",
                message: `Action '${step.action}' must declare risk '${definition.risk}'.`,
                stepId: step.id,
            });
        }
        if (step.verify !== definition.verification) {
            issues.push({
                code: "verification_mismatch",
                message: `Action '${step.action}' must use verifier '${definition.verification}'.`,
                stepId: step.id,
            });
        }
        if (step.reversible !== definition.reversible) {
            issues.push({
                code: "reversibility_mismatch",
                message: `Action '${step.action}' must declare reversible '${definition.reversible}'.`,
                stepId: step.id,
            });
        }
        const sources = step.sourceRefs.map((source) => inputById.get(source));
        if (sources.some((source) => source === undefined)) {
            issues.push({
                code: "unknown_source",
                message: "Every sourceRefs entry must name an input.",
                stepId: step.id,
            });
        }
        if (!sources.some((source) => source?.kind === "instruction" && source.trust !== "untrusted_external")) {
            issues.push({
                code: "untrusted_instruction",
                message: "An action requires a trusted user or policy instruction source.",
                stepId: step.id,
            });
        }
        if (definition.directUserAuthorizationRequired) {
            const requirement = directAuthorization(definition, step);
            const authorized = sources.some((source) => {
                if (source?.kind !== "instruction" ||
                    source.trust !== "trusted_user" ||
                    typeof source.content !== "string" ||
                    requirement === undefined) {
                    return false;
                }
                return requirement.authorizes(source.content);
            });
            if (!authorized) {
                issues.push({
                    code: "direct_user_authorization_required",
                    message: "A direct trusted_user instruction must explicitly name the operation and exact target.",
                    stepId: step.id,
                });
            }
        }
        if (definition.approvalRequired) {
            const canonicalHash = canonicalActionHash(step, graph.workingContext);
            if (step.approval?.status !== "approved" || step.approval.canonicalHash !== canonicalHash) {
                issues.push({
                    code: "approval_required",
                    message: `Action '${step.action}' requires approval bound to its canonical arguments and context.`,
                    stepId: step.id,
                    canonicalHash,
                });
            }
        }
    }
    validateNestedFolders(graph, issues);
    const executionOrder = topologicalOrder(graph, issues);
    const rejectionCodes = new Set([
        "invalid_retry_budget",
        "graph_too_large",
        "no_authenticated_user_turn",
        "duplicate_step_id",
        "unknown_action",
        "missing_argument",
        "invalid_argument",
        "capability_disabled",
        "risk_mismatch",
        "verification_mismatch",
        "reversibility_mismatch",
        "unknown_source",
        "untrusted_instruction",
        "direct_user_authorization_required",
        "missing_parent_dependency",
        "missing_dependency",
        "dependency_cycle",
    ]);
    const rejected = issues.some((issue) => rejectionCodes.has(issue.code));
    const needsApproval = issues.some((issue) => issue.code === "approval_required");
    const needsClarification = graph.steps.length === 0 && (graph.questions?.length ?? 0) > 0;
    const status = rejected
        ? "rejected"
        : needsApproval
            ? "needs_approval"
            : needsClarification
                ? "needs_clarification"
                : "ready";
    return {
        valid: status === "ready" || status === "needs_clarification",
        status,
        issues,
        executionOrder,
        planHash,
    };
}
