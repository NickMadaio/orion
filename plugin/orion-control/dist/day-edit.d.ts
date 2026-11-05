import { type Said } from "./intent-time.js";
export type DayRef = "today" | "tomorrow" | "yesterday";
export type Span = {
    a: Said;
    b: Said;
};
export type EditPart = {
    op: "add";
    name: string;
    day: DayRef;
    span?: Span;
    at?: Said;
    after?: string;
    minutes?: number;
} | {
    op: "log";
    name: string;
    day: DayRef;
    span?: Span;
    minutes?: number;
} | {
    op: "move";
    name: string;
    day: DayRef;
    to: Said;
} | {
    op: "drop";
    name: string;
    day: DayRef;
}
/** "everything after my nap should be dropped", "clear everything after 6:30": every movable block from that block's end (or that clock) on. */
 | {
    op: "dropafter";
    day: DayRef;
    name?: string;
    at?: Said;
} | {
    op: "didnt";
    name: string;
    day: DayRef;
    did?: string;
    span?: Span;
}
/** "i did dinner at 7 not 6 earlier": the block (said at `was`) really happened at `at`, length kept. evening: it is the small hours and "earlier" means last evening. */
 | {
    op: "correct";
    name: string;
    day: DayRef;
    at: Said;
    was: Said;
    evening?: boolean;
}
/** "push the learning plan back an hour": by minutes, later (+) or earlier (-). */
 | {
    op: "shift";
    name: string;
    day: DayRef;
    minutes: number;
}
/** "make the mum call 45 mins": a block's total length. */
 | {
    op: "resize";
    name: string;
    day: DayRef;
    minutes: number;
}
/** scope: bedtime-read.ts's reading of the clause ("change my bedtime to 11:30" is every night, "push it to 12" is tonight). */
 | {
    op: "bedtime";
    to: Said;
    scope?: "tonight" | "always";
}
/** "i went to bed at 2 last night": what happened, noted as a fact (orion-declare), not a change. */
 | {
    op: "slept";
    text: string;
} | {
    op: "busy";
    until: Said;
}
/** "wake me at 6": the alarm's, run through orion-wake (day-edit-run.ts), never a block on the calendar. */
 | {
    op: "wake";
    time: string;
}
/** "ate at 4": his food log's, handed on whole. */
 | {
    op: "food";
    text: string;
}
/** "i want six hours of sleep": a bedtime counted back from his alarm. */
 | {
    op: "sleephours";
    hours: number;
} | {
    op: "note";
    text: string;
};
export type DayEdit = {
    parts: EditPart[];
};
/** The edits in a message, or null when it is not one (or an action clause in it cannot be read whole). */
export declare function readDayEdit(message: string, now: Date): DayEdit | null;
/** Whether any part is about time that has already gone: his own log of the day. Only clocks he made exact (am/pm, 24-hour) count, so a bare "at 6" late at night is never read as a log. */
export declare function touchesPast(edit: DayEdit, now: Date): boolean;
