export declare const DEFER_WINDOW_DAYS = 14;
export type Deferrals = {
    count: number;
    since?: string;
};
/** Distinct days in the last two weeks a plan named like `title` slipped or never started, and the first of them. */
export declare function deferralsOf(stateDir: string | undefined, title: string, now: Date): Deferrals;
/** The line after the booking: this push counted with the ones on record, and a small first step. Empty with nothing on record. */
export declare function slipAck(d: Deferrals): string;
