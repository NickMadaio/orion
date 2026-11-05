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
