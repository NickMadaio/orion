import { type Decision } from "./front-desk.js";
import { type FlowResult } from "./schedule-flow.js";
export type LocalRoutingMode = "off" | "shadow" | "on";
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type HookApi = {
    on: (name: string, fn: Handler) => unknown;
    logger?: {
        warn?: (m: string) => void;
    };
};
export type LocalRoutingOptions = {
    mode: LocalRoutingMode;
    logPath: string;
    decideImpl?: (input: {
        message: string;
        clock: string;
    }) => Promise<Decision>;
    clock?: () => string;
    finalizeWaitMs?: number;
    workerProvider?: string;
    workerModel?: string;
    /** Requests to change his calendar go to the configured (cloud) model instead of the worker:
     *  the 9B failed his real "fill the time between my classes" three ways (2026-10-12). */
    scheduleChangesToCloud?: boolean;
    /** ISO time until which "on" runs without an acceptance record (deliberate testing; max 48 h ahead). */
    testingUntil?: string;
    /** The scheduling flow (tests pass a stub; default runs the real scheduler and the worker via Ollama). */
    scheduleFlow?: (message: string, clock: string, opts?: {
        undo?: string[];
    }) => Promise<FlowResult>;
    /** Starts a focus session from his words (tests pass a stub; wired from index.ts). */
    sessionFlow?: (message: string) => Promise<FlowResult>;
    /** Pulls {time "HH:MM", label} out of a reminder request (tests pass a stub; wired from index.ts). */
    extractReminder?: (message: string) => Promise<{
        time: string;
        label: string;
    } | null>;
    /** Reads his day as a numbered list for questions (tests pass a stub; wired from index.ts). */
    readDay?: (tomorrow: boolean) => Promise<string>;
    /** Brain search used to pre-fetch notes for each message (tests pass a stub). */
    brainSearch?: (query: string) => Promise<string>;
    /** Acceptance record "on" requires (see acceptanceVerdict); undefined skips the gate (tests only). */
    acceptancePath?: string;
    /** Load the front desk at registration (off in tests). */
    warm?: boolean;
    /** Append one line per hook stage to <logPath>.trace (diagnostics). */
    trace?: boolean;
};
export declare const GO_ON = "Go on.";
/** Nick's own words: the part after a channel brief, if the message carries one. */
export declare function userText(prompt: string): string;
/** "Sat 18:05" in local time, the clock format the front desk was evaluated with. */
export declare function localClock(now?: Date): string;
/** A tool result's text, whatever shape the host hands back. */
export declare function resultText(result: unknown): string;
/** The canonical call string the work check reads ("exec orion-reschedule move …"). */
export declare function canonicalCall(toolName: string, params: unknown): string;
/** The worker's instructions for this job. */
export declare function instructionsFor(decision: Decision | undefined, message: string): string;
export declare const LOOK_IT_UP = "Your manual and his memory live in his brain; you only see a small part of it here. When you need something that is not in front of you \u2014 how a script works, a scheduling rule, dates, his routines, people, preferences, what was decided before \u2014 look it up first with exec: /Users/nickmadaio/Desktop/ORION/scripts/orion-brain search \"<words>\", or read \"ORION Manual - Index\" for the list of manual sections, then read \"<title>\". Never guess a fact about Nick or a command's syntax that you could look up.";
/** Brain search for the message, trimmed to the best few matches (pre-fetched while the front desk decides). */
export declare function brainSnippets(output: string, maxChars?: number): string;
/** His day as a numbered list, read from the scheduler (wired in by index.ts). */
export declare const liveReadDay: (tomorrow: boolean) => Promise<string>;
/** The stamp of the newest change in the scheduler's undo journal (the entry "orion-reschedule undo"
 *  reverts; same file and same skipping of empty entries as scripts/lib/life/calendar-write.mjs). */
export declare function undoJournalTop(home?: string, now?: number): string | null;
/** The real scheduling flow (scheduler + worker via Ollama). Wired in by index.ts only. */
export declare const liveScheduleFlow: (message: string, clock: string, opts?: {
    undo?: string[];
}) => Promise<FlowResult>;
/** The real reminder extraction (worker via Ollama, form-constrained). Wired in by index.ts only. */
export declare const liveExtractReminder: (message: string) => Promise<{
    time: string;
    label: string;
} | null>;
/** "Today is Sunday 2026-10-11; tomorrow is Monday 2026-10-12." — so --date never needs arithmetic. */
export declare function dateLine(now?: Date): string;
export declare const PRODUCTION_NOTES: string;
/** What reaches Nick when the reply still claims what the tools do not show. Dictated as the whole reply
 *  on the last revise: the Mac chat and phone call `openclaw agent --json`, which has no delivery stage,
 *  so the reply_payload_sending swap never runs there. Left to HONEST_STOP alone, the 9B repeated
 *  "I've started the focus session" verbatim (2026-10-15). */
export declare const honestLine: (calendar: boolean) => string;
export declare const ACCEPTANCE: {
    minPassRate: number;
    maxMedianMs: number;
    maxAgeDays: number;
    minCases: number;
};
export declare function acceptanceVerdict(path: string, now?: number): {
    ok: boolean;
    why: string;
};
export declare function registerLocalRouting(api: HookApi, options: LocalRoutingOptions): void;
export {};
