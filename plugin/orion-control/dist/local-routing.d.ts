import { type PlaceRun } from "./place-save-run.js";
import { type Decision } from "./front-desk.js";
import { type ToolResult } from "./work-check.js";
import { type SessionExec, type SessionHint } from "./session-flow.js";
import { type ChatDeps } from "./chat-asks.js";
import { type TimerDeps } from "./timer-flow.js";
import type { Reminder } from "./ambient.js";
import { type ReplanAsk } from "./day-replan.js";
import { parseEdit, type EditTarget } from "./edit-followup.js";
import { type ComputerDeps } from "./computer-loop.js";
import { type MessagesRead, type ReadOutcome } from "./messages-read.js";
import { type OfferPort, type StoredReminder } from "./reminder-flow.js";
import { type DeadlineRead } from "./deadline-read.js";
import { type ReadyDeps } from "./focus-ready.js";
import { type FocusRow } from "./focus-status.js";
import { type PendingRun } from "./schedule-pending.js";
import { type Probe, type QueuedMessage } from "./model-outage.js";
import { type AgendaRun } from "./agenda-day.js";
import { type ConnectorRow, type HealthLog } from "./code-answers.js";
import { type ScriptRun } from "./reality.js";
import { type PhoneTimeRun } from "./phone-block-flow.js";
import { type SleepRun } from "./sleep-plan-flow.js";
import { type KnowledgeRun } from "./knowledge-run.js";
import { type SelffixRun } from "./selffix-flow.js";
import { type QuestionsRun } from "./questions-flow.js";
import { type FoodRun } from "./food-chat.js";
import { type AppsRun } from "./apps-chat.js";
import { type ShutdownRun } from "./bedtime-shutdown-chat.js";
import { type WorkoutRun } from "./workout-chat.js";
import { type MouseRun } from "./mouse-chat.js";
import { type JournalEntry, type LedgerRun } from "./ledger-run.js";
import { type MailPrefsRun } from "./mail-flow.js";
import { type AskContext, type Day, type FlowResult } from "./schedule-flow.js";
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
    /** 2026-10-31: the computer-use loop (computer-loop.ts): "close my safari tabs", "whats on my screen". Progress is wired here; absent means the loop never runs. */
    computer?: Omit<ComputerDeps, "progress">;
    mode: LocalRoutingMode;
    logPath: string;
    decideImpl?: (input: {
        message: string;
        clock: string;
        timeoutMs?: number;
        history?: Array<{
            role: "user" | "assistant";
            content: string;
        }>;
        context?: string;
    }) => Promise<Decision>;
    /** ORION's state directory (now.json, declared facts, slips, routines, outreach): the state card's source (state-card.ts).
     *  Unset (tests that do not name one): no card, and nothing is read from or written to any state dir. index.ts wires the live one. */
    stateDir?: string;
    /** USER.md, for the card's few essentials about him. */
    userMdPath?: string;
    /** Runs scripts/orion-declare or scripts/orion-reschedule with fixed arguments (no shell), for reality statements (reality.ts).
     *  Unset: reality statements route as before. index.ts wires the real scripts; tests pass a stub. */
    realityRun?: ScriptRun;
    /** Whether the local model answers (index.ts: probeOllama). Unset: no outage gate and no replay (model-outage.ts). */
    modelProbe?: Probe;
    /** Loads the local models (keepWarm), tried once before a turn is given up as "model down". */
    modelWarm?: () => Promise<unknown>;
    /** How long to wait after warming before asking again (default 1500 ms; tests shorten it). */
    warmWaitMs?: number;
    /** Replays a message queued while the model was down, in its session, and delivers the reply (index.ts). */
    replay?: (row: QueuedMessage) => Promise<boolean>;
    /** Runs orion-checkin with these arguments (index.ts wires the real script); a reply to a start line sets its check-in through it (2026-10-23). */
    checkinRun?: (args: string[]) => Promise<{
        stdout: string;
        code: number;
    }>;
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
        lengthDefaulted?: boolean;
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
    /** W5: orion-wake with fixed arguments, for the bedtime reply's alarm check (pending-reply-bed.ts). Wired in by index.ts only. */
    wakeExec?: (args: string[]) => Promise<{
        stdout: string;
        code: number;
    }>;
    /** W5: orion-remember with fixed arguments, for a stated preference (preference-remember.ts). Wired in by index.ts only. */
    rememberRun?: (args: string[]) => Promise<{
        stdout: string;
        code: number;
    }>;
    /** W10-B: scripts/orion-sleepplan with fixed arguments (sleep-plan-flow.ts). Wired in by index.ts only. */
    sleepPlanRun?: SleepRun;
    /** W10-G: scripts/orion-phone-time with fixed arguments, for "block safari till 12" (phone-block-flow.ts). Wired in by index.ts only. */
    phoneTimeRun?: PhoneTimeRun;
    /** Ticks a to-do off (scripts/orion-tasks done) for "mark the oats one done" (tests pass a stub; wired from index.ts). */
    todoDoneFlow?: (message: string) => Promise<FlowResult>;
    /** w18 note: saves a note's whole text (note-flow.ts); tests pass a stub, never his real vault. */
    noteFlow?: (message: string, bound?: boolean) => Promise<FlowResult>;
    /** w20 r3 (chat-asks.ts): open an app or site, add to his list, read his list; tests pass stubs, index.ts wires the real ones. */
    chatRun?: ChatDeps;
    /** orion-session with fixed arguments, for the focus moves: break, extend, block, doomscroll (focus-moves.ts). Tests pass a stub; wired from index.ts. */
    sessionExec?: SessionExec;
    /** "im ready to work", finishing a session early, one-time site allow (focus-ready.ts). Tests pass stubs; wired from index.ts. */
    focusReady?: Pick<ReadyDeps, "exec" | "profile" | "sites" | "tasks" | "resolveApp" | "pending">;
    /** Reads the focus session's state for a status question (tests pass a stub; wired from index.ts). */
    sessionStatus?: () => Promise<FlowResult>;
    /** The focus history rows, for "how long have i been focusing today" (tests pass a stub; default reads the real file, read-only). */
    focusHistory?: () => FocusRow[];
    /** Pulls {time "HH:MM" or null, label} out of a reminder request (tests pass a stub; wired from index.ts). */
    extractReminder?: (message: string, clock?: string) => Promise<{
        time: string | null;
        label: string;
    } | null>;
    /** w20 r4 (timer-flow.ts): writes a timer into the reminder store, as timer_set does; unset: timers stay with the worker. Wired from index.ts. */
    addTimer?: TimerDeps["add"];
    /** w20 r6 (reminder-split.ts): writes one plain reminder into the store, as alarm_set does; unset: a reminder joined to another ask goes the old way. Wired from index.ts. */
    addReminder?: (dueAt: number, label: string, important: boolean) => Promise<Reminder>;
    /** Reads the live reminder store, to list and to find what to cancel (tests pass a stub; wired from index.ts). */
    listReminders?: () => Promise<StoredReminder[]>;
    /** w20 r3 (ledger-run.ts): scripts the ledger removes things with (orion-reschedule, orion-log, orion-brain, orion-food-estimate); unset: the ledger stays off. */
    ledgerRun?: LedgerRun;
    /** Takes reminders out of the store by id (under the store's lock); with listReminders it is how "cancel the stretch one" works. */
    removeReminders?: (ids: string[]) => Promise<void>;
    /** The scheduler's undo journal, oldest first (default: the file the scheduler writes). */
    undoJournal?: () => JournalEntry[];
    /** Reminders ORION offers (a thing he says he has to do, a deadline) and his "yes" to them (reminder-offers.ts). */
    offerPort?: OfferPort;
    /** The current time for reminder arithmetic (tests pin it). */
    now?: () => Date;
    /** Reads his day as a numbered list for questions (tests pass a stub; wired from index.ts). */
    readDay?: (tomorrow: boolean) => Promise<string>;
    /** Reads a day as `show --json` gives it (--date args), for the time backstop on the worker's own writes (tests pass a stub; wired from index.ts). */
    readDayJson?: (dateArgs: string[]) => Promise<Day | undefined>;
    /** What the calendar held on a day that is over (agenda-day.ts): yesterday cannot be read by the scheduler. */
    agendaDay?: AgendaRun;
    /** How long that read may take before the write is refused as unreadable (default DAY_READ_MS; tests shorten it). */
    dayReadMs?: number;
    /** Reads the calendar's deadlines and dated to-dos for "whats due this week"; null when it fails (tests pass a stub; wired from index.ts) (q041, 2026-10-16 r8). */
    readDeadlines?: () => Promise<DeadlineRead | null>;
    /** 2026-10-31 (code-answers.ts): the health log for sleep questions (default: health-log.json in stateDir) and connector key status (names and set / not set only). */
    readHealth?: () => Promise<HealthLog | undefined>;
    connectorStatus?: () => Promise<ConnectorRow[] | undefined>;
    /** Brain search used to pre-fetch notes for each message (tests pass a stub). */
    brainSearch?: (query: string) => Promise<string>;
    /** Wave 6 (knowledge-run.ts): orion-brain forget/links/profile and orion-trash. Unset, those moves are not taken. */
    knowledgeRun?: KnowledgeRun;
    /** w19 selffix (selffix-flow.ts): orion-selfcheck and orion-selffix; unset, the real scripts with stateDir. */
    selffixRun?: SelffixRun;
    /** Wave 12 L1 (questions-flow.ts): orion-questions; unset, the real script with stateDir. */
    questionsRun?: QuestionsRun;
    /** Wave 14 (mail-flow.ts): orion-mail-prefs; unset, the real script with stateDir. */
    mailPrefsRun?: MailPrefsRun;
    /** w14 g-food: orion-food-estimate (food-chat.ts). Without it no turn is a food estimate and a meal is logged as before. */
    foodRun?: FoodRun;
    /** w17 g-workout: orion-workout-log (workout-chat.ts). Without it no turn is a workout log. */
    workoutRun?: WorkoutRun;
    /** w18 apps: orion-apps (apps-chat.ts). Without it no turn is an apps turn. */
    appsRun?: AppsRun;
    /** w18 bedtime: orion-bedtime-shutdown (bedtime-shutdown-chat.ts). Without it no turn is a shutdown turn. */
    shutdownRun?: ShutdownRun;
    /** w18 mousechat: orion-mouse (mouse-chat.ts). Without it no turn is a mouse-button request. */
    mouseRun?: MouseRun;
    /** w20 (place-save.ts): scripts/orion-awareness, the one writer of known places. Unset: the save-a-place thread is not code's. */
    placeRun?: PlaceRun;
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
/** A "say" from the schedule flow that is only the scheduler refusing a log it should never have been asked for. */
export declare const misreadLog: (flow: FlowResult | undefined) => boolean;
/** 2026-10-30: the front desk is told a turn came through the microphone, so room speech is "ignore" (R2: 30 replies to a rehearsal). */
export declare const SPOKEN_DESK_NOTE = "Heard through the Mac microphone, maybe not said to ORION: if it is not a request or question for ORION (talk to someone in the room, a call, TV, rehearsing, thinking aloud), the move is ignore.";
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
/** The cap on reading his day before a worker write (re-review: never a long stall in a tool call). */
export declare const DAY_READ_MS = 5000;
/** The day as data (`show --json`, read-only), or undefined when it cannot be read. */
export declare const liveReadDayJson: (dateArgs: string[]) => Promise<Day | undefined>;
export declare const liveReadDay: (tomorrow: boolean) => Promise<string>;
/** The stamp of the newest change in the scheduler's undo journal (the entry "orion-reschedule undo"
 *  reverts; same file and same skipping of empty entries as scripts/lib/life/calendar-write.mjs). */
export declare function undoJournalTop(home?: string, now?: number): string | null;
/** The whole undo journal, oldest first (the file `orion-reschedule undo` pops from); empty when it cannot be read. */
export declare function undoJournalEntries(home?: string, now?: number): JournalEntry[];
/** The real scheduling flow (scheduler + worker via Ollama). Wired in by index.ts only. */
export declare const liveScheduleFlow: (message: string, clock: string, opts?: {
    lengthDefaulted?: boolean;
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
/** orion-checkin with fixed arguments (no shell): a reply to ORION's start line sets or closes its check-in (2026-10-23). Wired in by index.ts only. */
export declare const liveCheckinRun: (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
/** orion-declare / orion-reschedule with fixed arguments (no shell), for reality statements (2026-10-30). Wired in by index.ts only. */
export declare const liveRealityRun: ScriptRun;
/** The scripts the ledger removes things with, fixed arguments and no shell. Wired in by index.ts only. */
export declare const liveLedgerRun: LedgerRun;
/** Loads both local models at the context each is called with (2026-10-30: the outage gate's one warm-and-retry). Wired in by index.ts only. */
export declare const liveModelWarm: () => Promise<string[]>;
/** Replays a message queued while the model was down (model-outage.ts): one agent turn in its own session, and the reply is
 *  pushed to him through orion-reach as a real message, marked as a replay. Wired in by index.ts only. */
export declare const liveReplay: (row: QueuedMessage) => Promise<boolean>;
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
export declare const isPlanStatement: (message: string) => boolean;
export declare const STATEMENT_LINE = "Got it. I haven't changed or noted anything. Tell me if you want me to add it to your day.";
/** w20 wording: never "say it again". From the tool results when there are any (what ran, what failed and why, the next step);
 *  else what really happened (nothing ran) and an offer to do it now. `rotate` avoids the same variant twice in a row (live replies only). */
export declare const honestLine: (calendar: boolean, message?: string, tools?: ReadonlyArray<ToolResult>, rotate?: boolean) => string;
export declare const MESSAGES_UNSURE = "I read your messages but my summary contradicted itself, so I won't guess. Ask me again and I'll read them out.";
export declare const LOOKUP_HONEST = "I didn't actually check that, so I can't tell you yet. Want me to look it up now?";
/** Spoken turns get one revise round (turn-budget.ts). What HONEST_STOP would have had the model say, said by code instead. */
export declare const SPOKEN_STOP_WROTE = "Something went wrong partway through that, so I won't say it's done. Check your calendar, and say \"undo\" if it looks wrong.";
export declare const SPOKEN_STOP = "That didn't finish properly, so I won't say it's done. Want me to run it again?";
/**
 * Review of feat/voice-fluid (HIGH 3): after a spoken turn's single retry, ANY finding still open ends in an honest line written by code —
 * never the model's reply, never a clean success line over a failed command.
 */
/** The findings that mean the reply would tell him something false about what happened. A wrong time or an "error"
 *  somewhere in a tool's output beside a real success does not (re-review HIGH): those keep the model's reply. Overlap and
 *  duplicate count only when the check actually had his calendar to look at. */
export declare const SPOKEN_BLOCKING: readonly ["claims what the tools don't show", "promised but did not act", "failure not mentioned", "did not finish", "denies messages it shows", "claims a lookup it did not do"];
export declare function spokenBlocking(findings: readonly string[], calendarChecked: boolean): string[];
export declare function spokenFinalLine(allFindings: readonly string[], ctx: {
    calendar: boolean;
    wrote: boolean;
    calendarChecked?: boolean;
    tools?: ReadonlyArray<ToolResult>;
    message?: string;
}): string | undefined;
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
