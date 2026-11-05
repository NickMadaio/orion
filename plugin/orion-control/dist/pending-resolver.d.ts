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
/** A short answer that is not a yes/no: a number or a few words ("2", "chicken", "the big one", "at 5"). */
export declare const isShortAnswer: (message: string) => boolean;
/** ORION's last reply ends with a question that needs an answer ("How much?", "What time?"): a short answer next is that answer. */
export declare function resolveQuestion(last: Said | undefined, now: number): Pending;
/** The newest exchange across a chat's session keys: the phone sends one conversation under several (as the retry slots already allow). */
export declare function latestExchange<T extends {
    at: number;
}>(all: ReadonlyMap<string, T>, key: string | undefined, isFamily: (k: string) => boolean): T | undefined;
/** What a bare go-ahead gets when nothing is waiting. */
export declare const nothingPending: (message: string) => string;
/** The note for the worker when something IS pending: his word answers exactly that. */
export declare const pendingNote: (message: string, refers: string) => string;
export { isBareGoAhead };
