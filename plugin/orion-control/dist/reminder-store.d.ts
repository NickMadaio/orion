import { type Reminder } from "./ambient.js";
/** A fired one-off stays this long so "done" and "snooze" still find it (same number as the script side). */
export declare const KEEP_FIRED_MS: number;
export declare function withReminderLock<T>(file: string, fn: () => Promise<T>): Promise<T>;
/** Read, change (return the new list, or undefined for no change) and write back, under the lock. */
export declare function updateReminders(file: string, fn: (list: Reminder[]) => Reminder[] | undefined): Promise<Reminder[]>;
/** The reminder most recently delivered (or snoozed) in the last three hours: what "done" and "snooze" mean. */
export declare function latestFired(list: Reminder[], now: Date | number): Reminder | null;
export type SnoozeResult = {
    ok: true;
    reminder: Reminder;
    dueAt: number;
} | {
    ok: false;
    reason: string;
};
export declare function snoozeReminder(file: string, key: string, minutes: number, now?: Date): Promise<SnoozeResult>;
export type DoneResult = {
    ok: true;
    reminder: Reminder;
    recurring: boolean;
} | {
    ok: false;
    reason: string;
};
export declare function doneReminder(file: string, key: string, now?: Date): Promise<DoneResult>;
