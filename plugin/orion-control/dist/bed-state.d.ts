import type { Memo, PendingTurn } from "./pending-reply.js";
/** It is past the bedtime he set and the night has not ended. */
export declare function pastBedtime(stateDir: string | undefined, now: Date): boolean;
/** memo: this chat's bedtime memo, when there is one (the check-back it set is moved, not doubled). */
export type BedStateInput = {
    message: string;
    now: Date;
    stateDir?: string;
    focusActive: boolean;
    memo?: Memo;
};
/** His reply read as answering bedtime from the clock and his bedtime alone, or undefined. Pure apart from reading his bedtime. */
export declare function bedtimeFromState({ message, now, stateDir, focusActive, memo }: BedStateInput): PendingTurn | undefined;
/** The app context's focus line says a session is running ("Focus session: active …"), not "inactive". */
export declare const focusRunning: (raw: string) => boolean;
