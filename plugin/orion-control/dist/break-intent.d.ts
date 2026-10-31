import type { FlowResult } from "./schedule-flow.js";
import type { SessionExec } from "./session-flow.js";
export type BreakMove = {
    kind: "break";
    minutes: number;
    work: number;
    restart: boolean;
    assumed: boolean;
};
export type BreakOutcome = {
    flow?: FlowResult;
    reminder?: {
        args: string;
        say: string;
        action: "alarm_set";
        label: string;
        at: string;
    };
    /** The session calls made before a reminder the worker sets (recorded as this turn's tool calls). */
    calls?: string[];
    outputs?: string[];
    writes?: number;
};
/** A request to rest, or null. Never a question about a break, a refusal, or a meal. */
export declare function readBreak(message: string): BreakMove | null;
/** Carries a break out and says only what orion-session returned. Never starts a session unless he asked for the restart. */
export declare function runBreak(move: BreakMove, deps: {
    exec: SessionExec;
    now: Date;
    task?: string;
}): Promise<BreakOutcome>;
