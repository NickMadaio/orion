import type { Day } from "./schedule-flow.js";
export type SaidStep = {
    args: string[];
    said: string;
};
/** Where the block titled `title` sits after the write: the re-read day first, else the scheduler's "planned" line. */
export declare function bookedSpan(title: string, stdout: string, day: Day | undefined): {
    start: string;
    end: string;
} | undefined;
/** The clause for one step that wrote, true to the calendar. Falls back to the planned wording only when nothing says otherwise. */
export declare function spokenAfterWrite(step: SaidStep, stdout: string, day: Day | undefined): string;
