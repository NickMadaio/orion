/*
 Local routing (V3): front desk → worker → check → retry → honest stop.

 docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md; results in docs/evals/v3/REPORT.md §9.

 SHADOW (`localRouting: "shadow"`): on every real turn, ask the front desk what it would have done
 (fire and forget, so no added latency) and run the work check on the answer ORION actually gave;
 append both to a private log. Never overrides, replies or revises.

 ON (`localRouting: "on"`):
   1. before_model_resolve — the front desk (qwen3.5:4b) picks a move; every turn then runs on the
      worker (ollama/qwen3.5:9b) — never the cloud model. For answer/ask the worker is handed the
      front desk's draft to confirm (step 3), since the direct-reply hook does not fire on the
      agent-CLI/phone route (found live 2026-10-11). "ignore" is deliberately NOT silenced: a
      wrong "not for ORION" must never swallow a real request (6/138 critical misroutes held-out).
   2. before_agent_reply — the front desk's own answer/question is sent without a model call.
   3. before_prompt_build — the worker gets the V3-tuned instructions for the job: scheduling
      (coach guide + full reschedule usage), brain, or the general honesty block.
   4. before_agent_finalize — the work check. Findings → one revise with what to fix. Still
      flagged → one more revise: undo any change and tell Nick plainly what did not happen.
      Then finalize. The hand-off to gpt-oss (plan step 5) is logged as `escalationNeeded` until
      that model is registered in the gateway and the follow-up turn is proven.

 Phone, Mac chat and voice all reach the gateway as agent turns, so every channel is covered; the
 phone's channel brief is stripped so the front desk reads only Nick's words.
 (Written by Claude on 2026-10-10 for the V3 implementation.)
*/
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { decide, keepWarm, FRONT_DESK_CTX, type Decision } from "./front-desk.js";
import { FRONT_DESK_MODEL } from "./front-desk-prompt.js";
import { BRAIN_INSTRUCTIONS, FOOD_TOOL, GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS, WORKER_MODEL, WORKOUT_TOOL, MOUSE_TOOL } from "./job-instructions.js";
import { checkWork, outcomeOf, retryInstruction, type ToolResult } from "./work-check.js";
import { isSessionStart, startsSession, type SessionExec, type SessionHint } from "./session-flow.js";
import { guardTaskRun, madeTaskRunCall, taskRunCall, taskRunNow } from "./task-run-wiring.js";
import { asksCurrentTask, asksFocusStatus, withoutDayClaims } from "./status-questions.js";
import { parseTodoDone } from "./todo-done-flow.js";
import { openRequest } from "./open-request.js";
import { isTimerRequest, toolDirective, type ToolDirective } from "./tool-moves.js";
import { directAddShape, restatementIsHis } from "./direct-add.js";
import { type ReplanAsk } from "./day-replan.js";
import { readIntent } from "./calendar-intent.js";
import { runsFirst } from "./intent-run.js";
import { asksDayRead, asksHabit, habitAnswer } from "./day-questions.js";
import { answerAvailability } from "./availability-read.js";
import { blockTarget, isEdit, parseEdit, SESSION_EDIT, whichOne, type EditTarget } from "./edit-followup.js";
import { timeMismatch, writesIn } from "./time-backstop.js";
import { carriesNamedFlag, unnamedAnchorWrite } from "./anchor-write-guard.js";
import { TurnProgress, stageForTool, stagesForReads } from "./turn-progress.js";
import { maybeRunComputerTask, type ComputerDeps } from "./computer-loop.js";
import { detectComputerIntent } from "./computer-intent.js";
import { stepsAsToolResults } from "./computer-evidence.js";
import { DESK_TIMEOUT_MS, DeskHealth, HOOK_TIMEOUT_MS, SLOW_FLOW_LINE, LATE_UNKNOWN_LINE, SLOW_FLOW_MAYBE_WROTE_LINE, SLOW_TURN_LINE, SLOW_TURN_MS, flowDeadline, revisePasses } from "./turn-budget.js";
import { CRISIS_REPLY, OVERWHELMED_NOTE, SUPPORT_LINE, isCrisis, isOverwhelmed, withGentleCheckIn } from "./distress.js";
import { NOTE_ASK, NOTE_WINDOW_MS, isBareNoteRequest, isOtherCommand, parseNote } from "./note-flow.js";
import { FACT_NOTE, FACT_NOW, RECALL_NOTE, RECALL_NOW, SEARCH_UNAVAILABLE, asksRecall, learnedLines, reframeDocumentRecall, searchRefused, stripExecFailed, tellsFact, tellsFactAloud } from "./memory-facts.js";
import { MESSAGES_NOTE, cannotSend, isMessagesJob } from "./messages-route.js";
import { LATE_ASK, LATE_TOO_SMALL, isBareYes, isLateConfirm, isLateWithoutMinutes, lateMinutesAnswer, nothingMovedReply, type LateExec } from "./late-flow.js";
import { parseMessagesRead, readNote, type MessagesRead, type ReadOutcome } from "./messages-read.js";
import { isBareTime, isReminderTurn, leaveAsReminder, planReminder, type OfferPort, type StoredReminder } from "./reminder-flow.js";
import { finalizeReply, mailReadFailed } from "./reply-sanitize.js";
import { SPEAK_AS_I } from "./self-voice.js";
import { readPlanReasons, whyFirstAnswer, whyFirstAsk } from "./plan-why.js";
import { codeDayAnswer, dayRead, isAfterThat, noBlockReply, type DayMemory } from "./day-read-answers.js";
import { asksDeadlines, deadlineReply, type DeadlineRead } from "./deadline-read.js";
import { runFocusReady, type ReadyDeps } from "./focus-ready.js";
import { asksFocusOn, asksFocusToday, focusTodayReply, focusTodayTotal, liveFocusSeconds, localDayKey, noSessionReply, readFocusHistory, type FocusRow } from "./focus-status.js";
import { answerPending, ADD_DECLINED, isYes, type PendingAdd, type PendingAnswer, type PendingRun } from "./schedule-pending.js";
import { whyAnswer } from "./why-answer.js";
import { kindOf, parseOutreach, asksWhy, asksYourQuestion, whyNote, planOutreachReply, outreachHistory, outreachNote, loopArgs, type Outreach } from "./outreach-reply.js";
import { TONE_NOTE, clockOf, deskLine, loadCardInputs, readLastOutreach, stateCard, type CardInputs } from "./state-card.js";
import { readStatedMove } from "./stated-move.js";
import { WIPE_CONFIRM, gymPushback, isWipe, deferAsk, legitAsk, legitLead, readGymSkip, type GymSkip } from "./anchor-guards.js";
import { ModelHealth, OUTAGE_LINE, REPLAY_MARK, ReplayQueue, doneWhileDown, drainQueue, replayText, type Probe, type QueuedMessage } from "./model-outage.js";
import { notBooked, refused, sideNotes, wrote } from "./scheduler-out.js";
import { casualStartTask, workStartTask, type KnownName } from "./work-start.js";
import { QUIET_REPLY, QuietWindow, RepeatGuard, RoomStreak, addressed, quietAck, quietRequest, requestShaped, roomQuiet, roomTalk } from "./chatter.js";
import { planLighten, readLighten, runLighten, saysYes, type LightenPending, type LightenRead } from "./day-lighten.js";
import { readFocusMove, runFocusMove, type FocusMove } from "./focus-moves.js";
import { readHealthIntent, runHealthIntent, sleepLine, type HealthRead } from "./health-log.js";
import { KNOWLEDGE_PROMPT, isKnowledgeAsk } from "./knowledge-ask.js";
import { askKind, ownAnswer, readGraphFile, readHealthFile, type AskKind, type ConnectorRow, type HealthLog } from "./code-answers.js";
import { declareOnly, readReality, runReality, undoReality, type RealityRead, type ScriptRun } from "./reality.js";
import { pluginNow } from "./plugin-clock.js";
import { asksTheTime, timeReply } from "./clock-answer.js";
import { activityReply, asksActivity } from "./activity-read.js";
import { LATE_TONE_LINE, pastNudgeTime, stripLateInstruction } from "./night-hush.js";
import { PendingMemory, continuationOf, readPendingTurn, runPendingTurn, type PendingTurn } from "./pending-reply.js";
import { learnPersonAfter } from "./person-learn.js";
/** w16: sessions that are a chat with him (the app's chats, the phone thread, a DM); a CLI check or a probe is not. */
const CHAT_SURFACE = /:(?:orion-chat-|discord|telegram|imessage|whatsapp|main$)/;
import { bedtimeFromState, focusRunning } from "./bed-state.js";
import { readPreference, savePreference, type Preference } from "./preference-remember.js";
import { learnCorrection, pendingOffer, standingRulesLine } from "./correction-learn.js";
import { ownsSleepStatement, readSleepTurn, type SleepTurn } from "./sleep-plan-read.js";   // W10-B: a standing wake statement wins over a health read ("gym days")
import { readPhoneBlock, type PhoneBlockRead } from "./phone-block-read.js";
import { runPhoneBlock, type PhoneTimeRun } from "./phone-block-flow.js";
import { runSleepTurn, SleepPlanPending, type SleepRun } from "./sleep-plan-flow.js";
import { readDayDefault, runDayDefault, type DayDefault } from "./day-defaults.js";
import { KnowledgePending, readKnowledgeMove } from "./knowledge-moves.js";   // wave 6: forget / links / profile / trash
import { runKnowledgeMove, type KnowledgeRun } from "./knowledge-run.js";
import { liveSelffixRun, readSelffixMove, runSelffixMove, type SelffixRun } from "./selffix-flow.js";   // w19 selffix
import { liveQuestionsRun, readQuestionsMove, runQuestionsMove, type QuestionsRun } from "./questions-flow.js";   // wave 12 L1
import { readFoodTurn } from "./food-read.js";   // w14 g-food
import { FoodMemory, readFoodPending, runFoodTurn, type FoodRun } from "./food-chat.js";   // w14 g-food
import { readWorkoutTurn } from "./workout-read.js";   // w17 g-workout
import { readAppsTurn } from "./apps-read.js";   // w18 apps
import { runAppsTurn, type AppsRun } from "./apps-chat.js";   // w18 apps
import { isShutdownOffer, readShutdownTurn } from "./bedtime-shutdown-read.js";   // w18 bedtime
import { runShutdownTurn, type ShutdownRun } from "./bedtime-shutdown-chat.js";
import { readLastOutreach as lastPush } from "./state-card.js";
import { WorkoutMemory, readWorkoutPending, runWorkoutTurn, type WorkoutRun } from "./workout-chat.js";   // w17 g-workout
import { readMouseTurn } from "./mouse-read.js";   // w18 mousechat
import { MouseMemory, runMouseTurn, type MouseRun } from "./mouse-chat.js";   // w18 mousechat
import { answeredCardLine } from "./questions-store.js";
import { liveMailPrefsRun, readMailMove, runMailMove, type MailPrefsRun } from "./mail-flow.js";   // wave 14 f-mail
import { approvalAsk } from "./approval-reply.js";   // run-1101020721: a held send is said as a draft and a question
import { FORM_OPTIONS, NOTHING_REPLY, RESCHEDULE, TOMORROW, LATE_NIGHT_UNTIL, meansTomorrow, blockList, runScheduleFlow, spokenReply, parseAskContext, type AskContext, type Day, type FlowResult } from "./schedule-flow.js";

export type LocalRoutingMode = "off" | "shadow" | "on";
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type HookApi = { on: (name: string, fn: Handler, opts?: { priority?: number; timeoutMs?: number }) => unknown; logger?: { warn?: (m: string) => void } };

export type LocalRoutingOptions = {
  /** 2026-10-31: the computer-use loop (computer-loop.ts): "close my safari tabs", "whats on my screen". Progress is wired here; absent means the loop never runs. */
  computer?: Omit<ComputerDeps, "progress">;
  mode: LocalRoutingMode;
  logPath: string;
  decideImpl?: (input: { message: string; clock: string; timeoutMs?: number; history?: Array<{ role: "user" | "assistant"; content: string }>; context?: string }) => Promise<Decision>;
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
  checkinRun?: (args: string[]) => Promise<{ stdout: string; code: number }>;
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
  scheduleFlow?: (message: string, clock: string, opts?: { lengthDefaulted?: boolean; undo?: string[]; pending?: PendingRun; askContext?: AskContext; deadlineAt?: number; signal?: AbortSignal; onWriteStart?: () => void; replanContext?: ReplanAsk; lastTarget?: { title: string; start?: string; dateArgs: string[] }; edit?: { target: Extract<EditTarget, { kind: "block" }>; req: NonNullable<ReturnType<typeof parseEdit>> } }) => Promise<FlowResult>;
  /** Moves the rest of today back by N minutes (scripts/orion-reschedule late N); tests pass a stub (q029). */
  lateFlow?: (minutes: number) => Promise<FlowResult>;
  /** Reads his texts or Gmail by code (read-only scripts); tests pass a stub (q066, q069). */
  messagesRead?: (req: MessagesRead) => Promise<ReadOutcome>;
  /** Starts a focus session from his words (tests pass a stub; wired from index.ts). */
  sessionFlow?: (message: string, hint?: SessionHint) => Promise<FlowResult>;
  /** Moves his phone's wake alarm (scripts/orion-wake) for "push my alarm to 12" (tests pass a stub; wired from index.ts). */
  wakeFlow?: (message: string, decision?: Decision) => Promise<FlowResult>;
  /** W5: orion-wake with fixed arguments, for the bedtime reply's alarm check (pending-reply-bed.ts). Wired in by index.ts only. */
  wakeExec?: (args: string[]) => Promise<{ stdout: string; code: number }>;
  /** W5: orion-remember with fixed arguments, for a stated preference (preference-remember.ts). Wired in by index.ts only. */
  rememberRun?: (args: string[]) => Promise<{ stdout: string; code: number }>;
  /** W10-B: scripts/orion-sleepplan with fixed arguments (sleep-plan-flow.ts). Wired in by index.ts only. */
  sleepPlanRun?: SleepRun;
  /** W10-G: scripts/orion-phone-time with fixed arguments, for "block safari till 12" (phone-block-flow.ts). Wired in by index.ts only. */
  phoneTimeRun?: PhoneTimeRun;
  /** Ticks a to-do off (scripts/orion-tasks done) for "mark the oats one done" (tests pass a stub; wired from index.ts). */
  todoDoneFlow?: (message: string) => Promise<FlowResult>;
  /** w18 note: saves a note's whole text (note-flow.ts); tests pass a stub, never his real vault. */
  noteFlow?: (message: string, bound?: boolean) => Promise<FlowResult>;
  /** orion-session with fixed arguments, for the focus moves: break, extend, block, doomscroll (focus-moves.ts). Tests pass a stub; wired from index.ts. */
  sessionExec?: SessionExec;
  /** "im ready to work", finishing a session early, one-time site allow (focus-ready.ts). Tests pass stubs; wired from index.ts. */
  focusReady?: Pick<ReadyDeps, "exec" | "profile" | "sites" | "tasks" | "resolveApp" | "pending">;
  /** Reads the focus session's state for a status question (tests pass a stub; wired from index.ts). */
  sessionStatus?: () => Promise<FlowResult>;
  /** The focus history rows, for "how long have i been focusing today" (tests pass a stub; default reads the real file, read-only). */
  focusHistory?: () => FocusRow[];
  /** Pulls {time "HH:MM" or null, label} out of a reminder request (tests pass a stub; wired from index.ts). */
  extractReminder?: (message: string, clock?: string) => Promise<{ time: string | null; label: string } | null>;
  /** Reads the live reminder store, to list and to find what to cancel (tests pass a stub; wired from index.ts). */
  listReminders?: () => Promise<StoredReminder[]>;
  /** Reminders ORION offers (a thing he says he has to do, a deadline) and his "yes" to them (reminder-offers.ts). */
  offerPort?: OfferPort;
  /** The current time for reminder arithmetic (tests pin it). */
  now?: () => Date;
  /** Reads his day as a numbered list for questions (tests pass a stub; wired from index.ts). */
  readDay?: (tomorrow: boolean) => Promise<string>;
  /** Reads a day as `show --json` gives it (--date args), for the time backstop on the worker's own writes (tests pass a stub; wired from index.ts). */
  readDayJson?: (dateArgs: string[]) => Promise<Day | undefined>;
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

type Run = {
  /** The computer loop handled this turn (its reply is fixed; no draft may replace it). */
  computer?: boolean;
  message: string;
  /** His day as read for the time backstop on the worker's writes, by --date: once per turn (re-review, 2026-10-25). */
  dayReads?: Map<string, Promise<Day | undefined>>;
  decision: Promise<Decision | { error: string }>;
  settled?: Decision;
  tools: ToolResult[];
  started: number;
  passes: number;
  findings: string[][];
  cloud?: boolean;
  /** A reminder the worker must set: the exact orion_task_run arguments and what to tell him. */
  reminder?: { args: string; say: string; action?: "alarm_set" | "reminder_cancel" | "reminder_snooze" | "reminder_done"; label?: string; at?: string };
  /** Code put the data in the prompt (his day, brain snippets, the overwhelm note): no lookup is owed. */
  provided?: boolean;
  /** What code read for the worker this turn ("day", "day-tomorrow", "notes", "learned", "deadlines", ...), for the routing log (2026-10-16 r8). */
  reads?: string[];
  /** A recall turn: the lines he told ORION (his Nick note's Learned section), for the "you told me" check (2026-10-16). */
  recall?: { learned: string[] };
  /** The prompt forbade tools (the overwhelm note): no promise or lookup check can be met by acting. */
  noTools?: boolean;
  /** A front-desk tool move code worked out (tool-moves.ts): the one call the worker must make. */
  directive?: Extract<ToolDirective, { kind: "call" }>;
  brain?: Promise<string>;
  flow?: FlowResult;
  sessionKey?: string;
  /** Spoken and trailing off mid-sentence: nothing is done until the rest arrives. */
  cutOff?: boolean;
  /** 2026-10-20: the calendar intent layer read this as a change code carries out by itself (calendar-intent.ts): the desk was not asked. */
  codeFirst?: boolean;
  /** "make it an hour": an edit of the last thing this chat created (edit-followup.ts); never a new session */
  edit?: boolean;
  scheduleTried?: boolean;
  /** Tools the HOST ran this turn (after_tool_call), as opposed to the reads code pushed into `tools` itself (H4, r8 review 1, 2026-10-16). */
  hostTools?: number;
  /** An open outreach question (his prompt's ORION context line): the blank or the planned block it asked about. */
  ask?: AskContext;
  /** What ORION said first, that this message answers (Mac label or phone line; 2026-10-23). */
  outreach?: Outreach;
  /** r8 review 2 HIGH-1 (2026-10-16): code itself ran a read this turn (messages, gmail, focus status), as opposed to `provided` brain snippets or the day. */
  codeRead?: boolean;
  /** Said out loud (the app's spoken marker), not typed. */
  spoken?: boolean;
  /** Changes the cut-off first half of this request made, to take back before acting on the whole. */
  undo?: string[];
  /** H6 (r8b2, 2026-10-16): this turn's message is a cut-off request joined to its rest (the host's prompt carries only the rest). */
  stitched?: boolean;
  /** 2026-10-31 (pending-reply.ts): a short reply to ORION's own nudge, read against what it offered; code carries it out. */
  pending?: PendingTurn;
  /** W5 (preference-remember.ts): a standing preference he stated; code keeps it (orion-remember --user) and says what was kept. */
  preference?: Preference;
  /** W10-B (sleep-plan-read.ts): the sleep-plan interview, its answers, or a night exception; code runs it (sleep-plan-flow.ts). */
  sleepTurn?: SleepTurn;
  /** W10-G (phone-block-read.ts): block / unblock an app group on his phone, or the one question when he did not say which. */
  phoneBlock?: PhoneBlockRead;
  /** q029 (2026-10-16 r8): a "running late" turn code owns: the fixed "how late?" question, the stitched minutes answer, or the go-ahead. */
  /** r8 review 3 H1 (2026-10-16): his answer to the add flow's own question (go ahead / the title / no). */
  addAnswer?: PendingAnswer;
  /** 2026-10-19: the rest of a cut-off message whose first half got the crisis reply, and which has no danger words itself: its request is answered, with one support line. */
  afterCrisis?: boolean;
  /** The rest of a cut-off message whose first half got the crisis reply, and which has no danger words itself (it may still be more distress). */
  crisisRest?: string;
  /** 2026-10-19: the worker tried `orion-reschedule <write>` by name (refused by the guard); code gets one more go at it from the worker's restatement. */
  refusedWrite?: string;
  /** Aborted when before_prompt_build gives up: the scheduler process is killed and nothing more starts. */
  abort?: AbortController;
  /** A write may have started (the schedule flow says exactly; the other flows count from the moment they are called). */
  writeStarted?: boolean;
  late?: { kind: "ask" } | { kind: "run"; minutes: number } | { kind: "confirm"; last: { minutes: number; changed: boolean; reply: string; asked?: boolean } };
  /** 2026-10-30: what code read of his state for this turn (state-card.ts); the worker's prompt carries it as the card. */
  card?: CardInputs;
  /** 2026-10-30: he stated what happened ("no classes today", "i did X instead of Y"): code declares it and changes the plan (reality.ts). */
  reality?: RealityRead;
  /** 2026-10-30 (chatter.ts): he asked for quiet (minutes), or this spoken turn falls in a quiet window and is not addressed. */
  quietStart?: number;
  hushed?: boolean;
  /** 2026-10-31 (chatter.ts): spoken without "orion": "room" = said to someone else (silent); "streak" = request-shaped inside a run of room talk. */
  room?: "room" | "streak";
  /** 2026-10-31: his "yes" to a change ORION proposed last turn (day-lighten.ts / focus-moves.ts). */
  pendingYes?: LightenPending;
  /** 2026-10-31: tired, sick, slept badly or stressed (day-lighten.ts). */
  lighten?: LightenRead;
  /** 2026-10-31: a focus phrase mapped to its one call (focus-moves.ts). */
  focusMove?: FocusMove;
  /** run-1101020721: a task run this turn was held for approval; the reply is its draft and a question (approval-reply.ts). */
  approvalHeld?: boolean;
  /** 2026-10-31 (health-log.ts): a meal to log, a gym-history question, or a bedtime. */
  health?: HealthRead;
  /** Wave 4 (day-defaults.ts): a request with a safe default, or "what now", carried out by code from the real day. */
  dayDefault?: DayDefault;
  /** 2026-10-31: a textbook question (knowledge-ask.ts): the worker answers it, never the desk's draft. */
  knowledge?: boolean;
  /** 2026-10-31 (code-answers.ts): sleep, who-is, secrets, connector status and draft asks are answered by code; ownText is that answer. */
  own?: AskKind;
  ownText?: string;
  /** 2026-10-30 gate (anchor-guards.ts): he is putting gym off; code answers, gym is never dropped for an excuse. */
  gymSkip?: GymSkip;
  /** "wipe my week": asked about first by code, nothing runs. */
  wipe?: boolean;
  /** 2026-10-30 (model-outage.ts): a message queued while the model was down, replayed now. */
  replayed?: boolean;
};

/** Notes what code read for the worker this turn, once (routing log, 2026-10-16 r8). */
const markRead = (run: Run, name: string): void => { if (!(run.reads ?? []).includes(name)) run.reads = [...(run.reads ?? []), name]; };

const INTERNAL = /\b(?:cron|heartbeat|doctor|test|subagent|eval)\b/i;
// One spoken request can arrive as two turns: the app sends what it heard when he pauses, and the rest
// with this marker (native AppState.send). 2026-10-15: the first half ("…so if you can go ahead and")
// changed his day on its own, and the second half was read without the first.
const SPOKEN = /Nick SAID this out loud/;
// A spoken message that ends on a word a sentence cannot end on ("…go ahead and", "…move the").
const TRAILS_OFF = /\b(and|or|but|so|because|cause|then|if|to|the|a|an|my|your|with|of|from|um|uh)\s*[,–—-]*\s*$/i;
// H6 (r8b2, 2026-10-16): the 11:24:58 fragment was a bare "can". These end a cut-off sentence too, but real short messages end on
// them ("yes i can", "what's it like", "i know what it is"), so a clause that is complete without the word is not held. "it", "that"
// and "this" are left out: "what time is it", "what is that", "i love this" are whole questions and statements.
const TRAILS_OFF_SOFT = /\b(can|could|is|are|was|just|like|i|i'm)\s*[,–—-]*\s*$/i;
const COMPLETE_TAIL = /\b(?:yes|yeah|yep|no|nope|i|we|you|they|he|she|it|that|this|there)\s+(?:can|could|is|are|was|am)\s*$|\b(?:it|that|this|looks?|feels?|sounds?|seems?|more|something|someone|things?)\s+like\s*$|\b(?:what|where|who|how)\s+(?:it|that|this|he|she|they|there)\s+(?:is|are|was)\s*$|\b(?:what|where|who|how|when|which)\s+\S+(?:\s+\S+)*?\s+(?:is|are|was)\s*$|\b(?:you|they|we)\s+like\s*$/i; // review 5 H4 (2026-10-16): "tell me what my next class is", "do you know where my keys are", "whatever you like" are whole sentences
export const trailsOff = (message: string): boolean => TRAILS_OFF.test(message) || (TRAILS_OFF_SOFT.test(message) && !COMPLETE_TAIL.test(message.trim()));
export const GO_ON = "Go on.";
const LABEL_COMMANDS = /\b(turn|open|play|start|text|email|add|move|cancel|set|what|whats|what's|how|when)\b/i;
/** An answer to "what should I remind you about?" is a plain label: no change, calendar, live-data or command word, and no tool/escalate from the front desk (review, 2026-10-16). */
// A weekday, a cancel, "instead" or a before/after word is a statement about his day, never a label (final round, 2026-10-16).
const LABEL_DAYWORDS = /\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?s?\b|\bcancel\w*|\b(instead|after|before|until)\b/i;
const answersLabel = (message: string, move?: string): boolean =>
  move !== "tool" && move !== "escalate" && ![CHANGE_REQUEST, ...(move === "answer" ? [] : [SCHEDULING]), LIVE_DATA, LABEL_COMMANDS, LABEL_DAYWORDS].some((re) => re.test(message)); // a calendar word alone (class, lab) is a label when the front desk answered (final round, 2026-10-16)
const REMINDER_UNCLEAR = "I couldn't work that reminder out — nothing was set.";
const STITCH_WINDOW_MS = 3 * 60_000;
const DAY_MEMORY_MS = 10 * 60_000;
const nowMinutes = (now?: () => Date): number => { const d = (now ?? pluginNow)(); return d.getHours() * 60 + d.getMinutes(); };
// 2026-10-16 re-run, q092: in a FRESH chat "cancel that" had the worker run `orion-reschedule undo`, which
// reversed a REAL change Nick made a day earlier ("Undone: put Review spending back"). A bare cancel or
// undo (no named object) may take back a calendar change only when THIS session made one recently.
export const UNDO_NOTHING_TO_UNDO = "I haven't changed your calendar in this chat. What should I cancel?";
// 2026-10-16 review: "start a focus session" then "cancel that" said nothing had changed and the session kept
// running. A session start, a timer or a logged supplement made in this chat is something "cancel that" may mean;
// ending or undoing it is a different action from the calendar undo, so code ASKS (the safer choice) and never
// ends it on a guess. The undo exec block stays calendar-only.
const OTHER_ASKS = { focus: "End the focus session you just started?", timer: "Cancel the timer you just set?", supplement: "Undo the supplement you just logged?" } as const;
const SESSION_CHANGE_WINDOW_MS = 30 * 60_000;
const BARE_UNDO = /^(?:(?:ok|okay|please|pls|orion|hey|actually|wait|no)\s+)*(?:(?:cancel|undo|revert)(?:\s+(?:that|it|this|the last (?:one|change|thing)|my last change))?|(?:never ?mind|nvm)\s+(?:that|it|this)|(?:put|take)\s+(?:it|that|this|them)\s+back)(?:\s+(?:please|pls|thanks))?$/;
/** A cancel or undo that names nothing: "cancel that", "undo", "put it back", "never mind that". */
export const isBareUndo = (message: string) => BARE_UNDO.test(message.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim());
const UNDO_COMMAND = /\borion-reschedule\s+undo\b/;
// A scheduler verb that writes (the read-only ones are show and undo itself).
const RESCHEDULE_WRITE = /\borion-reschedule\s+(?!show\b|undo\b)[a-z]/;
// q029 (2026-10-16 r8): "NOTHING WAS BOOKED on Friday …" (what orion-reschedule prints when it wrote nothing) matched neither, so a late 15 that moved nothing was recorded as a change.
const NOTHING_CHANGED = /NOTHING WAS (?:CHANGED|BOOKED)|NOT BOOKED/i;
const MARKERS = ["--- Nick's message follows ---", "User message:\n"];
// Word STEMS, not whole words: "studying", "shorter", "ditch", "nuke", "stick" missed the flow and the old
// loop answered "Done" for changes it never made (live gauntlet, 2026-10-12).
const SCHEDULING = /\b(schedul|reschedul|plan|calendar|day\b|today|tonight|tomorrow|morning|afternoon|evening|block|move|push|pull|swap|resiz|extend|shorten|shorter|longer|clear|drop|ditch|nuke|scrap|cancel|skip|free|fit|stick|put|add|slot|book|class|lab\b|lectur|seminar|stud|revis|gym|nap|dinner|lunch|breakfast|meeting|appointment|undo|commute|after my|before my|between|out from|leaving at|leetcode|deck|presentation)\w*|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;
// A short "never mind" after "What time?" drops the reminder instead of being read as its answer.
const REMINDER_DROPPED = /^(never ?mind|nvm|forget it|no|nah|ok|okay|thanks?|thank you|cancel)\b/i;
const CORRECTION_WINDOW_MS = 10 * 60_000;
// "im running late" got the front desk's "Got it. Hope you make it safely." and "the lecture ran over"
// never reached the scheduler's late/overrun (sweep q029, 2026-10-15). Not "stayed up late".
// (review, 2026-10-16) "going over my notes", "went over well", "run over by a bike", "behind on my reading" were
// read as lateness and wrote blocks: "over" needs a number or a class word, "behind" a number or "schedule".
const RUNNING_LATE = /\b(?:(?:i'?m|im|i am|running|gonna be|going to be|will be|be)\s+(?:(?:\d+\s*(?:min\w*|m)?\s+|(?:a )?(?:bit|little|few min\w*)\s+)?late|\d+\s*(?:min\w*|m)?\s+behind|behind\s+schedule)|(?:ran|running|run|went|going|gone)\s+\d+\s*(?:min\w*)?\s+over|(?:class|lecture|lab|meeting|seminar|section|recitation|session)\s+(?:ran|is running|was running|running)\s+over|overr[au]n)\b/i;
const REMINDER = /\b(remind me|reminder|set an? alarm|alarm (for|at)|wake me|ping me|nudge me|don'?t let me forget)\b/i;
// "schedule me for…", "move X", "put X between…", "change of plans": work, never a drafted reply.
const CHANGE_REQUEST = /\b(schedul\w*|reschedul\w*|move|put|add|book|fit|clear|cancel|push|pull|swap|replace|rebuild|redo|plan (my|the)|change of plans|shorten|extend|resize|drop|skip)\b/i;
// Live data the front desk cannot know: its "answer" drafts made these up and went out unchecked
// ("Sunset is at 6:42 PM today.", "it's still warm outside", "I haven't seen any new messages"; live sweep
// 2026-10-15). A message about these is a lookup: the worker gets the job's tools and no draft.
const LIVE_DATA = /\b(weather|forecast|rain\w*|snow\w*|sunny|temperature|degrees|(cold|warm|hot|dark) (out|outside)|jacket|coat|umbrella|sunset|sunrise|sun (sets?|rises?|goes down|comes up)|texts?|texted|messages?|messaged|emails?|emailed|inbox|missed calls?|voicemails?|mail)\b|\bhow (cold|warm|hot)\b|\bmy (calendar|day|schedule|agenda|session|focus|supplements?|to-?dos?|tasks|reminders|alarms?)\b/i;
// Plain chit-chat that only mentions one of those words is not a lookup: "thanks for the message", "nice coat",
// "my day was rough", "it's dark out already lol" each cost a full worker pass (review, 2026-10-16). Narrow on
// purpose: a question or a request ("do i need a jacket tho") stays live data.
const CHIT_CHAT = /^(?:thanks|thank you|thx|ty)\s+(?:so much\s+)?(?:for|about)\s+(?:the|that|your)\s+\w+\s*[.!]*$|^(?:nice|cool|love|like|cute|great)\s+(?:your|that|the|my|a)?\s*\w+\s*[.!]*$|^my day (?:was|has been|went|is going)\s+\w+\s*[.!]*$|^it'?s (?:dark|cold|warm|hot) (?:out|outside)(?: already| now)?\s*(?:lol|haha)?\s*[.!]*$/i;
const needsLiveData = (message: string) => LIVE_DATA.test(message) && !CHIT_CHAT.test(message.trim());
const LIVE_NOTE = "This needs live data (weather, sun times, his messages, his day). Answer only from what a tool returns just now; if none of your tools can get it, say \"I can't check that right now.\" Never guess it.";
// 2026-10-15 sweep: SCHEDULING alone ran the calendar flow, whatever the front desk decided. "text myself
// bring the charger to lab" booked "bring the charger" at 11:45 PM, "add a todo to email prof…" ran add … 0,
// "focus mode on for an hour" added a "focus mode" block, "i take creatine every morning at 8" added creatine,
// and "cancel that" / "make it longer" (no history reaches the form) dropped and resized "finish resume".
// He says what he really did ("i'm at the gym", "was at the library since 2", "gym 2-4", "did gym instead of resume"):
// the flow logs it over the plan. Any reply while an ask is open goes there too (run.ask).
const LOGGING = /\b(i'?m|i am|was|been|just)\b.*\b(at|in|doing|since)\b|\binstead\b|\bsince \d|\bfrom \d.* to \d|^\s*[a-z][a-z ]{1,30}\s\d{1,2}(:\d{2})?\s*-\s*\d{1,2}(:\d{2})?\s*$/i;
const CALENDAR_TOOLS = new Set(["reschedule", "agenda"]);
// A message to send or something to capture, not a block: "text myself…", "email prof…", "add a todo…".
// A to-do counts only when he adds one: "plan my day around my todos" and "fit my to-dos into this
// afternoon" are calendar requests and skipped the flow (review, 2026-10-16).
const SEND_OR_CAPTURE = /^(?:(?:hey|ok(?:ay)?|so|please|pls|orion|can you|could you|would you)[,\s]+)*(?:text|message|imessage|email|send|remind|note|jot)\b|\b(?:add|put|create|make|jot)\s+(?:an?\s+|another\s+|new\s+)*to-?dos?\b|\bto (?:my|the) to-?dos?\b|\bnew to-?dos?\b|\bto-?do\s*:|\bto do list\b/i;
// A habit he is telling ORION about ("i take creatine every morning at 8"), to remember, not to book today.
const HABIT = /\bi\s+(?:usually\s+|always\s+|normally\s+)?(?:take|have|drink|eat|do|go|run|lift|wake)\b.*\b(?:every|each)\s+(?:day|morning|night|evening|week|mon|tues|wednes|thurs|fri|satur|sun)\w*/i;
// Booking travel or a table is not a calendar block ("book me a flight to mars" → "That doesn't fit: …").
const BOOK_ELSEWHERE = /\bbook\b.*\b(?:flight|train|plane|hotel|airbnb|uber|taxi|cab|ride|table|ticket)s?\b/i;
// "cancel that", "make it longer": only a pronoun for the block. The form sees no earlier turns, so it guessed one.
const VAGUE = new Set(["that", "it", "this", "them", "those", "one", "thing", "last", "the", "a", "cancel", "drop", "delete", "remove", "scrap", "ditch", "nuke", "skip", "clear", "make", "longer", "shorter", "bigger", "smaller", "move", "push", "pull", "back", "forward", "later", "earlier", "extend", "shorten", "resize", "undo", "please", "pls", "can", "could", "you", "just", "actually", "and", "ok", "okay", "nah", "yeah", "so", "now", "then", "instead", "bit", "little", "more", "less", "do", "go", "ahead"]);
const NAMES_NOTHING = (message: string) => {
  const words = message.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return words.length > 0 && words.every((w) => VAGUE.has(w));
};
// Tools that can never be a change to his day, whatever the message says.
const NOT_CALENDAR_TOOLS = new Set(["weather", "lights", "alarm", "wake", "session", "phone_time", "app_open", "browser", "media", "log_intake", "supplements", "show", "repair_note"]);
// A time or a length in the message: what makes a "tasks" or "brain" pick worth a second look.
const WHEN_OR_HOW_LONG = /\bat \d{1,2}(:\d{2})?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(am|pm)\b|\b\d+(\.\d+)?\s*(h|hrs?|hours?|mins?|minutes?)\b|\b(an?|half an?) hour\b|\b(this|tomorrow) (morning|afternoon|evening)\b|\b(today|tonight|tomorrow|tmrw)\b/i;
// What he says in answer to "what are you up to?": a short statement of what he is doing, or "nothing really".
const ACTIVITY_REPLY = /^(?:i'?m|i am|i was|i'?ve been|i have been|was|been|just|doing|did|still|at|in|on|with|working|studying|reading|coding|writing|cooking|cleaning|watching|playing|napping|nap|gym|lab|lunch|dinner|class)\b/i;
/** An open ask forces the schedule flow only for a reply that plausibly answers it, not for any message in the next 90 minutes. */
export function answersAsk(message: string, ask?: AskContext): boolean {
  const m = message.trim();
  // 2026-10-19: "yes" / "yes, put cs lab until 10:30" answers ORION's own "I could put CS Lab there"; a bare yes means nothing without an offer.
  const accepts = !!ask?.suggest && (isYes(m.replace(/[.!?…]+$/, "")) || /^(?:yes|yeah|yea|yep|yup|ok(?:ay)?|sure|alright)\b[,\s]/i.test(m));
  return m.length > 0 && m.length <= 160 && (accepts || NOTHING_REPLY.test(m) || LOGGING.test(m) || WHEN_OR_HOW_LONG.test(m) || ACTIVITY_REPLY.test(m));
}
/** Whether this turn is a change to his calendar at all, whatever words it shares with one. */
export function isCalendarTurn(message: string, settled: Decision, askOpen = false): boolean {
  // The 4B's tool pick is a hint, not a fact (review, 2026-10-16): "add gym at 5 today" picked as "tasks"
  // is still a block. A clearly unrelated tool skips the flow; "tasks" or "brain" only with no time or length.
  if (settled.move === "tool" && !CALENDAR_TOOLS.has(settled.tool ?? "") && (NOT_CALENDAR_TOOLS.has(settled.tool ?? "") || !WHEN_OR_HOW_LONG.test(message))) return false;
  if (SEND_OR_CAPTURE.test(message) || BOOK_ELSEWHERE.test(message)) return false;
  if (HABIT.test(message) && !CHANGE_REQUEST.test(message)) return false;
  if (settled.move === "ask" && NAMES_NOTHING(message)) return false;
  // Chit-chat the front desk answered, with no change word, time or "after/before my…" anchor ("the meeting went
  // over well") is not a calendar turn (re-review, 2026-10-16).
  if (settled.move === "answer" && !askOpen && !CHANGE_REQUEST.test(message) && !RUNNING_LATE.test(message) && !WHEN_OR_HOW_LONG.test(message) && !LOGGING.test(message) && !/\b(after|before|between|until|till|from|cancel\w*|mov\w*|not going|instead|no \w+ for me|no \w+ today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(message)) return false;
  return true;
}
// A fact he tells ORION, including a habit ("i take creatine every morning at 8"): saved, never drafted (2026-10-15).
const keepsFact = (message: string) => tellsFact(message) || parseNote(message) !== null || (HABIT.test(message) && !CHANGE_REQUEST.test(message) && !/\?\s*$/.test(message.trim()));
const BRAIN = /\b(remember|note|notes|brain|wrote|write down|repair (queue|list)|bug|save (that|this|it))\b/i;

/** The front desk's session start, task and length (sweep 2026-10-15, q051: it read "focus mode on for an
 *  hour, leetcode" right — session start, task leetcode — and the calendar flow booked "focus mode"). */
export function sessionHint(d: Decision | undefined): SessionHint {
  if (d?.move !== "tool" || d.tool !== "session" || d.args?.do !== "start") return {};
  const task = typeof d.args.task === "string" ? d.args.task.trim() : "";
  const minutes = Number(d.args.minutes);
  return { start: true, ...(task && task.length <= 80 ? { task } : {}), ...(Number.isInteger(minutes) && minutes > 0 && minutes <= 480 ? { minutes } : {}) };
}

// Filler and gibberish the front desk marked "ignore" ("hm", "asdf jkl qwer"): the worker answered them with
// his focus-session status from the stale app context (q094, q095, sweep 2026-10-15). A fixed short question
// instead — still a reply, never silence. Anything longer, or typed with a command word, stays with the worker.
export const NOT_CAUGHT = "Didn't catch that — what do you need?";
const FILLER_WORD = /^(?:h+m+|u+h+m*|u+m+|e+r+m*|a+h+|o+h+|ok(?:ay)?|k+|lol|lmao|huh|mhm+|m+|what|wait|like|so)$/;
const COMMAND_WORD = /\b(on|off|open|close|play|pause|stop|start|lights?|music|volume|timer|next|unlock|show|help)\b/i;
const SESSION_CHANGE = /\b(extend|stop|end|finish|pause|resume|break)\b(?:\s+(?:my|the|this))?\s+(?:focus\s+)?(?:session|focus|pomodoro)\b|\b(?:focus\s+)?session\b[^.?!]{0,20}\b(extend|stop|end|finish|pause)\b/i;
const SESSION_VERB_SAY: Record<string, string> = { extend: "extend", stop: "stop", end: "end", finish: "finish", pause: "pause", resume: "resume", break: "take a break from" };
const MISREAD_LOG =/^Not done: .*(?:is shorter than 5 minutes|more than 3 hours ahead of now|log is for what already happened|is before 04:00)/;
/** A "say" from the schedule flow that is only the scheduler refusing a log it should never have been asked for. */
export const misreadLog = (flow: FlowResult | undefined): boolean =>
  flow?.outcome === "say" && MISREAD_LOG.test(flow.text) && (flow.calls ?? []).every((c) => /orion-reschedule log\b/.test(c));
/** The state card's last push reached him in the last 30 minutes: a short reply most likely answers it. */
const recentPush = (card?: CardInputs): boolean => !!card?.lastOutreach && card.now.getTime() - Date.parse(card.lastOutreach.at) < 30 * 60_000;
/** 2026-10-30: the front desk is told a turn came through the microphone, so room speech is "ignore" (R2: 30 replies to a rehearsal). */
export const SPOKEN_DESK_NOTE = "Heard through the Mac microphone, maybe not said to ORION: if it is not a request or question for ORION (talk to someone in the room, a call, TV, rehearsing, thinking aloud), the move is ignore.";
const IGNORE_NOTE = "This may not be meant for you (a fragment, or him talking to someone else). If it is a real request, do it; otherwise ask him briefly what he needs and say nothing else — not his session or his day.";
export function isNotForOrion(message: string, spoken: boolean): boolean {
  const words = message.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  if (words.length > 3) return false;
  if (words.every((w) => FILLER_WORD.test(w))) return true;
  if (spoken) return false;
  return ![SCHEDULING, REMINDER, CHANGE_REQUEST, LIVE_DATA, BRAIN, COMMAND_WORD].some((re) => re.test(message)) && !isSessionStart(message);
}
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const pick = (event: Record<string, unknown>, ctx: Record<string, unknown>, key: string) => str(event[key]) ?? str(ctx[key]);

/** Nick's own words: the part after a channel brief, if the message carries one. */
export function userText(prompt: string): string {
  // The Mac app prepends "[ORION context: ...]" lines (what ORION asked first) to his words: they are not his message.
  const own = (text: string) => text.replace(/^(?:\s*\[ORION context:[^\]]*\])+/, "").trim();
  for (const marker of MARKERS) if (prompt.includes(marker)) return own(prompt.split(marker).pop()!);
  return own(prompt);
}

/** "Sat 18:05" in local time, the clock format the front desk was evaluated with. */
export function localClock(now = pluginNow()): string {
  const day = now.toLocaleDateString("en-GB", { weekday: "short" });
  return `${day} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** A tool result's text, whatever shape the host hands back. */
export function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content;
  if (Array.isArray(content)) return content.map((c) => c?.text ?? "").join("\n");
  try { return JSON.stringify(result) ?? ""; } catch { return String(result); }
}

/** The canonical call string the work check reads ("exec orion-reschedule move …"). */
export function canonicalCall(toolName: string, params: unknown): string {
  const p = (params ?? {}) as Record<string, unknown>;
  if (toolName === "exec") return `exec ${String(p.command ?? "").trim().replace(/^\S*\//, "")}`;
  return `${toolName} ${JSON.stringify(p)}`;
}

/** The worker's instructions for this job. */
export function instructionsFor(decision: Decision | undefined, message: string): string {
  if (decision?.tool === "brain" || decision?.tool === "repair_note" || (!decision?.tool && BRAIN.test(message))) return BRAIN_INSTRUCTIONS;
  if (["agenda", "reschedule", "tasks"].includes(decision?.tool ?? "") || SCHEDULING.test(message) || RUNNING_LATE.test(message)) return SCHEDULING_INSTRUCTIONS;
  const tools = [...(FOOD_TURN.test(message) ? [FOOD_TOOL] : []), ...(WORKOUT_TURN.test(message) ? [WORKOUT_TOOL] : []), ...(MOUSE_TURN.test(message) ? [MOUSE_TOOL] : [])];   // w14 g-food, w17 g-workout: a tool's line only when the turn is about it
  return tools.length ? `${GENERAL_INSTRUCTIONS}\n\n${tools.join("\n")}` : GENERAL_INSTRUCTIONS;
}
const MOUSE_TURN = /\b(?:mouse|basilisk|side button|thumb button)\b/i;
const WORKOUT_TURN = /\b(?:workout|worked out|gym|lifted|lifting|squats?|bench|deadlifts?|sets|reps|stairmaster|treadmill|ran|run|jog|jogged)\b/i;
const FOOD_TURN = /\b(?:calories|calorie|cals|kcal|macros|protein|carbs|ate|eaten|food|meal|breakfast|lunch|dinner|snack)\b/i;

// The small core every local turn gets (Nick, 2026-10-12: a small prompt, and ORION looks up the rest
// in the brain). The manual is generated into the brain by scripts/orion-brain-manual.
export const LOOK_IT_UP = "Your manual and his memory live in his brain; you only see a small part of it here. When you need something that is not in front of you — how a script works, a scheduling rule, dates, his routines, people, preferences, what was decided before — look it up first with exec: /Users/nickmadaio/Desktop/ORION/scripts/orion-brain search \"<words>\", or read \"ORION Manual - Index\" for the list of manual sections, then read \"<title>\". Never guess a fact about Nick or a command's syntax that you could look up.";

/** Brain search for the message, trimmed to the best few matches (pre-fetched while the front desk decides). */
export function brainSnippets(output: string, maxChars = 1400): string {
  const blocks = output.split(/\n(?=## )/).map((b) => b.trim()).filter((b) => b.startsWith("## "));
  const picked: string[] = []; let used = 0;
  for (const b of blocks.slice(0, 4)) { const cut = b.slice(0, 500); if (used + cut.length > maxChars) break; picked.push(cut); used += cut.length; }
  return picked.join("\n\n");
}
const ORION_BRAIN = "/Users/nickmadaio/Desktop/ORION/scripts/orion-brain";
const NICK_NOTE = join(homedir(), "Documents/orionBrain/20 Areas/Me/Nick.md");
const readNickNote = (): string => { try { return readFileSync(NICK_NOTE, "utf8"); } catch { return ""; } };
const defaultBrainSearch = (query: string): Promise<string> => new Promise((resolve) => {
  execFile(ORION_BRAIN, ["search", query.slice(0, 200)], { timeout: 8000, maxBuffer: 1 << 20 }, (_e, stdout) => resolve(String(stdout ?? "")));
});

// 2026-10-15 sweep: only a trailing "?" made a question, so "whats on tomorrow morning" and "uh whats next
// on my schedule" went to the change flow ("a question, not a change") and the worker, with no rule for
// it, read 1:30 PM and 3:30 PM out as "morning" (q014). A message that opens with a question word (after
// a filler) is a question too, unless it also asks for a change ("my schedule" is a noun, not a verb).
// (review, 2026-10-16) "when" only as "when is|does|do|am|will": "when i get home i'll do laundry" is a plan.
// "do"/"does" only before a pronoun ("do my laundry at 6" is a plan); "how about" / "what if" suggest.
const QUESTION_OPENER = /^(?:(?:uh+|um+|so|ok(?:ay)?|hey|orion|and|but|wait)[,\s]+)*(?:(?!how about|what if)(?:what|whats|what's|when(?=\s+(?:is|does|do|am|will|are|was|can|should|could|would)\b)|whens|when's|how|is|are|which|who)|do(?:es)?\s+(?:i|we|my|he|she|they))\b/i;
// 2026-10-19: "Can you please put CS lab from now until ten thirty?" is a request that ends in "?", not a question: it was read as
// one and answered "I can't add that to your calendar right now". Judged on the LAST sentence ("I'm fine. … Can you please put …?").
const POLITE_REQUEST = /^(?:(?:uh+|um+|so|ok(?:ay)?|hey|orion|and|but|wait|alright|yes|yeah|please|pls)[,.…\s]+)*(?:(?:can|could|would|will)\s+(?:you|u)|(?:can|could|would) you)\s+(?:(?:please|pls|just)\s+)*(?:put|add|schedule|book|move|push|pull|swap|extend|shorten|resize|clear|cancel|drop|skip|log|reschedule|fit)\b/i;
const lastSentence = (message: string): string => message.trim().split(/(?<=[.!?…])\s+/).filter(Boolean).at(-1) ?? message;
export const isPoliteRequest = (message: string): boolean => POLITE_REQUEST.test(lastSentence(message));
export const isQuestion = (message: string): boolean => !isPoliteRequest(message) && (
  /\?\s*$/.test(message.trim()) || (QUESTION_OPENER.test(message.trim()) && !CHANGE_REQUEST.test(message.replace(/\b(my|the|his|your) schedule\b/gi, ""))));
// The day read has no window rule of its own: "tomorrow morning" listed afternoon classes (q014).
const DAY_QUESTION_NOTE = "Morning means before 12:00, afternoon 12:00 to 17:00, evening after 17:00: list only what falls in the window he names. \"Next\" means the first block that has not already happened. For \"how long until\", count from Now. If nothing in the list matches, say so and name what is there.";

/** His day as a numbered list, read from the scheduler (wired in by index.ts). */
/** The cap on reading his day before a worker write (re-review: never a long stall in a tool call). */
export const DAY_READ_MS = 5000;
/** The promise's value, or undefined once `ms` have passed. */
const withTimeout = <T>(p: Promise<T | undefined>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => { const t = setTimeout(() => resolve(undefined), ms); p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(undefined); }); });
/** The day as data (`show --json`, read-only), or undefined when it cannot be read. */
export const liveReadDayJson = (dateArgs: string[]): Promise<Day | undefined> => new Promise((resolve) => execFile(RESCHEDULE, ["show", "--json", ...dateArgs], { timeout: DAY_READ_MS }, (_e, stdout) => {
  try { resolve(JSON.parse(String(stdout)) as Day); } catch { resolve(undefined); }
}));
export const liveReadDay = (tomorrow: boolean): Promise<string> => new Promise((resolve) => execFile(RESCHEDULE, ["show", "--json", ...(tomorrow ? ["--date", "tomorrow"] : [])], { timeout: 30000 }, (_e, stdout) => {
  try { resolve(dayRead(JSON.parse(String(stdout)))); } catch { resolve(""); }
}));

/** The stamp of the newest change in the scheduler's undo journal (the entry "orion-reschedule undo"
 *  reverts; same file and same skipping of empty entries as scripts/lib/life/calendar-write.mjs). */
export function undoJournalTop(home = homedir(), now = Date.now()): string | null {
  const dir = join(home, ".openclaw", "orion-controlled");
  let evalRun = false;
  try { evalRun = now - statSync(join(dir, "eval-mode")).mtimeMs < 2 * 3600_000 && existsSync(join(dir, "eval-calendar.json")); } catch { /* not an evaluation */ }
  try {
    const history = JSON.parse(readFileSync(join(dir, `${evalRun ? "eval-" : ""}reschedule-undo.json`), "utf8")) as Array<{ at?: string; steps?: unknown[] }>;
    return [...history].reverse().find((e) => (e.steps ?? []).length)?.at ?? null;
  } catch { return null; }
}

/** The real scheduling flow (scheduler + worker via Ollama). Wired in by index.ts only. */
export const liveScheduleFlow = (message: string, clock: string, opts: { lengthDefaulted?: boolean; undo?: string[]; pending?: PendingRun; askContext?: AskContext; deadlineAt?: number; signal?: AbortSignal; onWriteStart?: () => void; replanContext?: ReplanAsk; lastTarget?: { title: string; start?: string; dateArgs: string[] }; edit?: { target: Extract<EditTarget, { kind: "block" }>; req: NonNullable<ReturnType<typeof parseEdit>> } } = {}): Promise<FlowResult> => runScheduleFlow({
  message, clock, undo: opts.undo ?? [], ...(opts.askContext ? { askContext: opts.askContext } : {}), undoTop: () => undoJournalTop(), ...(opts.pending ? { pending: opts.pending } : {}),
  ...(opts.deadlineAt !== undefined ? { deadlineAt: opts.deadlineAt } : {}), ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.onWriteStart ? { onWriteStart: opts.onWriteStart } : {}), ...(opts.replanContext ? { replanContext: opts.replanContext } : {}), ...(opts.edit ? { edit: opts.edit } : {}), ...(opts.lastTarget ? { lastTarget: opts.lastTarget } : {}), ...(opts.lengthDefaulted ? { lengthDefaulted: true } : {}),
  exec: (args, signal) => new Promise((resolve) => execFile(RESCHEDULE, args, { timeout: 60000, maxBuffer: 1 << 20, ...(signal ? { signal } : {}) }, (e, stdout, stderr) =>
    resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? 1 : 0 }))),
  ask: async (system, user, schema, budgetMs) => {
    try {
      const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: WORKER_MODEL, stream: false, think: false, format: schema, options: FORM_OPTIONS, keep_alive: "24h",
          messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: opts.signal ? AbortSignal.any([AbortSignal.timeout(budgetMs ?? 30000), opts.signal]) : AbortSignal.timeout(budgetMs ?? 30000) });
      const body = (await res.json()) as { message?: { content?: string } };
      return JSON.parse(body.message?.content ?? "");
    } catch { return null; }
  },
});

const RESTATES_TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b/i;
const CANT_OR_CONFIRM = /\b(?:can'?t|cannot|unable|not (?:being )?(?:added|able)|(?:need|have) to (?:ask|confirm)|confirm)\b/i;
export const REFUSED_NOTHING_CHANGED = "I couldn't make that change just now, so nothing was changed. Tell me the block, the day and the start and end times, and I'll do it.";
/** exactReply for a run: after a crisis reply the support line stays, one short line, so it is never withdrawn (2026-10-19). */
const exactFor = (run: { flow?: FlowResult; afterCrisis?: boolean }): string => {
  const text = run.flow ? exactReply(run.flow) : "";
  return run.afterCrisis && text ? `${text} ${SUPPORT_LINE}` : text;
};

/** What Nick must hear after the scheduling flow: the scheduler's own lines, or its "can't"/question. */
function exactReply(flow: FlowResult): string {
  if (flow.outcome === "done") return flow.reply ?? spokenReply(flow.outputs);
  if (flow.outcome === "say") return flow.kind === "ask" || flow.kind === "plain" ? flow.text : `That doesn't fit: ${flow.text.replace(/^(that|it) (can't|cannot) be done[:,]?\s*/i, "")}`;
  return "";
}

const ampm12 = (t: string): string => { const [h, m] = t.split(":").map(Number); return `${((h ?? 0) + 11) % 12 + 1}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };

/** orion-checkin with fixed arguments (no shell): a reply to ORION's start line sets or closes its check-in (2026-10-23). Wired in by index.ts only. */
export const liveCheckinRun = (args: string[]): Promise<{ stdout: string; code: number }> => new Promise((resolve) =>
  execFile(RESCHEDULE.replace(/orion-reschedule$/, "orion-checkin"), args, { timeout: 15000 }, (e, stdout, stderr) => resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? 1 : 0 })));

/** orion-declare / orion-reschedule with fixed arguments (no shell), for reality statements (2026-10-30). Wired in by index.ts only. */
// ORION_SCRIPTS_DIR: a checkout's own scripts for a replay against a state copy (the live plugin runs the repo's).
export const liveRealityRun: ScriptRun = (script, args) => new Promise((resolve) =>
  execFile(join(process.env.ORION_SCRIPTS_DIR || dirname(RESCHEDULE), script), args, { timeout: 30000 }, (e, stdout, stderr) => resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));

/** Loads both local models at the context each is called with (2026-10-30: the outage gate's one warm-and-retry). Wired in by index.ts only. */
export const liveModelWarm = (): Promise<string[]> => keepWarm([{ model: FRONT_DESK_MODEL, numCtx: FRONT_DESK_CTX }, { model: WORKER_MODEL, numCtx: FORM_OPTIONS.num_ctx }]);

/** Replays a message queued while the model was down (model-outage.ts): one agent turn in its own session, and the reply is
 *  pushed to him through orion-reach as a real message, marked as a replay. Wired in by index.ts only. */
export const liveReplay = (row: QueuedMessage): Promise<boolean> => new Promise((resolve) => {
  const at = new Date(row.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const openclaw = join(homedir(), ".openclaw/bin/openclaw");
  const sessionKey = row.sessionKey.replace(/^agent:main:/, "");
  execFile(openclaw, ["agent", "--session-key", sessionKey, "--json", "--message", replayText(row, at), "--timeout", "240"], { timeout: 300_000, maxBuffer: 16 << 20 }, (error, stdout) => {
    if (error) { resolve(false); return; }
    let reply = "";
    try { reply = JSON.parse(`"${/"finalAssistantRawText":"((?:[^"\\]|\\.)*)"/.exec(String(stdout))?.[1] ?? ""}"`) as string; } catch { reply = ""; }
    if (!reply.trim()) { resolve(false); return; }
    execFile(RESCHEDULE.replace(/orion-reschedule$/, "orion-reach"), [`Earlier, while my model was down, you said "${row.message.slice(0, 120)}". ${reply.trim()}`.slice(0, 900), "--kind", "update", "--why", "replay: sent while the local model was down"],
      { timeout: 30_000 }, (e) => resolve(!e));
  });
});

/** The real reminder extraction (worker via Ollama, form-constrained). Wired in by index.ts only. */
export const liveExtractReminder = async (message: string, clock?: string): Promise<{ time: string | null; label: string } | null> => {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model: WORKER_MODEL, stream: false, think: false, options: FORM_OPTIONS, keep_alive: "24h",
        // An empty time means he gave none: the forced HH:MM made it invent noon for "remind me about the
        // thing" and the peanut fact (sweep 2026-10-15). Relative times ("in 10 min") are code's arithmetic.
        format: { type: "object", properties: { time: { type: "string", pattern: "^(([01][0-9]|2[0-3]):[0-5][0-9])?$" }, label: { type: "string", maxLength: 100 } }, required: ["time", "label"] },
        messages: [{ role: "system", content: `${clock ? `Now: ${clock}. ` : ""}From Nick's message, give the time of day for his reminder (24-hour HH:MM; \"around 11\" or \"11 am\" = 11:00, \"5ish\" in the afternoon = 17:00) and a short label of what it is for, in his words. If he names no time of day at all, time is \"\" — never guess one. JSON only: {\"time\":\"HH:MM\",\"label\":\"…\"}` }, { role: "user", content: message }] }) });
    const out = JSON.parse(((await res.json()) as { message?: { content?: string } }).message?.content ?? "");
    if (!out.label) return null;
    return { time: /^\d{2}:\d{2}$/.test(out.time) ? out.time : null, label: out.label };
  } catch { return null; }
};

// "I'm currently using the ollama/qwen3.5:9b model" (q101, sweep 2026-10-15): no model, provider or setting names.
/**
 * 2026-10-16 (speed audit, docs/audits/2026-10-16-local-speed.md): a reply code already wrote is a one-line system prompt.
 * The 9B only repeats it (it was called with 6.7k tokens of prompt for that, 9.1 s). The hook cannot drop history or tool
 * schemas in this OpenClaw version, so the prompt is as small as it can be; finalize still checks the text and puts it in place.
 */
export const EXACT_REPLY_PROMPT = "Reply to Nick with exactly this text and nothing else, and do not call any tools:";

const LOCAL_IDENTITY = "You are ORION, Nick's personal assistant on his Mac and iPhone. Reply in one to three short sentences, the way you would say it out loud: no lists, no markdown, times like 8:15 PM. Never say something happened unless a tool result shows it did. Never name the model, provider or settings you run on. " + SPEAK_AS_I + " Scripts named orion-… are commands you run with the exec tool, never tools of their own, and you never tell Nick which tools are or are not available.";

/** "Today is Sunday 2026-10-11; tomorrow is Monday 2026-10-12." — so --date never needs arithmetic. */
export function dateLine(now = pluginNow()): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const name = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long" });
  const tomorrow = new Date(now.getTime() + 86400000);
  if (now.getHours() < LATE_NIGHT_UNTIL) return `It is after midnight and he is still up: today is ${name(now)} ${iso(now)}, and when he says "tomorrow" he means ${name(now)} ${iso(now)} (the day after he sleeps), not ${name(tomorrow)}.`;
  return `Today is ${name(now)} ${iso(now)}; tomorrow is ${name(tomorrow)} ${iso(tomorrow)}.`;
}

// What the live system needs that the evaluation sandbox did not (2026-10-11, "fix my schedule"
// failed on all four: bare script names refused, "&" in a title refused, a guessed date, asking
// for times it could read).
export const PRODUCTION_NOTES = [
  "On this Mac, exec needs the full path of a script: /Users/nickmadaio/Desktop/ORION/scripts/orion-agenda, /Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule, /Users/nickmadaio/Desktop/ORION/scripts/orion-tasks, /Users/nickmadaio/Desktop/ORION/scripts/orion-brain (same for every orion- script).",
  "Read a day with: orion-agenda day <today|tomorrow|weekday|YYYY-MM-DD>. For another day's change add --date <tomorrow|weekday|YYYY-MM-DD>.",
  "Never put & ; | or > inside an argument, even in quotes: name a class by its code or a distinctive word (\"CS2101\", \"Discrete\").",
  "\"Fill the time between two classes with X\" is one call: orion-reschedule move \"X\" --after \"<first class>\" --before \"<second class>\" (add --date for another day). If X is not on that day yet, use add \"X\" <minutes> --after … --before ….",
  "Do the job: read his calendar instead of asking him for times you can look up. Ask only for what no tool can tell you.",
].join("\n");

const HONEST_STOP = "The check still finds a problem. Undo any change you made in this turn (orion-reschedule undo, or the matching undo), then tell Nick in one or two plain sentences what you could not do and why. Do not say it is done.";
/** What reaches Nick when the reply still claims what the tools do not show. Dictated as the whole reply
 *  on the last revise: the Mac chat and phone call `openclaw agent --json`, which has no delivery stage,
 *  so the reply_payload_sending swap never runs there. Left to HONEST_STOP alone, the 9B repeated
 *  "I've started the focus session" verbatim (2026-10-15). */
/** 2026-11-03 phone audit: "I'll get home and see, I need to meal prep" (a plan he was telling ORION, not asking for) got
 *  "I didn't actually do that — nothing was started or changed. Can you say it again?" twice, as if he had asked and it broke. */
const OWN_PLAN = /\b(?:i'?ll|i will|ill|i'?m (?:gonna|going to)|im (?:gonna|going to)|i (?:do )?need to|i have to|we'?ll see|gonna)\b/i;
export const isPlanStatement = (message: string): boolean =>
  OWN_PLAN.test(message) && !isQuestion(message) && !CHANGE_REQUEST.test(message) && !requestShaped(message);
export const STATEMENT_LINE = "Got it. I haven't changed or noted anything. Tell me if you want me to add it to your day.";
export const honestLine = (calendar: boolean, message?: string): string => message && isPlanStatement(message)
  ? STATEMENT_LINE
  : calendar
  ? "I couldn't make that change — nothing on your calendar changed. Can you say it again?"
  : "I didn't actually do that — nothing was started or changed. Can you say it again?";
const FALSE_CLAIM = /claims what the tools|promised but did not act/;
const LOOKUP_CLAIM = /claims a lookup/;
const LOOKUP_UNCHECKED = "I didn't actually check that.";
export const MESSAGES_UNSURE = "I read your messages but my summary contradicted itself, so I won't guess. Ask me again and I'll read them out.";
export const LOOKUP_HONEST = "I didn't actually check that, so I can't tell you right now. Want me to try again?";
const HONEST_STOP_NO_WRITE = "The check still finds a problem. Tell Nick in one or two plain sentences what you could not do and why. Do not say it is done.";
/** Spoken turns get one revise round (turn-budget.ts). What HONEST_STOP would have had the model say, said by code instead. */
export const SPOKEN_STOP_WROTE = "Something went wrong partway through that, so I won't say it's done. Check your calendar, and say \"undo\" if it looks wrong.";
export const SPOKEN_STOP = "I couldn't finish that properly, so I won't say it's done. Can you say it again?";
/**
 * Review of feat/voice-fluid (HIGH 3): after a spoken turn's single retry, ANY finding still open ends in an honest line written by code —
 * never the model's reply, never a clean success line over a failed command.
 */
/** The findings that mean the reply would tell him something false about what happened. A wrong time or an "error"
 *  somewhere in a tool's output beside a real success does not (re-review HIGH): those keep the model's reply. Overlap and
 *  duplicate count only when the check actually had his calendar to look at. */
export const SPOKEN_BLOCKING = ["claims what the tools don't show", "promised but did not act", "failure not mentioned", "did not finish", "denies messages it shows", "claims a lookup it did not do"] as const;
export function spokenBlocking(findings: readonly string[], calendarChecked: boolean): string[] {
  return findings.filter((f) => (SPOKEN_BLOCKING as readonly string[]).includes(f) || (calendarChecked && (f === "overlap left" || f === "duplicate block")));
}
export function spokenFinalLine(allFindings: readonly string[], ctx: { calendar: boolean; wrote: boolean; calendarChecked?: boolean }): string | undefined {
  const findings = spokenBlocking(allFindings, ctx.calendarChecked ?? false);
  if (!findings.length) return undefined;
  if (findings.some((f) => FALSE_CLAIM.test(f))) return honestLine(ctx.calendar);
  if (findings.some((f) => LOOKUP_CLAIM.test(f))) return LOOKUP_HONEST;
  if (findings.includes("denies messages it shows")) return MESSAGES_UNSURE;
  if (ctx.wrote) return SPOKEN_STOP_WROTE;
  return ctx.calendar ? honestLine(true) : SPOKEN_STOP;
}
/** A write this turn: an orion-reschedule/orion-tasks change or an orion_task_run action (not a read). */
const wroteThisTurn = (tools: ToolResult[]): boolean =>
  tools.some((t) => /orion-reschedule|orion-tasks|orion_task_run|orion-session|orion-remember/.test(t.canonical) && !/\b(show|day|list|status)\b/.test(t.canonical));
/** Whether the worker made the directive's call (directly, or through tool_call with the orion_task_run id).
 *  2026-10-16 (tool wiring): a "Tool orion_task_run not found" or error result is not a call made. */
const directiveCalled = (run: Run): boolean => !!run.directive && run.tools.some((t) => madeTaskRunCall(t, run.directive!.action));

/** The tool family that can stand in for each directive action (re-review, 2026-10-16): an unrelated success
 *  (lights, supplement_add) must not carry a reply about weather or a dose. */
const DIRECTIVE_FAMILY: Record<string, RegExp> = {
  weather_now: /weather/i,
  supplement_take: /"supplement_take"|orion-log\s+(supplement|take)/i,
  timer_set: /"timer_set"/,
  supplement_status: /"supplement_status"/,
};
/** A result this turn from the directive's own family that shows a change: NOTHING WAS CHANGED, an error or a
 *  refusal is not one. No family known: no stand-in, the fail line stays. */
const anotherToolSucceeded = (tools: ToolResult[], action: string): boolean =>
  tools.some((t) => DIRECTIVE_FAMILY[action]?.test(t.canonical) === true && (outcomeOf(t) === "success" || (action === "supplement_status" && outcomeOf(t) === "read")));

/** Puts the text that must reach Nick into the turn's last assistant message (the one the host builds the
 *  reply from). Sweep 2026-10-15 (q006, q042, q055, q057, q067, q091): on `openclaw agent --json` —
 *  the Mac chat and phone — reply_payload_sending never runs, before_agent_finalize can only revise, and
 *  before_message_write rewrites only the transcript copy, written before the check runs; the reply is
 *  read afterwards from this same message object, so it is changed in place (the one deliberate
 *  mutation here: the host owns the object). "buy more oats has been marked as done" went out after
 *  three flagged passes. Thinking and tool blocks are kept; the text blocks become this one. */
export function putReplyInPlace(messages: unknown, text: string): boolean {
  // Only this turn's reply: with no assistant message after the last user message, an earlier turn's
  // reply must never be rewritten (review, 2026-10-16).
  const list = Array.isArray(messages) ? (messages as Array<{ role?: unknown; content?: unknown }>) : [];
  const turnStart = list.map((m) => m?.role).lastIndexOf("user") + 1;
  const last = list.slice(turnStart).reverse().find((m) => m?.role === "assistant");
  if (!last) return false;
  if (!Array.isArray(last.content)) { last.content = text; return true; }
  const blocks = last.content as Array<{ type?: unknown }>;
  const at = blocks.findIndex((b) => b?.type === "text");
  const kept = blocks.filter((b) => b?.type !== "text");
  last.content = at < 0 ? [...kept, { type: "text", text }] : [...kept.slice(0, at), { type: "text", text }, ...kept.slice(at)];
  return true;
}

/*
 The gate (Nick, 2026-10-12: "clearly we havent done enough work with the local models to do this.
 lets make sure this doesnt happen again"). "on" was switched live on eval numbers alone and failed
 his first real request three ways. "on" now needs a recent end-to-end pass through the REAL route
 (scripts/eval/v3/ops/local-acceptance.mjs writes it): pass rate, speed and age. Otherwise: shadow.
*/
export const ACCEPTANCE = { minPassRate: 0.85, maxMedianMs: 20000, maxAgeDays: 14, minCases: 20 };
export function acceptanceVerdict(path: string, now = Date.now()): { ok: boolean; why: string } {
  let record: { at?: string; n?: number; pass?: number; medianMs?: number };
  try { record = JSON.parse(readFileSync(path, "utf8")); } catch { return { ok: false, why: `no acceptance record at ${path}` }; }
  const { at, n = 0, pass = 0, medianMs = Infinity } = record;
  const age = at ? (now - Date.parse(at)) / 86400000 : Infinity;
  if (!(age <= ACCEPTANCE.maxAgeDays)) return { ok: false, why: `acceptance is ${Number.isFinite(age) ? Math.round(age) : "?"} days old (max ${ACCEPTANCE.maxAgeDays})` };
  if (n < ACCEPTANCE.minCases) return { ok: false, why: `acceptance ran ${n} cases (min ${ACCEPTANCE.minCases})` };
  if (pass / n < ACCEPTANCE.minPassRate) return { ok: false, why: `acceptance passed ${pass}/${n} (needs ${Math.round(ACCEPTANCE.minPassRate * 100)}%)` };
  if (medianMs > ACCEPTANCE.maxMedianMs) return { ok: false, why: `acceptance median ${Math.round(medianMs / 1000)} s (max ${ACCEPTANCE.maxMedianMs / 1000} s)` };
  return { ok: true, why: `acceptance ${pass}/${n}, median ${Math.round(medianMs / 1000)} s` };
}

/** Starts a flow that may write: refused (`refused`) once the prompt hook has aborted its run, else marked as a write that has begun. */
export function startWrite<R>(run: { abort?: AbortController; writeStarted?: boolean } | undefined, start: () => Promise<R>, refused: R): Promise<R> {
  if (run?.abort?.signal.aborted) return Promise.resolve(refused);
  if (run) run.writeStarted = true;
  return start();
}

/** What a shutdown turn is read against: was the offer just made, is it night, did a shutdown arm the guard tonight. */
const offerConsumed = new Map<string, { offer: string; at: number }>();
function shutdownContext(stateDir: string, now: Date, label: string | undefined, sessionKey: string): { offered: boolean; night: boolean; armed: boolean } {
  const push = lastPush(stateDir, now);
  const recent = push && now.getTime() - Date.parse(push.at) <= 30 * 60_000 ? push.text : undefined;
  const night = pastNudgeTime(stateDir, now);
  let armed = false;
  try { armed = night && (JSON.parse(readFileSync(join(stateDir, "bedtime-shutdown.json"), "utf8")) as { armed?: boolean }).armed === true; } catch { /* not armed */ }
  // The offer answers ONE turn: the next message in this chat, whatever it says, uses it up (review 2026-11-04: a later "ok" to something else
  // shut the Mac down). A message the app labels as a reply to the offer counts only until that offer text has been seen once.
  const offer = isShutdownOffer(label ?? "") ? label : isShutdownOffer(recent ?? "") ? recent : undefined;
  const used = offerConsumed.get(sessionKey);
  const offered = !!offer && !(used?.offer === offer && now.getTime() - used.at < 2 * 3600_000);
  if (offer) offerConsumed.set(sessionKey, { offer, at: now.getTime() });
  return { offered, night, armed };
}

export function registerLocalRouting(api: HookApi, options: LocalRoutingOptions): void {
  if (options.mode === "off") return;
  // Which run a flow belongs to, so a flow that is running when the prompt hook gives up can be stopped and its writes known (review, 2026-10-20).
  const building = new AsyncLocalStorage<Run>();
  // A flow is a write point: once the hook has given up (and nothing was written), none of them starts.
  const marked = <A extends unknown[], R>(f: ((...a: A) => Promise<R>) | undefined) => f && ((...a: A) =>
    startWrite(building.getStore(), () => { forgetReplan(building.getStore()?.sessionKey); forgetMade(building.getStore()?.sessionKey); return f(...a); }, { outcome: "fallback", reason: "too slow" } as unknown as R));
  /** Per session: the last thing ORION created or changed (a block, or a focus session it started), for "make it an hour" (edit-followup.ts). */
  const lastMade = new Map<string, EditTarget>();
  const knowledgePending = new KnowledgePending();   // wave 6 (knowledge-moves.ts): a forget pick, a "put it back", a trash yes; one turn
  const sleepPending = new SleepPlanPending();   // W10-B (sleep-plan-flow.ts): the interview question asked in this chat
  const pendingMemory = new PendingMemory();   // 2026-10-31 (pending-reply.ts): what a nudge's reply agreed, for the next short reply
  const mouseMemory = new MouseMemory();   // w18 mousechat (mouse-chat.ts): the button/action question ORION is waiting on
  const workoutMemory = new WorkoutMemory();   // w17 g-workout (workout-chat.ts): whether a reply still answers the follow-up, and the last workout log for "undo"
  const foodMemory = new FoodMemory();   // w14 g-food (food-chat.ts): whether "yes" still answers "Log it?", and the last food log for "undo"
  const forgetMade = (key: string | undefined) => { if (key) lastMade.delete(key); };
  const recentMade = (key: string | undefined): EditTarget | undefined => { const m = key ? lastMade.get(key) : undefined; return m && Date.now() - m.at < 15 * 60_000 ? m : undefined; };
  /** Per session: his last reschedule request that was carried out, for a follow-up reorder ("actually do resume before gym"), for 15 minutes. */
  const replanMemory = new Map<string, { ask: ReplanAsk; at: number }>();
  const forgetReplan = (key: string | undefined) => { if (key) replanMemory.delete(key); };
  const recentReplan = (key: string | undefined): ReplanAsk | undefined => { const m = key ? replanMemory.get(key) : undefined; return m && Date.now() - m.at < 15 * 60_000 ? m.ask : undefined; };
  const schedule = options.scheduleFlow;
  options = { ...options,
    ...(schedule ? { scheduleFlow: (m: string, c: string, o: Parameters<NonNullable<LocalRoutingOptions["scheduleFlow"]>>[2] = {}) => {
      const r = building.getStore();
      const context = recentReplan(r?.sessionKey);
      const made = recentMade(r?.sessionKey);
      return schedule(m, c, { ...o, ...(context ? { replanContext: context } : {}), ...(made?.kind === "block" ? { lastTarget: { title: made.title, ...(made.start ? { start: made.start } : {}), dateArgs: made.dateArgs } } : {}), ...(r?.abort ? { signal: r.abort.signal, onWriteStart: () => { r.writeStarted = true; progress.stage(r.sessionKey, "changing-calendar"); } } : {}) });
    } } : {}),
    ...(options.lateFlow ? { lateFlow: marked(options.lateFlow)! } : {}), ...(options.sessionFlow ? { sessionFlow: marked(options.sessionFlow)! } : {}),
    ...(options.wakeFlow ? { wakeFlow: marked(options.wakeFlow)! } : {}), ...(options.todoDoneFlow ? { todoDoneFlow: marked(options.todoDoneFlow)! } : {}), ...(options.noteFlow ? { noteFlow: marked(options.noteFlow)! } : {}) };
  const on = options.mode === "on";
  // 2026-10-16, Nick: "i dont want to EVER have to use the cloud model unless necessary". "on" no longer needs
  // an acceptance pass or a 48 h testing window: both assumed the cloud model was a safe fallback, and with
  // no Anthropic credit the window closing meant ORION going silent. The acceptance score is a report now.
  if (on && options.acceptancePath !== undefined) {
    const verdict = acceptanceVerdict(options.acceptancePath);
    api.logger?.warn?.(`[orion-control] localRouting "on" (local always). Acceptance report: ${verdict.ok ? "passing" : "not passing"} — ${verdict.why}.`);
  }
  // The front desk is asked with a timeout that depends on how it did last time (turn-budget.ts): after a failure it gets 2.5 s, not 8 s again.
  const deskHealth = new DeskHealth();
  const { logPath, decideImpl = (input) => decide(input, { timeoutMs: input.timeoutMs ?? DESK_TIMEOUT_MS }), clock = () => localClock(), finalizeWaitMs = 5000, workerProvider = "ollama", workerModel = WORKER_MODEL } = options;
  // Both local models stay loaded, at the context each is called with, checked every 5 minutes
  // (2026-10-14: the 9B was never warmed; a terminal run or another num_ctx unloaded them).
  if (options.warm !== false) {
    const models = [{ model: FRONT_DESK_MODEL, numCtx: FRONT_DESK_CTX }, { model: workerModel, numCtx: FORM_OPTIONS.num_ctx }];
    const warm = () => void keepWarm(on ? models : models.slice(0, 1));
    warm();
    setInterval(warm, 5 * 60_000).unref?.();
  }
  const traceLine = (stage: string, event: Record<string, unknown>, ctx: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    if (!options.trace) return;
    try { appendFileSync(`${logPath}.trace`, `${JSON.stringify({ at: new Date().toISOString(), stage, runId: pick(event, ctx, "runId") ?? null, sessionKey: pick(event, ctx, "sessionKey") ?? null, ...extra })}\n`, { mode: 0o600 }); } catch { /* diagnostics only */ }
  };
  // 2026-10-23 (voice): real stages per session, for the app's "still on it — checking your calendar" (turn-progress.ts).
  const progress = new TurnProgress(options.progressDir ?? join(dirname(dirname(logPath)), "turn-progress"));
  // 2026-10-30 (chatter.ts): the quiet window he asks for, and no failure line twice in ten minutes per session.
  const quiet = new QuietWindow(options.stateDir);
  const repeats = new RepeatGuard();
  // 2026-10-31: spoken lines that went unanswered as not for ORION, per session (chatter.ts), and what a "yes" next turn carries out.
  const rooms = new RoomStreak();
  const ownPending = new Map<string, { pending: LightenPending; at: number }>();
  const nowMs = () => (options.now ?? (() => new Date()))().getTime();
  const runs = new Map<string, Run>();
  /** Per session: his last message (stitched) and the scheduler changes it made. */
  const lastTurn = new Map<string, { text: string; at: number; marks: string[] }>();
  /** Per session: when it last changed his calendar (flow marks, or a write the worker ran). What a bare "undo" may take back. */
  const sessionChanges = new Map<string, { at: number; marks: string[] }>();
  /** Per session: what the last reality statement did (declared facts, calendar writes), for its "undo" (reality.ts). Any later change forgets it. */
  const lastReality = new Map<string, { facts: string[]; writes: number; at: number }>();
  const recordChange = (sessionKey: string | undefined, marks: string[]) => {
    forgetMade(sessionKey);   // any write: "make it an hour" no longer means the older block (review of 45b3383)
    if (!sessionKey) return;
    lastReality.delete(sessionKey);
    forgetReplan(sessionKey);
    sessionChanges.set(sessionKey, { at: Date.now(), marks: [...(sessionChanges.get(sessionKey)?.marks ?? []), ...marks] });
  };
  /** r8b2 (2026-10-16): per session, the block the last code day answer named (what "and after that?" means), short window. */
  const dayMemory = new Map<string, { at: number; memory: DayMemory }>();
  const otherChanges = new Map<string, { at: number; kind: keyof typeof OTHER_ASKS }>();
  const recordOther = (sessionKey: string | undefined, kind: keyof typeof OTHER_ASKS) => { if (sessionKey) { forgetReplan(sessionKey); forgetMade(sessionKey); lastReality.delete(sessionKey); otherChanges.set(sessionKey, { at: Date.now(), kind }); } };
  const recentOther = (sessionKey: string | undefined) => {
    const c = sessionKey ? otherChanges.get(sessionKey) : undefined;
    return c && Date.now() - c.at < SESSION_CHANGE_WINDOW_MS ? c.kind : undefined;
  };
  const changedRecently = (sessionKey: string | undefined) => {
    const c = sessionKey ? sessionChanges.get(sessionKey) : undefined;
    return !!c && Date.now() - c.at < SESSION_CHANGE_WINDOW_MS;
  };
  /** Per session: the reminder just set (for "no wait make it 5:30") and an unanswered "what/when?" about one. */
  const lastReminder = new Map<string, { label: string; at: string; set: number }>();
  /** w18 note: sessions waiting for the note after a bare "make a note" (when it was asked); the next message in that chat is the note. */
  const noteAwait = new Map<string, number>();
  const saveNote = async (run: Run, bound: boolean): Promise<void> => {
    const saved = await options.noteFlow!(run.message, bound).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
    if (saved.outcome === "fallback") return;
    run.flow = saved;
    const calls = saved.outcome === "done" ? saved.calls : saved.calls ?? [];
    const outputs = saved.outcome === "done" ? saved.outputs : saved.outputs ?? [];
    calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: outputs[i] ?? "", exit: null }));
  };
  const reminderAsk = new Map<string, { text: string; at: number; label?: boolean }>();
  /** Per session: an unanswered "how late?" (q029), and the last late move code ran (so "yeah push everything after it" does not move it twice). */
  const lateAsk = new Map<string, number>();
  /** r8 review 3 H1: per session, the add question just asked ("push Gym later — go ahead?", "what should I put before …?") and what it would run. */
  const addPending = new Map<string, { pending: PendingAdd; at: number }>();
  /** His reply to that question, if it is one. The pending add is consumed by whatever turn comes next. */
  const addTurn = (key: string, message: string): PendingAnswer | undefined => {
    const held = addPending.get(key); addPending.delete(key);
    return held && Date.now() - held.at < STITCH_WINDOW_MS ? answerPending(held.pending, message) : undefined;
  };
  /** What a finished schedule flow leaves behind: the calls in the log, the undo marks, and the question it asked (if any). */
  const settleSchedule = (run: Run): void => {
    const flow = run.flow;
    if (flow?.outcome === "say" && flow.pending && run.sessionKey) addPending.set(run.sessionKey, { pending: flow.pending, at: Date.now() });
    // A reschedule he asked for that code answered without writing ("Resume isn't on your day tomorrow…") is remembered too, so "actually do resume before gym" is still its follow-up.
    if (flow?.outcome === "say" && flow.replan && run.sessionKey) replanMemory.set(run.sessionKey, { ask: flow.replan, at: Date.now() });
    if (flow?.outcome !== "done") return;
    flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: flow.outputs[i] ?? "", exit: null }));
    const turn = run.sessionKey ? lastTurn.get(run.sessionKey) : undefined;
    if (turn && run.sessionKey) lastTurn.set(run.sessionKey, { ...turn, marks: flow.marks ?? [] });
    // An unknown outcome may have written: "undo" is allowed for it.
    if (flow.marks?.length || flow.uncertain) recordChange(run.sessionKey, flow.marks ?? []);
    // Any other write forgets the last request; a reschedule remembers itself AFTER that.
    // What "make it an hour" means next: the block this change wrote (an undo leaves nothing to edit).
    if (run.sessionKey) { const t = flow.calls.some((c) => /\bundo\b/.test(c)) ? undefined : blockTarget(flow.calls, flow.outputs, Date.now()); if (t) lastMade.set(run.sessionKey, t); else lastMade.delete(run.sessionKey); }
    if (!flow.replan) forgetReplan(run.sessionKey);
    else if (run.sessionKey) replanMemory.set(run.sessionKey, { ask: flow.replan, at: Date.now() });
  };
  /** The flow's second go for a turn whose worker was refused the scheduler: from the worker's restatement if it states a time, else an honest "nothing changed". */
  const heldChange = async (run: Run, reply: string): Promise<FlowResult> => {
    const restated = reply.trim();
    // Only Nick's own request said back: the worker's sentence is never what the guards check ("move gym later" -> "Move Gym to 6 PM").
    if (options.scheduleFlow && restated && RESTATES_TIME.test(restated) && !CANT_OR_CONFIRM.test(restated) && !isQuestion(restated)
      && restatementIsHis(restated, run.message, nowMinutes(options.now))) {
      const flow = await options.scheduleFlow(restated, clock(), { undo: run.undo ?? [] }).catch(() => undefined);
      if (flow && flow.outcome !== "fallback") return flow;
    }
    return { outcome: "say", kind: "plain", text: REFUSED_NOTHING_CHANGED };
  };
  /** REV5 MUST 4 (work-start.ts): the names a casual focus start may resolve to — today's blocks and the deadlines' titles. Read-only. */
  const knownNames = async (): Promise<KnownName[]> => {
    const [day, due] = await Promise.all([
      options.readDayJson ? withTimeout(options.readDayJson([]).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) : Promise.resolve(undefined),
      options.readDeadlines ? withTimeout(options.readDeadlines().catch(() => null), options.dayReadMs ?? DAY_READ_MS) : Promise.resolve(undefined),
    ]);
    return [...(day?.blocks ?? []), ...(due?.events ?? []).map((e) => ({ title: e.title })), ...(due?.tasks ?? []).map((t) => ({ title: t.title }))];
  };
  /** Wave 8 B: gym is not on today's calendar and he named tomorrow: book it there (the usual placement), say what was assumed. */
  const bookTomorrowGym = async (run: Run, skip: Extract<GymSkip, { kind: "tomorrow" }>): Promise<void> => {
    const at = skip.at ? ["--at", skip.at] : [];
    const add = await options.realityRun!("orion-reschedule", ["add", "Gym", "90", ...at, "--date", "tomorrow"]).catch(() => ({ stdout: "", code: 1 }));
    run.tools.push({ canonical: `exec orion-reschedule add "Gym" 90 ${at.length ? `${at.join(" ")} ` : ""}--date tomorrow`, stdout: add.stdout, exit: add.code });
    if (refused(add) || notBooked(add.stdout, "Gym")) {
      if (wrote(add)) { const back = await options.realityRun!("orion-reschedule", ["undo"]).catch(() => ({ stdout: "", code: 1 })); run.tools.push({ canonical: "exec orion-reschedule undo", stdout: back.stdout, exit: back.code }); }
      run.flow = { outcome: "say", kind: "plain", text: `Gym wasn't on today's calendar, and there's no room for 90 minutes of it tomorrow${at.length ? ` at ${ampm12(at[1]!)}` : ""}, so nothing changed. Tell me what to move tomorrow and I'll fit it.` };
      return;
    }
    const when = /(\d{2}:\d{2})[–-](\d{2}:\d{2})/.exec(add.stdout) ?? (at.length ? [at[1]!, at[1]!] : null);
    const assumed = skip.assumed ? ` (I took ${skip.assumed} as ${ampm12(skip.at!)})` : "";
    const also = sideNotes("Gym", [add.stdout]);
    recordChange(run.sessionKey, []);
    if (run.sessionKey) lastReality.set(run.sessionKey, { facts: [], writes: 1, at: Date.now() });
    run.flow = { outcome: "done", calls: run.tools.map((t) => t.canonical), outputs: run.tools.map((t) => t.stdout),
      reply: `Booked: gym tomorrow${when ? ` at ${ampm12(when[1]!)}` : ""}, 90 minutes${assumed}. Gym wasn't on today's calendar, so there was nothing to take off today.${also.length ? ` To fit it tomorrow: ${also.join("; ")}.` : ""} Say "undo" to take it back.` };
  };
  /** 2026-10-30 gate (anchor-guards.ts): gym put off. An excuse is pushed back on, a real reason moves it, "tomorrow" books it there first. */
  const gymTurn = async (run: Run): Promise<void> => {
    const skip = run.gymSkip!;
    const say = (text: string, kind: "plain" | "ask" = "plain") => { run.flow = { outcome: "say", kind, text }; };
    const day = options.readDayJson ? await withTimeout(options.readDayJson([]).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) : undefined;
    const gym = day?.blocks.find((b) => b.kind === "gym" || /\bgym\b/i.test(b.title));
    if (day) markRead(run, "day");
    if (skip.kind === "stated") {   // wave 8 B (stated-move.ts): "gym is bumped to 10:30" is a request; the flow moves it or adds it
      const flow = options.scheduleFlow ? await options.scheduleFlow(`move ${skip.name} to ${ampm12(skip.at)} ${skip.day}`, clock(), { deadlineAt: flowDeadline(run.started) }).catch(() => undefined) : undefined;
      if (flow && flow.outcome !== "fallback") { run.flow = flow; if (flow.outcome === "done") settleSchedule(run); }
      else say(`I haven't changed your calendar: I couldn't move ${skip.name} to ${ampm12(skip.at)} just now. Say it again and I'll retry.`);
      return;
    }
    if (skip.kind === "excuse") {
      const skipsThisWeek = (run.card?.slipsWeek ?? []).filter((s) => s.planned?.kind === "gym" || /\bgym\b/i.test(s.planned?.title ?? "")).length;
      say(gymPushback({ skipsThisWeek, firm: run.card?.record?.strictness === "firm", ...(gym ? { gymAt: gym.start } : {}) }));
      return;
    }
    if (skip.kind === "legit") {
      if (!skip.at || !options.scheduleFlow) { say(legitAsk(skip.reason), "ask"); return; }
      const flow = await options.scheduleFlow(`move ${gym?.title ?? "gym"} to ${ampm12(skip.at)} today`, clock(), { deadlineAt: flowDeadline(run.started) }).catch(() => undefined);
      if (flow?.outcome === "done") { run.flow = { ...flow, reply: `${legitLead(skip.reason)} ${exactReply(flow)}` }; settleSchedule(run); }
      else say(legitAsk(skip.reason), "ask");
      return;
    }
    // "move it to tomorrow": tomorrow's 90 minutes first, and today's comes off only once that is booked. One "undo" takes both back.
    // Wave 8 B: "move it to tomorrow" with no gym today is still an explicit target: tomorrow's gym is booked, and he is told today had none.
    if (!options.realityRun || (!gym && skip.kind !== "tomorrow")) { say(gym ? "I couldn't move gym just now, so it's still on today." : "Gym isn't on today's calendar, so there's nothing to move. Want me to put 90 minutes in tomorrow?", gym ? "plain" : "ask"); return; }
    if (!gym) { await bookTomorrowGym(run, skip); return; }
    const nowD = (options.now ?? pluginNow)();
    const nowHm = `${String(nowD.getHours()).padStart(2, "0")}:${String(nowD.getMinutes()).padStart(2, "0")}`;
    // REV2 finding 8: "ill do gym tmrw" before today's gym is over would delete a gym day on a whim: pushback and one question.
    if (skip.kind === "tomorrow" && skip.deferred && gym.end > nowHm) { say(deferAsk(gym.start), "ask"); return; }
    const at = skip.kind === "tomorrow" && skip.at ? ["--at", skip.at] : [];
    const add = await options.realityRun("orion-reschedule", ["add", gym.title, "90", ...at, "--date", "tomorrow"]).catch(() => ({ stdout: "", code: 1 }));
    run.tools.push({ canonical: `exec orion-reschedule add "${gym.title}" 90 ${at.length ? `${at.join(" ")} ` : ""}--date tomorrow`, stdout: add.stdout, exit: add.code });
    const when = /(\d{2}:\d{2})[–-](\d{2}:\d{2})/.exec(add.stdout) ?? (at.length ? [at[1]!, at[1]!] : null);
    const assumed = skip.kind === "tomorrow" && skip.assumed ? ` (I took ${skip.assumed} as ${ampm12(skip.at!)})` : "";
    // REV2 finding 1: only the gym's own NOT BOOKED (or a refusal) is "no room"; what else that run wrote is undone at once.
    if (refused(add) || notBooked(add.stdout, gym.title)) {
      if (wrote(add)) { const back = await options.realityRun("orion-reschedule", ["undo"]).catch(() => ({ stdout: "", code: 1 })); run.tools.push({ canonical: "exec orion-reschedule undo", stdout: back.stdout, exit: back.code }); }
      say(`There's no room for 90 minutes of gym tomorrow${at.length ? ` at ${ampm12(at[1]!)}` : ""}, so I left today's gym at ${ampm12(gym.start)}. Tell me what to move tomorrow and I'll fit it.`); return;
    }
    const tomorrowAlso = sideNotes(gym.title, [add.stdout]);
    const alsoLine = tomorrowAlso.length ? ` To fit it tomorrow: ${tomorrowAlso.join("; ")}.` : "";
    // 2026-10-31 (loop-gym-ladder-ignored-c): today's gym already over is a slip, not a block to take off.
    if (gym.end <= nowHm) {
      recordChange(run.sessionKey, []);
      if (run.sessionKey) lastReality.set(run.sessionKey, { facts: [], writes: 1, at: Date.now() });
      run.flow = { outcome: "done", calls: run.tools.map((t) => t.canonical), outputs: run.tools.map((t) => t.stdout),
        reply: `Booked: gym tomorrow${when ? ` at ${ampm12(when[1]!)}` : ""}, 90 minutes${assumed}.${alsoLine} Today's ${ampm12(gym.start)} gym slipped; I'll come back to you when tomorrow's starts. Say "undo" to take it back.` };
      return;
    }
    const drop = await options.realityRun("orion-reschedule", ["drop", gym.title]).catch(() => ({ stdout: "", code: 1 }));
    run.tools.push({ canonical: `exec orion-reschedule drop "${gym.title}"`, stdout: drop.stdout, exit: drop.code });
    const dropped = !refused(drop);
    recordChange(run.sessionKey, []);
    if (run.sessionKey) lastReality.set(run.sessionKey, { facts: [], writes: dropped ? 2 : 1, at: Date.now() });
    run.flow = { outcome: "done", calls: run.tools.map((t) => t.canonical), outputs: run.tools.map((t) => t.stdout),
      reply: dropped ? `Moved: gym is off today and on tomorrow${when ? ` at ${ampm12(when[1]!)}` : ""}, 90 minutes${assumed}.${alsoLine} Say "undo" to put it back.`
        : `I booked gym tomorrow${when ? ` at ${ampm12(when[1]!)}` : ""} but couldn't take today's off, so you have both for now. Say "undo" to take tomorrow's back.` };
  };
  /** 2026-10-31 (day-lighten.ts, focus-moves.ts): carries out his yes, a lightening of the day, or a focus phrase. A prompt only when the worker
   *  must make the one call (a stall's reminder); otherwise run.flow is set and the turn's reply is code's. */
  const ownTurn = async (run: Run, now: string): Promise<{ systemPrompt: string; appendContext: string } | undefined> => {
    const at = (options.now ?? pluginNow)();
    const key = run.sessionKey;
    const offer = (pending: LightenPending | undefined) => { if (pending && key) ownPending.set(key, { pending, at: Date.now() }); };
    const wrote = (flow: FlowResult, writes: number) => {
      run.flow = flow;
      if ("calls" in flow && flow.calls) flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: flow.outputs?.[i] ?? "", exit: null }));
      if (writes) { recordChange(key, []); if (key) lastReality.set(key, { facts: [], writes, at: Date.now() }); }
    };
    const startSession = async (words: string) => {
      if (!options.sessionFlow) return;
      const flow = await options.sessionFlow(words).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
      if (flow.outcome === "fallback") { run.flow = { outcome: "say", kind: "plain", text: "I couldn't start the focus session just now, so nothing is running." }; return; }
      wrote(flow, 0);
      if (flow.outcome === "done") recordOther(key, "focus");
    };
    if (run.pendingYes) {
      const p = run.pendingYes;
      if ("session" in p) await startSession(p.session);
      else if (options.realityRun) { const out = await runLighten(p.steps, options.realityRun); wrote(out.flow, out.writes); markRead(run, "day"); }
      return undefined;
    }
    const task = run.card?.record?.shouldBe?.kind && !/^(?:unknown|sleep|free)$/.test(run.card.record.shouldBe.kind) ? run.card.record.shouldBe.title ?? undefined : run.card?.record?.next?.title ?? undefined;
    if (run.focusMove) {
      const out = await runFocusMove(run.focusMove, { ...(options.sessionExec ? { exec: options.sessionExec } : {}), ...(options.realityRun ? { run: options.realityRun } : {}), now: at, ...(task ? { task } : {}),
        ...(options.readDayJson ? { readDay: () => withTimeout(options.readDayJson!([]).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) } : {}),
        // run-1101020721 foc-doomscroll-v: a doomscroll may start a session only when typed or addressed (room speech never starts one).
        mayStart: !run.spoken || addressed(run.message),
        ...(options.readDeadlines ? { readDeadlines: () => withTimeout(options.readDeadlines!().catch(() => null), options.dayReadMs ?? DAY_READ_MS) } : {}) });
      if (out.pendingSession) offer({ session: out.pendingSession });
      if (out.flow) { wrote(out.flow, out.writes ?? 0); if (out.flow.outcome === "done" && /orion-session start/.test(out.flow.calls.join(" "))) recordOther(key, "focus"); }
      if (out.reminder) {
        (out.calls ?? []).forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs?.[i] ?? "", exit: null }));
        run.reminder = { args: out.reminder.args, say: out.reminder.say, action: "alarm_set", label: out.reminder.label, at: out.reminder.at };
        return { systemPrompt: `${LOCAL_IDENTITY}\n\nDo this for Nick now with ${taskRunCall(out.reminder.args)}\nThen, only if the result shows it worked, reply: "${out.reminder.say}" If it did not, say so plainly.\n\n${now}`,
          appendContext: `[ORION: ${taskRunNow(out.reminder.args)}]` };
      }
      return undefined;
    }
    if (run.health && options.stateDir) {
      const flow = await runHealthIntent(run.health, { stateDir: options.stateDir, now: at });
      wrote(flow, 0); run.provided = true;
      return undefined;
    }
    if (run.lighten) {
      const read = run.lighten;
      const [day, deadlines] = await Promise.all([
        options.readDayJson ? withTimeout(options.readDayJson([]).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) : Promise.resolve(undefined),
        options.readDeadlines ? withTimeout(options.readDeadlines().then((r) => r ?? undefined).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) : Promise.resolve(undefined),
      ]);
      if (day) markRead(run, "day");
      if (deadlines) markRead(run, "deadlines");
      const plan = planLighten(read, { ...(day ? { day } : {}), deadlines: deadlines ?? null, now: at });
      // 2026-10-31 (health-log.ts): a lightened day after a bad night states the real sleep numbers first.
      const sleep = options.stateDir && (read.kind === "slept" || read.kind === "tired") ? await sleepLine(options.stateDir, at) : "";
      const withSleep = (f: FlowResult): FlowResult => (!sleep ? f : f.outcome === "done" && f.reply ? { ...f, reply: `${sleep} ${f.reply}` } : f.outcome === "say" ? { ...f, text: `${sleep} ${f.text}` } : f);
      if (plan.steps.length && options.realityRun) { const out = await runLighten(plan.steps, options.realityRun, plan.text); wrote(withSleep(out.flow), out.writes); return undefined; }
      run.flow = withSleep({ outcome: "say", kind: plan.pending ? "ask" : "plain", text: plan.text || "I couldn't change your day just now, so nothing changed." });
      offer(plan.pending);
    }
    return undefined;
  };
  const lastLate = new Map<string, { minutes: number; at: number; changed: boolean; reply: string; asked?: boolean }>();
  /** Whether this turn is the late flow's: "running late" with no minutes, the short answer to our question, or the go-ahead after it. Consumes the pending question. */
  const lateTurn = (key: string, message: string): Run["late"] => {
    const askedAt = lateAsk.get(key); lateAsk.delete(key);
    const pending = askedAt !== undefined && Date.now() - askedAt < STITCH_WINDOW_MS;
    // H1 (r8 review 1, 2026-10-16): the go-ahead only counts on the turn right after a late reply; any other turn clears it
    // (a bare "yeah" after the schedule flow's own question re-ran `late 15`).
    const last = lastLate.get(key); lastLate.delete(key);
    if (isLateWithoutMinutes(message)) return { kind: "ask" };
    if (pending) {
      const minutes = lateMinutesAnswer(message);
      if (minutes !== null) return { kind: "run", minutes };
      if (isLateConfirm(message) || isBareYes(message)) return { kind: "ask" };
    }
    // r8 review 2 MEDIUM-1: a bare "ok"/"yeah" confirms only a late reply that asked something; after "Nothing was moved — …" it is an acknowledgement.
    if (last && Date.now() - last.at < SESSION_CHANGE_WINDOW_MS && (isLateConfirm(message) || (isBareYes(message) && last.asked))) return { kind: "confirm", last };
    return undefined;
  };
  const runFor = (event: Record<string, unknown>, ctx: Record<string, unknown>) => runs.get(pick(event, ctx, "runId") ?? "") ?? runs.get(`session:${pick(event, ctx, "sessionKey") ?? ""}`);
  const log = (entry: Record<string, unknown>) => {
    try {
      mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
      appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), mode: options.mode, ...entry })}\n`, { mode: 0o600 });
    } catch (error) {
      api.logger?.warn?.(`[orion-control] local routing log failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const settle = async (run: Run): Promise<Decision | { error: string }> => {
    const timeout = new Promise<{ error: string }>((resolve) => setTimeout(() => resolve({ error: "front desk still running" }), finalizeWaitMs));
    return Promise.race([run.decision, timeout]);
  };

  /** The run, swapped for a copy that the (late) original build can no longer change: what Nick is told is fixed once the hook gives up. */
  const freezeRun = (old: Run, flow: FlowResult): Run => {
    const next: Run = { ...old, flow, provided: false, directive: undefined, reminder: undefined };
    for (const [k, v] of runs) if (v === old) runs.set(k, next);
    return next;
  };
  const fixedReply = (text: string, state = "nothing was changed") => ({ systemPrompt: `${EXACT_REPLY_PROMPT}\n${text}`, appendContext: `[ORION scheduler — ${state}. Your whole reply must be exactly: ${text}]` });
  /**
   * 2026-10-20 incident: the host cuts before_prompt_build off at 15 s and then runs the FULL workspace prompt (17.7k tokens, 3 min 1 s on battery) —
   * silently, with no error anywhere. The hook now (1) is registered with a longer timeout, (2) bounds its own work so that it answers first,
   * (3) never throws into the host's default prompt, and (4) does not hand a change request that already took SLOW_TURN_MS a multi-minute tool loop.
   */
  /** Per session: how a change the prompt hook left to finish ended, told with the next message. */
  const lateReports = new Map<string, { text: string; at: number }>();
  const deliverLate = (run: Run, built: unknown): unknown => {
    const key = run.sessionKey; const late = key ? lateReports.get(key) : undefined;
    if (!key || !late || !built || typeof built !== "object" || Date.now() - late.at > 60 * 60_000) return built;
    lateReports.delete(key);
    const said = `Earlier: ${late.text}`;
    const flow = run.flow;
    if (flow?.outcome === "done") { run.flow = { ...flow, reply: `${said} ${exactFor(run)}` }; const exact = exactFor(run); return { systemPrompt: `You already made this change. ${EXACT_REPLY_PROMPT}\n${exact}`, appendContext: `[ORION scheduler — already done. Your whole reply must be exactly: ${exact}]` }; }
    if (flow?.outcome === "say") { run.flow = { ...flow, text: `${said} ${exactFor(run)}`, kind: "plain" }; return fixedReply(exactFor(run)); }
    const b = built as { systemPrompt?: string; appendContext?: string };
    return { ...b, appendContext: `${b.appendContext ? `${b.appendContext}\n` : ""}[ORION: begin your reply with exactly this, then answer him: "${said}"]` };
  };
  const guardedPrompt = (inner: Handler): Handler => async (event, ctx) => {
    const run = runFor(event, ctx);
    if (!run?.settled || run.cloud) return undefined;
    traceLine("before_prompt_build", event, ctx, { sinceStartMs: Date.now() - run.started });
    let timer: ReturnType<typeof setTimeout> | undefined;
    run.abort = new AbortController(); run.writeStarted = false;
    const cut = new Promise<"cut">((resolve) => { timer = setTimeout(() => resolve("cut"), HOOK_TIMEOUT_MS - 5_000); timer.unref?.(); });
    try {
      const working = building.run(run, () => Promise.resolve(inner(event, ctx)));
      const built = await Promise.race([working, cut]);
      if (built === "cut") {
        traceLine("before_prompt_build_cut", event, ctx, { sinceStartMs: Date.now() - run.started, writeStarted: !!run.writeStarted });
        if (run.writeStarted) {
          // A write that has begun is left to finish; he is told how it went with his next message.
          recordChange(run.sessionKey, []);
          void working.then(() => {
            const flow = run.flow;
            if (flow?.outcome === "done") settleSchedule(run);
            const text = flow?.outcome === "done" || flow?.outcome === "say" ? exactReply(flow) : LATE_UNKNOWN_LINE;
            if (run.sessionKey) lateReports.set(run.sessionKey, { text: text || LATE_UNKNOWN_LINE, at: Date.now() });
          }, () => { if (run.sessionKey) lateReports.set(run.sessionKey, { text: LATE_UNKNOWN_LINE, at: Date.now() }); });
        } else run.abort?.abort();   // nothing was written: stop the reads and the model calls, and say so
        const line = run.writeStarted ? SLOW_FLOW_MAYBE_WROTE_LINE : SLOW_FLOW_LINE;
        freezeRun(run, { outcome: "say", kind: "plain", text: line });
        return fixedReply(line, run.writeStarted ? "a change is being made and is not stopped" : "nothing was changed");
      }
      const now = runFor(event, ctx) ?? run;
      for (const stage of stagesForReads(now.reads)) progress.stage(now.sessionKey, stage);
      progress.stage(now.sessionKey, "thinking");
      const stillWorker = !now.flow || now.flow.outcome === "fallback";
      if (stillWorker && !now.directive && !now.reminder && !now.noTools && !now.provided && Date.now() - now.started > SLOW_TURN_MS
        && CHANGE_REQUEST.test(now.message) && SCHEDULING.test(now.message) && !isQuestion(now.message)) {
        now.flow = { outcome: "say", kind: "plain", text: SLOW_TURN_LINE };
        traceLine("slow_turn", event, ctx, { sinceStartMs: Date.now() - now.started });
        return fixedReply(SLOW_TURN_LINE);
      }
      return deliverLate(runFor(event, ctx) ?? run, built) as ReturnType<Handler>;
    } catch (error) {
      api.logger?.warn?.(`[orion-control] before_prompt_build failed, using the slim prompt: ${error instanceof Error ? error.message : String(error)}`);
      return { systemPrompt: `${instructionsFor(run.settled, run.message)}\n\n${PRODUCTION_NOTES}\n\n${LOOK_IT_UP}\n\nNow: ${clock()} (Europe/London). ${dateLine()}` };
    } finally { if (timer) clearTimeout(timer); }
  };

  api.on("before_model_resolve", async (event, ctx) => {
    const runId = pick(event, ctx, "runId");
    const sessionKey = pick(event, ctx, "sessionKey") ?? "";
    const raw = str(event.prompt);
    traceLine("before_model_resolve", event, ctx, { hasPrompt: !!raw });
    if (!raw || INTERNAL.test(sessionKey)) return undefined;
    if (sessionKey) progress.begin(sessionKey, runId ?? null);
    // The rest of a cut-off spoken request is read together with its first half, as one request.
    const heard = userText(raw);
    // 2026-10-30: a message replayed after a model outage reads as he said it (the marker is for the transcript and the worker).
    const replayed = REPLAY_MARK.test(heard);
    const said = heard.replace(REPLAY_MARK, "");
    const before = sessionKey ? lastTurn.get(sessionKey) : undefined;
    const cont = continuationOf(said);   // 2026-10-31 (pending-reply.ts): the marker may carry the whole sentence itself
    const stitch = cont && before && Date.now() - before.at < STITCH_WINDOW_MS ? before : undefined;
    const continuation = cont ? cont.rest : undefined;
    // 2026-10-19: the rest of a message whose first half got the crisis reply. Still joined to it (so more distress, even without the
    // listed words, keeps CRISIS_REPLY); only a concrete request that code then runs gets its own reply (see crisisRest below).
    const crisisRest = stitch && isCrisis(stitch.text) && !isCrisis(continuation ?? "") ? continuation : undefined;
    const message = cont?.full ?? (stitch ? `${stitch.text} ${continuation}` : cont?.rest || said);
    const spokenTurn = SPOKEN.test(raw);
    // 2026-10-30 (chatter.ts): "shush" / "don't reply unless I say orion" starts a quiet window; inside it, spoken turns without
    // "orion" are dropped before anything else reads them (no desk, no flow, no memory). Saying "orion" ends it.
    // A reply to ORION's own line ("im doing work shush up" after the bedtime nudge) is that line's (outreach-reply.ts), not a quiet window.
    const quietStart = on && !parseOutreach(raw) ? quietRequest(message) ?? undefined : undefined;
    const quietUntil = on ? quiet.until(nowMs()) : null;
    if (quietUntil && addressed(message) && quietStart === undefined) quiet.end(nowMs());
    // 2026-10-31 (chatter.ts roomTalk): out loud and without "orion", one side of someone else's conversation, or a line in a run of them.
    if (addressed(message)) rooms.clear(sessionKey);
    const room = on && !cont && !quietUntil && quietStart === undefined ? roomTalk(message, { spoken: spokenTurn, streak: rooms.recent(sessionKey, nowMs()), trailing: trailsOff(message) }) ?? undefined : undefined;
    const hushed = !cont && ((!!quietUntil && spokenTurn && !addressed(message) && quietStart === undefined) || room === "room");
    const cutOff = !hushed && spokenTurn && trailsOff(message);
    if (sessionKey) lastTurn.set(sessionKey, { text: message, at: Date.now(), marks: [] });
    // Text owed by an earlier turn in this session is never delivered on this one (review, 2026-10-16).
    if (sessionKey) finalText.delete(`session:${sessionKey}`);
    // 2026-10-20: "reschedule my day after my class, gym first" is code's whole job (day-replan.ts): the 4B is not asked, so a slow or
    // failing desk can neither delay it by 8 s nor send it down the worker path.
    // The calendar intent layer (calendar-intent.ts): a replan, a follow-up to one, an add at a time or "until T", or a request he took back at the end.
    // 2026-10-30: a statement of what happened ("i dont have classes today") is code's from the start: no desk, no model needed for its effect.
    const quietTurn = hushed || quietStart !== undefined;
    // Wave 12 L1 (questions-flow.ts): "any questions for me", "forget that question", or his answer to ORION's question owns the whole turn.
    // w19 selffix (selffix-flow.ts): "why did you do that" / "that was wrong" (he reads his own last turns and answers), or his now / later / no to a fix offer.
    const smove = on && !cutOff && !quietTurn && !isCrisis(message) && options.stateDir ? readSelffixMove(message, { stateDir: options.stateDir, now: (options.now ?? pluginNow)(), outreach: !!parseOutreach(raw) }) : undefined;
    const qmove = on && !cutOff && !quietTurn && !smove && !isCrisis(message) && options.stateDir ? readQuestionsMove(message, { stateDir: options.stateDir, now: (options.now ?? pluginNow)(), ...(parseOutreach(raw) ? { label: parseOutreach(raw)!.text } : {}), lastPush: readLastOutreach(options.stateDir, (options.now ?? pluginNow)()) }) : undefined;
    // Wave 14 (mail-flow.ts): "not important" / "this matters" to a mail alert, or "stop telling me about X emails", owns the whole turn.
    const mmove = on && !cutOff && !quietTurn && !qmove && !smove && !isCrisis(message) && options.stateDir ? readMailMove(message, { stateDir: options.stateDir, now: (options.now ?? pluginNow)(), ...(parseOutreach(raw) ? { label: parseOutreach(raw)!.text } : {}), lastPush: readLastOutreach(options.stateDir, (options.now ?? pluginNow)()) }) : undefined;
    // w14 g-food (food-read.ts): a calorie question, "log this: …", a meal with a food in it, a chat photo, or his reply to "Log it?".
    const foodPending = on && options.foodRun && options.stateDir ? readFoodPending(options.stateDir, (options.now ?? pluginNow)()) : undefined;
    const food = on && !cutOff && !quietTurn && !qmove && !smove && !mmove && !isCrisis(message) && options.foodRun && options.stateDir ? readFoodTurn(message, { now: (options.now ?? pluginNow)(), mealsOn: true,
      ...(foodPending ? { pending: foodPending, bound: foodMemory.bound(sessionKey, foodPending, parseOutreach(raw)?.text) } : {}), attachments: Array.isArray(event.attachments) ? event.attachments as Array<{ kind?: string }> : [],
      ...(foodMemory.lastLogged(sessionKey) ? { lastLogged: foodMemory.lastLogged(sessionKey)! } : {}) }) ?? undefined : undefined;
    if (!food && !quietTurn) foodMemory.otherTurn(sessionKey, (options.now ?? pluginNow)().getTime());
    // w17 g-workout (workout-read.ts): "just did legs, squats 4x6 at 185", "log my workout: …", "went for a 3 mile run", or his answer to the follow-up question.
    const workoutPending = on && options.workoutRun && options.stateDir ? readWorkoutPending(options.stateDir, (options.now ?? pluginNow)()) : undefined;
    const workout = on && !cutOff && !quietTurn && !qmove && !smove && !mmove && !food && !isCrisis(message) && options.workoutRun && options.stateDir ? readWorkoutTurn(message, { now: (options.now ?? pluginNow)(),
      ...(workoutPending ? { pending: workoutPending, bound: workoutMemory.bound(sessionKey, workoutPending, parseOutreach(raw)?.text) } : {}), outreach: !!parseOutreach(raw),
      ...(workoutMemory.lastLogged(sessionKey) ? { lastLogged: workoutMemory.lastLogged(sessionKey)! } : {}) }) ?? undefined : undefined;
    if (!workout && !quietTurn) workoutMemory.otherTurn(sessionKey, (options.now ?? pluginNow)().getTime());
    // w18 apps (apps-read.ts): "close the apps im not using", "quit spotify and discord", "what apps do i have open": orion-apps does it and says what it did.
    // w18 bedtime (bedtime-shutdown-read.ts): a yes to "want me to shut things down?", "put my computer to bed", "i need 20 more minutes": code runs it.
    const shutdownAt = (options.now ?? pluginNow)();
    const shutdownCtx = options.shutdownRun && options.stateDir ? shutdownContext(options.stateDir, shutdownAt, parseOutreach(raw)?.text, sessionKey ?? "") : undefined;
    const shutdownTurn = on && shutdownCtx && !cutOff && !quietTurn && !qmove && !smove && !mmove && !food && !workout && !isCrisis(message)
      ? readShutdownTurn(message, shutdownCtx) ?? undefined : undefined;
    const appsTurn = on && !cutOff && !quietTurn && !qmove && !smove && !mmove && !food && !workout && !shutdownTurn && !isCrisis(message) && options.appsRun ? readAppsTurn(message) ?? undefined : undefined;
    // w18 mousechat (mouse-read.ts): "make my side button do stage manager", "dont do anything in minecraft", "what are my mouse buttons set to", or a yes to a new-mouse outreach.
    const mouseAt = (options.now ?? pluginNow)();
    const mouseWaiting = on && options.mouseRun ? mouseMemory.get(sessionKey, mouseAt.getTime()) : undefined;
    // A bare yes/no answers the new-mouse outreach only as its immediate reply: the app's label on this very message, or the push was within
    // 15 minutes and nothing else was said in this chat since.
    const push = options.stateDir ? readLastOutreach(options.stateDir, mouseAt) : null;
    const mouseOutreach = parseOutreach(raw)?.text ?? (push && mouseAt.getTime() - Date.parse(push.at) <= 15 * 60_000 && Date.parse(push.at) > mouseMemory.lastOther(sessionKey) ? push.text : undefined);
    const mouse = on && !cutOff && !quietTurn && !qmove && !smove && !mmove && !food && !workout && !appsTurn && !shutdownTurn && !isCrisis(message) && options.mouseRun
      ? readMouseTurn(message, { ...(mouseWaiting ?? {}), outreachAbout: !!mouseOutreach && /\bmouse\b/i.test(mouseOutreach) }) ?? undefined : undefined;
    if (!mouse && !quietTurn) { mouseMemory.clear(sessionKey); mouseMemory.otherTurn(sessionKey, mouseAt.getTime()); }
    const reality = on && !cutOff && !quietTurn && !qmove && !smove && !mmove && !food && !workout && !appsTurn && !shutdownTurn && !mouse && options.realityRun ? readReality(message, (options.now ?? pluginNow)()) ?? undefined : undefined;
    const realityWhole = (!!reality && !reality.rest) || !!qmove || !!smove || !!mmove || !!food || !!workout || !!appsTurn || !!shutdownTurn || !!mouse;
    // 2026-10-30 gate: putting gym off, or "wipe my week", is code's before the intent layer can read it as a drop or a clear.
    const gymSkip = on && !cutOff && !quietTurn && !realityWhole ? readGymSkip(message) ?? readStatedMove(message) ?? undefined : undefined;
    const wipe = on && !cutOff && !quietTurn && !realityWhole && isWipe(message);
    // 2026-10-31: tired / sick / slept badly / stressed (day-lighten.ts), a focus phrase (focus-moves.ts), or his "yes" to what one proposed.
    const held = sessionKey ? ownPending.get(sessionKey) : undefined;
    if (sessionKey) ownPending.delete(sessionKey);
    const free = on && !cutOff && !quietTurn && !realityWhole && !gymSkip && !wipe;
    const pendingYes = free && held && Date.now() - held.at < STITCH_WINDOW_MS * 3 && (isYes(message.replace(/[.!?…]+$/, "")) || saysYes(message)) ? held.pending : undefined;
    const phoneBlock = free && !pendingYes && options.phoneTimeRun && !isCrisis(message) ? readPhoneBlock(message) : undefined;   // W10-G
    const lighten = free && !pendingYes && !phoneBlock && !isCrisis(message) ? readLighten(message) ?? undefined : undefined;
    // A stall ("in 10") answering ORION's own line is that line's loop (outreach-reply.ts); a bare time after "What time?" is the reminder's.
    const move = free && !pendingYes && !lighten && !phoneBlock ? readFocusMove(message) ?? undefined : undefined;
    const focusMove = move?.kind === "stall" && (parseOutreach(raw) || reminderAsk.has(sessionKey)) ? undefined : move;
    const health = free && !pendingYes && !lighten && !move && options.stateDir ? readHealthIntent(message, (options.now ?? pluginNow)()) ?? undefined : undefined;
    const sheld = sessionKey ? sleepPending.take(sessionKey, Date.now()) : undefined;   // W10-B: before preference-remember can keep it as a "preference"
    const alarmCtx = { now: (options.now ?? pluginNow)(), ...(sessionKey && sleepPending.recentAlarm(sessionKey, Date.now()) ? { recentAlarm: true } : {}) };   // W18 (alarm-read.ts)
    const sleepTurn = free && !pendingYes && !phoneBlock && options.sleepPlanRun && !isCrisis(message) && (sheld || (!lighten && !move && !health) || ownsSleepStatement(message, alarmCtx)) ? readSleepTurn(message, { held: sheld, ...alarmCtx }) : undefined;
    const preference = !sleepTurn && !phoneBlock && free && !pendingYes && !lighten && !move && !health && options.rememberRun && (!spokenTurn || tellsFactAloud(message)) ? readPreference(message) : undefined;
    // Wave 12 (correction-learn.ts): a correction meant to last becomes a standing rule in USER.md (never in an evaluation); the turn goes on as usual.
    // Fixer: what ORION just proposed (its label, last push, held offer or memo), so "no dont move my study block" stays one-off.
    if (free && !preference && !sleepTurn && !pendingYes && options.rememberRun && (!spokenTurn || tellsFactAloud(message))) {
      const offered = pendingOffer({ label: parseOutreach(raw)?.text, stateDir: options.stateDir, now: (options.now ?? pluginNow)(), held: !!held, memo: sessionKey ? pendingMemory.memo(sessionKey, (options.now ?? pluginNow)().getTime()) : undefined });
      void learnCorrection(message, { run: options.rememberRun, ...(options.stateDir ? { stateDir: options.stateDir } : {}), ...(options.userMdPath ? { userMdPath: options.userMdPath } : {}), ...(offered ? { offered } : {}), sessionKey });
    }
    const kheld = sessionKey ? knowledgePending.take(sessionKey, Date.now()) : undefined;
    const kmove = on && !cutOff && !quietTurn && !realityWhole && !pendingYes && !preference && !isCrisis(message) && options.knowledgeRun ? readKnowledgeMove(message, { ...(kheld ? { held: kheld } : {}), spoken: spokenTurn }) : undefined;
    const knowledge = on && !quietTurn && !kmove && !food && !workout && !appsTurn && !shutdownTurn && !mouse && isKnowledgeAsk(message);
    const own = on && !cutOff && !quietTurn && !realityWhole && !pendingYes && !lighten && !isCrisis(message) ? askKind(message) ?? undefined : undefined;
    const pendingAt = (options.now ?? pluginNow)();
    const prior = sessionKey ? pendingMemory.beginTurn(sessionKey, pendingAt.getTime(), { crisis: isCrisis(message), replied: !hushed }, options.stateDir) : undefined;
    const dayDefault = free && !prior?.afterCrisis && !pendingYes && !lighten && !focusMove && !health && !reality && options.realityRun ? readDayDefault(message, parseOutreach(raw)?.text, pendingAt) ?? undefined : undefined;
    const guarded = !!gymSkip || wipe || !!pendingYes || !!lighten || !!focusMove || !!health || !!dayDefault || !!preference || !!kmove || !!sleepTurn || !!phoneBlock;
    const intentRead = on && !cutOff && !quietTurn && !realityWhole && !guarded && options.scheduleFlow ? readIntent(message, { now: (options.now ?? pluginNow)(), ...(recentReplan(sessionKey) ? { last: recentReplan(sessionKey)! } : {}) }) : undefined;
    // Never for something that is not his calendar at all ("book a table at 7", "add a todo …", "text mom at 5").
    const elsewhere = SEND_OR_CAPTURE.test(message) || BOOK_ELSEWHERE.test(message) || isCrisis(message);
    const intentFirst = !!intentRead && !elsewhere && ("intent" in intentRead ? runsFirst(intentRead.intent) : !!intentRead.tookBack);
    // "make it an hour" is an edit of the last thing this chat made: code's, never the desk's (it read a session start in run 4).
    // Only when ORION made something here, and more recently than a reminder ("make it 5:30" after "remind me at 5" is the reminder's).
    // An edit-shaped message is always code's (never the worker's guess), unless a reminder set here is the newer thing ("make it 5:30").
    const made = recentMade(sessionKey);
    const reminderAt = lastReminder.get(sessionKey)?.set ?? 0;
    const editing = on && !cutOff && !quietTurn && !guarded && isEdit(message) && (made ? made.at > reminderAt : Date.now() - reminderAt > CORRECTION_WINDOW_MS);
    // 2026-10-31: a screen task is code's (computer-loop.ts), so the desk is not asked.
    const computerFirst = on && !cutOff && !quietTurn && !!options.computer && !!detectComputerIntent(message);
    const codeFirst = intentFirst || editing || realityWhole || quietTurn || guarded || computerFirst;
    // "why" to something ORION sent is about THAT message: the front desk (which saw only a one-line history) must not answer it as chat.
    const whyAsked = on && !cutOff && !quietTurn && (asksWhy(message) || asksYourQuestion(message)) && !!parseOutreach(raw);
    // 2026-10-23: what ORION said first goes to the front desk as ORION's last turn ("I'm meal prepping" answers "Gym, now").
    const outreach = parseOutreach(raw);
    // 2026-10-30: his state, read once per turn by code (state-card.ts). The desk gets one line of it; the worker gets the card.
    const card = on && options.stateDir ? loadCardInputs({ stateDir: options.stateDir, ...(options.userMdPath ? { userMdPath: options.userMdPath } : {}), now: (options.now ?? pluginNow)() }) : undefined;
    const deskContext = [card ? deskLine(card) : "", spokenTurn ? SPOKEN_DESK_NOTE : ""].filter(Boolean).join(" ") || undefined;
    const decision = cutOff
      ? Promise.resolve<Decision>({ move: "ask", answer: GO_ON })
      : codeFirst || whyAsked || own || kmove ? Promise.resolve<Decision>({ move: "escalate", fallback: "code-first", ms: 0 })
      : Promise.resolve(deskHealth.begin()).then((call) => Promise.resolve()
        .then(() => decideImpl({ message, clock: clock(), timeoutMs: call.timeoutMs, ...(outreach ? { history: outreachHistory(outreach) } : {}), ...(deskContext ? { context: deskContext } : {}) }))
        .then((d) => { deskHealth.record(d, call); return d; })
        .catch((error: unknown) => { deskHealth.record({ error: "threw" }, call); return { error: error instanceof Error ? error.message : String(error) }; }));
    const askContext = parseAskContext(raw);
    // 2026-10-31 (pending-reply.ts): a short reply resolved against the nudge it answers (the label, the card's last push, or this chat's memo).
    // REV4: never within 30 min of the crisis reply; never over a question ORION asked here (his yes to a proposal, the reminder's "What
    // time?"); only an outreach newer than ORION's last reply in this chat; an outreach already answered in any chat is not answered again.
    const pending = on && !cutOff && !quietTurn && !qmove && !smove && !mmove && !food && !workout && !appsTurn && !shutdownTurn && !mouse && !kmove && !sleepTurn && !phoneBlock && !isCrisis(message) && sessionKey && !prior?.afterCrisis && !pendingYes && !reminderAsk.has(sessionKey)
      ? readPendingTurn({ message, now: pendingAt, ...(outreach ? { outreach } : {}), lastPush: card?.lastOutreach ?? null, memo: pendingMemory.memo(sessionKey, pendingAt.getTime()),
        ...(prior?.lastReplyAt !== undefined ? { lastReplyAt: prior.lastReplyAt } : {}), answered: (t, sent) => pendingMemory.wasAnswered(t, sent, pendingAt.getTime(), options.stateDir),
        chatSurface: CHAT_SURFACE.test(sessionKey) })
        // Wave 6 (bed-state.ts): past his bedtime with no nudge in reach, a stall or "going to bed" is still the bedtime reply.
        ?? bedtimeFromState({ message, now: pendingAt, ...(options.stateDir ? { stateDir: options.stateDir } : {}), focusActive: focusRunning(raw), memo: pendingMemory.memo(sessionKey, pendingAt.getTime()) }) : undefined;
    if (sessionKey && !cutOff && !pending) pendingMemory.setMemo(sessionKey, null);
    const run: Run = { message, decision, tools: [], started: Date.now(), passes: 0, findings: [], sessionKey, cutOff, ...(card ? { card } : {}), ...(reality ? { reality } : {}), ...(quietStart !== undefined ? { quietStart } : {}), ...(hushed ? { hushed } : {}), ...(room ? { room } : {}), ...(pendingYes ? { pendingYes } : {}), ...(lighten ? { lighten } : {}), ...(focusMove ? { focusMove } : {}), ...(health ? { health } : {}), ...(dayDefault ? { dayDefault } : {}), ...(knowledge ? { knowledge } : {}), ...(own ? { own } : {}), ...(gymSkip ? { gymSkip } : {}), ...(wipe ? { wipe } : {}), ...(replayed ? { replayed } : {}), ...(intentFirst ? { codeFirst: true } : {}), ...(editing ? { edit: true } : {}), ...(askContext ? { ask: askContext } : {}), ...(outreach ? { outreach } : {}), spoken: SPOKEN.test(raw), undo: stitch?.marks ?? [], ...(stitch || cont ? { stitched: true } : {}), ...(pending ? { pending } : {}), ...(preference ? { preference } : {}), ...(sleepTurn ? { sleepTurn } : {}), ...(phoneBlock ? { phoneBlock } : {}), ...(crisisRest ? { crisisRest } : {}),
      ...(on && !cutOff && !quietTurn ? { brain: (options.brainSearch ?? defaultBrainSearch)(message).catch(() => "") } : {}) };
    if (runId) runs.set(runId, run);
    if (sessionKey) runs.set(`session:${sessionKey}`, run);
    if (!on) return undefined; // shadow: fire and forget
    // w16 (2026-11-02 23:56, clock-answer.ts): the time is the clock's, in four words; the worker parroted the room words back.
    if (!run.ownText && asksTheTime(message)) run.ownText = timeReply((options.now ?? pluginNow)());
    // w19 (activity-read.ts): "what am i doing" is what his Mac reports, "what have i been doing today" is the history; never the model's guess.
    const activityAsk = !run.ownText && options.stateDir ? asksActivity(message) : null;
    if (activityAsk && options.stateDir) run.ownText = activityReply(activityAsk, options.stateDir, (options.now ?? pluginNow)());
    // 2026-10-31 (code-answers.ts): answered from data in under a second or two, no desk call and no model loop.
    if (run.own) {
      const at = (options.now ?? pluginNow)();
      const text = await withTimeout(ownAnswer(run.own, message, { now: at, brainSearch: options.brainSearch ?? defaultBrainSearch,
        ...(options.readHealth ? { readHealth: options.readHealth } : options.stateDir ? { readHealth: async () => readHealthFile(options.stateDir!) } : {}),
        ...(options.stateDir ? { readGraph: () => readGraphFile(options.stateDir!) } : {}),
        ...(options.connectorStatus ? { connectorStatus: options.connectorStatus } : {}) }).catch(() => undefined), 6000);
      if (text) run.ownText = text;
    }
    if (kmove && options.knowledgeRun) {   // wave 6 (knowledge-run.ts): the reply is built from the scripts' JSON
      const out = await withTimeout(runKnowledgeMove(kmove, options.knowledgeRun).catch(() => undefined), 12000);
      if (out) { run.ownText = out.text; out.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 })); if (out.held && sessionKey) knowledgePending.set(sessionKey, out.held, Date.now()); }
    }
    if (smove && options.stateDir) {   // w19 selffix: the reply is built from orion-selfcheck's and orion-selffix's JSON
      const out = await withTimeout(runSelffixMove(smove, options.selffixRun ?? liveSelffixRun(options.stateDir), (options.now ?? pluginNow)()).catch(() => undefined), 70000);
      if (out) { run.ownText = out.text; out.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 })); }
    }
    if (qmove && options.stateDir) {   // wave 12 L1: the reply is built from orion-questions' JSON
      const out = await withTimeout(runQuestionsMove(qmove, options.questionsRun ?? liveQuestionsRun(options.stateDir)).catch(() => undefined), 12000);
      if (out) { run.ownText = out.text; out.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 })); }
    }
    if (mmove && options.stateDir) {   // wave 14: the reply is built from orion-mail-prefs' JSON
      const out = await withTimeout(runMailMove(mmove, options.mailPrefsRun ?? liveMailPrefsRun(options.stateDir)).catch(() => undefined), 12000);
      if (out) { run.ownText = out.text; out.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 })); }
    }
    if (food && options.foodRun && options.stateDir) {   // w14 g-food: the reply is built from orion-food-estimate's JSON
      const out = await withTimeout(runFoodTurn(food, { run: options.foodRun, stateDir: options.stateDir, now: (options.now ?? pluginNow)() }).catch(() => undefined), 55000);
      run.ownText = out?.text ?? "I couldn't estimate that just now, so nothing was logged. Tell me again in a bit.";
      out?.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 }));
      if (out?.logged) foodMemory.logged(sessionKey, out.logged.id, (options.now ?? pluginNow)().getTime(), out.logged.ids ?? [out.logged.id]);
      if (food.kind === "undo") foodMemory.forgetLog(sessionKey);
      if (out?.logged) workoutMemory.forgetLog(sessionKey);   // "undo" takes off the newest thing logged in this chat
    }
    if (workout && options.workoutRun && options.stateDir) {   // w17 g-workout: the reply is orion-workout-log's own sentence
      const out = await withTimeout(runWorkoutTurn(workout, { run: options.workoutRun, stateDir: options.stateDir, now: (options.now ?? pluginNow)() }).catch(() => undefined), 55000);
      run.ownText = out?.text ?? "I couldn't log that workout just now, so nothing was logged. Tell me again in a bit.";
      out?.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 }));
      if (out?.logged) { workoutMemory.logged(sessionKey, out.logged.id, (options.now ?? pluginNow)().getTime()); foodMemory.forgetLog(sessionKey); }
      if (workout.kind === "undo") workoutMemory.forgetLog(sessionKey);
    }
    if (shutdownTurn && options.shutdownRun) {   // w18 bedtime: the reply is orion-bedtime-shutdown's own sentence
      const out = await withTimeout(runShutdownTurn(shutdownTurn, { run: options.shutdownRun }).catch(() => undefined), 100000);
      run.ownText = out?.text ?? "I couldn't shut the Mac down just now, so nothing was closed or locked. Tell me again in a bit.";
      out?.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 }));
    } else if (appsTurn && options.appsRun) {   // w18 apps: the reply is orion-apps' own sentence
      const out = await withTimeout(runAppsTurn(appsTurn, { run: options.appsRun }).catch(() => undefined), 70000);
      run.ownText = out?.text ?? "I couldn't reach your apps just now, so nothing was closed. Try again in a bit.";
      out?.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 }));
    } else if (mouse && options.mouseRun) {   // w18 mousechat: the reply is orion-mouse's own sentence
      const out = await withTimeout(runMouseTurn(mouse, { run: options.mouseRun }).catch(() => undefined), 20000);
      run.ownText = out?.text ?? "I couldn't change the mouse settings just now, so nothing was changed. Tell me again in a bit.";
      out?.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: out.outputs[i] ?? "", exit: 0 }));
      if (out && (out.pending || out.confirm)) mouseMemory.wait(sessionKey, mouseAt.getTime(), { ...(out.pending ? { pending: out.pending } : {}), ...(out.confirm ? { confirm: true } : {}) });
      else mouseMemory.clear(sessionKey);
    }
    if (sessionKey && !cutOff && !quietTurn && options.lateFlow) { const late = lateTurn(sessionKey, message); if (late) run.late = late; }
    if (sessionKey) { const answer = addTurn(sessionKey, message); if (answer && !cutOff) run.addAnswer = answer; }
    // 2026-10-19: after a crisis reply, a continuation that is exactly "put X until T" runs, and its reply is the scheduler's plus a check-in
    // line. Only when the flow really ran (done); a question, a refusal or anything else in it keeps the full crisis reply.
    if (run.crisisRest && !cutOff && options.scheduleFlow && directAddShape(run.crisisRest)) {
      const ran = await options.scheduleFlow(run.crisisRest, clock(), { undo: run.undo ?? [] }).catch(() => undefined);
      if (ran?.outcome === "done") { run.afterCrisis = true; run.flow = ran; settleSchedule(run); }
    }
    const d = await decision;
    // 2026-10-20: a row the moment the desk fails (it was only written when the turn ended, 4m40 later, and never if it did not end).
    if ("error" in d || (d.fallback && d.fallback !== "code-first")) log({ stage: "decision", runId, message, decision: "error" in d ? { move: "escalate", fallback: d.error } : d });
    // A front-desk failure must not switch the flow off (it did once: "scrap the gym tmrw").
    if ("error" in d) { run.settled = { move: "escalate", fallback: d.error }; return { providerOverride: workerProvider, modelOverride: workerModel }; }
    run.settled = d;
    // r8 review 4 HIGH-1 (2026-10-16): the front desk read his reply as a device or lookup request ("turn off the lights"),
    // so it is not the title the add question asked for: nothing is booked and the turn routes normally.
    if (run.addAnswer?.kind === "run" && "title" in run.addAnswer.run && d.move === "tool") run.addAnswer = undefined;
    if (options.scheduleChangesToCloud && CHANGE_REQUEST.test(message) && SCHEDULING.test(message) && !isCrisis(message)) {
      run.cloud = true;
      return undefined; // the configured model, with ORION's full prompt
    }
    // Every move goes to the local worker: the direct-reply hook does not fire on every route
    // (agent CLI / phone), and falling through to the configured cloud model costs money.
    return { providerOverride: workerProvider, modelOverride: workerModel };
  });

  if (on) {
    api.on("before_agent_reply", (event, ctx) => {
      const d = runFor(event, ctx)?.settled;
      traceLine("before_agent_reply", event, ctx, { move: d?.move ?? null });
      const run = runFor(event, ctx);
      // Words that may mean he is not safe get the fixed caring reply, never a draft (2026-10-16).
      if (run && isCrisis(run.message) && !run.afterCrisis) return { handled: true, reply: { text: CRISIS_REPLY }, reason: "distress: fixed safety reply" };
      if (run && (run.room || run.hushed || run.pending || run.preference || run.sleepTurn || run.phoneBlock || run.pendingYes || run.lighten || run.focusMove || run.health || run.dayDefault || run.knowledge)) return undefined;   // 2026-10-31: code's, or the worker's textbook answer
      if (run?.ownText) return { handled: true, reply: { text: withGentleCheckIn(run.message, run.ownText) }, reason: "code answered from data" };
      if (run && openRequest(run.message)) return undefined;   // w18 voiceself: opening an app is app_open, never a drafted "I can't pull up apps"
      if (run && isOverwhelmed(run.message)) return undefined;
      // A fact to save or a question about one is work: the drafts said "I've noted that" and saved nothing (2026-10-15).
      if (run && (keepsFact(run.message) || asksRecall(run.message))) return undefined;
      if (run && (RUNNING_LATE.test(run.message) || run.late)) return undefined; // the calendar flow, never a drafted "no problem"
      // r8 review 4 MEDIUM-1 (2026-10-16): a draft must never answer the add question's yes ("Sure, done!" with nothing written).
      if (run?.addAnswer) return undefined;
      if (run?.computer || (options.computer && run && detectComputerIntent(run.message))) return undefined; // 2026-10-31: the screen loop's reply, never a drafted "I can't see your screen"
      if (run?.reality) return undefined;   // 2026-10-30: what he said happened is code's (reality.ts), never a drafted "Noted!"
      // 2026-10-16 r7: a draft keeps no claim about his day ("You've been coding for hours", q082).
      const draftText = withoutDayClaims(d?.answer ?? "");
      if (d?.move === "answer" && draftText && !CHANGE_REQUEST.test(run?.message ?? "") && !needsLiveData(run?.message ?? "") && !isSessionStart(run?.message ?? "") && !casualStartTask(run?.message ?? "")) return { handled: true, reply: { text: withGentleCheckIn(run?.message ?? "", draftText) }, reason: "front desk answered" };
      return undefined;
    });

    api.on("before_prompt_build", guardedPrompt(async (event, ctx) => {
      const run = runFor(event, ctx);
      if (!run?.settled || run.cloud) return undefined;
      // The workspace prompt written for Claude is ~17k tokens; on the 9B that cost 60-100 s a turn
      // (live, 2026-10-11). The worker gets what it was evaluated with instead: the tuned
      // instructions for this job, plus the time.
      // 2026-10-16 (speed audit): every system prompt below puts the stable text first and this clock, with the per-turn
      // facts, LAST. At the top it changed the prefix each minute and Ollama re-read the whole prompt (7.25 s against 0.05 s
      // on a 6.7k prompt; 3.67 s against 1.09 s on a 3.8k one). The wording of each part is unchanged, only its place.
      const now = `Now: ${clock()} (Europe/London). ${dateLine()}`;
      // 2026-10-30: the state card and the tone note, just before the clock (both change far less often than it does).
      const tone = pastNudgeTime(options.stateDir, (options.now ?? pluginNow)()) ? `${TONE_NOTE.split("\n").slice(0, 2).join("\n")}\n${LATE_TONE_LINE}` : TONE_NOTE;
      const card = run.card ? `${[`${stateCard(run.card)}${standingRulesLine(options.userMdPath)}`, answeredCardLine(options.stateDir, (options.now ?? pluginNow)())].filter(Boolean).join("\n")}\n\n${tone}\n\n` : "";   // wave 12: + his standing rules (L2) and his answers (L1)
      // Distress comes before every flow: "i literally cant do this anymore" got a canned "Want to take a
      // break?" with no question about his safety (live sweep, 2026-10-16). Fixed text, no tools.
      // Only in "on" mode: in shadow, or once the testing window closes, the configured (cloud) model answers
      // him itself, which is intended: the fixed reply exists to guard the small local models.
      // REV2 5 (orchestrator decision): crisis words always get the safety reply, whatever room classification says.
      if (isCrisis(run.message) && !run.afterCrisis) run.flow = { outcome: "say", kind: "plain", text: CRISIS_REPLY };
      // 2026-10-30 (chatter.ts): his quiet request gets a short ack; a spoken turn inside the window gets nothing. Safety (above) still wins.
      if (!run.flow && run.quietStart !== undefined) { quiet.start(nowMs(), run.quietStart, run.message); run.flow = { outcome: "say", kind: "plain", text: quietAck(run.quietStart) }; }
      if (!run.flow && run.hushed) run.flow = { outcome: "say", kind: "plain", text: QUIET_REPLY };
      // w18 note: a bare "make a note" is asked once by code, and his next message (10 minutes, this chat) is the whole note; a clear command unbinds it.
      if (!run.flow && !run.cutOff && options.noteFlow && run.sessionKey) {
        const asked = noteAwait.get(run.sessionKey); noteAwait.delete(run.sessionKey);
        if (isBareNoteRequest(run.message)) { noteAwait.set(run.sessionKey, nowMs()); run.flow = { outcome: "say", kind: "ask", text: NOTE_ASK }; }
        else if (asked !== undefined && nowMs() - asked < NOTE_WINDOW_MS && !isOtherCommand(run.message)) await saveNote(run, true);
      }
      // 2026-10-31 (pending-reply.ts): his short reply to ORION's own nudge does what the nudge offered, before any template or chatter guard.
      if (!run.flow && !run.cutOff && run.pending && (run.addAnswer || run.late) && run.sessionKey) pendingMemory.setMemo(run.sessionKey, null);   // REV4: ORION's own question here comes first
      // W5: "gonna eat first" read against the block that just started steps aside for a focus or health phrase code already has.
      if (!run.flow && !run.cutOff && run.pending && !run.addAnswer && !run.late && !(run.pending.plan && (run.focusMove || run.health || run.reality || run.dayDefault))) {
        const out = await runPendingTurn(run.pending, { now: (options.now ?? pluginNow)(), ...(options.scheduleFlow ? { schedule: (m: string, meta?: { lengthDefaulted?: boolean }) => options.scheduleFlow!(m, clock(), { deadlineAt: flowDeadline(run.started), ...meta }) } : {}), ...(options.sessionFlow ? { session: options.sessionFlow } : {}), ...(options.checkinRun ? { checkin: options.checkinRun } : {}), ...(options.readDayJson ? { readDay: options.readDayJson } : {}),
          ...(options.stateDir ? { stateDir: options.stateDir } : {}), ...(options.wakeExec ? { wake: options.wakeExec } : {}), ...(options.phoneTimeRun ? { phoneTime: options.phoneTimeRun } : {}) }).catch(() => undefined);
        if (run.sessionKey) { pendingMemory.setMemo(run.sessionKey, out?.memo ?? null); if (out && run.pending.outreachText && run.pending.sentAt !== undefined) pendingMemory.markAnswered(run.pending.outreachText, run.pending.sentAt, (options.now ?? pluginNow)().getTime(), options.stateDir); }
        if (out) { run.flow = out.flow; run.tools.push(...out.tools); if (out.marks.length) recordChange(run.sessionKey, out.marks); }
        // w16: a person he named in that answer ("im at Avery's place, shes a friend…") is kept, and the reply says so.
        if (out && options.knowledgeRun) {
          const kept = await withTimeout(learnPersonAfter(out.flow, run.message, options.knowledgeRun).catch(() => undefined), 6000);
          if (kept) { run.flow = kept.flow; if (kept.call) run.tools.push(kept.call); }
        }
      }
      if (!run.flow && !run.cutOff && run.sleepTurn && options.sleepPlanRun) {   // W10-B (sleep-plan-flow.ts)
        const out = await runSleepTurn(run.sleepTurn, { run: options.sleepPlanRun, now: (options.now ?? pluginNow)(), ...(options.checkinRun ? { checkin: options.checkinRun } : {}) });
        run.flow = out.flow; run.tools.push(...out.tools); if (run.sessionKey) sleepPending.set(run.sessionKey, out.pending, Date.now());
        if (run.sessionKey && run.sleepTurn.kind === "alarm") sleepPending.noteAlarm(run.sessionKey, Date.now());
      }
      if (!run.flow && !run.cutOff && run.phoneBlock && options.phoneTimeRun) {   // W10-G (phone-block-flow.ts)
        const out = await runPhoneBlock(run.phoneBlock, { run: options.phoneTimeRun, now: (options.now ?? pluginNow)(), ...(options.stateDir ? { stateDir: options.stateDir } : {}) });
        run.flow = out.flow; out.tools.forEach((t) => run.tools.push(t));
      }
      if (!run.flow && !run.cutOff && run.preference && options.rememberRun) {   // W5 (preference-remember.ts)
        run.flow = await savePreference(run.preference, options.rememberRun);
        if (run.flow.outcome === "done") { const outs = run.flow.outputs; run.flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: outs[i] ?? "", exit: 0 })); }
      }
      if (!run.flow && !run.cutOff && run.ownText) { run.provided = true; run.flow = { outcome: "say", kind: "plain", text: run.ownText }; }
      // 2026-10-31: tired / sick / stressed, a focus phrase, or his yes to what one of them proposed: code's (ownTurn below).
      if (!run.flow && !run.cutOff && (run.pendingYes || run.lighten || run.focusMove || run.health)) {
        const prompt = await ownTurn(run, now);
        if (prompt) return prompt;
      }
      // Wave 4 (day-defaults.ts): a defaultable request is acted on with its assumption said; "what now" is read from the day.
      if (!run.flow && !run.cutOff && run.dayDefault && options.realityRun) {
        const out = await runDayDefault(run.dayDefault, { run: options.realityRun, now: (options.now ?? pluginNow)(), ...(options.readDeadlines ? { deadlines: options.readDeadlines } : {}),
          readDay: (a) => (options.readDayJson ? withTimeout(options.readDayJson(a).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) : Promise.resolve(undefined)) });
        run.flow = out.flow; out.reads.forEach((r) => markRead(run, r));
        if ("calls" in out.flow && out.flow.calls) { const f = out.flow; f.calls!.forEach((canonical, i) => run.tools.push({ canonical, stdout: f.outputs?.[i] ?? "", exit: null })); }
        if (out.writes) { recordChange(run.sessionKey, []); if (run.sessionKey) lastReality.set(run.sessionKey, { facts: [], writes: out.writes, at: Date.now() }); }
      }
      // 2026-10-31 (cha-thinking-aloud-c): a textbook question gets the worker with a prompt for the standard answer, not the desk's draft.
      if (!run.flow && !run.cutOff && run.knowledge && run.settled.move !== "tool" && run.settled.move !== "ignore") {
        run.noTools = true;
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${KNOWLEDGE_PROMPT}\n\n${now}` };
      }
      // 2026-10-31: a screen task ("close my safari tabs", "whats on my screen") runs through the computer loop, by code, before any other
      // intent flow. Not on half a spoken sentence, in a quiet window, or on a spoken turn the chatter guard below would drop as not for ORION.
      const chatter = run.settled.move === "ignore" && !!run.spoken && (!addressed(run.message) || isNotForOrion(run.message, true));
      if (!run.flow && !run.cutOff && !run.hushed && !chatter && options.computer) {
        const cu = await maybeRunComputerTask({ message: run.message, ...(run.sessionKey ? { sessionKey: run.sessionKey } : {}) },
          { ...options.computer, progress: (line) => progress.stage(run.sessionKey, "using-tool", line) }).catch(() => null);
        if (cu) {
          run.computer = true; run.flow = { outcome: "say", kind: "plain", text: cu.reply };
          stepsAsToolResults(cu.steps).forEach((t) => run.tools.push(t)); // the loop's steps are this turn's tool evidence
          if (cu.steps.length) try { appendFileSync(`${logPath}.steps`, `${JSON.stringify({ at: new Date().toISOString(), sessionKey: run.sessionKey ?? null, steps: stepsAsToolResults(cu.steps) })}\n`, { mode: 0o600 }); } catch { /* the gate reads this; a missing line is never a failure */ }
        }
      }
      // Overwhelmed but not a crisis: warmth and one small step. Left to the worker it searched his brain,
      // read two agendas and read him a quiz schedule (16 s, 2026-10-16). A change he asks for still runs.
      // Only when he asks for nothing else: "i'm so stressed, remind me at 3" still sets the reminder (review, 2026-10-16).
      if (!run.flow && isOverwhelmed(run.message) && !CHANGE_REQUEST.test(run.message) && !REMINDER.test(run.message) && !RUNNING_LATE.test(run.message) && !isSessionStart(run.message)
        && !LIVE_DATA.test(run.message) && !/\?\s*$/.test(run.message.trim()) && run.settled.move !== "tool") {
        run.provided = true;
        run.noTools = true;
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${OVERWHELMED_NOTE}\n\n${card}${now}` };
      }
      // Half a spoken sentence: nothing is acted on; the rest arrives as a continuation.
      if (run.cutOff && !run.flow) run.flow = { outcome: "say", text: GO_ON, kind: "ask" };
      // 2026-10-23: a short answer to ORION's own bedtime or start line is read against that line by code: "shush" after a bedtime
      // reminder is not a log entry, "I'm meal prepping" after "Gym, now" is not a calendar change with no time.
      // Only a WHOLE short answer ("in 10", "yeah", "shush"), never a request that also says one (review 2026-10-23: "set an alarm for
      // 8 am", "remind me in 10 min to call mom", "play some music" were all taken): those go to the normal turn, with the context.
      if (!run.flow && !run.cutOff && run.outreach && !isCrisis(run.message) && run.settled.move !== "tool" && !CHANGE_REQUEST.test(run.message)
        && !REMINDER.test(run.message) && !LIVE_DATA.test(run.message) && !isSessionStart(run.message)) {
        const plan = planOutreachReply(run.outreach, run.message, pastNudgeTime(options.stateDir, (options.now ?? pluginNow)()));
        if (plan && !plan.act) run.flow = { outcome: "say", kind: "plain", text: plan.text };
        else if (plan?.act && plan.find && options.checkinRun) {
          // The one loop this start line belongs to, by id; none or several and code does nothing (the turn goes on as usual).
          const found = await options.checkinRun(["find", "--what", plan.find.what]).catch(() => ({ stdout: "", code: 1 }));
          let id: string | undefined;
          try { const f = JSON.parse(found.stdout.trim().split("\n").at(-1) ?? "") as { open?: boolean; id?: unknown }; if (found.code === 0 && f.open && typeof f.id === "string") id = f.id; } catch { /* not found */ }
          if (id) {
            const args = loopArgs(plan.act, id);
            const ran = await options.checkinRun(args).catch(() => ({ stdout: "", code: 1 }));
            run.tools.push({ canonical: `exec orion-checkin ${args.join(" ")}`, stdout: ran.stdout, exit: ran.code });
            // A defer orion-checkin refuses ("That reads as putting it off") is said as it said it, never as done.
            const refused = plan.act.verb === "defer" && !/^Fair\b/.test(ran.stdout.trim());
            if (ran.code === 0) run.flow = { outcome: "say", kind: "plain", text: refused ? ran.stdout.trim().split("\n")[0]! : plan.text };
          }
        }
      }
      // 2026-10-30: "undo" right after a reality statement takes back its calendar writes AND the facts it declared.
      const realityDone = run.sessionKey ? lastReality.get(run.sessionKey) : undefined;
      if (!run.flow && !run.cutOff && options.realityRun && realityDone && Date.now() - realityDone.at < SESSION_CHANGE_WINDOW_MS && isBareUndo(run.message)) {
        lastReality.delete(run.sessionKey!);
        run.flow = await undoReality(realityDone, options.realityRun);
        if ("calls" in run.flow && run.flow.calls) { const f = run.flow; f.calls!.forEach((canonical, i) => run.tools.push({ canonical, stdout: f.outputs?.[i] ?? "", exit: null })); }
        if (realityDone.writes) { recordChange(run.sessionKey, []); forgetReplan(run.sessionKey); }
      }
      // 2026-10-30: he said what happened ("i dont have classes today", "im doing econ instead of gym", "i ate already"): code declares
      // it (orion-declare) and changes the plan, and the reply says exactly what changed. With another change in the same breath only
      // the fact is written here, and the change goes on as usual.
      if (!run.flow && !run.cutOff && run.reality && options.realityRun) {
        const read = run.reality; const key = run.sessionKey;
        const slips = run.card?.slipsWeek ?? [];
        const next = run.card?.record?.next?.title ? `Next up: ${run.card.record.next.title} at ${clockOf(run.card.record.next.start) ?? "?"}.` : undefined;
        const deps = { run: options.realityRun, now: (options.now ?? pluginNow)(), text: run.message,
          source: run.spoken ? "voice" : /phone/.test(key ?? "") ? "phone" : "chat",
          readDay: () => (options.readDayJson ? options.readDayJson(read.reality.kind === "no-classes" && read.reality.tomorrow ? ["--date", "tomorrow"] : []) : Promise.resolve(undefined)),
          readDayOn: (dateArgs: string[]) => (options.readDayJson ? options.readDayJson(dateArgs) : Promise.resolve(undefined)),
          slipsOf: (what: string) => slips.filter((s) => s.planned?.kind === what || (s.planned?.title ?? "").toLowerCase().includes(what.toLowerCase())).length,
          ...(options.stateDir ? { stateDir: options.stateDir } : {}),   // Wave 6: slip-history.ts
          ...(options.readDeadlines ? { readDeadlines: options.readDeadlines } : {}),
          ...(next ? { next } : {}) };
        if (read.rest) await declareOnly(read, deps).catch(() => null);
        else {
          const out = await runReality(read, deps).catch(() => null);
          if (out) {
            run.flow = out.flow; markRead(run, "day");
            const f = out.flow;
            if ("calls" in f && f.calls) f.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: f.outputs?.[i] ?? "", exit: null }));
            if (out.writes) recordChange(key, []);
            if (key && (out.writes || out.facts.length)) lastReality.set(key, { facts: out.facts, writes: out.writes, at: Date.now() });
          }
        }
      }
      if (!run.flow && !run.cutOff && run.wipe) run.flow = { outcome: "say", kind: "ask", text: WIPE_CONFIRM };
      if (!run.flow && !run.cutOff && run.gymSkip) await gymTurn(run);
      // A bare "cancel that" / "undo" with no change made in THIS chat has nothing to take back: ask, fixed text,
      // no tools (q092, 2026-10-16). A reminder just set, or one being asked about, owns the word instead.
      if (!run.flow && !run.cutOff && isBareUndo(run.message) && !changedRecently(run.sessionKey)
        && !(Date.now() - (lastReminder.get(run.sessionKey ?? "")?.set ?? 0) < CORRECTION_WINDOW_MS) && !reminderAsk.has(run.sessionKey ?? "")) {
        const other = recentOther(run.sessionKey);
        run.flow = { outcome: "say", kind: "ask", text: other ? OTHER_ASKS[other] : UNDO_NOTHING_TO_UNDO };
      }
      // Live run 4: "make it an hour" changes the last thing made here. A block is resized; a session just started is left running and he is
      // told so (its length can't be changed without ending it); nothing on record is asked about. It never starts a session.
      if (!run.flow && !run.cutOff && run.edit) {
        const target = recentMade(run.sessionKey); const req = parseEdit(run.message)!;
        if (!target) run.flow = { outcome: "say", kind: "ask", text: whichOne(req) };
        else if (target.kind === "session") run.flow = { outcome: "say", kind: "plain", text: SESSION_EDIT(target.task) };
        else if (options.scheduleFlow) {
          const flow = await options.scheduleFlow(run.message, clock(), { edit: { target, req }, deadlineAt: flowDeadline(run.started) }).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
          run.flow = flow.outcome === "fallback" ? { outcome: "say", kind: "plain", text: `I couldn't change ${target.title} just now, so nothing changed. Tell me again in a moment.` } : flow;
          markRead(run, target.dateArgs.length ? "day-tomorrow" : "day");
          settleSchedule(run);
        }
      }
      // 2026-10-20 re-run: a change the intent layer read is the schedule flow's before any other flow looks at it ("resume" is not a focus-session resume).
      if (!run.flow && !run.cutOff && run.codeFirst && options.scheduleFlow) {
        const flow = await options.scheduleFlow(run.message, clock(), { undo: run.undo ?? [], deadlineAt: flowDeadline(run.started), ...(run.ask ? { askContext: run.ask } : {}) })
          .catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
        if (flow.outcome !== "fallback") { run.flow = flow; markRead(run, /--date/.test("calls" in flow ? (flow.calls ?? []).join(" ") : "") || meansTomorrow(run.message) ? "day-tomorrow" : "day"); settleSchedule(run); }
        else run.scheduleTried = true;   // the flow (and its form) already had this message: not run a second time below
      }
      // q029 (2026-10-16 r8): "im running late" → code asks "how late?", the short answer is stitched to it, and
      // "yeah push everything after it" is the same late move, never a free exec for the 9B (it ran late 15, got
      // NOTHING WAS BOOKED and said "Your schedule has been adjusted"). Before the ignore line: "like 15 min" is "ignore".
      if (!run.flow && !run.cutOff && run.late && options.lateFlow) {
        const key = run.sessionKey ?? "";
        const done = run.late.kind === "confirm" ? run.late.last : undefined;
        if (run.late.kind === "ask") { run.flow = { outcome: "say", kind: "ask", text: LATE_ASK }; if (key) lateAsk.set(key, Date.now()); }
        else if (done?.changed) run.flow = { outcome: "say", kind: "plain", text: `That's already done. ${done.reply}` };
        else {
          const minutes = run.late.kind === "run" ? run.late.minutes : done?.minutes ?? 0;
          const flow = await options.lateFlow(minutes).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
          if (flow.outcome !== "fallback") {
            run.flow = flow;
            if (flow.outcome === "say" && flow.text === LATE_TOO_SMALL && key) lateAsk.set(key, Date.now());
            if ("calls" in flow && flow.calls) flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: flow.outputs?.[i] ?? "", exit: null }));
            if (key && "calls" in flow && flow.calls) lastLate.set(key, { minutes, at: Date.now(), changed: flow.outcome === "done", reply: flow.outcome === "done" ? flow.reply ?? "" : "", asked: flow.outcome === "say" && /\?\s*$/.test(flow.text) });
            if (flow.outcome === "done" && flow.marks?.length) recordChange(run.sessionKey, flow.marks);
          }
        }
      }
      // 2026-10-30: a reply to ORION's own message is never "not for ORION" ("yeah" after the morning brief got "Didn't catch that",
      // loop-morning-brief-v): it goes to the worker with that message in front of it. Spoken room speech the desk calls ignore,
      // with no "orion" in it, gets no reply at all (R2: rehearsal, phone call, TV).
      const answersOutreach = !!run.outreach || (recentPush(run.card) && run.message.trim().split(/\s+/).length <= 6);
      if (!run.flow && run.settled.move === "ignore" && run.spoken && !addressed(run.message) && !answersOutreach && !run.stitched) run.flow = { outcome: "say", kind: "plain", text: QUIET_REPLY };
      if (!run.flow && run.settled.move === "ignore" && isNotForOrion(run.message, !!run.spoken) && !answersOutreach && !run.stitched) run.flow = { outcome: "say", kind: "plain", text: NOT_CAUGHT };
      // "im ready to work" / "done" / "i need youtube for this" (focus-ready.ts): code starts the session from the plan with the task's
      // apps, ends it early with one break-or-next question, or allows one site. Typed or addressed to ORION only starts anything.
      if (!run.flow && !run.cutOff && options.focusReady) {
        const at = (options.now ?? pluginNow)();
        const readied = await runFocusReady(run.message, { ...options.focusReady, now: at, mayStart: !run.spoken || addressed(run.message),
          ...(options.readDayJson ? { readDay: () => withTimeout(options.readDayJson!([]).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) } : {}),
          ...(options.readDeadlines ? { readDeadlines: () => withTimeout(options.readDeadlines!().catch(() => null), options.dayReadMs ?? DAY_READ_MS) } : {}) })
          .catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
        if (readied.outcome !== "fallback") {
          run.flow = readied;
          if ("calls" in readied && readied.calls) readied.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: readied.outputs?.[i] ?? "", exit: null }));
          if (readied.outcome === "done" && /orion-session start/.test(readied.calls.join(" "))) recordOther(run.sessionKey, "focus");
        }
      }
      // A focus session is one fixed command: code runs orion-session and the reply is built from
      // its output. Left to the worker, it said "I've started a focus session" three times and
      // called nothing (2026-10-15). Before the scheduler, which "focus block" would also match.
      // The front desk's own session start counts too, unless his words rule one out (q051, q054).
      // Merge of r2-routing-polish (front-desk session start counts) with r2-front-desk-tools (a timer is
      // timer_set whatever the front desk picked): a front-desk "session start" for "set a timer for 25 min"
      // started a focus session before the tool move ran, so the hint never applies to a timer request.
      const deskHint = isTimerRequest(run.message) ? {} : sessionHint(run.settled);
      // REV5 MUST 4: a casual "let's work on X" counts only typed or said to ORION by name, and X must be work or a name on his day / deadlines.
      const casual = !run.spoken || addressed(run.message);
      const known = !run.flow && casual && options.sessionFlow && casualStartTask(run.message) && !workStartTask(run.message) ? await knownNames() : [];
      const casualTask = casual ? workStartTask(run.message, known) : undefined;
      const hint = casualTask && !startsSession(run.message, deskHint, { casual: false }) ? { ...deskHint, start: true, task: casualTask } : deskHint;
      if (!run.flow && startsSession(run.message, deskHint, { casual, known }) && options.sessionFlow) {
        run.flow = await options.sessionFlow(run.message, hint).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
        if (run.flow.outcome === "done") {
          recordOther(run.sessionKey, "focus");
          const task = run.flow.calls.map((c) => c.match(/orion-session start\s+(?:"([^"]+)"|(\S+))/)).find(Boolean);
          if (run.sessionKey) lastMade.set(run.sessionKey, { kind: "session", task: task?.[1] ?? task?.[2] ?? "Focus", at: Date.now() });
          const outputs = run.flow.outputs;
          run.flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: outputs[i] ?? "", exit: null }));
        }
      }
      // His wake alarm is orion-wake, not a reminder: "push my alarm to 12" became alarm_set "push my alarm" and
      // the phone's alarm never moved (live, 2026-10-16). Before the reminder block, which would catch "alarm".
      if (!run.flow && !run.cutOff && options.wakeFlow) {
        const woke = await options.wakeFlow(run.message, run.settled).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
        if (woke.outcome !== "fallback") {
          run.flow = woke;
          if (woke.outcome === "done") woke.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: woke.outputs[i] ?? "", exit: null }));
        }
      }
      // "how much focus time is left": code reads the session (q049 said "15 minutes remaining" from nothing).
      // 2026-10-16 r7: only a message that names the session (q015 "nap block" is the calendar), or "what am i supposed to be
      // working on" (q050); with no session running that one falls through to the day read below.
      const statusAsk = asksCurrentTask(run.message) || asksFocusOn(run.message) || (run.settled.move === "tool" && run.settled.tool === "session" && (run.settled.args as { do?: unknown } | undefined)?.do === "status" && asksFocusStatus(run.message));
      const todayAsk = asksFocusToday(run.message);
      if (!run.flow && !run.cutOff && (statusAsk || todayAsk) && options.sessionStatus) {
        const status = await options.sessionStatus().catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
        // r8 (2026-10-16) q053/q050/q052: the status read is recorded, and code says the whole reply.
        if (status.outcome === "say" && status.calls) status.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: status.outputs?.[i] ?? "", exit: null }));
        if (status.outcome === "say" && status.calls) { run.provided = true; run.codeRead = true; markRead(run, "focus-status"); }
        const noSession = status.outcome === "say" && /^No focus session/.test(status.text);
        if (todayAsk && !statusAsk && status.outcome === "say" && (noSession || status.calls)) {
          // q052: today's focused minutes from the history file plus a session still running (see focusTodayTotal).
          const now = (options.now ?? pluginNow)();
          const rows = (options.focusHistory ?? (() => readFocusHistory()))();
          const total = focusTodayTotal(rows, localDayKey(now), liveFocusSeconds(status.outputs?.[0] ?? ""));
          run.tools.push({ canonical: "read focus-history.jsonl (today)", stdout: JSON.stringify(total), exit: null });
          markRead(run, "focus-today");
          run.flow = /^I couldn't check/.test(status.text) ? status : { outcome: "say", kind: "plain", text: focusTodayReply(total) };
        } else if (asksCurrentTask(run.message) && noSession && options.readDay) {
          // q050: no session, so code names the block he is in now, else the next one today (never the 9B's guess).
          const day = await options.readDay(false).catch(() => "");
          const now = (options.now ?? pluginNow)();
          // An empty read is a failed read as often as an empty day: then only the session status is said (r8 integration).
          if (day.trim()) {
            run.tools.push({ canonical: "read day (code)", stdout: day, exit: null });
            markRead(run, "day");
          }
          run.flow = { outcome: "say", kind: "plain", text: day.trim() ? noSessionReply(day, `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`) : "No focus session is running right now." };
        } else if (!todayAsk || statusAsk) run.flow = status;
      }
      // A reminder at a time is ORION's alarm_set action, never a to-do: "remind me tomorrow around 11"
      // became orion-tasks add … --at 11:00, a to-do booked at 5:50 PM, and the reply said 11 (2026-10-13).
      // What kind of reminder turn it is — list, cancel, move the one just set, set, or ask — is code's call
      // (reminder-flow.ts): in the sweep of 2026-10-15 every one of them became a new alarm (q030–q038, q058, q091).
      if (!run.cutOff && !run.flow) {
        const key = run.sessionKey ?? "";
        const asked = reminderAsk.get(key);
        reminderAsk.delete(key);
        // His answer to "What time?" is read with the request it answers ("the one with the form", then "tomorrow at 9").
        const followUp = asked && Date.now() - asked.at < STITCH_WINDOW_MS && (isBareTime(run.message) || (asked.label && answersLabel(run.message, run.settled?.move))) && !/\?\s*$/.test(run.message) && run.message.split(/\s+/).length <= 8 && !REMINDER_DROPPED.test(run.message) ? `${asked.text} ${run.message}` : undefined;
        const last = lastReminder.get(key);
        const plan = await planReminder({ message: followUp ?? leaveAsReminder(run.message) ?? run.message, now: (options.now ?? pluginNow)(),
          extract: (m) => (options.extractReminder ? options.extractReminder(m, clock()) : Promise.resolve(null)),
          list: options.listReminders ?? (async () => []), ...(options.offerPort ? { offers: options.offerPort } : {}), ...(last && Date.now() - last.set < CORRECTION_WINDOW_MS ? { last } : {}) }).catch(() => undefined);
        if (plan?.kind === "say") {
          run.flow = { outcome: "say", kind: "plain", text: plan.text };
          if (plan.pending && key) reminderAsk.set(key, { text: followUp ?? run.message, at: Date.now(), ...(plan.askLabel ? { label: true } : {}) });
        }
        if (plan?.kind === "call") {
          run.reminder = { args: plan.args, say: plan.reply, action: plan.action, ...(plan.label && plan.at ? { label: plan.label, at: plan.at } : {}) };
          return { systemPrompt: `${LOCAL_IDENTITY}\n\nDo this for Nick now with ${taskRunCall(plan.args)}\nThen, only if the result shows it worked, reply: "${plan.reply}" If it did not, say so plainly.\n\n${now}`,
            appendContext: `[ORION: ${taskRunNow(plan.args)}]` };
        }
        // A reminder turn the plan could not work out gets a fixed reply, never the old free-form prompt (review, 2026-10-16).
        if (!plan && REMINDER.test(run.message) && isReminderTurn(run.message)) run.flow = { outcome: "say", kind: "plain", text: REMINDER_UNCLEAR };
      }
      // 2026-10-31 gate (hea-gym-streak-v): "have i been going to the gym" is answered from what was tracked (day-questions.ts), never a write.
      const habit = !run.flow && !run.cutOff && options.stateDir ? asksHabit(run.message) : null;
      if (habit) { run.provided = true; markRead(run, "history"); run.flow = { outcome: "say", kind: "plain", text: habitAnswer(habit, options.stateDir!, (options.now ?? pluginNow)()) }; }
      // 2026-11-04: "why is X first" is answered from the reason the planner left with each to-do (plan-why.ts), never a guess; no reason on file: the turn goes on.
      const whyAsked = !run.flow && !run.cutOff && options.stateDir ? whyFirstAsk(run.message) : null;
      if (whyAsked !== null) {
        const why = whyFirstAnswer(whyAsked, readPlanReasons(options.stateDir!, localDayKey((options.now ?? pluginNow)())));
        if (why) { run.provided = true; markRead(run, "day"); run.flow = { outcome: "say", kind: "plain", text: why }; }
      }
      // A fact to keep goes to his "Nick" note, a question about one searches first (live sweep 2026-10-15:
      // drafts said "I've noted that" and saved nothing, the allergy became an alarm, the creatine habit a
      // calendar block, the insurance date went to the repair queue, and "whats my allergy" got an offer to look).
      // 2026-10-30: out loud, only "remember …" / "orion note that …" is a fact to save ("Saved: Frozen." came from room speech).
      // w18 note: "make a note ..." / "remember that ..." keeps his whole text, saved by code (note-flow.ts), never summarised by the worker.
      if (!run.flow && !run.cutOff && options.noteFlow && parseNote(run.message)) await saveNote(run, false);
      const factTurn = run.spoken ? tellsFactAloud(run.message) : keepsFact(run.message);
      if (!run.flow && !run.cutOff && (factTurn || asksRecall(run.message))) {
        const fact = factTurn;
        const fetched = fact || !run.brain ? "" : brainSnippets(await Promise.race([run.brain, new Promise<string>((r) => setTimeout(() => r(""), 4000))]));
        // The snippets are what he is answered from: not a claimed lookup (review, 2026-10-16).
        if (fetched) { run.provided = true; markRead(run, "notes"); }
        // q064 (2026-10-16): the search snippet is the top of the Nick note, so a fact learned seconds ago, at the
        // bottom, never reached the worker. Recall reads the note directly and hands over what he told ORION.
        const learned = fact ? [] : learnedLines((options.nickNote ?? readNickNote)());
        if (!fact) run.recall = { learned };
        if (learned.length) { run.provided = true; markRead(run, "learned"); }
        const told = learned.length ? `\n\nWhat he told you (saved in his "Nick" note; only these are "you told me"):\n${learned.map((l) => `- ${l}`).join("\n")}` : "";
        return { systemPrompt: `${BRAIN_INSTRUCTIONS}\n\n${PRODUCTION_NOTES}\n\n${fact ? FACT_NOTE : RECALL_NOTE}${told}${fetched ? `\n\nFrom his notes and documents, matched to this message (NOT things he said; q056 2026-10-16: never "you told me" for these, say "your notes say"):\n${fetched}` : ""}\n\n${card}${now}`,
          appendContext: fact ? FACT_NOW : RECALL_NOW };
      }
      // q042 (2026-10-16 r8): "mark the oats one done" became supplement_take "oats" and "Done."; ticking a to-do off
      // is code's call (todo-done-flow.ts), before any front-desk tool move.
      if (!run.flow && !run.cutOff && options.todoDoneFlow && parseTodoDone(run.message)) {
        const ticked = await options.todoDoneFlow(run.message).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
        if (ticked.outcome !== "fallback") {
          run.flow = ticked;
          const calls = ticked.outcome === "done" ? ticked.calls : ticked.calls ?? [];
          const outputs = ticked.outcome === "done" ? ticked.outputs : ticked.outputs ?? [];
          calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: outputs[i] ?? "", exit: null }));
        }
      }
      // A front-desk tool move is carried out, not left as a hint (sweep 2026-10-15: weather, focus status,
      // a timer and supplements answered with no call or the wrong one). Before the calendar flow.
      // r8 review 2 HIGH-2: the question form needs isQuestion; only a bare noun phrase ("any deadlines coming up") passes without a "?".
      // q041 (2026-10-16 r8): "whats due this week" is read and worded by code (the 9B read a lecture's time out as the all-day quiz's).
      if (!run.flow && !run.cutOff && options.readDeadlines && asksDeadlines(run.message, isQuestion(run.message))) {
        const read = await options.readDeadlines().catch(() => null);
        if (read) {
          run.provided = true;
          markRead(run, "deadlines");
          run.tools.push({ canonical: "orion-agenda deadlines --json; orion-tasks list", stdout: `${read.events.length} events, ${read.tasks.length} dated to-dos`, exit: null });
          run.flow = { outcome: "say", kind: "plain", text: deadlineReply(run.message, read, (options.now ?? pluginNow)()) };
        }
      }
      // 2026-10-30 gate (foc-extend-c, foc-end-c, foc-pomodoro-break-c): "extend my focus session by 30" with no session running went to the
      // worker, which searched his brain, failed, and leaked "Exec failed" beside "it's inactive". Code reads the session and says it.
      const sessionWords = SESSION_CHANGE.exec(run.message);
      const sessionVerb = (sessionWords?.[1] ?? sessionWords?.[2])?.toLowerCase();
      if (!run.flow && !run.cutOff && sessionVerb && !isQuestion(run.message) && options.sessionStatus) {
        const status = await options.sessionStatus().catch(() => undefined);
        if (status?.outcome === "say" && /^No focus session/.test(status.text)) {
          if (status.calls) status.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: status.outputs?.[i] ?? "", exit: null }));
          run.flow = { outcome: "say", kind: "plain", text: `No focus session is running, so there's nothing to ${SESSION_VERB_SAY[sessionVerb] ?? "change"}. Say "start a focus session for 30 minutes" and I'll start one.` };
        }
      }
      // "why" to something ORION sent: code explains THAT message (a weather notice through a forecast lookup it asks for), before any worker guess.
      const whyPush = !run.outreach && asksWhy(run.message) && recentPush(run.card) ? run.card!.lastOutreach : null;
      const whyAbout = run.outreach ?? (whyPush ? { text: whyPush.text, minutes: 0, kind: kindOf(whyPush.text) } : undefined);
      const whyDone = !run.flow && !run.cutOff && whyAbout && (asksWhy(run.message) || (asksYourQuestion(run.message) && run.message.trim().split(/\s+/).length <= 10)) ? whyAnswer(whyAbout) : undefined;
      if (whyDone?.kind === "say") run.flow = { outcome: "say", kind: "plain", text: whyDone.text };
      const moved = !run.flow && !run.cutOff ? (whyDone ?? toolDirective(run.settled, run.message)) : null;
      if (moved?.kind === "say") run.flow = { outcome: "say", kind: "plain", text: moved.text };
      if (moved?.kind === "call") {
        run.directive = moved;
        return { systemPrompt: `${LOCAL_IDENTITY}\n\nDo this with ${taskRunCall(moved.args)}\n${moved.note} If it failed, say so plainly.\n\n${now}`,
          appendContext: `[ORION: ${taskRunNow(moved.args)}]` };
      }
      // Texts and email (messages-route.ts). Live sweep 2026-10-15: "read my last 3 texts" read the manual
      // index, "search gmail…" said it could not, "email myself my tasks" listed them and sent nothing. A
      // send ORION cannot do is a fixed line; a read or a text to someone gets only the tools for it.
      if (!run.flow && !run.cutOff) {
        const cannot = cannotSend(run.message);
        if (cannot) run.flow = { outcome: "say", kind: "plain", text: cannot };
        else {
          // q066 / q069 (2026-10-16 r8): a plain read is run by code and the worker only summarizes it ("I'm reading
          // your last three texts now." with no tool). A failure or an empty result is code's exact line.
          const req = options.messagesRead ? parseMessagesRead(run.message) : null;
          const read = req && options.messagesRead ? await options.messagesRead(req).catch(() => null) : null;
          if (req && read) {
            read.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: read.outputs[i] ?? "", exit: null }));
            markRead(run, req.kind === "gmail" ? "gmail" : "messages");
            if (read.say || !read.data) run.flow = { outcome: "say", kind: "plain", text: read.say ?? "I couldn't read that.", calls: read.calls, outputs: read.outputs };
            else {
              run.provided = true;
              run.codeRead = true;
              return { systemPrompt: `${LOCAL_IDENTITY}\n\n${readNote(req, read.data)}\n\n${now}`, appendContext: "[ORION: the read already ran — summarize it from the system prompt, do not call tools.]" };
            }
          }
        }
        if (!run.flow && isMessagesJob(run.message)) return { systemPrompt: `${GENERAL_INSTRUCTIONS}\n\n${MESSAGES_NOTE}\n\n${LIVE_NOTE}\n\n${now}` };
      }
      // H1 (r8 review 3, 2026-10-16): his answer to the add flow's own question is the flow's, never the worker's
      // (an unanchored add on "yes" / "laundry" was the live 5:50 PM bug). A title or yes runs through the flow with
      // what it stored; no declines; anything else cleared the question in before_model_resolve.
      if (!run.flow && !run.cutOff && run.addAnswer) {
        const a = run.addAnswer;
        if (a.kind === "decline") run.flow = { outcome: "say", kind: "plain", text: ADD_DECLINED };
        else if (a.kind === "reask") run.flow = { outcome: "say", kind: "ask", text: a.pending.ask, pending: a.pending };
        else {
          run.flow = options.scheduleFlow
            ? await options.scheduleFlow(run.message, clock(), { pending: a.run, deadlineAt: flowDeadline(run.started) }).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }))
            : { outcome: "fallback", reason: "no scheduling flow wired" };
          if (run.flow.outcome === "fallback") run.flow = { outcome: "say", kind: "plain", text: "I couldn't finish that add. Tell me what to put on your day and when." };
          markRead(run, a.run.when === "tomorrow" ? "day-tomorrow" : "day");
        }
        settleSchedule(run);
      }
      // Wave 9 B (availability-read.ts): "am i free sat night" reads that day and answers from it (the model was handed today's list and said it had no calendar).
      if (!run.flow && !run.cutOff && options.readDayJson) {
        const free = await answerAvailability(run.message, (options.now ?? pluginNow)(), (a) => withTimeout(options.readDayJson!(a), options.dayReadMs ?? DAY_READ_MS));
        if (free) { run.provided = true; markRead(run, "day"); run.flow = { outcome: "say", kind: "plain", text: free }; }
      }
      // Calendar changes run as a fixed sequence (schedule-flow.ts): code reads the day, the worker
      // fills one form, code runs the exact command; the worker only phrases the result.
      // Any statement about his day goes through the flow (a plan like "after my lab I'm going to…"
      // has no change verb, 2026-10-12); a question or anything the form cannot express falls back.
      const openAsk = run.ask && answersAsk(run.message, run.ask) ? run.ask : undefined;
      if ((SCHEDULING.test(run.message) || RUNNING_LATE.test(run.message) || LOGGING.test(run.message) || openAsk) && !isQuestion(run.message) && !asksDayRead(run.message) && !asksHabit(run.message) && !run.flow && !run.scheduleTried && isCalendarTurn(run.message, run.settled, !!openAsk)) {
        // No built-in default: only the plugin entry point wires the real scheduler in (a test that
        // forgot a stub wrote a block called "B4" to Nick's real calendar, 2026-10-12).
        // The flow reads the day itself (q019, q024: its "no such block" came from that read): the log says so.
        let flowRan = false;
        run.flow = options.scheduleFlow
          ? await options.scheduleFlow(run.message, clock(), { undo: run.undo ?? [], deadlineAt: flowDeadline(run.started), ...(openAsk ? { askContext: openAsk } : {}) }).then((r) => { flowRan = true; return r; }, (e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }))
          : { outcome: "fallback", reason: "no scheduling flow wired" };
        if (flowRan) markRead(run, meansTomorrow(run.message) ? "day-tomorrow" : "day");
        // 2026-10-30: a sentence the flow misread as "log what I did" ("im on tiktok instead of studying", a rehearsed presentation,
        // "draft a text to annika") is refused by the scheduler as a zero-length or far-future log. That refusal is not his answer:
        // the turn goes to the worker (foc-doomscroll-v, saf-send-message-c; R2's thirty "Not done: 6:00 AM–6:00 AM").
        if (misreadLog(run.flow)) run.flow = undefined;
        settleSchedule(run);
      }
      // r8b2 (2026-10-16) q006: "and after that?" follows the last day answer: code answers it from the day read.
      const dayMem = run.sessionKey ? dayMemory.get(run.sessionKey) : undefined;
      if (!run.flow && !run.cutOff && options.readDay && dayMem && Date.now() - dayMem.at < DAY_MEMORY_MS && isAfterThat(run.message)) {
        const tomorrow = dayMem.memory.tomorrow; // review 5 H2: the day the last answer was about, not today by default
        const day = await options.readDay(tomorrow).catch(() => "");
        const after = day ? codeDayAnswer(run.message, day, tomorrow, nowMinutes(options.now), dayMem.memory) : null;
        if (after) { run.provided = true; markRead(run, tomorrow ? "day-tomorrow" : "day"); run.flow = { outcome: "say", kind: "plain", text: after.text }; dayMemory.set(run.sessionKey!, { at: Date.now(), memory: after.memory }); }
      }
      // A question about his day: code reads the day and hands it over (it said "I can't see your schedule").
      if ((SCHEDULING.test(run.message) || asksCurrentTask(run.message)) && (isQuestion(run.message) || asksDayRead(run.message)) && options.readDay && !run.flow) {
        const tomorrow = meansTomorrow(run.message);
        const day = await options.readDay(tomorrow).catch(() => "");
        if (day) { run.provided = true; markRead(run, tomorrow ? "day-tomorrow" : "day"); }
        // q015 (2026-10-16 r8): a question that names a kind of block the day does not have ("my nap block") is answered by code.
        const absent = day ? noBlockReply(run.message, day, tomorrow) : null;
        // q009/q013/q006 (2026-10-16 r8b2): a named block that IS there, "next class": code says the times and the time left.
        const present = day && !absent ? codeDayAnswer(run.message, day, tomorrow, nowMinutes(options.now)) : null;
        if (absent) run.flow = { outcome: "say", kind: "plain", text: absent };
        else if (present) { run.flow = { outcome: "say", kind: "plain", text: present.text }; if (run.sessionKey) dayMemory.set(run.sessionKey, { at: Date.now(), memory: present.memory }); }
        else if (day) return { systemPrompt: `${LOCAL_IDENTITY}\n\nAnswer his question from this list only, in one or two short spoken sentences with 12-hour times; "All day:" lines are events with no time, say them as all day. ${DAY_QUESTION_NOTE} Do not call any tools.\n\nHis day${tomorrow ? " tomorrow" : ""}, read just now from his calendar:\n${day}\n\n${now}` };
      }
      if (run.flow?.outcome === "done") {
        // The reply is built by code from the scheduler's lines; the worker repeats it (left to phrase it,
        // it said "before you head to the spit" for a plan that starts there, 2026-10-12). It goes in the
        // LATEST message too: from the system prompt alone the 9B paraphrased old turns (live gauntlet).
        const exact = exactFor(run);
        return { systemPrompt: `You already made this change. ${EXACT_REPLY_PROMPT}\n${exact}`,
          appendContext: `[ORION scheduler — already done. Your whole reply must be exactly: ${exact}]` };
      }
      if (run.flow?.outcome === "say") {
        // 2026-10-31 (cha-tv-v): inside a run of room talk, a question back ("What time should I remind you?") or a failure line is not said.
        if (run.room === "streak" && roomQuiet(exactFor(run), run.flow.kind)) run.flow = { outcome: "say", kind: "plain", text: QUIET_REPLY };
        if (run.spoken && !addressed(run.message) && exactFor(run) === QUIET_REPLY) rooms.mark(run.sessionKey, nowMs());
        // 2026-10-30: the same failure line never twice in ten minutes in a session (R2: thirty "Not done: 6:00 AM–6:00 AM").
        const said = exactFor(run); const guarded = repeats.guard(run.sessionKey, said, !!run.spoken, nowMs());
        if (guarded !== said) run.flow = { outcome: "say", kind: "plain", text: guarded };
        const exact = exactFor(run);
        return { systemPrompt: `${EXACT_REPLY_PROMPT}\n${exact}`,
          appendContext: `[ORION scheduler — nothing was changed. Your whole reply must be exactly: ${exact}]` };
      }
      // Only a plain answer is handed over as a draft. "ask" goes to the worker with the job's
      // instructions (the 4B asked for times it could have read, 2026-10-12), and a request to change
      // his day is always work, whatever the front desk thought.
      // A lookup (weather, sun times, his texts, his day) never gets a draft: nothing checks a draft's facts.
      // 2026-10-31: inside a run of room talk, nothing reaches the worker's free reply: only a flow that acted above may answer.
      if (run.room === "streak") { run.flow = { outcome: "say", kind: "plain", text: QUIET_REPLY }; rooms.mark(run.sessionKey, nowMs()); return fixedReply(QUIET_REPLY); }
      const lookup = needsLiveData(run.message);
      const draft = withoutDayClaims(run.settled.answer ?? "");
      if (run.settled.move === "answer" && draft && !CHANGE_REQUEST.test(run.message) && !lookup) {
        // Even a pure answer's draft can invent his day ("you've been coding for hours", q082) and the 9B
        // read it out as "The front desk says…" (live sweep 2026-10-15). Round 2 (q079, q101): still named
        // "the front desk drafted…", and "otherwise answer him yourself" swapped a right draft for the model's
        // name. The draft is now his reply, with no source and no licence to rewrite it.
        return { systemPrompt: `${LOCAL_IDENTITY}\n\nSend the reply you drafted, exactly, as your whole reply: no tools, word for word. If it states something about Nick (what he has been doing, his day, his messages) or live facts (weather, sun times) that you were not told here, leave that out. Never mention the draft or the front desk.\n\nYou drafted this reply: "${draft}".\n\n${now}` };
      }
      const fetched = run.brain ? brainSnippets(await Promise.race([run.brain, new Promise<string>((r) => setTimeout(() => r(""), 4000))])) : "";
      // Snippets answer questions about his notes, never live data: "I checked the weather" beside a weather
      // note is still made up (review, 2026-10-16).
      if (fetched && !LIVE_DATA.test(run.message) && !asksCurrentTask(run.message)) { run.provided = true; markRead(run, "notes"); }
      const brainFetched = fetched ? `\n\nFrom his brain, matched to this message (may help):\n${fetched}` : "";
      const askNote = run.settled.move === "ask" && run.settled.answer
        // "The front desk mentioned they don't have it either" (q063, sweep 2026-10-15): no source named.
        ? `\n\nYou might need to ask: "${run.settled.answer}". Ask only if no tool can tell you; otherwise do the job.` : "";
      const pushed = !run.outreach && recentPush(run.card) && run.message.trim().split(/\s+/).length <= 6 ? run.card!.lastOutreach : null;
      const ignoreNote = run.settled.move === "ignore" && !run.outreach && !pushed ? `\n\n${IGNORE_NOTE}` : "";
      // A short reply with no outreach line of its own answers the push the card names (sent in the last 30 min).
      const pushNote = pushed && asksWhy(run.message) ? `\n\n${whyNote(pushed.text)}` : pushed ? `\n\nHe is most likely answering what you sent him at ${clockOf(pushed.at)}: "${pushed.text.slice(0, 200)}". Act on that (book it, move it, start it, or ask which one first); never "didn't catch that".` : "";
      // H6 (r8b2, 2026-10-16): the worker's user message is only the rest of a cut-off request ("…cut off, this is the rest"); give it the whole.
      const joinedNote = run.stitched ? `[ORION: his request came in two parts. The whole request, joined: "${run.message.slice(0, 600)}". Answer that, not only the last part.]` : undefined;
      return { systemPrompt: `${instructionsFor(run.settled, run.message)}\n\n${PRODUCTION_NOTES}\n\n${LOOK_IT_UP}${lookup ? `\n\n${LIVE_NOTE}` : ""}${ignoreNote}${pushNote}${brainFetched}${askNote}\n\n${card}${now}`, ...(joinedNote ? { appendContext: joinedNote } : {}),
        ...(run.outreach ? { prependContext: outreachNote(run.outreach, run.message) } : {}) };
    }), { timeoutMs: HOOK_TIMEOUT_MS });
  }

  // 2026-10-30 (model-outage.ts): before the model is called, is it there? Down after one warm-and-retry: an honest line by code, and his
  // message queued and replayed when Ollama is back (10-30: two of his messages ended in "Connection error." and were lost).
  // OpenClaw's before_agent_run is fail-closed and reads anything but {outcome:"pass"} as a block, so every path returns PASS unless down.
  if (on && options.modelProbe) {
    const PASS = { outcome: "pass" } as const;
    const health = new ModelHealth(options.modelProbe, options.modelWarm ?? (async () => undefined), options.warmWaitMs ?? 1500);
    const queue = new ReplayQueue(options.stateDir ?? dirname(logPath));
    let draining = false;
    const drain = () => {
      if (draining || !options.replay || !queue.pending().length) return;
      draining = true;
      void drainQueue(queue, health, options.replay).then((n) => { if (n) log({ stage: "replayed", count: n }); }, () => undefined).finally(() => { draining = false; });
    };
    setInterval(drain, 60_000).unref?.();
    api.on("before_agent_run", async (event, ctx) => {
      try {
        const run = runFor(event, ctx);
        if (!run || run.cloud) return PASS;
        if (await health.check()) { drain(); return PASS; }
        // Code already did this turn's work (a reality statement, a code flow): it is told as done, and not replayed.
        const said = run.flow && (run.flow.outcome === "done" || run.flow.outcome === "say") ? exactFor(run) : "";
        if (!said && run.sessionKey && !run.replayed) queue.add({ sessionKey: run.sessionKey, message: run.message, spoken: !!run.spoken });
        const message = said ? doneWhileDown(said) : OUTAGE_LINE;
        log({ stage: "model_down", runId: pick(event, ctx, "runId") ?? null, message: run.message, queued: !said, flow: run.flow?.outcome ?? null });
        traceLine("model_down", event, ctx, { queued: !said });
        return { outcome: "block", reason: "the local model (Ollama) is not answering", message };
      } catch { return PASS; }
    }, { timeoutMs: 12_000 });
  }

  // The text that must reach Nick for a run (the scheduler's own reply, or an honest stop), applied at
  // delivery: the 9B paraphrased it from session history ("Done: grind leetcode 6:15…" after a clear).
  const finalText = new Map<string, { text: string; at: number }>();
  const remember = (keys: string[], text: string) => { for (const k of keys) if (k) finalText.set(k, { text, at: Date.now() }); };
  if (on) api.on("reply_payload_sending", (event) => {
    const keys = [str(event.runId) ?? "", `session:${str(event.sessionKey) ?? ""}`];
    const hit = keys.map((k) => finalText.get(k)).find((v) => v && Date.now() - v.at < 120000);
    if (!hit) {
      // The host's raw "Exec failed" line is never spoken (q059, 2026-10-16).
      const raw = str(((event.payload ?? {}) as Record<string, unknown>).text);
      return raw && stripExecFailed(raw) !== raw ? { payload: { ...(event.payload as Record<string, unknown>), text: stripExecFailed(raw) }, reason: "orion-control: no raw exec failure" } : undefined;
    }
    keys.forEach((k) => finalText.delete(k));
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    return { payload: { ...payload, text: hit.text }, reason: "orion-control: the scheduler's own reply" };
  });

  // Second guard (2026-10-16 re-run, q092): whatever the model decides, `orion-reschedule undo` does not run in
  // a session that has changed nothing: it would revert a change from an earlier day. OpenClaw's
  // before_tool_call can block one call with its own reason (the same hook exec-routing.ts uses).
  if (on) api.on("before_tool_call", (event, ctx) => {
    if (pick(event, ctx, "toolName") !== "exec") return undefined;
    const command = str((event.params as Record<string, unknown> | undefined)?.command) ?? "";
    if (!UNDO_COMMAND.test(command)) return undefined;
    const sessionKey = pick(event, ctx, "sessionKey") ?? runFor(event, ctx)?.sessionKey ?? "";
    if (INTERNAL.test(sessionKey) || changedRecently(sessionKey)) return undefined;
    return { block: true, blockReason: "Orion undo guard: this chat has not changed his calendar, so there is nothing of THIS conversation to undo, and `orion-reschedule undo` would reverse a change from an earlier day. Do not run it. Ask Nick what he wants cancelled." };
  });

  // 2026-10-31 (gate foc-pomodoro-break-c): the worker's `orion-session pause` with no session running exited non-zero, and the host appended
  // "⚠️ 🛠️ Exec failed: …orion-session pause" after the plugin's last hook, where no sanitizer reaches. The status is read first: a control
  // command with nothing to control never runs, so it never fails.
  if (on && options.sessionExec) api.on("before_tool_call", async (event, ctx) => {
    if (pick(event, ctx, "toolName") !== "exec") return undefined;
    const command = str((event.params as Record<string, unknown> | undefined)?.command) ?? "";
    if (!/\borion-session\s+(?:pause|resume|unpause|continue|skip|shorten|finish|end|stop|done|complete|wrap|abandon|cancel|quit|back|idle|end-break)\b/.test(command)) return undefined;
    const status = await options.sessionExec!(["status", "--json"]).catch(() => ({ stdout: "", code: 1 }));
    let state = "";
    try { state = String((JSON.parse(status.stdout) as { status?: unknown }).status ?? ""); } catch { /* unread: let it run */ return undefined; }
    // REV2 finding 14: orion-session also reports not-started and finishing, where pause or abandon is legitimate. Only a state that
    // says there is no session (none, finished) is blocked; anything else, unknown included, runs.
    if (!["none", "finished"].includes(state)) return undefined;
    return { block: true, blockReason: "Orion session check: no focus session is running, so there is nothing to pause, resume or end. Do not run another command; tell Nick plainly that no focus session is running, and offer to start one." };
  });

  // 2026-10-30 (chatter.ts): out loud, nothing goes into his memory unless he said "remember …" / "note that …" ("Saved: Frozen.").
  if (on) api.on("before_tool_call", (event, ctx) => {
    const run = runFor(event, ctx);
    if (!run?.spoken || tellsFactAloud(run.message)) return undefined;
    const params = JSON.stringify(event.params ?? {});
    if (!/orion-brain[^"]*\blearn\b|orion-remember|"action"\s*:\s*"(?:memory_save|remember|brain_learn)"/.test(params)) return undefined;
    return { block: true, blockReason: "Orion memory guard: this was said out loud and not addressed to you as something to remember, so nothing is saved. Do not save it; answer only if it was a request for you." };
  });

  // 2026-10-16 (tool wiring): the worker's orion_task_run call for the directive's action carries the code-built
  // arguments, whatever it wrote (r02: routing said 21:00, the worker's call said 09:00). Rewritten, or blocked
  // with the exact arguments restated.
  if (on) api.on("before_tool_call", (event, ctx) => {
    const run = runFor(event, ctx);
    const toolName = pick(event, ctx, "toolName");
    const expected = run?.directive ?? run?.reminder;
    if (!run || !toolName || !expected || !expected.action) return undefined;
    return guardTaskRun(toolName, event.params, { action: expected.action, args: expected.args });
  });

  // Live run 3 (2026-10-21) backstop: the worker's own scheduler write must start at a time Nick said (time-backstop.ts), or it does not run.
  // 2026-10-25 review: the day is read first, so a `resize … 300` is checked against the block's real start (it was checked with no day,
  // and the incident's exact write passed). A day that cannot be read leaves an end it cannot work out, and that write is refused.
  if (on) api.on("before_tool_call", async (event, ctx) => {
    if (pick(event, ctx, "toolName") !== "exec") return undefined;
    const run = runFor(event, ctx);
    const writes = writesIn(str((event.params as Record<string, unknown> | undefined)?.command) ?? "");
    if (!run || !writes.length) return undefined;
    const now = (options.now ?? pluginNow)();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    // Wired to the live read in index.ts; without one (tests) there is no day, and an end that cannot be worked out is refused.
    // Re-review: the read is capped (DAY_READ_MS) and kept for the turn, so a worker that writes three times reads his day once.
    const readJson = options.readDayJson;
    const days = (run.dayReads ??= new Map<string, Promise<Day | undefined>>());
    const dayFor = (dateArgs: string[]) => {
      const k = dateArgs.join(" ");
      if (!days.has(k)) days.set(k, readJson ? withTimeout(readJson(dateArgs).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS) : Promise.resolve(undefined));
      return days.get(k)!;
    };
    const checks = await Promise.all(writes.map(async (args) => {
      const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined;
      const other = !!date && date !== "today" && date !== iso;
      const blocks = await dayFor(date ? ["--date", date] : []);
      return timeMismatch(run.message, [args], { day: other ? "tomorrow" : "today", now: other ? null : now.getHours() * 60 + now.getMinutes(), ...(blocks ? { blocks } : { dayUnread: true }) });
    }));
    const off = checks.find(Boolean);
    return off ? { block: true, blockReason: `Orion time check: ${off} Do not run another command; tell Nick exactly this.` } : undefined;
  });

  // REV2 finding 18: a misread form falls back to the worker, which can run orion-reschedule. Gym and study are not protected by the
  // scheduler the way classes are, so a worker write that takes or moves one he did not name is refused (anchor-write-guard.ts).
  // Wave 4 review MUST 1: `--named` lets the scheduler move a class or plan with people. Only code adds it (compile, after his own words
  // name the event) and code runs the scheduler itself, so a worker exec carrying it is refused whatever the path or wrapper.
  if (on) api.on("before_tool_call", (event, ctx) => {
    if (pick(event, ctx, "toolName") !== "exec") return undefined;
    const params = (event.params as Record<string, unknown> | undefined) ?? {};
    const command = ["command", "cmd", "script"].map((k) => str(params[k]) ?? "").join(" ");
    return carriesNamedFlag(command) ? { block: true, blockReason: "Orion own-event check: --named is ORION's own flag and is never passed by hand; classes and plans with people move only from his words through ORION's scheduler. Do not run another command; tell Nick nothing changed." } : undefined;
  });

  if (on) api.on("before_tool_call", async (event, ctx) => {
    if (pick(event, ctx, "toolName") !== "exec") return undefined;
    const run = runFor(event, ctx);
    const writes = writesIn(str((event.params as Record<string, unknown> | undefined)?.command) ?? "").filter((a) => /^(?:drop|move|resize|swap|rename|displace)$/.test(a[0] ?? ""));
    if (!writes.length) return undefined;
    // Review MUST 1: with no day to check against (no reader, a failed read, a read past DAY_READ_MS) the write is refused, not waved
    // through; with no run there are no words of his, so nothing protected counts as named.
    const unread = { block: true, blockReason: "Orion anchor check: his day could not be read, so this change cannot be checked and was not made. Do not run another command; tell Nick nothing changed and to try again in a moment." };
    const readJson = options.readDayJson;
    if (!readJson) return unread;
    // The same per-turn day read as the time backstop above (one read per turn, however many writes).
    const days = run ? (run.dayReads ??= new Map<string, Promise<Day | undefined>>()) : new Map<string, Promise<Day | undefined>>();
    for (const args of writes) {
      const date = args.includes("--date") ? ["--date", args[args.indexOf("--date") + 1]!] : [];
      const k = date.join(" ");
      if (!days.has(k)) days.set(k, withTimeout(readJson(date).catch(() => undefined), options.dayReadMs ?? DAY_READ_MS));
      const day = await days.get(k)!;
      if (!day?.blocks) return unread;
      const hit = unnamedAnchorWrite(run?.message ?? "", args, day.blocks);
      if (hit) return { block: true, blockReason: `Orion anchor check: ${hit.title} is ${hit.fixed ? "a class or a plan with people" : /gym/i.test(hit.kind ?? hit.title) ? "his daily gym" : "study for a deadline"}, and he did not name it, so it is not dropped or moved. Do not run another command; tell Nick nothing changed and ask whether he meant ${hit.title}.` };
    }
    return undefined;
  });

  // 2026-10-19 backstop: the worker reached for `orion-reschedule <write>` by name (the tool guard refuses it). The run remembers it, so
  // the reply is never "I can't" / "I need you to confirm" after he already asked: see heldChange in before_agent_finalize.
  if (on) api.on("before_tool_call", (event, ctx) => {
    if (pick(event, ctx, "toolName") !== "exec") return undefined;
    const command = (str((event.params as Record<string, unknown> | undefined)?.command) ?? "").trim();
    const run = runFor(event, ctx);
    if (run && /^orion-reschedule\s+(?!show\b|undo\b)[a-z]/.test(command)) run.refusedWrite = command;
    return undefined;
  });

  // 2026-10-23: each tool the worker calls is a real stage he can be told about ("still on it — checking your calendar").
  api.on("before_tool_call", (event, ctx) => {
    const run = runFor(event, ctx);
    const toolName = pick(event, ctx, "toolName");
    if (!run?.sessionKey || !toolName) return undefined;
    const { stage, detail } = stageForTool(toolName, str((event.params as Record<string, unknown> | undefined)?.command) ?? "");
    // A write is said only once it worked (after_tool_call below): "making the change to Gym" over a refused write would be a lie.
    if (stage !== "changing-calendar") progress.stage(run.sessionKey, stage, detail);
    return undefined;
  });

  api.on("after_tool_call", (event, ctx) => {
    const run = runFor(event, ctx);
    const toolName = pick(event, ctx, "toolName");
    if (!run || !toolName) return;
    {
      const command = str((event.params as Record<string, unknown> | undefined)?.command) ?? "";
      const { stage, detail } = stageForTool(toolName, command);
      const outcome = outcomeOf({ canonical: canonicalCall(toolName, event.params), stdout: resultText(event.result ?? event.output), exit: null });
      if (stage === "changing-calendar" && (outcome === "success" || outcome === "partial")) progress.stage(run.sessionKey, stage, detail);
    }
    if (toolName === "exec" && run.sessionKey) {
      const command = str((event.params as Record<string, unknown> | undefined)?.command) ?? "";
      if (RESCHEDULE_WRITE.test(command) && !NOTHING_CHANGED.test(resultText(event.result ?? event.output))) recordChange(run.sessionKey, []);
      if (UNDO_COMMAND.test(command)) forgetReplan(run.sessionKey);   // an undo ends the last reschedule request
      // The worker's own write of any kind (scheduler in any wrapper, agenda-change, a session, an undo): the last block made is no longer known.
      if (writesIn(command).some((a) => a[0] !== "show") || UNDO_COMMAND.test(command) || /orion-session\s+(?!status)/.test(command)) forgetMade(run.sessionKey);
    }
    if (toolName !== "exec" && /orion_task_run|tool_call/.test(toolName)) forgetMade(run.sessionKey);
    run.hostTools = (run.hostTools ?? 0) + 1;
    run.tools.push({ canonical: canonicalCall(toolName, event.params), stdout: resultText(event.result ?? event.output), exit: null });
    const made = run.tools[run.tools.length - 1]!;
    const action = run.directive?.action;
    if ((action === "timer_set" || action === "supplement_take") && madeTaskRunCall(made, action) && outcomeOf(made) === "success") recordOther(run.sessionKey, action === "timer_set" ? "timer" : "supplement");
  });

  api.on("before_agent_finalize", async (event, ctx) => {
    const runId = pick(event, ctx, "runId") ?? "";
    const run = runFor(event, ctx);
    traceLine("before_agent_finalize", event, ctx, { found: !!run });
    if (!run) return undefined;
    if (run.passes > 0) progress.stage(run.sessionKey, "double-checking");
    const done = () => { progress.finish(run.sessionKey); runs.delete(runId); runs.delete(`session:${pick(event, ctx, "sessionKey") ?? ""}`); };
    // What this run must deliver: kept for reply_payload_sending (channel routes) and put in place for the agent CLI.
    let owed: string | undefined;
    // OpenClaw ignores a "revise" once any tool has run in the turn and sends the original reply (live sweep
    // 2026-10-15, 16 items: q003 q030 q102 ...). Then the honest line must go in place now, not via a retry.
    const hostDrops = event.hadDeterministicSideEffect === true;
    try {
      const reply = str(event.lastAssistantMessage) ?? "";
      const allFindings = checkWork({ reply, turnResults: run.tools, finished: reply.trim().length > 0, changeRequest: CHANGE_REQUEST.test(run.message) && !/\?\s*$/.test(run.message.trim()) && run.flow?.outcome !== "say", dictated: run.flow?.outcome === "done" || run.flow?.outcome === "say" || run.noTools === true, provided: run.provided ?? false });
      // H4 (r8 review 1, 2026-10-16): when only CODE read (gmail/messages/deadlines/focus) and handed the worker the data, a summary
      // that says "found/confirmed/booked" is the data talking, not a claimed write: no done-claim finding, no replaced reply.
      const codeReadOnly = !run.hostTools && run.provided === true && run.codeRead === true;
      // 2026-10-30 gate (hea-gym-streak-c "how many gym days this week", per-who-am-i-c): a QUESTION on a turn that attempted no write
      // got "I couldn't make that change": a write-failure line for a turn with no write. A question with no write keeps its answer.
      const questionOnly = isQuestion(run.message) && !wroteThisTurn(run.tools) && !run.directive && !run.reminder;
      // 2026-10-31 (cha-thinking-aloud-c): a textbook answer with no tool is never replaced by the claims check.
      const findings = run.knowledge && !run.hostTools ? [] : codeReadOnly || questionOnly ? allFindings.filter((f) => !FALSE_CLAIM.test(f)) : allFindings;
      run.findings.push(findings);
      // A revise returns before the end of this hook; it is logged first so no turn goes unrecorded (those 16 had routing null).
      const record = async (extra: Record<string, unknown> = {}) => {
        const decision = run.settled ?? (await settle(run));
        log({ runId, message: run.message, decision, flow: run.flow ? { outcome: run.flow.outcome, ...("calls" in run.flow ? { calls: run.flow.calls } : {}), ...("reason" in run.flow ? { reason: run.flow.reason } : {}), ...("undone" in run.flow && run.flow.undone ? { undone: run.flow.undone } : {}), ...("blocked" in run.flow && run.flow.blocked ? { blocked: run.flow.blocked } : {}) } : null,
          ...(run.cutOff ? { heldCutOff: true } : {}), provided: run.provided ?? false, reads: run.reads ?? [], cloud: run.cloud ?? false, model: str(event.model) ?? null, tools: run.tools.length, findings: run.findings, passes: run.passes,
          ...(on ? { escalationNeeded: findings.length > 0 } : {}), ...extra, turnMs: Date.now() - run.started });
      };
      // After the scheduling flow acted, its result is final: the worker only reports it (a retry
      // with tools let the model act on its own).
      const sessionKeyNow = `session:${pick(event, ctx, "sessionKey") ?? ""}`;
      if (on && run.reminder) {
        const action = run.reminder.action ?? "alarm_set";
        const called = run.tools.some((t) => madeTaskRunCall(t, action));
        if (called && run.reminder.label && run.reminder.at && run.sessionKey) lastReminder.set(run.sessionKey, { label: run.reminder.label, at: run.reminder.at, set: Date.now() });
        if (!called && run.passes < 2 && !hostDrops) {
          run.passes += 1;
          await record({ revised: true });
          return { action: "revise", reason: "the reminder was not set", retry: { instruction: `You have NOT set the reminder yet — no tool was called. Call the tool_call tool now with id "openclaw:orion-control:orion_task_run" and args exactly ${run.reminder.args}, then reply.`, idempotencyKey: `${runId}:reminder:${run.passes}`, maxAttempts: 1 } };
        }
        if (!called) { owed = action === "reminder_cancel" ? "I didn't manage to cancel that reminder — nothing was changed. Can you say it again?"
          : action === "reminder_snooze" ? "I didn't manage to snooze that — nothing was changed. Say it again?"
          : action === "reminder_done" ? "I didn't manage to mark that done — nothing was changed. Say it again?"
          : "I didn't manage to set that reminder — nothing was set. Can you say it again?"; remember([runId, sessionKeyNow], owed); }
        // Wave 6 B (foc-pomodoro-break-v): once it is set, the reply is code's line (worded on pluginNow), never the worker's paraphrase of the tool result.
        else if (!run.flow && run.reminder.say) run.flow = { outcome: "done", calls: [], outputs: [], reply: run.reminder.say };
      }
      // 2026-10-19 backstop: the worker was refused `orion-reschedule <write>` and no flow acted. Its reply is never "I can't" or "I need you to
      // confirm" (he had confirmed): the sentence the guard asked it to write is read by the schedule flow (all its guards), else an honest line.
      // run-1101020721 saf-send-message-v: a task run held for approval (messages_send: nothing sent) is said as its draft and a question,
      // never replaced by the generic no-effect line. Nothing is sent or approved here (approval-reply.ts).
      const heldAsk = on && (!run.flow || run.flow.outcome === "fallback") ? approvalAsk(run.tools) : undefined;
      if (heldAsk) { run.flow = { outcome: "say", kind: "ask", text: heldAsk }; run.approvalHeld = true; }
      if (on && run.refusedWrite && (!run.flow || run.flow.outcome === "fallback") && !run.cutOff
        && (CHANGE_REQUEST.test(run.message) || (!!run.ask?.suggest && isYes(run.message.replace(/[.!?…]+$/, ""))))) {
        run.flow = await heldChange(run, reply);
        settleSchedule(run);
        run.passes = Math.max(run.passes, 1);   // code says it now: no revise round
        markRead(run, "day");
      }
      if (on && (run.flow?.outcome === "done" || run.flow?.outcome === "say")) {
        const expected = exactFor(run);
        owed = expected;
        remember([runId, sessionKeyNow], expected);
        const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (!squash(reply).includes(squash(expected).slice(0, 60)) && run.passes < 1 && !hostDrops) {
          run.passes += 1;
          await record({ revised: true });
          return { action: "revise", reason: "reply must be the scheduler's", retry: { instruction: `Ignore the earlier conversation. Your whole reply must be exactly this text, nothing before or after, no tools: ${expected}`, idempotencyKey: `${runId}:exact-reply`, maxAttempts: 1 } };
        }
      }
      if (on && run.directive && !run.approvalHeld && run.passes < 2 && !directiveCalled(run) && !hostDrops) {
        run.passes += 1;
        await record({ revised: true });
        return { action: "revise", reason: "the tool move was not carried out", retry: { instruction: `You have NOT done it yet — no tool was called. Call the tool_call tool now with id "openclaw:orion-control:orion_task_run" and args exactly ${run.directive.args}, then reply from its result.`, idempotencyKey: `${runId}:tool-move:${run.passes}`, maxAttempts: 1 } };
      }
      // 2026-10-20 re-run: a line code wrote (flow "say") is final, like a change code made. The claims check read "…and I'll put it in" in code's own
      // "Piano practice isn't on your day" as a false claim and swapped it for the generic "didn't manage" line.
      // A worker that still ran tools under a code "say" is checked as before.
      const flowActed = run.flow?.outcome === "done" || (run.flow?.outcome === "say" && (!(run.hostTools ?? 0) || run.approvalHeld === true));
      // q029 (2026-10-16 r8): a revise is ignored once a tool ran (the 9B's exec of `late 15` printed NOTHING WAS BOOKED and
      // "Your schedule has been adjusted" went out, though the check had found it). With a tool already run, the honest
      // line goes in place NOW, from the scheduler's own words when it says nothing was booked/changed.
      const honestNow = on && !flowActed && !run.reminder && ((run.hostTools ?? 0) > 0 || hostDrops) && findings.some((f) => FALSE_CLAIM.test(f))
        ? nothingMovedReply(run.tools.filter((t) => /orion-reschedule/.test(t.canonical)).slice(-1).map((t) => t.stdout), /\b(late|move|push)\b/.test(run.tools.filter((t) => /orion-reschedule/.test(t.canonical)).at(-1)?.canonical ?? "") ? "I couldn't move anything, so nothing was moved" : "I couldn't make that change, so nothing on your calendar was changed")
          ?? honestLine(SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical)), run.message)
        : undefined;
      if (honestNow) { owed = honestNow; remember([runId, sessionKeyNow], honestNow); }
      if (on && findings.length > 0 && run.passes < revisePasses(!!run.spoken) && !flowActed && !hostDrops && !honestNow) {
        run.passes += 1;
        await record({ revised: true });
        const calendar = SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical));
        const claimed = findings.some((f) => FALSE_CLAIM.test(f));
        const lookedUp = !claimed && findings.some((f) => LOOKUP_CLAIM.test(f));
        // "Undo" only after this turn wrote something: told to undo with nothing to undo, the 9B could take
        // back an earlier turn's change from the journal (review, 2026-10-16).
        const stop = wroteThisTurn(run.tools) ? HONEST_STOP : HONEST_STOP_NO_WRITE;
        const instruction = run.passes === 1 ? retryInstruction(findings)
          : claimed ? `${stop}\nIgnore the earlier conversation. Your whole reply must be exactly this text, nothing before or after: ${honestLine(calendar, run.message)}`
          : lookedUp ? `${stop}\nIgnore the earlier conversation. Your whole reply must be exactly this text, nothing before or after: ${LOOKUP_HONEST}`
          : stop;
        return { action: "revise", reason: `work check: ${findings.join(", ")}`, retry: { instruction, idempotencyKey: `${runId}:work-check:${run.passes}`, maxAttempts: 1 } };
      }
      // Out of retries and still claiming something the tools don't show: deliver an honest line instead.
      if (on && !flowActed && !run.reminder && !honestNow && findings.some((f) => FALSE_CLAIM.test(f))) {
        owed = honestLine(SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical)), run.message);
        remember([runId, sessionKeyNow], owed);
      } else if (on && !flowActed && !run.reminder && findings.some((f) => LOOKUP_CLAIM.test(f))) {
        // "I checked the weather… no rain" with no lookup, after both retries (review, 2026-10-16).
        owed = LOOKUP_HONEST;
        remember([runId, sessionKeyNow], owed);
      } else if (on && !flowActed && !run.reminder && findings.some((f) => f === "denies messages it shows")) {
        // q065 (2026-10-16): still "no one texted you" beside his messages after both retries.
        owed = MESSAGES_UNSURE;
        remember([runId, sessionKeyNow], owed);
      }
      // A spoken turn out of its one retry with anything still open: code says the honest line (HIGH 3, review of feat/voice-fluid).
      // Never over the scheduler's own honest line (honestNow), and only for a finding that makes the reply false (spokenBlocking):
      // a real move with a mismatched time keeps its reply (re-review HIGH). This path never has calendar data (checkWork gets none).
      if (on && run.spoken && !honestNow && !flowActed && !run.reminder && (run.passes >= revisePasses(true) || hostDrops) && spokenBlocking(findings, false).length > 0) {
        const line = spokenFinalLine(findings, { calendar: SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical)), wrote: wroteThisTurn(run.tools) });
        if (line) { owed = line; remember([runId, sessionKeyNow], owed); }
      }
      // Out of retries and the call was never made: say so (not "I checked the weather…", q007).
      // Merge of r2-front-desk-tools (tool-move fail line) with 9a3a25a (LOOKUP_HONEST): a missed tool move whose
      // reply also claimed a lookup ("I checked the weather…", q007) owes both — that nothing was checked, and why.
      // Another tool succeeded this turn ("took my creatine" logged by exec orion-log): the worker's reply stands
      // (it went through the work check above), not the fail line (review, 2026-10-16).
      if (on && run.directive && !run.approvalHeld && !directiveCalled(run) && !anotherToolSucceeded(run.tools, run.directive.action)) {
        const claimedLookup = findings.some((f) => LOOKUP_CLAIM.test(f));
        owed = claimedLookup ? `${LOOKUP_UNCHECKED} ${run.directive.failLine}` : run.directive.failLine;
        remember([runId, sessionKeyNow], owed);
      }
      // Recall (2026-10-16): a refused search never reaches him as "Exec failed" or a guess (q059), and a document's
      // words are not "you told me" (q056).
      if (on && run.recall && !owed) {
        if (searchRefused(run.tools.map((t) => t.stdout)) && !run.recall.learned.length) owed = SEARCH_UNAVAILABLE;
        else {
          const clean = reframeDocumentRecall(stripExecFailed(reply), run.message, run.recall.learned);
          if (clean && clean !== reply) owed = clean;
        }
        if (owed) remember([runId, sessionKeyNow], owed);
      }
      // H4 (r8b2, 2026-10-16) q069/q070: raw CLI text (URLs, "Exec failed", script paths, tool banners) never reaches him; only
      // here can it be fixed on the Mac chat / phone route (reply_payload_sending never runs there).
      // Wave 4: code-authored lines (owed) are cleaned too (the scheduler's "orion-reschedule extend … --until HH:MM" hint rode in one); a failed
      // host tool must be owned in the reply, or the host appends its raw "Exec failed" payload (finalizeReply, tool-failure.ts).
      if (on && (owed ?? reply).trim()) {
        const before: string = owed ?? reply;
        const clean = finalizeReply(before, run.tools, { mailFailed: mailReadFailed(run.tools), hostTools: run.hostTools ?? 0, changeRequest: CHANGE_REQUEST.test(run.message), askedChange: !isQuestion(run.message) && (CHANGE_REQUEST.test(run.message) || readStatedMove(run.message) !== null), codeAuthored: owed !== undefined });
        if (clean !== before) { owed = clean; remember([runId, sessionKeyNow], owed); }
      }
      // 2026-11-02: past tonight's nudge time a reply never ends by ordering him to the gym or a plan task.
      if (on && (owed ?? reply).trim() && pastNudgeTime(options.stateDir, (options.now ?? pluginNow)())) {
        const before: string = owed ?? reply;
        const late = stripLateInstruction(before, run.message);
        if (late !== before) { owed = late; remember([runId, sessionKeyNow], owed); }
      }
      // Wave 4 review 2: a GENTLE turn ("i hate my life rn the wifi is down") ran as normal; its reply opens with one warm check-in line.
      if (on && !run.hushed && (owed ?? reply).trim()) {
        const before: string = owed ?? reply;
        const gentle = withGentleCheckIn(run.message, before);
        if (gentle !== before) { owed = gentle; remember([runId, sessionKeyNow], owed); }
      }
      if (on && owed) putReplyInPlace(event.messages, owed);
      await record();
      done();
    } catch (error) {
      api.logger?.warn?.(`[orion-control] local routing finalize failed: ${error instanceof Error ? error.message : String(error)}`);
      done();
    }
    return undefined;
  });

  // 2026-10-20: a turn that ends in an error, an abort or a host timeout never reaches before_agent_finalize, so it left no row at all (the
  // front desk's failure was only written when the turn ended). A run still open at agent_end is logged here, with how it ended.
  api.on("agent_end", (event, ctx) => {
    const run = runFor(event, ctx);
    if (!run) return undefined;
    const runId = pick(event, ctx, "runId") ?? "";
    const flow = run.flow;
    log({ stage: "agent_end", runId, message: run.message, decision: run.settled ?? { move: "escalate", fallback: "unsettled" },
      flow: flow ? { outcome: flow.outcome, ..."reason" in flow ? { reason: flow.reason } : {} } : null, success: event.success !== false, error: str(event.error) ?? null,
      tools: run.tools.length, cloud: run.cloud ?? false, turnMs: typeof event.durationMs === "number" ? event.durationMs : Date.now() - run.started });
    progress.finish(run.sessionKey);
    runs.delete(runId); runs.delete(`session:${pick(event, ctx, "sessionKey") ?? run.sessionKey ?? ""}`);
    return undefined;
  });
}
