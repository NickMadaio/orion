import type { Memo, PendingOutcome } from "./pending-reply.js";
import type { Reply } from "./pending-reply-read.js";
import type { Ctx } from "./pending-reply-act.js";
import type { Day, DayBlock } from "./schedule-flow.js";
type BedMemo = Extract<Memo, {
    kind: "bedtime";
}>;
/** Under this much sleep (minutes, from the cap to his wake time) the night is short and tomorrow gets a nap. */
export declare const SHORT_NIGHT_MIN: number;
/** "one more thing" past bedtime: the limit ORION gives it, said as his limit in the reply (Wave 6). */
export declare const ONE_MORE_MIN = 15;
export declare function readBedStall(message: string): Extract<Reply, {
    kind: "defer";
}> | undefined;
/** The manual wake alarm still ahead (wake-request.json, written by orion-wake), in minutes on the day he wakes into; undefined for none. */
export declare function manualAlarm(stateDir: string | undefined, now: Date): number | undefined;
export declare function bedtime(c: Ctx, r: Reply, memo?: BedMemo): Promise<PendingOutcome | undefined>;
type Skips = {
    titles: string[];
    noClasses: boolean;
};
/** What he declared off on the day he wakes into (declared-facts.json: kind skip names the block, kind no-classes takes every class). */
export declare function readSkips(stateDir: string | undefined, date: string | undefined): Skips;
/** The first fixed block he will be at in person: skipped (the same rule as declared-facts cancels()) and online ones left out. */
export declare function attendedFirst(day: Day | undefined, skips: Skips): DayBlock | undefined;
/** orion-wake with fixed arguments (no shell). Wired in by index.ts only. */
export declare const liveWakeExec: (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export {};
