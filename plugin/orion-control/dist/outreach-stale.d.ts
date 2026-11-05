import type { Outreach } from "./outreach-reply.js";
/** True once ORION has replied in this chat after the outreach was sent. The label's minutes are truncated, so the earliest send time is used. */
export declare function outreachStale(o: Outreach, lastReplyAt: number | undefined, nowMs: number): boolean;
/** The line the worker gets in place of "his message answers that": the old outreach is not part of this turn. */
export declare const staleOutreachNote: (o: Outreach) => string;
/** A reply with any outreach text it echoes cut out (the exact lines, and the ladder's own shapes), whitespace tidied. */
export declare function stripOutreachEcho(reply: string, texts: readonly string[]): string;
