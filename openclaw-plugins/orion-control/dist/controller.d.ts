import { type CapabilityTier } from "./catalog.js";
import { executeAction, verifyAction } from "./executors.js";
import type { TaskGraph, TaskRunRecord, TrustProvenance } from "./types.js";
export interface RunOptions {
    ledgerPath: string;
    testWorkspaceRoot?: string;
    scratchWorkspaceRoot?: string;
    desktopRoot?: string;
    enabledTiers?: ReadonlySet<CapabilityTier>;
    /** Harness-derived trust provenance recorded on the durable run record. */
    authorization?: TrustProvenance;
    /** Uniqueness source for the task id; defaults to a fresh UUID. */
    nonce?: string;
    now?: () => Date;
    execute?: typeof executeAction;
    verify?: typeof verifyAction;
}
export declare function runTaskGraph(graph: TaskGraph, options: RunOptions): Promise<TaskRunRecord>;
export declare function defaultLedgerPath(configured?: string): string;
