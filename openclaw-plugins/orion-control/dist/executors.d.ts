import type { ActionDefinition, ControlledRoot, SupportedBrowser } from "./catalog.js";
import type { TaskStep, UndoRecord } from "./types.js";
export interface ExecutionContext {
    roots: Record<ControlledRoot, string>;
    workingContext?: string;
    simulatedState: Map<string, unknown>;
    /**
     * Run-scoped idempotency memo: idempotencyKey -> hash of the bytes a prior
     * attempt in this same run already committed. Lets a retry after a failed
     * verification recognise its own completed write instead of appending twice.
     */
    writeMemo?: Map<string, string>;
    /**
     * The authenticated user text for this run.
     *
     * Used ONLY to add refusals the validator cannot make without touching the
     * filesystem — currently "this directory is not empty, so your own words must
     * name it". It never grants anything: authorization has already happened in
     * the validator before any executor runs.
     */
    trustedInstruction?: string;
    /** Overridable for tests; defaults to the user's ~/.Trash. */
    trashRoot?: string;
    /** Configured browser preference; otherwise auto-detected. */
    browserPreference?: string;
    /** Where timers and alarms live. Overridable for tests. */
    remindersPath?: string;
    /** Default place for weather when the user did not name one. */
    defaultLocation?: string;
}
export interface ExecutionResult {
    mode: "simulated" | "created" | "appended" | "replaced" | "opened" | "quit" | "already_present" | "observed" | "controlled" | "moved" | "trashed" | "scheduled" | "cancelled";
    idempotencyKey: string;
    target?: string;
    output?: unknown;
    /** The exact inverse operation, recorded in the ledger. */
    undo?: UndoRecord;
}
export interface VerificationResult {
    observed: boolean;
    evidence?: string;
}
export declare class ActionExecutionError extends Error {
    readonly retryable: boolean;
    constructor(message: string, retryable?: boolean);
}
type BrowserEngine = "chromium" | "safari";
export interface ResolvedBrowser {
    name: SupportedBrowser;
    bundleId: string;
    engine: BrowserEngine;
    path: string;
}
export interface BrowserTab {
    windowIndex: number;
    tabIndex: number;
    active: boolean;
    url: string;
    title: string;
}
export declare function executeAction(definition: ActionDefinition, step: TaskStep, context: ExecutionContext): Promise<ExecutionResult>;
export declare function verifyAction(definition: ActionDefinition, step: TaskStep, execution: ExecutionResult, context: ExecutionContext): Promise<VerificationResult>;
export {};
