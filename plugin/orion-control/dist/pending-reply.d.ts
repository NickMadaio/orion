import type { Day, FlowResult } from "./schedule-flow.js";
import type { ToolResult } from "./work-check.js";
import type { Outreach } from "./outreach-reply.js";
import { type Offer, type Reply } from "./pending-reply-read.js";
export { offerOf, readReply } from "./pending-reply-read.js";
/** What this chat agreed a turn ago, that the next short reply continues. */
export type Memo = {
    kind: "resume";
    title: string;
    activity?: string;
    at: number;
} | {
    kind: "bedtime";
    at: number;
    checkinId?: string;
    checkinAt?: number;
    napped?: boolean;
} | {
    kind: "booked";
    title: string;
    when: string;
    at: number;
} | {
    kind: "brief";
    items: string[];
    at: number;
} | {
    kind: "next";
    at: number;
} | {
    kind: "move-offer";
    title: string;
    to: number;
    which: "today" | "tomorrow";
    at: number;
};
/** said: his words, trimmed (the reason orion-checkin reads for a grace). */
export type PendingTurn = {
    reply: Reply;
    offer?: Offer;
    memo?: Memo;
    sentAt?: number;
    outreachText?: string;
    said?: string;
};
export type PendingDeps = {
    now: Date;
    schedule?: (command: string) => Promise<FlowResult>;
    session?: (words: string) => Promise<FlowResult>;
    checkin?: (args: string[]) => Promise<{
        stdout: string;
        code: number;
    }>;
    readDay?: (dateArgs: string[]) => Promise<Day | undefined>;
};
export type PendingOutcome = {
    flow: FlowResult;
    tools: ToolResult[];
    marks: string[];
    memo: Memo | null;
};
export declare const CRISIS_HOLD_MS: number;
/** What came before this turn in the chat: when ORION last replied here, and whether the crisis reply is still recent. */
export type PriorTurn = {
    lastReplyAt?: number;
    afterCrisis: boolean;
};
/**
 Per chat: the memo, when ORION last replied, and when the crisis reply went. Per state dir (every chat, across restarts): the outreach
 already answered (pending-reply-answered.ts). Without a state dir the answered record is kept in memory only.
*/
export declare class PendingMemory {
    private memos;
    private replies;
    private crises;
    private answered;
    memo(key: string, nowMs: number): Memo | undefined;
    setMemo(key: string, memo: Memo | null): void;
    /**
     Records this turn (ORION answers it unless it was hushed; a crisis turn starts the hold) and returns what came before it.
     nowMs is the plugin's clock, the one outreach times are read on.
    */
    beginTurn(key: string, nowMs: number, turn: {
        crisis: boolean;
        replied: boolean;
    }, dir?: string): PriorTurn;
    wasAnswered(text: string, sentAt: number, nowMs: number, dir?: string): boolean;
    markAnswered(text: string, sentAt: number, nowMs: number, dir?: string): void;
}
export type PendingInput = {
    message: string;
    now: Date;
    /** The app's label for the outreach this answers (already windowed by the app's tracker). */
    outreach?: Outreach;
    /** The last message ORION sent (outreach.jsonl via the state card), for a reply that came with no label. */
    lastPush?: {
        text: string;
        at: string;
    } | null;
    memo?: Memo;
    /** Whether this outreach (its text, sent at) was already answered, in any chat. */
    answered?: (text: string, sentAt: number) => boolean;
    /** When ORION last replied in this chat (plugin clock, ms): an outreach sent before that is not what a short reply answers. */
    lastReplyAt?: number;
};
/** The pending reply this message is, or undefined (the turn goes on unchanged). Pure. */
export declare function readPendingTurn(input: PendingInput): PendingTurn | undefined;
/** Carries the pending reply out; undefined when there is nothing code can do with it (the normal turn follows). */
export declare function runPendingTurn(turn: PendingTurn, deps: PendingDeps): Promise<PendingOutcome | undefined>;
/**
 * The app's marker for the rest of a cut-off spoken request (AppState.send): `full` when the marker carries the whole sentence
 * ("…my full message was: "…""), `rest` the words after it. Undefined when the message is not a continuation.
 */
export declare function continuationOf(said: string): {
    full?: string;
    rest: string;
} | undefined;
