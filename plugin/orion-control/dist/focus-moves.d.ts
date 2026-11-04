import type { Day, FlowResult } from "./schedule-flow.js";
import type { SessionExec } from "./session-flow.js";
import { type BreakMove } from "./break-intent.js";
import type { ScriptRun } from "./reality.js";
import type { DeadlineRead } from "./deadline-read.js";
export type FocusMove = {
    kind: "stall";
    minutes: number;
} | BreakMove | {
    kind: "extend";
    minutes: number;
} | {
    kind: "block";
} | {
    kind: "doomscroll";
    app: string;
    instead?: string;
    duty?: true;
} | {
    kind: "side-missed";
    label: string;
};
/** What the turn does: a fixed reply (flow), or a reminder the worker must set, plus what a "yes" next turn starts. */
export type FocusOutcome = {
    calls?: string[];
    outputs?: string[];
    flow?: FlowResult;
    reminder?: {
        args: string;
        say: string;
        action: "alarm_set";
        label: string;
        at: string;
    };
    pendingSession?: string;
    writes?: number;
};
/** The focus phrase in his message, or null. Never a request that also names a session start ("start a 25 min session…"). */
export declare function readFocusMove(message: string): FocusMove | null;
type Deps = {
    exec?: SessionExec;
    run?: ScriptRun;
    now: Date;
    task?: string; /** today's calendar (show --json), for the block he is in now */
    readDay?: () => Promise<Day | undefined>;
    /** Typed, or spoken and addressed to ORION: only then may a doomscroll start a session (room speech never does; work-start.ts). */
    mayStart?: boolean;
    /** The calendar's deadlines and dated to-dos, for the top study item when no block is current. */
    readDeadlines?: () => Promise<DeadlineRead | null | undefined>;
};
/** The study or work block on his calendar right now, with at least ten minutes left; never a class, gym, meal or rest. */
export declare function currentWorkBlock(day: Day | undefined, now: Date): {
    title: string;
    end: string;
} | undefined;
/** The nearest deadline or dated to-do from today on. */
export declare function topDeadline(due: DeadlineRead | null | undefined, now: Date): string | undefined;
/** Carries the move out and says only what the session or the scheduler shows. */
export declare function runFocusMove(move: FocusMove, deps: Deps): Promise<FocusOutcome>;
export {};
