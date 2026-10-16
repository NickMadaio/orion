export interface ExecRoute {
    /** What was wrong, and the route that works. Read aloud by the model. */
    reason: string;
}
/** Catalog action names. These belong inside `orion_task_run`, not the shell. */
export declare const TYPED_ACTIONS: RegExp;
/** Host tool ids. Calling one as a shell program never works. */
export declare const TOOL_IDS: Set<string>;
/** Why a command with a live shell operator is refused. */
export declare const OPERATOR_REASON: string;
/**
 * Returns a route when `command` is certain to be refused, otherwise undefined.
 *
 * Order matters: the most specific diagnosis wins, because "you used a pipe" is
 * true of the memory-grep case too and is the less useful of the two things to
 * be told.
 */
export declare function routeForDoomedExec(command: string): ExecRoute | undefined;
