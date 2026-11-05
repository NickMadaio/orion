/** The scheduler's argv in a plain `orion-reschedule <verb> …` command (quotes only, no shell), or undefined for anything else. */
export declare function schedulerArgs(command: string): string[] | undefined;
/** The refusal in a dry run's output, as one plain sentence; undefined when it did not refuse (so the real command runs). */
export declare function refusalOf(stdout: string, code: number): string | undefined;
