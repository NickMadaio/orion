import { type ReplanAsk } from "./day-replan.js";
import { type Refusal } from "./intent-gate.js";
import { type DayWord } from "./intent-time.js";
import type { AskContext } from "./schedule-flow.js";
export type Verb = "add" | "move" | "replan" | "reorder" | "remove" | "extend";
/** A clock that cannot be used as said: already behind him today, or 9 tomorrow with no am/pm. */
export type TimeIssue = {
    kind: "passed";
    at: string;
    field: "start" | "end";
} | {
    kind: "ambiguous";
    choices: [string, string];
} | {
    kind: "from-now-not-today";
};
/** endSaid: an extend's end as he said it ("9"), read against the block's own start when the day is known. */
export type IntentItem = {
    name: string;
    start?: string;
    end?: string;
    minutes?: number;
    fromNow?: boolean;
    by?: number;
    endSaid?: string;
    issue?: TimeIssue;
};
export type IntentAnchor = {
    kind: "block";
    name: string;
} | {
    kind: "home";
} | {
    kind: "now";
} | {
    kind: "first-class";
};
export type CalendarIntent = {
    verb: Verb;
    items: IntentItem[];
    day: DayWord;
    anchor?: IntentAnchor;
    /** replan / reorder: the request as the day planner reads it (day-replan.ts). */
    replan?: ReplanAsk;
    /** reorder: names in the follow-up that the remembered request did not have ("dinner then gym"): never reordered. */
    outside?: string[];
    /** add: "yes" to ORION's own offer, or the "put X [from now] until T" sentence (direct-add.ts reads it against the day). */
    until?: true;
    /** the remembered request's date, when a follow-up acts on it */
    date?: string;
};
export type IntentRead = {
    intent: CalendarIntent;
} | {
    refused: Refusal | "unparsed" | "other-day";
    tookBack?: true;
};
/** What a follow-up needs from the request before it: the request, and the date it was for. */
export type IntentMemory = ReplanAsk;
/**
 * His sentence as one structured change, or why not. ctx.now is the clock; ctx.last is his last reschedule request in this chat
 * (for "actually do resume before gym"); ctx.ask is ORION's open question (for "yes" to its offer).
 */
export declare function readIntent(message: string, ctx: {
    now: Date;
    last?: IntentMemory;
    ask?: AskContext;
}): IntentRead;
/** The intent, when there is one (anything else: the normal path). */
export declare const parseCalendarIntent: (message: string, ctx: {
    now: Date;
    last?: IntentMemory;
    ask?: AskContext;
}) => CalendarIntent | undefined;
/** Minutes of an item's start, when it has one. */
export declare const startOf: (it: IntentItem) => number | undefined;
