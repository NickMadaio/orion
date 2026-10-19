import type { PendingAdd, PendingRun, TitlePending } from "./schedule-pending.js";
export type DayBlock = {
    title: string;
    start: string;
    end: string;
    fixed: boolean;
    kind?: string;
};
export type Day = {
    date: string;
    now: string | null;
    blocks: DayBlock[];
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
export declare const FORM_PROMPT = "You fill in a form for ORION's scheduler. You get the time now, Nick's day as numbered blocks (B1, B2\u2026; FIXED = a class or plan with people) and what he says. Choose the steps that do exactly what he asked; the scheduler does the times and slides other blocks.\n\nSteps:\n- fill_between: put \"what\" (a block id, or a new title) in all the time between block \"after\" and block \"before\" (\"between DS and my lab\", \"the entire time between the two classes\")\n- plan: after block \"after\" he goes somewhere and does several things there (the list itself is read separately \u2014 just give \"after\")\n- clear_after: remove everything planned after block \"after\" (\"clear my schedule after the lab\", \"I'm going home after X, clear the rest\") \u2014 classes and plans with people stay\n- move: block \"what\" to start at \"to\" (HH:MM), or end at \"until\", or shift it \"by\" minutes (\"push it back half an hour\" = by 30, \"an hour earlier\" = by -60 \u2014 never work out the clock time yourself)\n- resize: block \"what\" lasts \"minutes\" in total\n- extend: block \"what\" (running long) ends at \"until\"; \"N more minutes\" = now + N\n- add: a new block titled \"what\", \"minutes\" long, at \"to\" or right after block \"after\"\n- drop: remove block \"what\" (movable only) \u00B7 skip: he is not going to class \"what\" today\n- swap: block \"what\" with block \"with\" \u00B7 tidy: separate overlaps\n- late: he is running \"minutes\" late right now (\"I'm running 15 late\") \u2014 everything not yet done slides back\n- overrun: class \"what\" runs \"minutes\" over, or he is late to it and wants what comes after it pushed back by \"minutes\"\n- log: he says what he did or is doing, which may be over a planned block (\"i'm at the gym\", \"was at the library since 2\", \"gym 2-4\", \"did gym instead of resume\"): \"what\" is his own short title, \"from\" when he started (24-hour HH:MM), \"to\" when it ended (HH:MM) or \"now\" if he is still at it, \"instead\" the block id it replaced if he says so. A time he does not give is left out \u2014 code fills it in. \"nothing\", \"nothing really\", \"just chilling\" is NOT a log: answer\n- cannot: it cannot be done \u2014 say why in \"text\" \u00B7 ask: only if no block tells you \u2014 question in \"text\" \u00B7 answer: he only asked a question \u2014 reply in \"text\"\n\nExamples, for this SAMPLE day only (his real day below has its own ids \u2014 never copy these ids):\n  B1 11:00\u201312:30 Discrete Structures (FIXED) \u00B7 B2 15:30\u201317:00 Lab (FIXED) \u00B7 B3 17:50\u201321:50 cert courses\n- \"stay in the building between DS and my lab, schedule cert courses the entire time between the two classes\" \u2192 {\"steps\":[{\"do\":\"fill_between\",\"what\":\"B3\",\"after\":\"B1\",\"before\":\"B2\"}]}\n- \"put gym between my two classes\" (gym is not on the day) \u2192 {\"steps\":[{\"do\":\"fill_between\",\"what\":\"gym\",\"after\":\"B1\",\"before\":\"B2\"}]}\n- \"after my lab I'll go to the library, 10 min walk, then do my essay and call mom\" \u2192 {\"steps\":[{\"do\":\"plan\",\"after\":\"B2\"}]}\n- \"going back to my dorm after the lab, clear my schedule after it, I'll tell you the plan later\" \u2192 {\"steps\":[{\"do\":\"clear_after\",\"after\":\"B2\"}]}\n- \"skip the lab today\" \u2192 {\"steps\":[{\"do\":\"skip\",\"what\":\"B2\"}]}   (a class is skipped, never dropped or moved)\n- \"push cert courses to 6\" \u2192 {\"steps\":[{\"do\":\"move\",\"what\":\"B3\",\"to\":\"18:00\"}]}\n- \"push cert courses back 20 min\" \u2192 {\"steps\":[{\"do\":\"move\",\"what\":\"B3\",\"by\":20}]}\n- \"running 15 min behind, push everything\" \u2192 {\"steps\":[{\"do\":\"late\",\"minutes\":15}]}   (\"I'm running late\" with no number \u2192 ask how late)\n- \"DS is going 20 over\" \u2192 {\"steps\":[{\"do\":\"overrun\",\"what\":\"B1\",\"minutes\":20}]}\n- \"add a 15 minute stretch block tomorrow at 7:30 am\" \u2192 {\"steps\":[{\"do\":\"add\",\"what\":\"stretch\",\"minutes\":15,\"to\":\"07:30\"}]}   (a time he says goes in \"to\", 24-hour \u2014 never leave it out; \"tomorrow\" is the day shown, not part of the step)\n- \"what time is my lab?\" \u2192 {\"steps\":[{\"do\":\"answer\",\"text\":\"Your lab is <its start>\u2013<its end>.\"}]}   (read the times from his day, never from these examples)\n- \"I'm in a time block but I don't need it. I'm gonna meal prep \u2014 put it from 12:45 to 1:45 and push everything else to follow\" \u2192 {\"steps\":[{\"do\":\"add\",\"what\":\"meal prep\",\"to\":\"12:45\",\"until\":\"13:45\"}]}   (one step: the scheduler cuts short the block he is in and slides everything after it \u2014 never move the blocks after it yourself)\n\n- \"i'm at the gym\" \u2192 {\"steps\":[{\"do\":\"log\",\"what\":\"gym\"}]}   (no times said: leave from and to out)\n- \"was at the library since 2\" \u2192 {\"steps\":[{\"do\":\"log\",\"what\":\"library\",\"from\":\"14:00\",\"to\":\"now\"}]}\n- \"gym 2-4\" \u2192 {\"steps\":[{\"do\":\"log\",\"what\":\"gym\",\"from\":\"14:00\",\"to\":\"16:00\"}]}\n- \"did gym instead of resume\" \u2192 {\"steps\":[{\"do\":\"log\",\"what\":\"gym\",\"instead\":\"B3\"}]}   (B3 = the resume block on that day)\n- \"nothing really\" \u2192 {\"steps\":[{\"do\":\"answer\",\"text\":\"Okay, nothing logged.\"}]}\n\nNever drop a block and add it again \u2014 move it (or fill_between). Name blocks by their id. Classes he mentions by name or nickname (\"DS\" = Discrete Structures, \"my lab\", \"program design\") are the matching blocks. Only what he asked for.\nOutput JSON only: {\"steps\":[...]}";
export declare const EXTRACT_PROMPT = "From what Nick says, list where he is going, how many minutes it takes to get there (0 if he does not say), and the things he will do there, in his order. When he lists what he will do, the general reason for going (\"to study\", \"to work\") is not a separate thing. Each thing: a short title in his words, and minutes \u2014 his number if he gives one, otherwise an honest estimate (15 for a quick errand or a look-up, 45 for a task or prep, 60 for practice or study). Output JSON only: {\"where\":\"\",\"travel\":0,\"items\":[{\"title\":\"\",\"minutes\":45}]}";
export declare const EXTRACT_SCHEMA: {
    type: string;
    properties: {
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
    };
    required: string[];
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
export declare function runScheduleFlow({ message, clock, exec, ask, now, undo, undoTop, pending, askContext }: {
    message: string;
    clock: string;
    now?: Date;
    askContext?: AskContext;
    exec: (args: string[]) => Promise<{
        stdout: string;
        code: number;
    }>;
    ask: (system: string, user: string, schema: object) => Promise<{
        steps?: Intent[];
    } | null>;
    undo?: string[];
    undoTop?: () => string | null;
    pending?: PendingRun;
}): Promise<FlowResult>;
/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export declare function spokenReply(outputs: string[], when?: string): string;
export {};
