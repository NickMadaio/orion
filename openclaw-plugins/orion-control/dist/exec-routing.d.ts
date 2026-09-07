export interface ExecRoute {
    /** What was wrong, and the route that works. Read aloud by the model. */
    reason: string;
}
/**
 * Returns a route when `command` is certain to be refused, otherwise undefined.
 *
 * Order matters: the most specific diagnosis wins, because "you used a pipe" is
 * true of the memory-grep case too and is the less useful of the two things to
 * be told.
 */
export declare function routeForDoomedExec(command: string): ExecRoute | undefined;
