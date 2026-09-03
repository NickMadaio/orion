import { type CapabilityTier } from "./catalog.js";
import { executeAction, verifyAction } from "./executors.js";
import type { TaskGraph, TaskRunRecord, TrustProvenance } from "./types.js";
export interface RunOptions {
    ledgerPath: string;
    testWorkspaceRoot?: string;
    scratchWorkspaceRoot?: string;
    desktopRoot?: string;
    /** Read-only root for the `home_read` tier. */
    homeRoot?: string;
    /** Overridable for tests; defaults to the user's ~/.Trash. */
    trashRoot?: string;
    /** Configured browser for the `browser_control` tier. */
    browserPreference?: string;
    /** Reject arguments an action does not accept. Default off; see PHASE_4_PLAN.md. */
    strictArguments?: boolean;
    remindersPath?: string;
    /** Shared supplement/workout store, also read by the Orion dashboard. */
    healthLogPath?: string;
    defaultLocation?: string;
    enabledTiers?: ReadonlySet<CapabilityTier>;
    /** Harness-derived trust provenance recorded on the durable run record. */
    authorization?: TrustProvenance;
    /** Paths Orion already wrote under an authenticated turn (see provenance). */
    isSelfAuthored?: (candidate: string) => boolean;
    /**
     * Which canonical hashes a person has approved.
     *
     * Threaded through to the AUTHORITATIVE validation below rather than only to
     * the entry point's evidence copy. That distinction has bitten this file
     * before -- see the note on `strictArguments`: a gate wired only into the
     * copy looks live in the record and changes nothing about what runs.
     */
    approvalGrants?: (canonicalHash: string) => boolean;
    /**
     * Called with the resolved target of every step that executed AND verified.
     *
     * Placed after verification on purpose: an attempted write that failed or
     * could not be observed does not earn the file a place in the registry.
     */
    onArtifact?: (target: string) => void;
    /** Uniqueness source for the task id; defaults to a fresh UUID. */
    nonce?: string;
    now?: () => Date;
    execute?: typeof executeAction;
    verify?: typeof verifyAction;
}
export declare function runTaskGraph(graph: TaskGraph, options: RunOptions): Promise<TaskRunRecord>;
export declare function defaultLedgerPath(configured?: string): string;
