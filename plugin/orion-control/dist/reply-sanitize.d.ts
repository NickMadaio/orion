import type { ToolResult } from "./work-check.js";
export declare const REPLY_FAILED = "I couldn't finish that just now.";
/** `strict`: this turn had a failed tool, so paths, long CLI flags, JSON and stack frames are tool text, not prose. */
export type SanitizeContext = {
    mailFailed?: boolean;
    strict?: boolean;
    codeAuthored?: boolean;
};
/** True when this run's tool results include a gmail/messages read that failed (non-zero exit or a raw error shape). */
export declare function mailReadFailed(tools: ReadonlyArray<{
    canonical: string;
    stdout: string;
    exit?: number | null;
}>): boolean;
export declare const ONE_PART_FAILED = "One part didn't work.";
/** The reply with raw CLI/tool spans removed (known failures become one short line). Returns the input when it is clean. */
export declare function sanitizeReply(reply: string, ctx?: SanitizeContext): string;
export type FinalizeContext = {
    mailFailed?: boolean;
    /** Tool calls the host itself ran this turn (the host's raw "Exec failed" payload exists only for these). */
    hostTools?: number;
    changeRequest?: boolean;
    /** The text was written by code from tool results: cleaned of raw spans, never given an acknowledgement. */
    codeAuthored?: boolean;
};
export declare function finalizeReply(reply: string, tools: ReadonlyArray<ToolResult>, ctx?: FinalizeContext): string;
