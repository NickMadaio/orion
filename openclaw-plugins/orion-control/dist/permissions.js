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
const PROFILE_TIERS = {
    restricted_read_only: new Set(["simulation", "desktop_read"]),
    approved_root_edit: new Set([
        "simulation",
        "app_control",
        "desktop_read",
        "test_workspace",
        "scratch_workspace",
        "desktop_test_workspace",
        "desktop_modify",
        "desktop_direct_write",
        "scratch_direct_write",
    ]),
    broad_local_filesystem: new Set([
        "simulation",
        "app_control",
        "desktop_read",
        "test_workspace",
        "scratch_workspace",
        "desktop_test_workspace",
        "desktop_modify",
        "desktop_direct_write",
        "scratch_direct_write",
    ]),
    consequential_local: new Set([
        "simulation",
        "app_control",
        "desktop_read",
        "test_workspace",
        "scratch_workspace",
        "desktop_test_workspace",
        "desktop_modify",
        "desktop_direct_write",
        "scratch_direct_write",
    ]),
    external_connected: new Set([
        "simulation",
        "app_control",
        "desktop_read",
        "test_workspace",
        "scratch_workspace",
        "desktop_test_workspace",
        "desktop_modify",
        "desktop_direct_write",
        "scratch_direct_write",
    ]),
};
export const PROFILE_MATRIX = {
    restricted_read_only: {
        enabled: "Simulation and configured visible non-sensitive read/list/metadata actions.",
        separatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control.",
    },
    approved_root_edit: {
        enabled: "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards.",
        separatelyGated: "Delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control.",
    },
    broad_local_filesystem: {
        enabled: "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority.",
        separatelyGated: "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control.",
    },
    consequential_local: {
        enabled: "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed.",
        separatelyGated: "Every consequential action, OS permission, external/account action, credential, communication, browser/web/network, and elevated macOS control.",
    },
    external_connected: {
        enabled: "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.",
        separatelyGated: "Credentials, account connections, every delivery/communication, browser/web/network use, destructive actions, OS permissions, and elevated macOS control.",
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
