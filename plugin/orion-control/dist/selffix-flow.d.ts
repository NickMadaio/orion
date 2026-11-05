import { type FixItem } from "./selffix-store.js";
export type LastExchange = {
    message: string;
    reply: string;
    at: string;
};
export declare const isBareWhy: (about: string) => boolean;
export type SelffixRun = (script: "orion-selfcheck" | "orion-selffix", args: string[], input?: string) => Promise<{
    stdout: string;
    code: number;
    stderr?: string;
}>;
export type SelffixMove = {
    kind: "why";
    about: string; /** ORION's previous exchange in THIS chat (message, reply), supplied by the router. */
    last?: LastExchange | null;
} | {
    kind: "now";
    id: string;
} | {
    kind: "later";
    id: string;
    at?: string;
    reparking?: boolean;
} | {
    kind: "no";
    id: string;
} | {
    kind: "start";
    id: string;
}
/** target: the request ORION said he cannot do and offered to build ("want me to build that?"); the diagnosis is made from it. */
 | {
    kind: "fix";
    about: string;
    target?: string;
}
/** His yes to "I'll start a fix for: X. Go?": the project is created from what was confirmed. */
 | {
    kind: "fix-go";
    hold: FixHold;
} | {
    kind: "fix-drop";
};
/** What "fix your code" resolved to and asked about, kept until his next message: the subject said in the one-line confirmation, and what it will start from. */
export type FixHold = {
    subject: string;
    about: string;
    target?: string;
    reuse?: FixItem;
    diagnosis?: Record<string, any>;
};
/** `offered`: the reply ends in "now or later?", so his next bare answer is about this offer. */
export type SelffixOut = {
    text: string;
    calls: string[];
    outputs: string[];
    offered?: boolean;
    errors?: string[]; /** The fix subject asked about, awaiting his yes. */
    hold?: FixHold;
};
/** `bound`: the offer (or the reminder to start it) was ORION's last message in this chat, so a bare answer is about it. Set by the caller. */
export type SelffixCtx = {
    stateDir: string;
    now: Date;
    outreach?: boolean;
    items?: FixItem[];
    bound?: boolean; /** The fix subject ORION just asked "Go?" about (this chat, last message). */
    hold?: FixHold; /** ORION's last reply offered to build something: the request it could not do */
    build?: {
        request: string;
    };
};
export declare const asksWhy: (message: string) => boolean;
export declare const asksFix: (message: string) => boolean;
/** The time a "later" answer names ("tomorrow at 9", "tonight at 8"): an ISO instant, or undefined to take the default evening slot. */
export declare function laterAt(message: string, now: Date): string | undefined;
/** What this message does to the fix offers, if anything. Reads only. */
export declare function readSelffixMove(message: string, ctx: SelffixCtx): SelffixMove | undefined;
/** "tonight at 7:30 PM", "tomorrow at 7:30 PM", "Friday at 7:30 PM". */
export declare function spokenWhen(iso: string, now: Date): string;
/** "open" -> "opening", "close" -> "closing", "stop" -> "stopping": the first word of a goal, said as a subject. */
export declare function gerund(word: string): string;
/** What he said the fix is FOR ("so you can open websites without asking me" -> "opening websites without asking me"); undefined when he named nothing. */
export declare function explicitFixSubject(message: string): string | undefined;
/** The failure being discussed, in one phrase: his request in the diagnosed turn, and what went wrong with it. */
export declare function subjectOfDiagnosis(d: {
    message?: string;
    kind?: string;
}): string;
export declare function runSelffixMove(move: SelffixMove, run: SelffixRun, now?: Date): Promise<SelffixOut>;
/** The real scripts (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export declare const liveSelffixRun: (stateDir?: string) => SelffixRun;
