import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
export type NamedWrite = {
    kind: "named-write";
    op: "length" | "span";
    name: string;
    minutes?: number;
    from?: string;
    until?: string;
    day: "today" | "tomorrow";
    evening: boolean;
};
export type CalScript = (script: "orion-declare" | "orion-reschedule" | "orion-tasks", args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type CalDeps = {
    run: CalScript;
    readDay: () => Promise<Day | undefined>;
    readDayOn?: (dateArgs: string[]) => Promise<Day | undefined>;
    now: Date;
};
export type CalOutcome = {
    flow: FlowResult;
    facts: string[];
    writes: number;
};
/** Whether his name for a block is this title: every long word matches (a course's subject counts), and every short qualifier is there. */
export declare function namesTitle(name: string, title: string): boolean;
/** The block of his day he means: the same title first, then one still ahead (earliest), else the latest one that already ended. */
export declare function resolveNamed(name: string, day: Day | undefined, now: number): {
    block: DayBlock;
    over: boolean;
} | undefined;
/** A clear write on a block he names, or null. */
export declare function readNamedWrite(message: string): NamedWrite | null;
/** How long ago a start he said may be and still mean "now" (he typed it a few minutes late). */
export declare const LATE_START_GRACE = 20;
/** Carries a named write out with one scheduler call; the reply says where the block is now, read back from the calendar. */
export declare function runNamedWrite(r: NamedWrite, deps: CalDeps): Promise<CalOutcome>;
