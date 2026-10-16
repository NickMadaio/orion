import { hasShellOperator } from "./shell-operators.js";
export { hasShellOperator };
export declare const SCRIPTS_DIR = "/Users/nickmadaio/Desktop/ORION/scripts";
export interface GuardDeps {
    /** Names of the files in scripts/ (injected in tests). */
    scriptNames: () => readonly string[];
}
export type GuardResult = {
    block: true;
    blockReason: string;
} | {
    params: Record<string, unknown>;
} | undefined;
/** The before_tool_call guards for exec and the tool_call wrapper. Undefined means "no opinion". */
export declare function guardToolCall(toolName: string, params: unknown, deps?: GuardDeps): GuardResult;
/**
 * Tool calls one run may make before it must answer. Runs that kept varying their calls (the repeat guard
 * only catches identical ones) hit the ~300 s ollama timeout with no reply at all (324425f4, a4488a26,
 * 50d66cdf, 2026-10-16). Eight is more than any real turn in the sweep needed.
 */
export declare const TOOL_BUDGET = 8;
export declare class ToolBudget {
    private readonly runs;
    private anon;
    /** Counts one call (once per toolCallId) and returns a block when the run is over budget. */
    take(runKey: string, toolCallId?: string): {
        block: true;
        blockReason: string;
    } | undefined;
    end(runKey: string): void;
    size(): number;
}
