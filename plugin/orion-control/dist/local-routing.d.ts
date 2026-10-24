import { type Decision } from "./front-desk.js";
import { type SessionHint } from "./session-flow.js";
import { type ReplanAsk } from "./day-replan.js";
import { parseEdit, type EditTarget } from "./edit-followup.js";
import { type MessagesRead, type ReadOutcome } from "./messages-read.js";
import { type StoredReminder } from "./reminder-flow.js";
import { type DeadlineRead } from "./deadline-read.js";
import { type FocusRow } from "./focus-status.js";
import { type PendingRun } from "./schedule-pending.js";
import { type AskContext, type FlowResult } from "./schedule-flow.js";
export type LocalRoutingMode = "off" | "shadow" | "on";
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type HookApi = {
    on: (name: string, fn: Handler, opts?: {
        priority?: number;
        timeoutMs?: number;
    }) => unknown;
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
        timeoutMs?: number;
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
        pending?: PendingRun;
        askContext?: AskContext;
        deadlineAt?: number;
        signal?: AbortSignal;
        onWriteStart?: () => void;
        replanContext?: ReplanAsk;
        lastTarget?: {
            title: string;
            start?: string;
            dateArgs: string[];
        };
        edit?: {
            target: Extract<EditTarget, {
                kind: "block";
            }>;
            req: NonNullable<ReturnType<typeof parseEdit>>;
        };
    }) => Promise<FlowResult>;
    /** Moves the rest of today back by N minutes (scripts/orion-reschedule late N); tests pass a stub (q029). */
    lateFlow?: (minutes: number) => Promise<FlowResult>;
    /** Reads his texts or Gmail by code (read-only scripts); tests pass a stub (q066, q069). */
    messagesRead?: (req: MessagesRead) => Promise<ReadOutcome>;
    /** Starts a focus session from his words (tests pass a stub; wired from index.ts). */
    sessionFlow?: (message: string, hint?: SessionHint) => Promise<FlowResult>;
    /** Moves his phone's wake alarm (scripts/orion-wake) for "push my alarm to 12" (tests pass a stub; wired from index.ts). */
    wakeFlow?: (message: string, decision?: Decision) => Promise<FlowResult>;
    /** Ticks a to-do off (scripts/orion-tasks done) for "mark the oats one done" (tests pass a stub; wired from index.ts). */
    todoDoneFlow?: (message: string) => Promise<FlowResult>;
    /** Reads the focus session's state for a status question (tests pass a stub; wired from index.ts). */
    sessionStatus?: () => Promise<FlowResult>;
    /** The focus history rows, for "how long have i been focusing today" (tests pass a stub; default reads the real file, read-only). */
    focusHistory?: () => FocusRow[];
    /** Pulls {time "HH:MM" or null, label} out of a reminder request (tests pass a stub; wired from index.ts). */
    extractReminder?: (message: string, clock?: string) => Promise<{
        time: string | null;
        label: string;
    } | null>;
    /** Reads the live reminder store, to list and to find what to cancel (tests pass a stub; wired from index.ts). */
    listReminders?: () => Promise<StoredReminder[]>;
    /** The current time for reminder arithmetic (tests pin it). */
    now?: () => Date;
    /** Reads his day as a numbered list for questions (tests pass a stub; wired from index.ts). */
    readDay?: (tomorrow: boolean) => Promise<string>;
    /** Reads the calendar's deadlines and dated to-dos for "whats due this week"; null when it fails (tests pass a stub; wired from index.ts) (q041, 2026-10-16 r8). */
    readDeadlines?: () => Promise<DeadlineRead | null>;
    /** Brain search used to pre-fetch notes for each message (tests pass a stub). */
    brainSearch?: (query: string) => Promise<string>;
    /** His Nick note's text, read directly for recall (tests pass a stub; never his real file) (2026-10-16). */
    nickNote?: () => string;
    /** Acceptance record "on" requires (see acceptanceVerdict); undefined skips the gate (tests only). */
    acceptancePath?: string;
    /** Load the front desk at registration (off in tests). */
    warm?: boolean;
    /** Append one line per hook stage to <logPath>.trace (diagnostics). */
    trace?: boolean;
    /** Where the per-turn progress files for the app's spoken updates go (turn-progress.ts); default <logPath>/../../turn-progress. */
    progressDir?: string;
};
export declare const trailsOff: (message: string) => boolean;
export declare const GO_ON = "Go on.";
export declare const UNDO_NOTHING_TO_UNDO = "I haven't changed your calendar in this chat. What should I cancel?";
/** A cancel or undo that names nothing: "cancel that", "undo", "put it back", "never mind that". */
export declare const isBareUndo: (message: string) => boolean;
/** An open ask forces the schedule flow only for a reply that plausibly answers it, not for any message in the next 90 minutes. */
export declare function answersAsk(message: string, ask?: AskContext): boolean;
/** Whether this turn is a change to his calendar at all, whatever words it shares with one. */
export declare function isCalendarTurn(message: string, settled: Decision, askOpen?: boolean): boolean;
/** The front desk's session start, task and length (sweep 2026-10-15, q051: it read "focus mode on for an
 *  hour, leetcode" right — session start, task leetcode — and the calendar flow booked "focus mode"). */
export declare function sessionHint(d: Decision | undefined): SessionHint;
export declare const NOT_CAUGHT = "Didn't catch that \u2014 what do you need?";
export declare function isNotForOrion(message: string, spoken: boolean): boolean;
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
export declare const isPoliteRequest: (message: string) => boolean;
export declare const isQuestion: (message: string) => boolean;
/** His day as a numbered list, read from the scheduler (wired in by index.ts). */
export declare const liveReadDay: (tomorrow: boolean) => Promise<string>;
/** The stamp of the newest change in the scheduler's undo journal (the entry "orion-reschedule undo"
 *  reverts; same file and same skipping of empty entries as scripts/lib/life/calendar-write.mjs). */
export declare function undoJournalTop(home?: string, now?: number): string | null;
/** The real scheduling flow (scheduler + worker via Ollama). Wired in by index.ts only. */
export declare const liveScheduleFlow: (message: string, clock: string, opts?: {
    undo?: string[];
    pending?: PendingRun;
    askContext?: AskContext;
    deadlineAt?: number;
    signal?: AbortSignal;
    onWriteStart?: () => void;
    replanContext?: ReplanAsk;
    lastTarget?: {
        title: string;
        start?: string;
        dateArgs: string[];
    };
    edit?: {
        target: Extract<EditTarget, {
            kind: "block";
        }>;
        req: NonNullable<ReturnType<typeof parseEdit>>;
    };
}) => Promise<FlowResult>;
export declare const REFUSED_NOTHING_CHANGED = "I couldn't make that change just now, so nothing was changed. Tell me the block, the day and the start and end times, and I'll do it.";
/** The real reminder extraction (worker via Ollama, form-constrained). Wired in by index.ts only. */
export declare const liveExtractReminder: (message: string, clock?: string) => Promise<{
    time: string | null;
    label: string;
} | null>;
/**
 * 2026-10-16 (speed audit, docs/audits/2026-10-16-local-speed.md): a reply code already wrote is a one-line system prompt.
 * The 9B only repeats it (it was called with 6.7k tokens of prompt for that, 9.1 s). The hook cannot drop history or tool
 * schemas in this OpenClaw version, so the prompt is as small as it can be; finalize still checks the text and puts it in place.
 */
export declare const EXACT_REPLY_PROMPT = "Reply to Nick with exactly this text and nothing else, and do not call any tools:";
/** "Today is Sunday 2026-10-11; tomorrow is Monday 2026-10-12." — so --date never needs arithmetic. */
export declare function dateLine(now?: Date): string;
export declare const PRODUCTION_NOTES: string;
/** What reaches Nick when the reply still claims what the tools do not show. Dictated as the whole reply
 *  on the last revise: the Mac chat and phone call `openclaw agent --json`, which has no delivery stage,
 *  so the reply_payload_sending swap never runs there. Left to HONEST_STOP alone, the 9B repeated
 *  "I've started the focus session" verbatim (2026-10-15). */
export declare const honestLine: (calendar: boolean) => string;
export declare const MESSAGES_UNSURE = "I read your messages but my summary contradicted itself, so I won't guess. Ask me again and I'll read them out.";
export declare const LOOKUP_HONEST = "I didn't actually check that, so I can't tell you right now. Want me to try again?";
/** Puts the text that must reach Nick into the turn's last assistant message (the one the host builds the
 *  reply from). Sweep 2026-10-15 (q006, q042, q055, q057, q067, q091): on `openclaw agent --json` —
 *  the Mac chat and phone — reply_payload_sending never runs, before_agent_finalize can only revise, and
 *  before_message_write rewrites only the transcript copy, written before the check runs; the reply is
 *  read afterwards from this same message object, so it is changed in place (the one deliberate
 *  mutation here: the host owns the object). "buy more oats has been marked as done" went out after
 *  three flagged passes. Thinking and tool blocks are kept; the text blocks become this one. */
export declare function putReplyInPlace(messages: unknown, text: string): boolean;
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
/** Starts a flow that may write: refused (`refused`) once the prompt hook has aborted its run, else marked as a write that has begun. */
export declare function startWrite<R>(run: {
    abort?: AbortController;
    writeStarted?: boolean;
} | undefined, start: () => Promise<R>, refused: R): Promise<R>;
export declare function registerLocalRouting(api: HookApi, options: LocalRoutingOptions): void;
export {};
