export declare const TASK_RUN_ID = "openclaw:orion-control:orion_task_run";
/** The wrapper form the worker must use, with the exact arguments (a JSON object string). */
export declare const taskRunCall: (args: string) => string;
/** The one-line instruction for the context and retry messages. */
export declare const taskRunNow: (args: string) => string;
type Rec = Record<string, unknown>;
/** The orion_task_run arguments in a tool call: direct, or inside the tool_call wrapper. Otherwise null. */
export declare function taskRunArgs(toolName: string, params: unknown): {
    args: Rec;
    via: "direct" | "tool_call";
} | null;
/** Steps of a call, flat ({action, ...arguments}), however the worker wrote them (string, graph, nested arguments). */
export declare function stepsOf(args: Rec): Rec[] | null;
export type Expected = {
    action: string;
    args: string;
};
/** A worker call to the directive's action whose arguments differ: the code-built ones win. */
export declare function guardTaskRun(toolName: string, params: unknown, expected: Expected): {
    params: Rec;
} | {
    block: true;
    blockReason: string;
} | undefined;
/** Whether a recorded call is a real orion_task_run call for this action: a "not found" or error result is not one. */
export declare function madeTaskRunCall(t: {
    canonical: string;
    stdout?: string;
}, action: string): boolean;
export {};
