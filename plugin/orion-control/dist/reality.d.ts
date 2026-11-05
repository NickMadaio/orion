import type { Day, FlowResult } from "./schedule-flow.js";
import { type DayEdit } from "./day-edit.js";
import { type DayRequest } from "./day-requests.js";
import type { DeadlineRead } from "./deadline-read.js";
export type Reality = {
    kind: "no-classes";
    names: string[];
    keep?: string;
    tomorrow: boolean;
    fill: boolean;
} | {
    kind: "missed";
    what: string;
} | {
    kind: "instead";
    did: string;
    planned?: string;
    past: boolean;
} | {
    kind: "ate";
} | {
    kind: "place";
    place: string;
}
/** "marketing is running over lol" (rea-class-late-v): what comes after it moves back, by his minutes or a stated guess. */
 | {
    kind: "overrun";
    what: string;
    minutes?: number;
    guess?: number;
}
/** "gym done, was 5:30 to 7", "just got back from the gym", "took a nap lol", "i slept from 2 to 3:30pm" (2026-10-31 gate, cluster 3). */
 | {
    kind: "done";
    what: string;
    from?: string;
    to?: string;
    fill: boolean;
}
/** "i was literally in marketing", "you said i missed marketing but i was there, fix it": the missed mark is taken back. */
 | {
    kind: "attended";
    what: string;
}
/** A calendar request code carries out itself (day-requests.ts): a deadline, a combination, tomorrow, "X then Y", clear my own blocks. */
 | {
    kind: "request";
    request: DayRequest;
}
/** w20 sched (day-edit.ts): one or more edits to his day, including time already gone: logged, never refused. */
 | {
    kind: "edit";
    edit: DayEdit;
};
/** A reality statement plus whether he also asked for another change in the same breath ("..., put catch-up on it tomorrow"). */
export type RealityRead = {
    reality: Reality;
    rest: boolean;
};
export type ScriptRun = (script: "orion-declare" | "orion-reschedule" | "orion-tasks" | "orion-sleepplan", args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type RealityDeps = {
    run: ScriptRun;
    readDay: () => Promise<Day | undefined>;
    now: Date;
    source: string;
    text: string;
    /** Another day, by orion-reschedule's --date words ("tomorrow", a weekday, YYYY-MM-DD). Unset: only today is read. */
    readDayOn?: (dateArgs: string[]) => Promise<Day | undefined>;
    /** How many times this kind or title slipped in the last 7 days (the state card), for "that's the fourth gym skip this week". */
    slipsOf?: (what: string) => number;
    /** Wave 6: ORION's state dir (day-requests.ts reads how often a deferred plan already slid). */
    stateDir?: string;
    /** His deadlines, for what freed class time is spent on (freed-class-time.ts). */
    readDeadlines?: () => Promise<DeadlineRead | null | undefined>;
};
/** What a reality turn did: the reply, the declared fact ids and how many calendar writes (each is one orion-reschedule undo). */
export type RealityOutcome = {
    flow: FlowResult;
    facts: string[];
    writes: number;
};
export declare const TAKING_GUESS_MIN = 45;
/** He told ORION something that happened (or is happening), not asked for a change. Null when it is not one. */
export declare function readReality(message: string, now?: Date): RealityRead | null;
/** "macro" names "ECON1115" and "ECON1115 Principles of Macroeconomics", "marketing" names "MKTG2201". */
export declare function names(word: string, title: string): boolean;
/** "MKTG2201" for "MKTG2201 Introduction to Marketing — Lecture", the title otherwise. */
export declare const shortTitle: (title: string) => string;
export declare const REALITY_SAVE_FAILED = "I couldn't save that just now, so nothing changed. Say go and I'll retry it.";
export declare const OVERRUN_GUESS_MIN = 15;
/** Carries out what he said, with no model. Null: the words were not a reality statement after all (the turn goes on). */
export declare function runReality(read: RealityRead, deps: RealityDeps & {
    next?: string;
}): Promise<RealityOutcome | null>;
/** Only the fact, for a statement that also asks for another change ("i skipped marketing, put catch-up tomorrow"): the change goes on as usual. */
export declare function declareOnly(read: RealityRead, deps: RealityDeps): Promise<string | null>;
/** "undo" right after a reality turn: every calendar write it made comes back, and the facts it declared are taken back. */
export declare function undoReality(last: {
    facts: string[];
    writes: number;
}, run: ScriptRun): Promise<FlowResult>;
