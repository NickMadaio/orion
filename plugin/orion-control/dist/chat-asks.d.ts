import { type OpenRequest } from "./open-request.js";
export type ChatAsk = {
    kind: "open";
    req: Extract<OpenRequest, {
        kind: "app" | "url";
    }>;
} | {
    kind: "list-add";
    item: string;
} | {
    kind: "todo-list";
};
export type Exec = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type ChatDeps = {
    open: Exec;
    installed: (app: string) => Promise<boolean>;
    tasks: Exec;
};
/** A question ORION asked that a bare "yeah" answers: open this address. */
export type WebOffer = {
    url: string;
    label: string;
};
export type ChatOut = {
    text: string;
    calls: string[];
    outputs: string[];
    offer?: WebOffer;
};
/** "oat milk and a phone charger cable" is two items, each its own row (so ticking one off finds it); "salt and pepper" stays one. */
export declare function splitListItems(text: string): string[];
/** What code does for this message, or null when any part of it is something else (the worker or another flow keeps it). */
export declare function readChatAsks(message: string): ChatAsk[] | null;
/** "and a list item: pick up parcel from reception, then tell me whats on tomorrow evening": the list add (run by code) and the question left to answer. */
export declare function splitLeadListItem(message: string): {
    item: string;
    rest: string;
} | null;
/** The items of a bare "and X" follow-up, or null when it is anything else (a verb, a question, a time, a calendar word). */
export declare function readListFollowUp(message: string): string[] | null;
/** "add a call with bea at 7pm and put eggs on my list": the list part (run by code) and the rest left for the calendar (w20 r5 #101). */
export declare function splitTrailingListAdd(message: string): {
    head: string;
    asks: ChatAsk[];
} | null;
/** "You have 3 on your list: milk, email careers (due 2026-11-06), ...", from `orion-tasks list` output. */
export declare function listReply(stdout: string): string;
/** Runs every ask in order (one failing never stops the next) and says what happened to each; items added in a row are one sentence naming each. */
export declare function runChatAsks(asks: ChatAsk[], deps: ChatDeps): Promise<ChatOut>;
export declare const answersWebOffer: (message: string) => boolean;
