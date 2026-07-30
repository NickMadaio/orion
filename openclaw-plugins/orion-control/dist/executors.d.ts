import type { ActionDefinition, ControlledRoot } from "./catalog.js";
import type { TaskStep } from "./types.js";
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
}
export interface ExecutionResult {
    mode: "simulated" | "created" | "appended" | "replaced" | "opened" | "quit" | "already_present" | "observed";
    idempotencyKey: string;
    target?: string;
    output?: unknown;
}
export interface VerificationResult {
    observed: boolean;
    evidence?: string;
}
export declare class ActionExecutionError extends Error {
    readonly retryable: boolean;
    constructor(message: string, retryable?: boolean);
}
export declare function executeAction(definition: ActionDefinition, step: TaskStep, context: ExecutionContext): Promise<ExecutionResult>;
export declare function verifyAction(definition: ActionDefinition, step: TaskStep, execution: ExecutionResult, context: ExecutionContext): Promise<VerificationResult>;
