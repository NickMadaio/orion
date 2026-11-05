import { type Repeat } from "./reminder-schedule.js";
import { type OfferPort } from "./reminder-offers.js";
export type { OfferPort, PendingOffer } from "./reminder-offers.js";
/** A reminder as the plan reads it: the store's entry, whatever the clock has since written on it. */
export type StoredReminder = {
    id: string;
    label: string;
    dueAt: number;
    repeat?: Repeat;
    place?: string;
    important?: boolean;
    firedAt?: number | null;
    snoozedAt?: number | null;
    kind?: "alarm" | "timer";
    createdAt?: number;
    open?: number | null;
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
    action: "alarm_set" | "reminder_cancel" | "reminder_snooze" | "reminder_done";
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
    /** Offered reminders (a thing he says he has to do; a deadline ORION suggested). Without it nothing is offered or accepted. */
    offers?: OfferPort;
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
export declare function leaveAsReminder(message: string): string | undefined;
/** A second reminder asked for with a time and no verb. Only meaningful right after one was set (the caller checks). */
export declare const isAnotherReminder: (message: string) => boolean;
/** What to do with a reminder turn, or undefined when it is not one (or the extractor is unavailable). */
export declare function planReminder(input: ReminderInput): Promise<ReminderPlan | undefined>;
