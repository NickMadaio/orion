import { type FixItem } from "./selffix-store.js";
export type SelffixRun = (script: "orion-selfcheck" | "orion-selffix", args: string[], input?: string) => Promise<{
    stdout: string;
    code: number;
}>;
export type SelffixMove = {
    kind: "why";
    about: string;
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
};
/** `offered`: the reply ends in "now or later?", so his next bare answer is about this offer. */
export type SelffixOut = {
    text: string;
    calls: string[];
    outputs: string[];
    offered?: boolean;
};
/** `bound`: the offer (or the reminder to start it) was ORION's last message in this chat, so a bare answer is about it. Set by the caller. */
export type SelffixCtx = {
    stateDir: string;
    now: Date;
    outreach?: boolean;
    items?: FixItem[];
    bound?: boolean;
};
export declare const asksWhy: (message: string) => boolean;
/** The time a "later" answer names ("tomorrow at 9", "tonight at 8"): an ISO instant, or undefined to take the default evening slot. */
export declare function laterAt(message: string, now: Date): string | undefined;
/** What this message does to the fix offers, if anything. Reads only. */
export declare function readSelffixMove(message: string, ctx: SelffixCtx): SelffixMove | undefined;
/** "tonight at 7:30 PM", "tomorrow at 7:30 PM", "Friday at 7:30 PM". */
export declare function spokenWhen(iso: string, now: Date): string;
export declare function runSelffixMove(move: SelffixMove, run: SelffixRun, now?: Date): Promise<SelffixOut>;
/** The real scripts (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export declare const liveSelffixRun: (stateDir?: string) => SelffixRun;
