/** Wake days as orion-sleepplan reads them: mon..sun, "weekdays", "weekends", "all", "gym". */
export type Draft = {
    wake?: string;
    days?: string[];
    rest?: string;
    lead?: number | null;
};
export type SleepStep = "wake" | "days" | "lead" | "confirm";
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
};
/** Everything a message says about the plan. Pure. */
export declare function slotsOf(message: string): Draft;
/** A habit statement about when he wakes or sleeps; the slots it already carries. Undefined when it is not one. */
export declare function readHabit(message: string): Draft | undefined;
/** A night he is out or working (an exception), or idling (no exception). Evening only, unless he says "tonight". Pure. */
export declare function readException(message: string, now: Date): SleepTurn | undefined;
/** His reply to the question ORION asked; undefined when it is not one (the pending interview is then dropped). */
export declare function readAnswer(message: string, held: SleepPending): SleepTurn | undefined;
/** This turn's part in the sleep plan, or undefined. A held interview reads the answer first; a new statement starts over. */
export declare function readSleepTurn(message: string, { held, now }: {
    held?: SleepPending | undefined;
    now: Date;
}): SleepTurn | undefined;
