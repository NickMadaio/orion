import type { Memo, PendingOutcome } from "./pending-reply.js";
import type { Reply } from "./pending-reply-read.js";
import type { Ctx } from "./pending-reply-act.js";
type BedMemo = Extract<Memo, {
    kind: "bedtime";
}>;
/** Under this much sleep (minutes, from the cap to his wake time) the night is short and tomorrow gets a nap. */
export declare const SHORT_NIGHT_MIN: number;
/** The manual wake alarm still ahead (wake-request.json, written by orion-wake), in minutes on the day he wakes into; undefined for none. */
export declare function manualAlarm(stateDir: string | undefined, now: Date): number | undefined;
export declare function bedtime(c: Ctx, r: Reply, memo?: BedMemo): Promise<PendingOutcome | undefined>;
/** orion-wake with fixed arguments (no shell). Wired in by index.ts only. */
export declare const liveWakeExec: (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export {};
