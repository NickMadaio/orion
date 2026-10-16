export type StoredReminder = {
    id: string;
    label: string;
    dueAt: number;
};
export type Extracted = {
    time: string | null;
    label: string;
} | null;
/** What the reminder turn is: a fixed reply (no tool), or one orion_task_run call for the worker to make. */
export type ReminderPlan = {
    kind: "say";
    text: string;
    pending?: boolean;
    askLabel?: boolean;
} | {
    kind: "call";
    args: string;
    reply: string;
    action: "alarm_set" | "reminder_cancel";
    label?: string;
    at?: string;
};
export type ReminderInput = {
    message: string;
    now: Date;
    extract: (message: string) => Promise<Extracted>;
    list: () => Promise<StoredReminder[]>;
    /** The reminder this session set last (for "make it 5:30"), if recent. */
    last?: {
        label: string;
        at: string;
    };
};
/** A correction names no new subject: a message that names something else ("move gym to 6pm") is a new request (review, 2026-10-16). */
export declare function isCorrection(message: string): boolean;
/** His whole answer is a time or day ("at 5pm", "tomorrow at 9"): safe to read together with the reminder it answers. */
export declare function isBareTime(message: string): boolean;
/** Whether this turn is about reminders at all (anything planReminder handles). */
export declare function isReminderTurn(message: string): boolean;
export declare const ampm12: (t: string) => string;
/** "in like 10 min" → now + 10 minutes; undefined when he gave no relative time. */
export declare function relativeTime(message: string, now: Date): Date | undefined;
/** What to do with a reminder turn, or undefined when it is not one (or the extractor is unavailable). */
export declare function planReminder(input: ReminderInput): Promise<ReminderPlan | undefined>;
