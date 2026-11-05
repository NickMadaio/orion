import type { DayEdit } from "./day-edit.js";
export declare const rememberEdit: (edit: DayEdit, now: Date) => void;
export declare const recallEdit: (now: Date) => DayEdit | null;
export declare const forgetEdit: () => void;
/** "add marketing museum anyways don't worry if it already passed": the last edit again, or just the parts he names. */
export declare function readOverride(message: string, now: Date): DayEdit | null;
