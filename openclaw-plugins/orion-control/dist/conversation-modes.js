/*
 The trunk and its branches.

 Nick's picture, and it is the right one: Orion is the trunk. A mode is a big
 branch off it -- same tree, same roots, same identity, but its own shape. Main
 is the trunk speaking. Project is a branch with its own instructions, its own
 folder, and a bigger model behind it.

 WHAT A MODE MAY CHANGE

   tone and instructions   its own soul file, layered over SOUL.md, never
                           replacing it -- a branch is not a different tree
   which model answers     by naming a ROLE that already exists in
                           model-roles.seed.json
   which memory it leans   broad / focused / minimal
   which folder it works   see below, and read this part twice

 WHAT A MODE MAY NOT CHANGE

 Anything else. No capability, no tier, no approval, no strictness, no allowlist
 entry. `personalities.ts` makes that unrepresentable and its test proves it with
 the compiler; this file inherits the same discipline for the same reason.

 THE FOLDER IS THE DANGEROUS PART

 "Project mode gets its own folder" sounds like tone and is not: naming a
 directory is naming a CAPABILITY. If a mode could introduce a root, then a mode
 would be a way to grant filesystem access, and the entire personality invariant
 would have a door in it labelled something friendly.

 So `workspaceRootId` is not a path. It is the id of a root the capability
 system ALREADY grants, resolved elsewhere and refused if unknown. A mode can
 point at a room Orion may already enter. It cannot build one.
*/
import { PERSONALITIES } from "./personalities.js";
export const CONVERSATION_MODE_IDS = ["main", "project", "offline"];
export const CONVERSATION_MODES = {
    main: {
        id: "main",
        label: "Main",
        summary: "Orion as he is. The trunk.",
        personality: "main",
        automaticWhenOffline: false,
    },
    project: {
        id: "project",
        label: "Project",
        summary: "A branch with its own instructions, its own folder and a bigger model — for sustained " +
            "work on one thing rather than a conversation.",
        personality: "research",
        modelRole: "reasoning",
        soulOverlay: "modes/project/SOUL.md",
        workspaceRootId: "brain",
        automaticWhenOffline: false,
    },
    offline: {
        id: "offline",
        label: "Offline",
        summary: "No network. A local model answers, nothing leaves the machine, and Orion says plainly " +
            "when a question needs something he cannot reach.",
        personality: "main",
        modelRole: "local",
        automaticWhenOffline: true,
    },
};
export class UnknownWorkspaceRootError extends Error {
    constructor(modeId, rootId) {
        super(`conversation mode "${modeId}" names workspace root "${rootId}", which the capability ` +
            `system does not grant. A mode may point at a root that already exists; it may not ` +
            `introduce one. Add the root through the catalog, or drop it from the mode.`);
        this.name = "UnknownWorkspaceRootError";
    }
}
/**
 * Resolve a mode against the roots that actually exist.
 *
 * `grantedRootIds` is passed in rather than imported so this file cannot be the
 * place someone quietly adds one.
 */
export function resolveMode(id, grantedRootIds) {
    const mode = CONVERSATION_MODES[id];
    if (mode.workspaceRootId && !grantedRootIds.includes(mode.workspaceRootId)) {
        throw new UnknownWorkspaceRootError(mode.id, mode.workspaceRootId);
    }
    return { mode, personality: PERSONALITIES[mode.personality] };
}
/** The mode to switch to when the network disappears mid-conversation. */
export function modeForConnectivity(current, online) {
    if (online) {
        if (current !== "offline")
            return { id: current, changed: false, reason: "" };
        return {
            id: "main",
            changed: true,
            reason: "the network is back, so Orion is out of offline mode",
        };
    }
    if (current === "offline")
        return { id: current, changed: false, reason: "" };
    return {
        id: "offline",
        changed: true,
        // Said out loud rather than done silently: an assistant that quietly becomes
        // a smaller model is one whose answers get worse for no visible reason.
        reason: "no network, so a local model is answering — this will be less sharp, and it is why",
    };
}
