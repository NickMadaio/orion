import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { appendFile, chmod, lstat, mkdir, open, rename, } from "node:fs/promises";
import path from "node:path";
export const PERMISSION_PROFILES = [
    "restricted_read_only",
    "approved_root_edit",
    "broad_local_filesystem",
    "consequential_local",
    "external_connected",
];
/**
 * Reading, browsing, and media sit at `approved_root_edit`. The destructive
 * `file_mutate` tier deliberately does NOT: move, rename, and delete require
 * raising the profile to `consequential_local` on purpose, even though they
 * were explicitly asked for.
 */
const EDIT_TIERS = [
    "simulation",
    "app_control",
    "browser_control",
    "media_control",
    "desktop_read",
    "home_read",
    "test_workspace",
    "scratch_workspace",
    "desktop_test_workspace",
    "desktop_modify",
    "desktop_direct_write",
    "scratch_direct_write",
    // Telling the time, reporting the weather, and holding a timer. These change
    // nothing the user owns, so they sit at the same level as reading a folder
    // rather than behind the filesystem escalation.
    "ambient_info",
    "reminders",
    // Adjusting his own voice timing. Sits here rather than behind the
    // filesystem escalation because the only thing it can touch is Orion's own
    // preference domain, under a closed key list with range-checked values — the
    // worst case is that he mishears until told to set it back, and every change
    // records its own inverse in the ledger.
    "self_tuning",
    // Supplements and workouts. Writes one JSON file Orion owns; the worst case
    // is a wrong number in his own log, which he can be told to correct.
    "health_tracking",
    // Waiting-on items. Writes one JSON file Orion owns, same shape and same
    // blast radius as the health log: the worst case is a wrong entry in his own
    // list, which he can be told to correct.
    "waiting_on",
    // Prep cards fan out across mail and the brain, all of it read-only and none
    // of it written back. Sits with the reads for that reason.
    "prep",
    // Search/read plus user-requested note creation and conflict-safe updates in
    // Atlas. No delete operation and no arbitrary file path is expressible.
    "atlas_notes",
    // Trips are notes about bookings other people made, assembled from reads.
    // Sits with the reads for the same reason prep does.
    "travel",
    // Reading his iMessage history. A read of his own machine, so it sits with
    // the other reads rather than behind the filesystem escalation -- but under
    // its own tier and its own config flag, because "read my home directory" and
    // "read every conversation I have had" deserve separate answers.
    //
    // `messages_send` is deliberately NOT here. See PROFILE_TIERS below.
    "messages_read",
];
const PROFILE_TIERS = {
    // Even the most restricted profile can answer "what time is it" and "what is
    // it like outside". Refusing those would not be caution, it would be theatre:
    // nothing is read from the user's machine and nothing is changed.
    restricted_read_only: new Set(["simulation", "desktop_read", "ambient_info"]),
    approved_root_edit: new Set(EDIT_TIERS),
    broad_local_filesystem: new Set(EDIT_TIERS),
    // Self-modification sits ONLY here and above, and is listed explicitly
    // rather than folded into EDIT_TIERS. It is not a filesystem operation and
    // must never arrive as a side effect of widening filesystem access.
    consequential_local: new Set([
        ...EDIT_TIERS,
        "file_mutate",
        "self_modification",
        // The three repair surfaces sit exactly where `self_modification` sits, and
        // are listed one by one for the same reason it is: none of them is a
        // filesystem operation, and none of them may arrive as a side effect of
        // widening filesystem access. `self_config` is here rather than lower even
        // though most of what it changes is a timeout, because the same tier also
        // carries the authority half — and that half must never be reachable from a
        // profile that promises under `separatelyGated` that permissions are not
        // included.
        "self_plugin",
        "self_scripts",
        "self_config",
        "calendar",
        // PHASE 51. Structured git/test/build operations. Here and not lower, and
        // listed by name rather than folded into EDIT_TIERS, for the reason
        // `self_modification` is: running a repository's build executes code out of
        // that repository, which is not a filesystem operation and must not arrive
        // as a side effect of widening filesystem access.
        "dev_operations",
        // Proposing an automation is not a filesystem operation and must not
        // arrive as a side effect of widening one, same as its neighbours here.
        // The half that installs is not in this catalog at all.
        "automation",
    ]),
    // The first profile that grants something no lower profile can reach.
    //
    // Until now `external_connected` was `consequential_local` spelled
    // differently -- same tier set, no behavioural difference, a rung on the
    // ladder with nothing on it. `messages_send` gives it its meaning, and the
    // placement is not a judgement call: every profile below promises under
    // `separatelyGated` that communications are not included, and sending a text
    // as Nick is a communication by any reading.
    //
    // Listed explicitly rather than added to EDIT_TIERS for the same reason
    // `self_modification` is: it must never arrive as a side effect of widening
    // something else.
    external_connected: new Set([
        ...EDIT_TIERS,
        "file_mutate",
        "self_modification",
        "self_plugin",
        "self_scripts",
        "self_config",
        "calendar",
        "dev_operations",
        "automation",
        "messages_send",
        // PHASE 53/54/55. "Elevated macOS control" is the one thing every
        // profile above promises under `separatelyGated`, in the same sentence
        // even at this, the top profile — so it is listed explicitly here for
        // the same reason `messages_send` is, and gated the same way: its own
        // config flags (`enableComputerObserveActions`,
        // `enableComputerControlActions`), both default OFF, ANDed with profile
        // membership by `configuredTiers`/`intersectTiers` in index.ts. Reaching
        // `computer_control` additionally requires, per action, a human
        // approval no strictness mode can waive — see `computerControlAction`
        // in catalog.ts.
        "computer_observe",
        "computer_control",
        // PHASE 52. Its own flag (`enableRawTerminalActions`, default OFF) AND
        // this profile, and a person's approval for every command -- or for this
        // chat, which Nick asked for on 2026-09-25: "allow this once, allow for
        // this chat, etc".
        "raw_terminal",
    ]),
};
export const PROFILE_MATRIX = {
    restricted_read_only: {
        enabled: "Simulation and configured visible non-sensitive read/list/metadata actions.",
        separatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control.",
    },
    approved_root_edit: {
        enabled: "Direct-user-authorized create/update within configured approved roots; opening or gracefully quitting an explicitly named installed app; when separately enabled in config, http/https browser tab control and page reads, media and volume control, and read-only listing/metadata/text reads inside the home directory.",
        separatelyGated: "Delete, move/rename, bulk operations, any home-directory write, permissions, external/account actions, credentials, communications, network requests outside a browser tab, and elevated macOS control.",
    },
    broad_local_filesystem: {
        enabled: "Only catalog actions for separately configured local roots, plus everything approved_root_edit allows; selecting this profile does not create new roots or grant home-directory writes.",
        separatelyGated: "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, network requests outside a browser tab, and elevated macOS control.",
    },
    consequential_local: {
        enabled: "Everything broad_local_filesystem allows, plus direct-user-authorized move, rename, and delete-to-Trash inside configured mutable roots; typed Apple Calendar and Reminders changes; and repairing Orion himself — his Swift source, his plugin, his wrapper scripts and a closed table of behaviour settings. Destructive actions require confirmation, and repair actions are built, tested, health-checked and rolled back automatically if they fail.",
        separatelyGated: "Permanent deletion, mutations outside configured roots or anywhere in the home directory, bulk operations, OS permissions, external/account actions, credentials, communications, elevated macOS control, and every change to what Orion is permitted to do — which requires that you name it yourself and approve it.",
    },
    external_connected: {
        enabled: "Everything consequential_local allows, plus separately configured and separately approved external actions — currently sending one iMessage/SMS to one recipient Nick named himself, each send requiring approval bound to that exact recipient and message; and, when separately enabled in config, reading the screen (the accessibility tree first, a screenshot only as a fallback, both refusing entirely for a denylisted app or window) and, separately again, clicking, typing or pressing a key, each requiring approval bound to the exact arguments and the live frontmost app.",
        separatelyGated: "Credentials, account connections, every other delivery/communication channel, network use outside a browser tab, permanent deletion, and OS permissions themselves.",
    },
};
function stable(value) {
    if (Array.isArray(value))
        return `[${value.map(stable).join(",")}]`;
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
function digest(value) {
    return createHash("sha256").update(stable(value)).digest("hex");
}
export function profileAllowedTiers(profile) {
    return PROFILE_TIERS[profile];
}
export async function readPermissionState(statePath) {
    try {
        const stats = await lstat(statePath);
        if (!stats.isFile() || stats.isSymbolicLink()) {
            throw new Error("Permission state path is not a regular file.");
        }
        const handle = await open(statePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            const parsed = JSON.parse(await handle.readFile("utf8"));
            if (!PERMISSION_PROFILES.includes(parsed.profile) ||
                !Number.isInteger(parsed.version) ||
                parsed.version < 0) {
                throw new Error("Permission state is invalid.");
            }
            return parsed;
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        return {
            profile: "restricted_read_only",
            version: 0,
            updatedAt: new Date(0).toISOString(),
        };
    }
}
function delta(current, requested) {
    const currentIndex = PERMISSION_PROFILES.indexOf(current);
    const requestedIndex = PERMISSION_PROFILES.indexOf(requested);
    return {
        direction: requestedIndex > currentIndex
            ? "raise"
            : requestedIndex < currentIndex
                ? "lower"
                : "same",
        from: current,
        to: requested,
        added: requestedIndex > currentIndex
            ? [PROFILE_MATRIX[requested].enabled]
            : [],
        removed: requestedIndex < currentIndex
            ? [PROFILE_MATRIX[current].enabled]
            : [],
        remainsSeparatelyGated: PROFILE_MATRIX[requested].separatelyGated,
    };
}
async function writeState(statePath, state) {
    const directory = path.dirname(statePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.permission-${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
        await handle.writeFile(JSON.stringify(state), "utf8");
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await rename(temporary, statePath);
    await chmod(statePath, 0o600);
}
async function appendAudit(auditPath, record) {
    await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
    await appendFile(auditPath, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    await chmod(auditPath, 0o600);
}
/**
 * Serialize profile changes. Read-check-write was previously racy: two calls
 * carrying the same `expectedVersion` could both pass the optimistic check and
 * both write, so the recorded version could disagree with the change count.
 */
const changeQueue = new Map();
function withStateLock(statePath, work) {
    const previous = changeQueue.get(statePath) ?? Promise.resolve();
    const next = previous.then(work, work);
    changeQueue.set(statePath, next.then(() => undefined, () => undefined));
    return next;
}
export async function changePermissionProfile(request, options) {
    return withStateLock(options.statePath, () => applyPermissionChange(request, options));
}
async function applyPermissionChange(request, options) {
    const current = await readPermissionState(options.statePath);
    const change = delta(current.profile, request.requestedProfile);
    if (request.request.kind !== "instruction" ||
        request.request.trust !== "trusted_user" ||
        !request.request.content.includes(request.requestedProfile) ||
        !/\b(profile|permission|level)\b/i.test(request.request.content) ||
        request.context.trim().length === 0) {
        return {
            status: "rejected",
            reason: "An explicit trusted_user instruction must name the requested profile and permission context.",
            current,
            delta: change,
        };
    }
    if (request.expectedVersion !== current.version) {
        return {
            status: "stale",
            reason: "Permission profile version changed; request must be reviewed again.",
            current,
            delta: change,
        };
    }
    const canonicalHash = digest({
        requestedProfile: request.requestedProfile,
        expectedVersion: request.expectedVersion,
        context: request.context,
        from: current.profile,
        delta: change,
    });
    if (change.direction === "raise" && request.approvalHash !== canonicalHash) {
        return {
            status: "needs_approval",
            current,
            delta: change,
            canonicalHash,
        };
    }
    if (change.direction === "same") {
        return {
            status: "unchanged",
            current,
            delta: change,
            canonicalHash,
        };
    }
    const now = (options.now ?? (() => new Date()))().toISOString();
    const next = {
        profile: request.requestedProfile,
        version: current.version + 1,
        updatedAt: now,
    };
    // Audit first: a failed audit write must abort the change rather than leave
    // an unaudited profile in place.
    await appendAudit(options.auditPath, {
        changedAt: now,
        previous: current,
        next,
        context: request.context,
        requestHash: digest(request.request),
        canonicalHash,
        delta: change,
    });
    try {
        await writeState(options.statePath, next);
    }
    catch (error) {
        await appendAudit(options.auditPath, {
            changedAt: now,
            previous: current,
            attempted: next,
            context: request.context,
            canonicalHash,
            outcome: "state_write_failed",
            error: error instanceof Error ? error.message : "unknown error",
        }).catch(() => undefined);
        throw error;
    }
    return {
        status: "changed",
        current: next,
        previous: current,
        delta: change,
        canonicalHash,
    };
}
