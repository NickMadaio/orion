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
    do: "fill_between" | "plan" | "clear_after" | "move" | "resize" | "extend" | "add" | "drop" | "skip" | "swap" | "tidy" | "cannot" | "ask" | "answer";
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
export declare const FORM_PROMPT = "You fill in a form for ORION's scheduler. You get the time now, Nick's day as numbered blocks (B1, B2\u2026; FIXED = a class or plan with people) and what he says. Choose the steps that do exactly what he asked; the scheduler does the times and slides other blocks.\n\nSteps:\n- fill_between: put \"what\" (a block id, or a new title) in all the time between block \"after\" and block \"before\" (\"between DS and my lab\", \"the entire time between the two classes\")\n- plan: after block \"after\" he goes somewhere and does several things there (the list itself is read separately \u2014 just give \"after\")\n- clear_after: remove everything planned after block \"after\" (\"clear my schedule after the lab\", \"I'm going home after X, clear the rest\") \u2014 classes and plans with people stay\n- move: block \"what\" to start at \"to\" (HH:MM), or end at \"until\", or shift it \"by\" minutes (\"push it back half an hour\" = by 30, \"an hour earlier\" = by -60 \u2014 never work out the clock time yourself)\n- resize: block \"what\" lasts \"minutes\" in total\n- extend: block \"what\" (running long) ends at \"until\"; \"N more minutes\" = now + N\n- add: a new block titled \"what\", \"minutes\" long, at \"to\" or right after block \"after\"\n- drop: remove block \"what\" (movable only) \u00B7 skip: he is not going to class \"what\" today\n- swap: block \"what\" with block \"with\" \u00B7 tidy: separate overlaps\n- cannot: it cannot be done \u2014 say why in \"text\" \u00B7 ask: only if no block tells you \u2014 question in \"text\" \u00B7 answer: he only asked a question \u2014 reply in \"text\"\n\nExamples, for this SAMPLE day only (his real day below has its own ids \u2014 never copy these ids):\n  B1 11:00\u201312:30 Discrete Structures (FIXED) \u00B7 B2 15:30\u201317:00 Lab (FIXED) \u00B7 B3 17:50\u201321:50 cert courses\n- \"stay in the building between DS and my lab, schedule cert courses the entire time between the two classes\" \u2192 {\"steps\":[{\"do\":\"fill_between\",\"what\":\"B3\",\"after\":\"B1\",\"before\":\"B2\"}]}\n- \"put gym between my two classes\" (gym is not on the day) \u2192 {\"steps\":[{\"do\":\"fill_between\",\"what\":\"gym\",\"after\":\"B1\",\"before\":\"B2\"}]}\n- \"after my lab I'll go to the library, 10 min walk, then do my essay and call mom\" \u2192 {\"steps\":[{\"do\":\"plan\",\"after\":\"B2\"}]}\n- \"going back to my dorm after the lab, clear my schedule after it, I'll tell you the plan later\" \u2192 {\"steps\":[{\"do\":\"clear_after\",\"after\":\"B2\"}]}\n- \"skip the lab today\" \u2192 {\"steps\":[{\"do\":\"skip\",\"what\":\"B2\"}]}   (a class is skipped, never dropped or moved)\n- \"push cert courses to 6\" \u2192 {\"steps\":[{\"do\":\"move\",\"what\":\"B3\",\"to\":\"18:00\"}]}\n- \"push cert courses back 20 min\" \u2192 {\"steps\":[{\"do\":\"move\",\"what\":\"B3\",\"by\":20}]}\n- \"what time is my lab?\" \u2192 {\"steps\":[{\"do\":\"answer\",\"text\":\"Your lab is <its start>\u2013<its end>.\"}]}   (read the times from his day, never from these examples)\n- \"I'm in a time block but I don't need it. I'm gonna meal prep \u2014 put it from 12:45 to 1:45 and push everything else to follow\" \u2192 {\"steps\":[{\"do\":\"add\",\"what\":\"meal prep\",\"to\":\"12:45\",\"until\":\"13:45\"}]}   (one step: the scheduler cuts short the block he is in and slides everything after it \u2014 never move the blocks after it yourself)\n\nNever drop a block and add it again \u2014 move it (or fill_between). Name blocks by their id. Classes he mentions by name or nickname (\"DS\" = Discrete Structures, \"my lab\", \"program design\") are the matching blocks. Only what he asked for.\nOutput JSON only: {\"steps\":[...]}";
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
type Compiled = {
    args: string[];
} | {
    say: "cannot" | "ask" | "answer";
    text: string;
} | {
    error: string;
};
/** One step → orion-reschedule arguments (argv, no shell), or what to tell him. */
export declare function compile(input: Intent, day: Day): Compiled;
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
export declare const RESCHEDULE = "/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule";
export type FlowResult = 
/** marks: the undo-journal stamp of each change made, so a continuation can take them back; undone: changes reverted first. */
{
    outcome: "done";
    calls: string[];
    outputs: string[];
    marks?: string[];
    undone?: number;
} | {
    outcome: "say";
    text: string;
    kind: "cannot" | "ask";
} | {
    outcome: "fallback";
    reason: string;
};
/** The whole fixed sequence for one request. exec runs the scheduler with argv (no shell).
 *  undo: stamps of changes an earlier, cut-off half of this request made — reverted first, newest first,
 *  each only while it is still the latest change in the journal (undoTop), so nothing else is undone. */
export declare function runScheduleFlow({ message, clock, exec, ask, now, undo, undoTop }: {
    message: string;
    clock: string;
    now?: Date;
    exec: (args: string[]) => Promise<{
        stdout: string;
        code: number;
    }>;
    ask: (system: string, user: string, schema: object) => Promise<{
        steps?: Intent[];
    } | null>;
    undo?: string[];
    undoTop?: () => string | null;
}): Promise<FlowResult>;
/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export declare function spokenReply(outputs: string[]): string;
export {};
