import { type Draft } from "./sleep-plan-slots.js";
export type { Draft, DayWake } from "./sleep-plan-slots.js";
export { slotsOf } from "./sleep-plan-slots.js";
export type SleepStep = "wake" | "days" | "lead" | "confirm" | "grace";
export type SleepPending = {
    step: SleepStep;
    draft: Draft;
    reasked?: boolean;
};
export type LegitReason = "friends" | "party" | "bar" | "schoolwork";
export type SleepTurn = {
    kind: "interview";
    draft: Draft;
    reask?: SleepStep;
} | {
    kind: "confirm";
    draft: Draft;
} | {
    kind: "decline";
} | {
    kind: "except";
    reason: LegitReason;
    until?: string;
} | {
    kind: "noexcept";
    activity: string;
    grace?: boolean;
    again?: boolean;
}
/** "i wanna sleep earlier this week": sleep only, nothing about waking. A new bedtime, said and saved in one reply. */
 | {
    kind: "bedtime";
    time?: string;
};
/** The default lead when he waves the question off with a yes ("yeah", "sure", "sounds good"): 3 hours, what he asked for. */
export declare const DEFAULT_LEAD = 180;
/** A habit statement about when he wakes or sleeps; the slots it already carries. Undefined when it is not one. */
export declare function readHabit(message: string): Draft | undefined;
/** "i wanna sleep earlier this week", "earlier bedtime from now on pls", "need to start crashing earlier, like 11": a new bedtime. Pure. */
export declare function readBedShift(message: string): {
    time?: string;
} | undefined;
/** Whether the sleep plan owns this statement before the health reader can (a wake statement, or a sleep-only bedtime shift). */
export declare const ownsSleepStatement: (message: string) => boolean;
/** A night he is out or working (an exception), or idling (no exception). Evening only, unless he says "tonight". Pure. */
export declare function readException(message: string, now: Date): SleepTurn | undefined;
/** A late-night plea for more time: an exception when the reason is legit, else no exception with one short grace. Pure. */
export declare function readPlea(message: string, now: Date): SleepTurn | undefined;
/** His reply to the question ORION asked; undefined when it is not one (the pending interview is then dropped). */
export declare function readAnswer(message: string, held: SleepPending): SleepTurn | undefined;
/** This turn's part in the sleep plan, or undefined. A held interview reads the answer first; a new statement starts over. */
export declare function readSleepTurn(message: string, { held, now }: {
    held?: SleepPending | undefined;
    now: Date;
}): SleepTurn | undefined;
