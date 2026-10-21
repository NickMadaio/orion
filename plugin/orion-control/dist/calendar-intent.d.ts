import { type ReplanAsk } from "./day-replan.js";
import { type Refusal } from "./intent-gate.js";
import { type ClockContext, type DayWord } from "./intent-time.js";
import type { AskContext } from "./schedule-flow.js";
export type Verb = "add" | "move" | "replan" | "reorder" | "remove" | "extend";
/** A clock that cannot be used as said: already behind him today, or 9 tomorrow with no am/pm. */
export type TimeIssue = {
    kind: "passed";
    at: string;
    field: "start" | "end";
} | {
    kind: "past-midnight";
    at: string;
} | {
    kind: "ambiguous";
    choices: [string, string];
} | {
    kind: "from-now-not-today";
};
/** endSaid: an extend's end as he said it ("9"), read against the block's own start when the day is known. */
/** fromSaid/toSaid: a move "from 7 to 8" as he said it, read against the block's own time once the day is known (live run 4). */
export type IntentItem = {
    name: string;
    start?: string;
    end?: string;
    minutes?: number;
    fromNow?: boolean;
    by?: number;
    endSaid?: string;
    fromSaid?: string;
    toSaid?: string;
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
    /** move / edit: the block ORION last made or changed in this chat ("it", or a name not on the day it was said for), by title and start */
    target?: {
        title: string;
        start?: string;
        dateArgs: string[];
    };
    /** move: "push everything 30 min" — every block of his still ahead today, by the same minutes */
    all?: true;
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
export declare const PART: (t: string) => ClockContext["part"];
/** "push everything 30 min", "ok and push the rest of my day back an hour": the minutes, or null. Today only; never a question or a hedge. */
export declare function pushAllMinutes(message: string): number | null;
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
