import type { PendingAdd, PendingRun, TitlePending } from "./schedule-pending.js";
import { FORM_PROMPT, EXTRACT_PROMPT, EXTRACT_SCHEMA } from "./schedule-form-prompt.js";
export { FORM_PROMPT, EXTRACT_PROMPT, EXTRACT_SCHEMA };
export type DayBlock = {
    title: string;
    start: string;
    end: string;
    fixed: boolean;
    kind?: string;
};
/** plan: what `show --json` says about how the scheduler lays this day out (the trip home, the gap between blocks, the daily anchors). */
export type Day = {
    date: string;
    now: string | null;
    blocks: DayBlock[];
    plan?: {
        commuteMinutes: number;
        bufferMinutes: number;
        anchors: Array<{
            title: string;
            minutes: number;
        }>;
    };
};
export type Intent = {
    do: "fill_between" | "plan" | "clear_after" | "move" | "resize" | "extend" | "add" | "drop" | "skip" | "swap" | "tidy" | "late" | "overrun" | "log" | "cannot" | "ask" | "answer";
    what?: string;
    after?: string;
    before?: string;
    with?: string;
    to?: string;
    until?: string;
    minutes?: number;
    text?: string;
    /** move: minutes later (positive) or earlier (negative) — code does the arithmetic. */
    by?: number;
    /** log: when he started ("14:00"), and what planned block it replaced (a block id or title); `to` is the end, HH:MM or "now". */
    from?: string;
    instead?: string;
    /** plan: where he goes, how long getting there takes, and what he does there, in order. */
    where?: string;
    travel?: number;
    items?: Array<{
        title: string;
        minutes?: number;
    }>;
};
/** "B1 09:00–10:30 CS2100 … (FIXED, done)" — what the model sees. */
export declare function blockList(day: Day): string;
/** What an open outreach question says (the ORION context line in his prompt): the blank he was asked about, or the block that was not started. */
export type AskContext = {
    start?: string;
    end?: string;
    block?: {
        title: string;
        start: string;
        end: string;
    };
    /** What ORION itself said, what it offered ("I could put CS Lab there") and where the free stretch ends ("Nothing planned till 10:30"): a "yes" accepts the offer. */
    text?: string;
    suggest?: string;
    till?: string;
};
/** Reads `[ORION context: ... (blank ask about 14:00-now ...)]` or `(finish resume, planned 14:00-16:00, not started)`; undefined when no ask is open. */
export declare function parseAskContext(prompt: string): AskContext | undefined;
/** "nothing", "nothing really", "just chilling": his answer to a blank ask that logs nothing. */
export declare const NOTHING_REPLY: RegExp;
/** JSON schema for the form; block references are enums of today's real ids. */
export declare function intentSchema(day: Day): {
    type: string;
    properties: {
        steps: {
            type: string;
            maxItems: number;
            items: {
                type: string;
                properties: {
                    do: {
                        type: string;
                        enum: string[];
                    };
                    where: {
                        type: string;
                        maxLength: number;
                    };
                    travel: {
                        type: string;
                    };
                    items: {
                        type: string;
                        maxItems: number;
                        items: {
                            type: string;
                            properties: {
                                title: {
                                    type: string;
                                    maxLength: number;
                                };
                                minutes: {
                                    type: string;
                                };
                            };
                            required: string[];
                        };
                    };
                    what: {
                        type: string;
                        maxLength: number;
                        description: string;
                    };
                    after: {
                        type: string;
                        enum: string[];
                    } | {
                        type: string;
                        enum?: undefined;
                    };
                    before: {
                        type: string;
                        enum: string[];
                    } | {
                        type: string;
                        enum?: undefined;
                    };
                    with: {
                        type: string;
                        enum: string[];
                    } | {
                        type: string;
                        enum?: undefined;
                    };
                    instead: {
                        type: string;
                        enum: string[];
                    } | {
                        type: string;
                        enum?: undefined;
                    };
                    from: {
                        type: string;
                        description: string;
                    };
                    to: {
                        type: string;
                        description: string;
                    };
                    until: {
                        type: string;
                        description: string;
                    };
                    minutes: {
                        type: string;
                    };
                    by: {
                        type: string;
                    };
                    text: {
                        type: string;
                        maxLength: number;
                        description: string;
                    };
                };
                required: string[];
            };
        };
    };
    required: string[];
};
/** Sampling for the form call: deterministic (thinking off, so greedy is safe). */
export declare const FORM_OPTIONS: {
    temperature: number;
    top_p: number;
    top_k: number;
    presence_penalty: number;
    repeat_penalty: number;
    num_predict: number;
    num_ctx: number;
};
export declare function setPlaces(places: Record<string, number>): void;
/** The message asks for two opposite things about one noun ("cancel my lab and also make sure I'm in the lab at 2"). */
export declare function contradiction(message: string): string | undefined;
/** Steps that would write something he did not ask for, as what to say instead. null = fine. */
export declare function guardSteps(message: string, steps: Intent[], day: Day): {
    say: "cannot" | "ask";
    text: string;
} | null;
/** "something", "small task", "a thing" — not a title (never booked as one). */
export declare function isUnnamedThing(what?: string): boolean;
type Anchor = {
    before?: {
        minute: number;
        label: string;
    };
    after?: DayBlock;
    gone?: string;
};
/** The anchor his words give an add: before <class/block/time>, after <block>, between X and Y — both sides read
 *  independently ("after my class and before gym", r8 review 3 H3, 2026-10-16). */
export declare function anchorFromMessage(message: string, day: Day): (Anchor & {
    name: string;
}) | undefined;
type Compiled = {
    args: string[];
} | {
    say: "cannot" | "ask" | "answer";
    text: string;
    pending?: Omit<TitlePending, "dateArgs" | "when">;
} | {
    error: string;
};
/** One step → orion-reschedule arguments (argv, no shell), or what to tell him. */
export declare function compile(input: Intent, day: Day, message?: string, opts?: {
    single?: boolean;
    anchor?: Anchor;
    askContext?: AskContext;
}): Compiled;
/** One scheduler failure line → one short spoken clause. The raw line was spoken word for word (sweep
 *  2026-10-16): usage text, "Blocks today: … 09:00–10:30", "Do not tell him anything was added". */
export declare function spokenFailure(line: string): string;
/** What to tell Nick, from the scheduler's own output only. */
export declare function summarize(outputs: string[], said: string[]): {
    reply: string;
    changed: boolean;
};
/** "tomorrow" as he types it ("tmrw" read today's calendar, 2026-10-12). */
export declare const TOMORROW: RegExp;
/** Before 5 AM he is still up: "tomorrow" means the coming daytime — today's date (2026-10-13: a reminder
 *  asked for at 00:44 "tomorrow at 11" was filed for the day after). */
export declare const LATE_NIGHT_UNTIL = 5;
export declare function meansTomorrow(message: string, now?: Date): boolean;
/** The day the change is for: tomorrow, a weekday he names, or today. "i gotta leave early friday, cut
 *  the last block off" resized Thursday's last block (sweep q027, 2026-10-15). The weekday that is
 *  today stays today; orion-reschedule reads any other as the next one ("--date friday"). */
export declare function dayArgsFor(message: string, now?: Date): {
    args: string[];
    label: string | undefined;
    ask?: string;
};
export declare const RESCHEDULE = "/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule";
export type FlowResult = 
/** marks: the undo-journal stamp of each change made, so a continuation can take them back; undone: changes reverted first. */
/** reply: a flow that builds its own reply (session-flow.ts) — used as-is instead of spokenReply(outputs). */
{
    outcome: "done";
    calls: string[];
    outputs: string[];
    marks?: string[];
    undone?: number;
    reply?: string;
}
/** plain: said exactly as written (no "That doesn't fit" framing). calls/outputs: a scheduler run that changed nothing. */
 | {
    outcome: "say";
    text: string;
    kind: "cannot" | "ask" | "plain";
    calls?: string[];
    outputs?: string[];
    pending?: PendingAdd;
} | {
    outcome: "fallback";
    reason: string;
};
/** The whole fixed sequence for one request. exec runs the scheduler with argv (no shell).
 *  undo: stamps of changes an earlier, cut-off half of this request made — reverted first, newest first,
 *  each only while it is still the latest change in the journal (undoTop), so nothing else is undone.
 *  pending (H1, r8 review 3): his answer to an earlier add question — a yes runs the stored argv exactly;
 *  a title answer compiles the stored anchor again with that title. */
export declare function runScheduleFlow({ message, clock, exec, ask, now, undo, undoTop, pending, askContext, deadlineAt }: {
    message: string;
    clock: string;
    now?: Date;
    askContext?: AskContext;
    exec: (args: string[]) => Promise<{
        stdout: string;
        code: number;
    }>;
    /** budgetMs: how long this one call may take (turn-budget.ts); a model call past it is abandoned and answers null. */
    ask: (system: string, user: string, schema: object, budgetMs?: number) => Promise<{
        steps?: Intent[];
    } | null>;
    undo?: string[];
    undoTop?: () => string | null;
    pending?: PendingRun;
    /** The instant after which nothing is written (a flow that is still thinking then is the worker's, with the slim prompt). */
    deadlineAt?: number;
}): Promise<FlowResult>;
/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export declare function spokenReply(outputs: string[], when?: string): string;
