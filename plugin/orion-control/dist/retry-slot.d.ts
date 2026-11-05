export declare const RETRY_WINDOW_MS: number;
export declare const RETRY_OFFER: RegExp;
/** What a reply says when it cannot keep that promise (no stored action to replay). */
export declare const NO_RETRY_LINE = "Ask me again and I'll retry.";
/** A bare go-ahead for a retry ("go", "yeah go", "do it", "try again", "retry"), not a sentence that starts with one. */
export declare const isRetryWord: (text: string) => boolean;
export type RetrySlot = {
    readonly message: string;
    readonly at: number;
} | undefined;
/** The slot after a reply: set when it offers a retry for `message` (never for a retry word itself), else empty. */
export declare function afterReply(reply: string, message: string, now: number): RetrySlot;
/** The message to run for this turn: the stored one when this is a fresh retry word, else what he typed. */
export declare function replayOf(slot: RetrySlot, typed: string, now: number): string;
/** The reply with its retry promise taken out, for a reply that has nothing stored to replay. */
export declare const withoutRetryOffer: (reply: string) => string;
