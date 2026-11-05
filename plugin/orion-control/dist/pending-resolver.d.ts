import { isBareGoAhead } from "./honest-reply.js";
export declare const PENDING_WINDOW_MS: number;
export type Said = {
    reply: string;
    at: number;
};
export type Pending = {
    pending: true;
    refers: string;
} | {
    pending: false;
};
/** The question or offer in ORION's last reply: its last question sentence, or the whole reply when it ends in an offer. */
export declare function resolvePending(last: Said | undefined, now: number): Pending;
/** What a bare go-ahead gets when nothing is waiting. */
export declare const nothingPending: (message: string) => string;
/** The note for the worker when something IS pending: his word answers exactly that. */
export declare const pendingNote: (message: string, refers: string) => string;
export { isBareGoAhead };
