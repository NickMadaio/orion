import { type PersonalityId, type PersonalityProfile } from "./personalities.js";
import type { ModelRole } from "./conversation-routing.js";
export declare const CONVERSATION_MODE_IDS: readonly ["main", "project", "offline"];
export type ConversationModeId = (typeof CONVERSATION_MODE_IDS)[number];
export interface ConversationMode {
    readonly id: ConversationModeId;
    readonly label: string;
    /** One line for the UI. What this mode is FOR, in Nick's terms. */
    readonly summary: string;
    readonly personality: PersonalityId;
    /** Overrides the personality's lean. A role name, never a model id. */
    readonly modelRole?: ModelRole;
    /**
     * A file layered OVER SOUL.md, never replacing it. Relative to the workspace,
     * so a mode cannot reach outside it to pick up instructions.
     */
    readonly soulOverlay?: string;
    /**
     * The id of an ALREADY-GRANTED capability root. Not a path. See the header.
     */
    readonly workspaceRootId?: string;
    /** Chosen automatically when the network is gone, rather than by Nick. */
    readonly automaticWhenOffline: boolean;
}
export declare const CONVERSATION_MODES: Readonly<Record<ConversationModeId, ConversationMode>>;
export declare class UnknownWorkspaceRootError extends Error {
    constructor(modeId: string, rootId: string);
}
/**
 * Resolve a mode against the roots that actually exist.
 *
 * `grantedRootIds` is passed in rather than imported so this file cannot be the
 * place someone quietly adds one.
 */
export declare function resolveMode(id: ConversationModeId, grantedRootIds: readonly string[]): {
    mode: ConversationMode;
    personality: PersonalityProfile;
};
/** The mode to switch to when the network disappears mid-conversation. */
export declare function modeForConnectivity(current: ConversationModeId, online: boolean): {
    id: ConversationModeId;
    changed: boolean;
    reason: string;
};
