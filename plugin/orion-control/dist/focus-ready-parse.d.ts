/** "im ready to work": a bare readiness to start, with no task named in it. */
export declare function isReadyMessage(message: string): boolean;
/** He says the work is over: {ok, markDone (he said he finished it), object (what he said he finished, if anything)}, or null. */
export declare function isDoneMessage(message: string): {
    ok: true;
    markDone: boolean;
    object?: string;
} | null;
export declare const hasAppsLead: (message: string) => boolean;
/** The reply to "need anything else?": apps he names (as he said them), or {none:true}. null when it is not an answer. */
export declare function readAppsReply(message: string): {
    apps: string[];
    none: boolean;
} | null;
export declare const content: (text: string) => string[];
/** The answer to the break-or-next question: break, next (only when there is one), or end (neither). `mark`: he also said to tick the task off. */
export declare function readEarlyAnswer(message: string, hasNext: boolean, nextTitle?: string): {
    choice: "break" | "next" | "end";
    mark: boolean;
} | null;
/** "i need youtube for this": the site he names (as said), for a one-time allow this session. null for anything else. */
export declare function readSiteOverride(message: string): string | null;
