import type { DayEdit } from "./day-edit.js";
export declare const rememberEdit: (edit: DayEdit, now: Date) => void;
export declare const recallEdit: (now: Date) => DayEdit | null;
export declare const forgetEdit: () => void;
/** Everything remembered, for tests. */
export declare const resetDayEditMemory: () => void;
/** "Undo. I meant add those to the schedule": the last edit comes back off, then the ask before it is read as the schedule. */
export declare const isUndoThen: (message: string) => boolean;
/** What he last asked (any message that is not itself an undo), for "those" in an undo-then. */
export declare const rememberAsk: (text: string, now: Date) => void;
export declare const recallAsk: (now: Date) => string | null;
/** The writes the last day edit made, so an undo takes back exactly those. */
export declare const rememberRun: (writes: number, facts: string[], now: Date) => void;
export declare const recallRun: (now: Date) => {
    writes: number;
    facts: string[];
} | null;
/** "add marketing museum anyways don't worry if it already passed": the part(s) that were refused, or just the ones he names. */
export declare function readOverride(message: string, now: Date): DayEdit | null;
