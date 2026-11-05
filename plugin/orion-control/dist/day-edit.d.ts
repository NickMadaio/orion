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
} | {
    op: "didnt";
    name: string;
    did?: string;
    span?: Span;
} | {
    op: "bedtime";
    to: Said;
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
