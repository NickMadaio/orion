export declare const REPLY_FAILED = "I couldn't finish that just now.";
export type SanitizeContext = {
    mailFailed?: boolean;
};
/** True when this run's tool results include a gmail/messages read that failed (non-zero exit or a raw error shape). */
export declare function mailReadFailed(tools: ReadonlyArray<{
    canonical: string;
    stdout: string;
    exit?: number | null;
}>): boolean;
/** The reply with raw CLI/tool spans removed (known failures become one short line). Returns the input when it is clean. */
export declare function sanitizeReply(reply: string, ctx?: SanitizeContext): string;
