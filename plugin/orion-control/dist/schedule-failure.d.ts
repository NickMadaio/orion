export type ScheduleFailure = {
    reason: "after_bedtime";
    bedtime: string;
    what?: string;
} | {
    reason: "no_room";
    what?: string;
} | {
    reason: "passed";
    at?: string;
    what?: string;
} | {
    reason: "no_such_block";
    name: string;
} | {
    reason: "too_short" | "too_far_ahead" | "class_in_the_way" | "other";
    detail?: string;
    what?: string;
};
/** `ctx.bedtime` (HH:MM) and `ctx.start` (minutes) let a "did not fit" be told apart as "after bedtime". */
export declare function failureReason(stdout: string, ctx?: {
    bedtime?: string;
    start?: number;
    what?: string;
}): ScheduleFailure | undefined;
