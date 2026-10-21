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
import { decide, keepWarm, FRONT_DESK_CTX } from "./front-desk.js";
import { FRONT_DESK_MODEL } from "./front-desk-prompt.js";
import { BRAIN_INSTRUCTIONS, GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS, WORKER_MODEL } from "./job-instructions.js";
import { checkWork, outcomeOf, retryInstruction } from "./work-check.js";
import { isSessionStart, startsSession } from "./session-flow.js";
import { guardTaskRun, madeTaskRunCall, taskRunCall, taskRunNow } from "./task-run-wiring.js";
import { asksCurrentTask, asksFocusStatus, withoutDayClaims } from "./status-questions.js";
import { parseTodoDone } from "./todo-done-flow.js";
import { isTimerRequest, toolDirective } from "./tool-moves.js";
import { directAddShape, restatementIsHis } from "./direct-add.js";
import { readIntent } from "./calendar-intent.js";
import { runsFirst } from "./intent-run.js";
import { timeMismatch, writesIn } from "./time-backstop.js";
import { DESK_TIMEOUT_MS, DeskHealth, HOOK_TIMEOUT_MS, SLOW_FLOW_LINE, LATE_UNKNOWN_LINE, SLOW_FLOW_MAYBE_WROTE_LINE, SLOW_TURN_LINE, SLOW_TURN_MS, flowDeadline } from "./turn-budget.js";
import { CRISIS_REPLY, OVERWHELMED_NOTE, SUPPORT_LINE, isCrisis, isOverwhelmed } from "./distress.js";
import { FACT_NOTE, FACT_NOW, RECALL_NOTE, RECALL_NOW, SEARCH_UNAVAILABLE, asksRecall, learnedLines, reframeDocumentRecall, searchRefused, stripExecFailed, tellsFact } from "./memory-facts.js";
import { MESSAGES_NOTE, cannotSend, isMessagesJob } from "./messages-route.js";
import { LATE_ASK, LATE_TOO_SMALL, isBareYes, isLateConfirm, isLateWithoutMinutes, lateMinutesAnswer, nothingMovedReply } from "./late-flow.js";
import { parseMessagesRead, readNote } from "./messages-read.js";
import { isBareTime, isReminderTurn, planReminder } from "./reminder-flow.js";
import { mailReadFailed, sanitizeReply } from "./reply-sanitize.js";
import { codeDayAnswer, dayRead, isAfterThat, noBlockReply } from "./day-read-answers.js";
import { asksDeadlines, deadlineReply } from "./deadline-read.js";
import { asksFocusOn, asksFocusToday, focusTodayReply, focusTodayTotal, liveFocusSeconds, localDayKey, noSessionReply, readFocusHistory } from "./focus-status.js";
import { answerPending, ADD_DECLINED, isYes } from "./schedule-pending.js";
import { FORM_OPTIONS, NOTHING_REPLY, RESCHEDULE, LATE_NIGHT_UNTIL, meansTomorrow, runScheduleFlow, spokenReply, parseAskContext } from "./schedule-flow.js";
/** Notes what code read for the worker this turn, once (routing log, 2026-10-16 r8). */
const markRead = (run, name) => { if (!(run.reads ?? []).includes(name))
    run.reads = [...(run.reads ?? []), name]; };
const INTERNAL = /\b(?:cron|heartbeat|doctor|test|subagent|eval)\b/i;
// One spoken request can arrive as two turns: the app sends what it heard when he pauses, and the rest
// with this marker (native AppState.send). 2026-10-15: the first half ("…so if you can go ahead and")
// changed his day on its own, and the second half was read without the first.
const CONTINUING = /^\(Continuing — my last message was cut off[^)]*\)\s*/;
const SPOKEN = /Nick SAID this out loud/;
// A spoken message that ends on a word a sentence cannot end on ("…go ahead and", "…move the").
const TRAILS_OFF = /\b(and|or|but|so|because|cause|then|if|to|the|a|an|my|your|with|of|from|um|uh)\s*[,–—-]*\s*$/i;
// H6 (r8b2, 2026-10-16): the 11:24:58 fragment was a bare "can". These end a cut-off sentence too, but real short messages end on
// them ("yes i can", "what's it like", "i know what it is"), so a clause that is complete without the word is not held. "it", "that"
// and "this" are left out: "what time is it", "what is that", "i love this" are whole questions and statements.
const TRAILS_OFF_SOFT = /\b(can|could|is|are|was|just|like|i|i'm)\s*[,–—-]*\s*$/i;
const COMPLETE_TAIL = /\b(?:yes|yeah|yep|no|nope|i|we|you|they|he|she|it|that|this|there)\s+(?:can|could|is|are|was|am)\s*$|\b(?:it|that|this|looks?|feels?|sounds?|seems?|more|something|someone|things?)\s+like\s*$|\b(?:what|where|who|how)\s+(?:it|that|this|he|she|they|there)\s+(?:is|are|was)\s*$|\b(?:what|where|who|how|when|which)\s+\S+(?:\s+\S+)*?\s+(?:is|are|was)\s*$|\b(?:you|they|we)\s+like\s*$/i; // review 5 H4 (2026-10-16): "tell me what my next class is", "do you know where my keys are", "whatever you like" are whole sentences
export const trailsOff = (message) => TRAILS_OFF.test(message) || (TRAILS_OFF_SOFT.test(message) && !COMPLETE_TAIL.test(message.trim()));
export const GO_ON = "Go on.";
const LABEL_COMMANDS = /\b(turn|open|play|start|text|email|add|move|cancel|set|what|whats|what's|how|when)\b/i;
/** An answer to "what should I remind you about?" is a plain label: no change, calendar, live-data or command word, and no tool/escalate from the front desk (review, 2026-10-16). */
// A weekday, a cancel, "instead" or a before/after word is a statement about his day, never a label (final round, 2026-10-16).
const LABEL_DAYWORDS = /\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?s?\b|\bcancel\w*|\b(instead|after|before|until)\b/i;
const answersLabel = (message, move) => move !== "tool" && move !== "escalate" && ![CHANGE_REQUEST, ...(move === "answer" ? [] : [SCHEDULING]), LIVE_DATA, LABEL_COMMANDS, LABEL_DAYWORDS].some((re) => re.test(message)); // a calendar word alone (class, lab) is a label when the front desk answered (final round, 2026-10-16)
const REMINDER_UNCLEAR = "I couldn't work that reminder out — nothing was set.";
const STITCH_WINDOW_MS = 3 * 60_000;
const DAY_MEMORY_MS = 10 * 60_000;
const nowMinutes = (now) => { const d = (now ?? (() => new Date()))(); return d.getHours() * 60 + d.getMinutes(); };
// 2026-10-16 re-run, q092: in a FRESH chat "cancel that" had the worker run `orion-reschedule undo`, which
// reversed a REAL change Nick made a day earlier ("Undone: put Review spending back"). A bare cancel or
// undo (no named object) may take back a calendar change only when THIS session made one recently.
export const UNDO_NOTHING_TO_UNDO = "I haven't changed your calendar in this chat. What should I cancel?";
// 2026-10-16 review: "start a focus session" then "cancel that" said nothing had changed and the session kept
// running. A session start, a timer or a logged supplement made in this chat is something "cancel that" may mean;
// ending or undoing it is a different action from the calendar undo, so code ASKS (the safer choice) and never
// ends it on a guess. The undo exec block stays calendar-only.
const OTHER_ASKS = { focus: "End the focus session you just started?", timer: "Cancel the timer you just set?", supplement: "Undo the supplement you just logged?" };
const SESSION_CHANGE_WINDOW_MS = 30 * 60_000;
const BARE_UNDO = /^(?:(?:ok|okay|please|pls|orion|hey|actually|wait|no)\s+)*(?:(?:cancel|undo|revert)(?:\s+(?:that|it|this|the last (?:one|change|thing)|my last change))?|(?:never ?mind|nvm)\s+(?:that|it|this)|(?:put|take)\s+(?:it|that|this|them)\s+back)(?:\s+(?:please|pls|thanks))?$/;
/** A cancel or undo that names nothing: "cancel that", "undo", "put it back", "never mind that". */
export const isBareUndo = (message) => BARE_UNDO.test(message.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim());
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
const needsLiveData = (message) => LIVE_DATA.test(message) && !CHIT_CHAT.test(message.trim());
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
const NAMES_NOTHING = (message) => {
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
export function answersAsk(message, ask) {
    const m = message.trim();
    // 2026-10-19: "yes" / "yes, put cs lab until 10:30" answers ORION's own "I could put CS Lab there"; a bare yes means nothing without an offer.
    const accepts = !!ask?.suggest && (isYes(m.replace(/[.!?…]+$/, "")) || /^(?:yes|yeah|yea|yep|yup|ok(?:ay)?|sure|alright)\b[,\s]/i.test(m));
    return m.length > 0 && m.length <= 160 && (accepts || NOTHING_REPLY.test(m) || LOGGING.test(m) || WHEN_OR_HOW_LONG.test(m) || ACTIVITY_REPLY.test(m));
}
/** Whether this turn is a change to his calendar at all, whatever words it shares with one. */
export function isCalendarTurn(message, settled, askOpen = false) {
    // The 4B's tool pick is a hint, not a fact (review, 2026-10-16): "add gym at 5 today" picked as "tasks"
    // is still a block. A clearly unrelated tool skips the flow; "tasks" or "brain" only with no time or length.
    if (settled.move === "tool" && !CALENDAR_TOOLS.has(settled.tool ?? "") && (NOT_CALENDAR_TOOLS.has(settled.tool ?? "") || !WHEN_OR_HOW_LONG.test(message)))
        return false;
    if (SEND_OR_CAPTURE.test(message) || BOOK_ELSEWHERE.test(message))
        return false;
    if (HABIT.test(message) && !CHANGE_REQUEST.test(message))
        return false;
    if (settled.move === "ask" && NAMES_NOTHING(message))
        return false;
    // Chit-chat the front desk answered, with no change word, time or "after/before my…" anchor ("the meeting went
    // over well") is not a calendar turn (re-review, 2026-10-16).
    if (settled.move === "answer" && !askOpen && !CHANGE_REQUEST.test(message) && !RUNNING_LATE.test(message) && !WHEN_OR_HOW_LONG.test(message) && !LOGGING.test(message) && !/\b(after|before|between|until|till|from|cancel\w*|mov\w*|not going|instead|no \w+ for me|no \w+ today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(message))
        return false;
    return true;
}
// A fact he tells ORION, including a habit ("i take creatine every morning at 8"): saved, never drafted (2026-10-15).
const keepsFact = (message) => tellsFact(message) || (HABIT.test(message) && !CHANGE_REQUEST.test(message) && !/\?\s*$/.test(message.trim()));
const BRAIN = /\b(remember|note|notes|brain|wrote|write down|repair (queue|list)|bug|save (that|this|it))\b/i;
/** The front desk's session start, task and length (sweep 2026-10-15, q051: it read "focus mode on for an
 *  hour, leetcode" right — session start, task leetcode — and the calendar flow booked "focus mode"). */
export function sessionHint(d) {
    if (d?.move !== "tool" || d.tool !== "session" || d.args?.do !== "start")
        return {};
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
const IGNORE_NOTE = "This may not be meant for you (a fragment, or him talking to someone else). If it is a real request, do it; otherwise ask him briefly what he needs and say nothing else — not his session or his day.";
export function isNotForOrion(message, spoken) {
    const words = message.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    if (words.length > 3)
        return false;
    if (words.every((w) => FILLER_WORD.test(w)))
        return true;
    if (spoken)
        return false;
    return ![SCHEDULING, REMINDER, CHANGE_REQUEST, LIVE_DATA, BRAIN, COMMAND_WORD].some((re) => re.test(message)) && !isSessionStart(message);
}
const str = (v) => (typeof v === "string" ? v : undefined);
const pick = (event, ctx, key) => str(event[key]) ?? str(ctx[key]);
/** Nick's own words: the part after a channel brief, if the message carries one. */
export function userText(prompt) {
    // The Mac app prepends "[ORION context: ...]" lines (what ORION asked first) to his words: they are not his message.
    const own = (text) => text.replace(/^(?:\s*\[ORION context:[^\]]*\])+/, "").trim();
    for (const marker of MARKERS)
        if (prompt.includes(marker))
            return own(prompt.split(marker).pop());
    return own(prompt);
}
/** "Sat 18:05" in local time, the clock format the front desk was evaluated with. */
export function localClock(now = new Date()) {
    const day = now.toLocaleDateString("en-GB", { weekday: "short" });
    return `${day} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
/** A tool result's text, whatever shape the host hands back. */
export function resultText(result) {
    if (typeof result === "string")
        return result;
    const content = result?.content;
    if (Array.isArray(content))
        return content.map((c) => c?.text ?? "").join("\n");
    try {
        return JSON.stringify(result) ?? "";
    }
    catch {
        return String(result);
    }
}
/** The canonical call string the work check reads ("exec orion-reschedule move …"). */
export function canonicalCall(toolName, params) {
    const p = (params ?? {});
    if (toolName === "exec")
        return `exec ${String(p.command ?? "").trim().replace(/^\S*\//, "")}`;
    return `${toolName} ${JSON.stringify(p)}`;
}
/** The worker's instructions for this job. */
export function instructionsFor(decision, message) {
    if (decision?.tool === "brain" || decision?.tool === "repair_note" || (!decision?.tool && BRAIN.test(message)))
        return BRAIN_INSTRUCTIONS;
    if (["agenda", "reschedule", "tasks"].includes(decision?.tool ?? "") || SCHEDULING.test(message) || RUNNING_LATE.test(message))
        return SCHEDULING_INSTRUCTIONS;
    return GENERAL_INSTRUCTIONS;
}
// The small core every local turn gets (Nick, 2026-10-12: a small prompt, and ORION looks up the rest
// in the brain). The manual is generated into the brain by scripts/orion-brain-manual.
export const LOOK_IT_UP = "Your manual and his memory live in his brain; you only see a small part of it here. When you need something that is not in front of you — how a script works, a scheduling rule, dates, his routines, people, preferences, what was decided before — look it up first with exec: /Users/nickmadaio/Desktop/ORION/scripts/orion-brain search \"<words>\", or read \"ORION Manual - Index\" for the list of manual sections, then read \"<title>\". Never guess a fact about Nick or a command's syntax that you could look up.";
/** Brain search for the message, trimmed to the best few matches (pre-fetched while the front desk decides). */
export function brainSnippets(output, maxChars = 1400) {
    const blocks = output.split(/\n(?=## )/).map((b) => b.trim()).filter((b) => b.startsWith("## "));
    const picked = [];
    let used = 0;
    for (const b of blocks.slice(0, 4)) {
        const cut = b.slice(0, 500);
        if (used + cut.length > maxChars)
            break;
        picked.push(cut);
        used += cut.length;
    }
    return picked.join("\n\n");
}
const ORION_BRAIN = "/Users/nickmadaio/Desktop/ORION/scripts/orion-brain";
const NICK_NOTE = join(homedir(), "Documents/orionBrain/20 Areas/Me/Nick.md");
const readNickNote = () => { try {
    return readFileSync(NICK_NOTE, "utf8");
}
catch {
    return "";
} };
const defaultBrainSearch = (query) => new Promise((resolve) => {
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
const lastSentence = (message) => message.trim().split(/(?<=[.!?…])\s+/).filter(Boolean).at(-1) ?? message;
export const isPoliteRequest = (message) => POLITE_REQUEST.test(lastSentence(message));
export const isQuestion = (message) => !isPoliteRequest(message) && (/\?\s*$/.test(message.trim()) || (QUESTION_OPENER.test(message.trim()) && !CHANGE_REQUEST.test(message.replace(/\b(my|the|his|your) schedule\b/gi, ""))));
// The day read has no window rule of its own: "tomorrow morning" listed afternoon classes (q014).
const DAY_QUESTION_NOTE = "Morning means before 12:00, afternoon 12:00 to 17:00, evening after 17:00: list only what falls in the window he names. \"Next\" means the first block that has not already happened. For \"how long until\", count from Now. If nothing in the list matches, say so and name what is there.";
/** His day as a numbered list, read from the scheduler (wired in by index.ts). */
export const liveReadDay = (tomorrow) => new Promise((resolve) => execFile(RESCHEDULE, ["show", "--json", ...(tomorrow ? ["--date", "tomorrow"] : [])], { timeout: 30000 }, (_e, stdout) => {
    try {
        resolve(dayRead(JSON.parse(String(stdout))));
    }
    catch {
        resolve("");
    }
}));
/** The stamp of the newest change in the scheduler's undo journal (the entry "orion-reschedule undo"
 *  reverts; same file and same skipping of empty entries as scripts/lib/life/calendar-write.mjs). */
export function undoJournalTop(home = homedir(), now = Date.now()) {
    const dir = join(home, ".openclaw", "orion-controlled");
    let evalRun = false;
    try {
        evalRun = now - statSync(join(dir, "eval-mode")).mtimeMs < 2 * 3600_000 && existsSync(join(dir, "eval-calendar.json"));
    }
    catch { /* not an evaluation */ }
    try {
        const history = JSON.parse(readFileSync(join(dir, `${evalRun ? "eval-" : ""}reschedule-undo.json`), "utf8"));
        return [...history].reverse().find((e) => (e.steps ?? []).length)?.at ?? null;
    }
    catch {
        return null;
    }
}
/** The real scheduling flow (scheduler + worker via Ollama). Wired in by index.ts only. */
export const liveScheduleFlow = (message, clock, opts = {}) => runScheduleFlow({
    message, clock, undo: opts.undo ?? [], ...(opts.askContext ? { askContext: opts.askContext } : {}), undoTop: () => undoJournalTop(), ...(opts.pending ? { pending: opts.pending } : {}),
    ...(opts.deadlineAt !== undefined ? { deadlineAt: opts.deadlineAt } : {}), ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.onWriteStart ? { onWriteStart: opts.onWriteStart } : {}), ...(opts.replanContext ? { replanContext: opts.replanContext } : {}),
    exec: (args, signal) => new Promise((resolve) => execFile(RESCHEDULE, args, { timeout: 60000, maxBuffer: 1 << 20, ...(signal ? { signal } : {}) }, (e, stdout, stderr) => resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? 1 : 0 }))),
    ask: async (system, user, schema, budgetMs) => {
        try {
            const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ model: WORKER_MODEL, stream: false, think: false, format: schema, options: FORM_OPTIONS, keep_alive: "24h",
                    messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: opts.signal ? AbortSignal.any([AbortSignal.timeout(budgetMs ?? 30000), opts.signal]) : AbortSignal.timeout(budgetMs ?? 30000) });
            const body = (await res.json());
            return JSON.parse(body.message?.content ?? "");
        }
        catch {
            return null;
        }
    },
});
const RESTATES_TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b/i;
const CANT_OR_CONFIRM = /\b(?:can'?t|cannot|unable|not (?:being )?(?:added|able)|(?:need|have) to (?:ask|confirm)|confirm)\b/i;
export const REFUSED_NOTHING_CHANGED = "I couldn't make that change just now, so nothing was changed. Tell me the block, the day and the start and end times, and I'll do it.";
/** exactReply for a run: after a crisis reply the support line stays, one short line, so it is never withdrawn (2026-10-19). */
const exactFor = (run) => {
    const text = run.flow ? exactReply(run.flow) : "";
    return run.afterCrisis && text ? `${text} ${SUPPORT_LINE}` : text;
};
/** What Nick must hear after the scheduling flow: the scheduler's own lines, or its "can't"/question. */
function exactReply(flow) {
    if (flow.outcome === "done")
        return flow.reply ?? spokenReply(flow.outputs);
    if (flow.outcome === "say")
        return flow.kind === "ask" || flow.kind === "plain" ? flow.text : `That doesn't fit: ${flow.text.replace(/^(that|it) (can't|cannot) be done[:,]?\s*/i, "")}`;
    return "";
}
const ampm12 = (t) => { const [h, m] = t.split(":").map(Number); return `${((h ?? 0) + 11) % 12 + 1}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };
/** The real reminder extraction (worker via Ollama, form-constrained). Wired in by index.ts only. */
export const liveExtractReminder = async (message, clock) => {
    try {
        const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ model: WORKER_MODEL, stream: false, think: false, options: FORM_OPTIONS, keep_alive: "24h",
                // An empty time means he gave none: the forced HH:MM made it invent noon for "remind me about the
                // thing" and the peanut fact (sweep 2026-10-15). Relative times ("in 10 min") are code's arithmetic.
                format: { type: "object", properties: { time: { type: "string", pattern: "^(([01][0-9]|2[0-3]):[0-5][0-9])?$" }, label: { type: "string", maxLength: 100 } }, required: ["time", "label"] },
                messages: [{ role: "system", content: `${clock ? `Now: ${clock}. ` : ""}From Nick's message, give the time of day for his reminder (24-hour HH:MM; \"around 11\" or \"11 am\" = 11:00, \"5ish\" in the afternoon = 17:00) and a short label of what it is for, in his words. If he names no time of day at all, time is \"\" — never guess one. JSON only: {\"time\":\"HH:MM\",\"label\":\"…\"}` }, { role: "user", content: message }] }) });
        const out = JSON.parse((await res.json()).message?.content ?? "");
        if (!out.label)
            return null;
        return { time: /^\d{2}:\d{2}$/.test(out.time) ? out.time : null, label: out.label };
    }
    catch {
        return null;
    }
};
// "I'm currently using the ollama/qwen3.5:9b model" (q101, sweep 2026-10-15): no model, provider or setting names.
/**
 * 2026-10-16 (speed audit, docs/audits/2026-10-16-local-speed.md): a reply code already wrote is a one-line system prompt.
 * The 9B only repeats it (it was called with 6.7k tokens of prompt for that, 9.1 s). The hook cannot drop history or tool
 * schemas in this OpenClaw version, so the prompt is as small as it can be; finalize still checks the text and puts it in place.
 */
export const EXACT_REPLY_PROMPT = "Reply to Nick with exactly this text and nothing else, and do not call any tools:";
const LOCAL_IDENTITY = "You are ORION, Nick's personal assistant on his Mac and iPhone. Reply in one to three short sentences, the way you would say it out loud: no lists, no markdown, times like 8:15 PM. Never say something happened unless a tool result shows it did. Never name the model, provider or settings you run on.";
/** "Today is Sunday 2026-10-11; tomorrow is Monday 2026-10-12." — so --date never needs arithmetic. */
export function dateLine(now = new Date()) {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const name = (d) => d.toLocaleDateString("en-GB", { weekday: "long" });
    const tomorrow = new Date(now.getTime() + 86400000);
    if (now.getHours() < LATE_NIGHT_UNTIL)
        return `It is after midnight and he is still up: today is ${name(now)} ${iso(now)}, and when he says "tomorrow" he means ${name(now)} ${iso(now)} (the day after he sleeps), not ${name(tomorrow)}.`;
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
export const honestLine = (calendar) => calendar
    ? "I couldn't make that change — nothing on your calendar changed. Can you say it again?"
    : "I didn't actually do that — nothing was started or changed. Can you say it again?";
const FALSE_CLAIM = /claims what the tools|promised but did not act/;
const LOOKUP_CLAIM = /claims a lookup/;
const LOOKUP_UNCHECKED = "I didn't actually check that.";
export const MESSAGES_UNSURE = "I read your messages but my summary contradicted itself, so I won't guess. Ask me again and I'll read them out.";
export const LOOKUP_HONEST = "I didn't actually check that, so I can't tell you right now. Want me to try again?";
const HONEST_STOP_NO_WRITE = "The check still finds a problem. Tell Nick in one or two plain sentences what you could not do and why. Do not say it is done.";
/** A write this turn: an orion-reschedule/orion-tasks change or an orion_task_run action (not a read). */
const wroteThisTurn = (tools) => tools.some((t) => /orion-reschedule|orion-tasks|orion_task_run|orion-session|orion-remember/.test(t.canonical) && !/\b(show|day|list|status)\b/.test(t.canonical));
/** Whether the worker made the directive's call (directly, or through tool_call with the orion_task_run id).
 *  2026-10-16 (tool wiring): a "Tool orion_task_run not found" or error result is not a call made. */
const directiveCalled = (run) => !!run.directive && run.tools.some((t) => madeTaskRunCall(t, run.directive.action));
/** The tool family that can stand in for each directive action (re-review, 2026-10-16): an unrelated success
 *  (lights, supplement_add) must not carry a reply about weather or a dose. */
const DIRECTIVE_FAMILY = {
    weather_now: /weather/i,
    supplement_take: /"supplement_take"|orion-log\s+(supplement|take)/i,
    timer_set: /"timer_set"/,
    supplement_status: /"supplement_status"/,
};
/** A result this turn from the directive's own family that shows a change: NOTHING WAS CHANGED, an error or a
 *  refusal is not one. No family known: no stand-in, the fail line stays. */
const anotherToolSucceeded = (tools, action) => tools.some((t) => DIRECTIVE_FAMILY[action]?.test(t.canonical) === true && (outcomeOf(t) === "success" || (action === "supplement_status" && outcomeOf(t) === "read")));
/** Puts the text that must reach Nick into the turn's last assistant message (the one the host builds the
 *  reply from). Sweep 2026-10-15 (q006, q042, q055, q057, q067, q091): on `openclaw agent --json` —
 *  the Mac chat and phone — reply_payload_sending never runs, before_agent_finalize can only revise, and
 *  before_message_write rewrites only the transcript copy, written before the check runs; the reply is
 *  read afterwards from this same message object, so it is changed in place (the one deliberate
 *  mutation here: the host owns the object). "buy more oats has been marked as done" went out after
 *  three flagged passes. Thinking and tool blocks are kept; the text blocks become this one. */
export function putReplyInPlace(messages, text) {
    // Only this turn's reply: with no assistant message after the last user message, an earlier turn's
    // reply must never be rewritten (review, 2026-10-16).
    const list = Array.isArray(messages) ? messages : [];
    const turnStart = list.map((m) => m?.role).lastIndexOf("user") + 1;
    const last = list.slice(turnStart).reverse().find((m) => m?.role === "assistant");
    if (!last)
        return false;
    if (!Array.isArray(last.content)) {
        last.content = text;
        return true;
    }
    const blocks = last.content;
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
export function acceptanceVerdict(path, now = Date.now()) {
    let record;
    try {
        record = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return { ok: false, why: `no acceptance record at ${path}` };
    }
    const { at, n = 0, pass = 0, medianMs = Infinity } = record;
    const age = at ? (now - Date.parse(at)) / 86400000 : Infinity;
    if (!(age <= ACCEPTANCE.maxAgeDays))
        return { ok: false, why: `acceptance is ${Number.isFinite(age) ? Math.round(age) : "?"} days old (max ${ACCEPTANCE.maxAgeDays})` };
    if (n < ACCEPTANCE.minCases)
        return { ok: false, why: `acceptance ran ${n} cases (min ${ACCEPTANCE.minCases})` };
    if (pass / n < ACCEPTANCE.minPassRate)
        return { ok: false, why: `acceptance passed ${pass}/${n} (needs ${Math.round(ACCEPTANCE.minPassRate * 100)}%)` };
    if (medianMs > ACCEPTANCE.maxMedianMs)
        return { ok: false, why: `acceptance median ${Math.round(medianMs / 1000)} s (max ${ACCEPTANCE.maxMedianMs / 1000} s)` };
    return { ok: true, why: `acceptance ${pass}/${n}, median ${Math.round(medianMs / 1000)} s` };
}
/** Starts a flow that may write: refused (`refused`) once the prompt hook has aborted its run, else marked as a write that has begun. */
export function startWrite(run, start, refused) {
    if (run?.abort?.signal.aborted)
        return Promise.resolve(refused);
    if (run)
        run.writeStarted = true;
    return start();
}
export function registerLocalRouting(api, options) {
    if (options.mode === "off")
        return;
    // Which run a flow belongs to, so a flow that is running when the prompt hook gives up can be stopped and its writes known (review, 2026-10-20).
    const building = new AsyncLocalStorage();
    // A flow is a write point: once the hook has given up (and nothing was written), none of them starts.
    const marked = (f) => f && ((...a) => startWrite(building.getStore(), () => { forgetReplan(building.getStore()?.sessionKey); return f(...a); }, { outcome: "fallback", reason: "too slow" }));
    /** Per session: his last reschedule request that was carried out, for a follow-up reorder ("actually do resume before gym"), for 15 minutes. */
    const replanMemory = new Map();
    const forgetReplan = (key) => { if (key)
        replanMemory.delete(key); };
    const recentReplan = (key) => { const m = key ? replanMemory.get(key) : undefined; return m && Date.now() - m.at < 15 * 60_000 ? m.ask : undefined; };
    const schedule = options.scheduleFlow;
    options = { ...options,
        ...(schedule ? { scheduleFlow: (m, c, o = {}) => {
                const r = building.getStore();
                const context = recentReplan(r?.sessionKey);
                return schedule(m, c, { ...o, ...(context ? { replanContext: context } : {}), ...(r?.abort ? { signal: r.abort.signal, onWriteStart: () => { r.writeStarted = true; } } : {}) });
            } } : {}),
        ...(options.lateFlow ? { lateFlow: marked(options.lateFlow) } : {}), ...(options.sessionFlow ? { sessionFlow: marked(options.sessionFlow) } : {}),
        ...(options.wakeFlow ? { wakeFlow: marked(options.wakeFlow) } : {}), ...(options.todoDoneFlow ? { todoDoneFlow: marked(options.todoDoneFlow) } : {}) };
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
    const traceLine = (stage, event, ctx, extra = {}) => {
        if (!options.trace)
            return;
        try {
            appendFileSync(`${logPath}.trace`, `${JSON.stringify({ at: new Date().toISOString(), stage, runId: pick(event, ctx, "runId") ?? null, sessionKey: pick(event, ctx, "sessionKey") ?? null, ...extra })}\n`, { mode: 0o600 });
        }
        catch { /* diagnostics only */ }
    };
    const runs = new Map();
    /** Per session: his last message (stitched) and the scheduler changes it made. */
    const lastTurn = new Map();
    /** Per session: when it last changed his calendar (flow marks, or a write the worker ran). What a bare "undo" may take back. */
    const sessionChanges = new Map();
    const recordChange = (sessionKey, marks) => {
        if (!sessionKey)
            return;
        forgetReplan(sessionKey);
        sessionChanges.set(sessionKey, { at: Date.now(), marks: [...(sessionChanges.get(sessionKey)?.marks ?? []), ...marks] });
    };
    /** r8b2 (2026-10-16): per session, the block the last code day answer named (what "and after that?" means), short window. */
    const dayMemory = new Map();
    const otherChanges = new Map();
    const recordOther = (sessionKey, kind) => { if (sessionKey) {
        forgetReplan(sessionKey);
        otherChanges.set(sessionKey, { at: Date.now(), kind });
    } };
    const recentOther = (sessionKey) => {
        const c = sessionKey ? otherChanges.get(sessionKey) : undefined;
        return c && Date.now() - c.at < SESSION_CHANGE_WINDOW_MS ? c.kind : undefined;
    };
    const changedRecently = (sessionKey) => {
        const c = sessionKey ? sessionChanges.get(sessionKey) : undefined;
        return !!c && Date.now() - c.at < SESSION_CHANGE_WINDOW_MS;
    };
    /** Per session: the reminder just set (for "no wait make it 5:30") and an unanswered "what/when?" about one. */
    const lastReminder = new Map();
    const reminderAsk = new Map();
    /** Per session: an unanswered "how late?" (q029), and the last late move code ran (so "yeah push everything after it" does not move it twice). */
    const lateAsk = new Map();
    /** r8 review 3 H1: per session, the add question just asked ("push Gym later — go ahead?", "what should I put before …?") and what it would run. */
    const addPending = new Map();
    /** His reply to that question, if it is one. The pending add is consumed by whatever turn comes next. */
    const addTurn = (key, message) => {
        const held = addPending.get(key);
        addPending.delete(key);
        return held && Date.now() - held.at < STITCH_WINDOW_MS ? answerPending(held.pending, message) : undefined;
    };
    /** What a finished schedule flow leaves behind: the calls in the log, the undo marks, and the question it asked (if any). */
    const settleSchedule = (run) => {
        const flow = run.flow;
        if (flow?.outcome === "say" && flow.pending && run.sessionKey)
            addPending.set(run.sessionKey, { pending: flow.pending, at: Date.now() });
        // A reschedule he asked for that code answered without writing ("Resume isn't on your day tomorrow…") is remembered too, so "actually do resume before gym" is still its follow-up.
        if (flow?.outcome === "say" && flow.replan && run.sessionKey)
            replanMemory.set(run.sessionKey, { ask: flow.replan, at: Date.now() });
        if (flow?.outcome !== "done")
            return;
        flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: flow.outputs[i] ?? "", exit: null }));
        const turn = run.sessionKey ? lastTurn.get(run.sessionKey) : undefined;
        if (turn && run.sessionKey)
            lastTurn.set(run.sessionKey, { ...turn, marks: flow.marks ?? [] });
        // An unknown outcome may have written: "undo" is allowed for it.
        if (flow.marks?.length || flow.uncertain)
            recordChange(run.sessionKey, flow.marks ?? []);
        // Any other write forgets the last request; a reschedule remembers itself AFTER that.
        if (!flow.replan)
            forgetReplan(run.sessionKey);
        else if (run.sessionKey)
            replanMemory.set(run.sessionKey, { ask: flow.replan, at: Date.now() });
    };
    /** The flow's second go for a turn whose worker was refused the scheduler: from the worker's restatement if it states a time, else an honest "nothing changed". */
    const heldChange = async (run, reply) => {
        const restated = reply.trim();
        // Only Nick's own request said back: the worker's sentence is never what the guards check ("move gym later" -> "Move Gym to 6 PM").
        if (options.scheduleFlow && restated && RESTATES_TIME.test(restated) && !CANT_OR_CONFIRM.test(restated) && !isQuestion(restated)
            && restatementIsHis(restated, run.message, nowMinutes(options.now))) {
            const flow = await options.scheduleFlow(restated, clock(), { undo: run.undo ?? [] }).catch(() => undefined);
            if (flow && flow.outcome !== "fallback")
                return flow;
        }
        return { outcome: "say", kind: "plain", text: REFUSED_NOTHING_CHANGED };
    };
    const lastLate = new Map();
    /** Whether this turn is the late flow's: "running late" with no minutes, the short answer to our question, or the go-ahead after it. Consumes the pending question. */
    const lateTurn = (key, message) => {
        const askedAt = lateAsk.get(key);
        lateAsk.delete(key);
        const pending = askedAt !== undefined && Date.now() - askedAt < STITCH_WINDOW_MS;
        // H1 (r8 review 1, 2026-10-16): the go-ahead only counts on the turn right after a late reply; any other turn clears it
        // (a bare "yeah" after the schedule flow's own question re-ran `late 15`).
        const last = lastLate.get(key);
        lastLate.delete(key);
        if (isLateWithoutMinutes(message))
            return { kind: "ask" };
        if (pending) {
            const minutes = lateMinutesAnswer(message);
            if (minutes !== null)
                return { kind: "run", minutes };
            if (isLateConfirm(message) || isBareYes(message))
                return { kind: "ask" };
        }
        // r8 review 2 MEDIUM-1: a bare "ok"/"yeah" confirms only a late reply that asked something; after "Nothing was moved — …" it is an acknowledgement.
        if (last && Date.now() - last.at < SESSION_CHANGE_WINDOW_MS && (isLateConfirm(message) || (isBareYes(message) && last.asked)))
            return { kind: "confirm", last };
        return undefined;
    };
    const runFor = (event, ctx) => runs.get(pick(event, ctx, "runId") ?? "") ?? runs.get(`session:${pick(event, ctx, "sessionKey") ?? ""}`);
    const log = (entry) => {
        try {
            mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
            appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), mode: options.mode, ...entry })}\n`, { mode: 0o600 });
        }
        catch (error) {
            api.logger?.warn?.(`[orion-control] local routing log failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const settle = async (run) => {
        const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: "front desk still running" }), finalizeWaitMs));
        return Promise.race([run.decision, timeout]);
    };
    /** The run, swapped for a copy that the (late) original build can no longer change: what Nick is told is fixed once the hook gives up. */
    const freezeRun = (old, flow) => {
        const next = { ...old, flow, provided: false, directive: undefined, reminder: undefined };
        for (const [k, v] of runs)
            if (v === old)
                runs.set(k, next);
        return next;
    };
    const fixedReply = (text, state = "nothing was changed") => ({ systemPrompt: `${EXACT_REPLY_PROMPT}\n${text}`, appendContext: `[ORION scheduler — ${state}. Your whole reply must be exactly: ${text}]` });
    /**
     * 2026-10-20 incident: the host cuts before_prompt_build off at 15 s and then runs the FULL workspace prompt (17.7k tokens, 3 min 1 s on battery) —
     * silently, with no error anywhere. The hook now (1) is registered with a longer timeout, (2) bounds its own work so that it answers first,
     * (3) never throws into the host's default prompt, and (4) does not hand a change request that already took SLOW_TURN_MS a multi-minute tool loop.
     */
    /** Per session: how a change the prompt hook left to finish ended, told with the next message. */
    const lateReports = new Map();
    const deliverLate = (run, built) => {
        const key = run.sessionKey;
        const late = key ? lateReports.get(key) : undefined;
        if (!key || !late || !built || typeof built !== "object" || Date.now() - late.at > 60 * 60_000)
            return built;
        lateReports.delete(key);
        const said = `Earlier: ${late.text}`;
        const flow = run.flow;
        if (flow?.outcome === "done") {
            run.flow = { ...flow, reply: `${said} ${exactFor(run)}` };
            const exact = exactFor(run);
            return { systemPrompt: `You already made this change. ${EXACT_REPLY_PROMPT}\n${exact}`, appendContext: `[ORION scheduler — already done. Your whole reply must be exactly: ${exact}]` };
        }
        if (flow?.outcome === "say") {
            run.flow = { ...flow, text: `${said} ${exactFor(run)}`, kind: "plain" };
            return fixedReply(exactFor(run));
        }
        const b = built;
        return { ...b, appendContext: `${b.appendContext ? `${b.appendContext}\n` : ""}[ORION: begin your reply with exactly this, then answer him: "${said}"]` };
    };
    const guardedPrompt = (inner) => async (event, ctx) => {
        const run = runFor(event, ctx);
        if (!run?.settled || run.cloud)
            return undefined;
        traceLine("before_prompt_build", event, ctx, { sinceStartMs: Date.now() - run.started });
        let timer;
        run.abort = new AbortController();
        run.writeStarted = false;
        const cut = new Promise((resolve) => { timer = setTimeout(() => resolve("cut"), HOOK_TIMEOUT_MS - 5_000); timer.unref?.(); });
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
                        if (flow?.outcome === "done")
                            settleSchedule(run);
                        const text = flow?.outcome === "done" || flow?.outcome === "say" ? exactReply(flow) : LATE_UNKNOWN_LINE;
                        if (run.sessionKey)
                            lateReports.set(run.sessionKey, { text: text || LATE_UNKNOWN_LINE, at: Date.now() });
                    }, () => { if (run.sessionKey)
                        lateReports.set(run.sessionKey, { text: LATE_UNKNOWN_LINE, at: Date.now() }); });
                }
                else
                    run.abort?.abort(); // nothing was written: stop the reads and the model calls, and say so
                const line = run.writeStarted ? SLOW_FLOW_MAYBE_WROTE_LINE : SLOW_FLOW_LINE;
                freezeRun(run, { outcome: "say", kind: "plain", text: line });
                return fixedReply(line, run.writeStarted ? "a change is being made and is not stopped" : "nothing was changed");
            }
            const now = runFor(event, ctx) ?? run;
            const stillWorker = !now.flow || now.flow.outcome === "fallback";
            if (stillWorker && !now.directive && !now.reminder && !now.noTools && !now.provided && Date.now() - now.started > SLOW_TURN_MS
                && CHANGE_REQUEST.test(now.message) && SCHEDULING.test(now.message) && !isQuestion(now.message)) {
                now.flow = { outcome: "say", kind: "plain", text: SLOW_TURN_LINE };
                traceLine("slow_turn", event, ctx, { sinceStartMs: Date.now() - now.started });
                return fixedReply(SLOW_TURN_LINE);
            }
            return deliverLate(runFor(event, ctx) ?? run, built);
        }
        catch (error) {
            api.logger?.warn?.(`[orion-control] before_prompt_build failed, using the slim prompt: ${error instanceof Error ? error.message : String(error)}`);
            return { systemPrompt: `${instructionsFor(run.settled, run.message)}\n\n${PRODUCTION_NOTES}\n\n${LOOK_IT_UP}\n\nNow: ${clock()} (Europe/London). ${dateLine()}` };
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    };
    api.on("before_model_resolve", async (event, ctx) => {
        const runId = pick(event, ctx, "runId");
        const sessionKey = pick(event, ctx, "sessionKey") ?? "";
        const raw = str(event.prompt);
        traceLine("before_model_resolve", event, ctx, { hasPrompt: !!raw });
        if (!raw || INTERNAL.test(sessionKey))
            return undefined;
        // The rest of a cut-off spoken request is read together with its first half, as one request.
        const said = userText(raw);
        const before = sessionKey ? lastTurn.get(sessionKey) : undefined;
        const stitch = CONTINUING.test(said) && before && Date.now() - before.at < STITCH_WINDOW_MS ? before : undefined;
        const continuation = stitch ? said.replace(CONTINUING, "") : undefined;
        // 2026-10-19: the rest of a message whose first half got the crisis reply. Still joined to it (so more distress, even without the
        // listed words, keeps CRISIS_REPLY); only a concrete request that code then runs gets its own reply (see crisisRest below).
        const crisisRest = stitch && isCrisis(stitch.text) && !isCrisis(continuation ?? "") ? continuation : undefined;
        const message = stitch ? `${stitch.text} ${continuation}` : said;
        const cutOff = SPOKEN.test(raw) && trailsOff(message);
        if (sessionKey)
            lastTurn.set(sessionKey, { text: message, at: Date.now(), marks: [] });
        // Text owed by an earlier turn in this session is never delivered on this one (review, 2026-10-16).
        if (sessionKey)
            finalText.delete(`session:${sessionKey}`);
        // 2026-10-20: "reschedule my day after my class, gym first" is code's whole job (day-replan.ts): the 4B is not asked, so a slow or
        // failing desk can neither delay it by 8 s nor send it down the worker path.
        // The calendar intent layer (calendar-intent.ts): a replan, a follow-up to one, an add at a time or "until T", or a request he took back at the end.
        const intentRead = on && !cutOff && options.scheduleFlow ? readIntent(message, { now: (options.now ?? (() => new Date()))(), ...(recentReplan(sessionKey) ? { last: recentReplan(sessionKey) } : {}) }) : undefined;
        // Never for something that is not his calendar at all ("book a table at 7", "add a todo …", "text mom at 5").
        const elsewhere = SEND_OR_CAPTURE.test(message) || BOOK_ELSEWHERE.test(message) || isCrisis(message);
        const intentFirst = !!intentRead && !elsewhere && ("intent" in intentRead ? runsFirst(intentRead.intent) : !!intentRead.tookBack);
        const codeFirst = intentFirst;
        const decision = cutOff
            ? Promise.resolve({ move: "ask", answer: GO_ON })
            : codeFirst ? Promise.resolve({ move: "escalate", fallback: "code-first", ms: 0 })
                : Promise.resolve(deskHealth.begin()).then((call) => Promise.resolve()
                    .then(() => decideImpl({ message, clock: clock(), timeoutMs: call.timeoutMs }))
                    .then((d) => { deskHealth.record(d, call); return d; })
                    .catch((error) => { deskHealth.record({ error: "threw" }, call); return { error: error instanceof Error ? error.message : String(error) }; }));
        const askContext = parseAskContext(raw);
        const run = { message, decision, tools: [], started: Date.now(), passes: 0, findings: [], sessionKey, cutOff, ...(intentFirst ? { codeFirst: true } : {}), ...(askContext ? { ask: askContext } : {}), spoken: SPOKEN.test(raw), undo: stitch?.marks ?? [], ...(stitch ? { stitched: true } : {}), ...(crisisRest ? { crisisRest } : {}),
            ...(on && !cutOff ? { brain: (options.brainSearch ?? defaultBrainSearch)(message).catch(() => "") } : {}) };
        if (runId)
            runs.set(runId, run);
        if (sessionKey)
            runs.set(`session:${sessionKey}`, run);
        if (!on)
            return undefined; // shadow: fire and forget
        if (sessionKey && !cutOff && options.lateFlow) {
            const late = lateTurn(sessionKey, message);
            if (late)
                run.late = late;
        }
        if (sessionKey) {
            const answer = addTurn(sessionKey, message);
            if (answer && !cutOff)
                run.addAnswer = answer;
        }
        // 2026-10-19: after a crisis reply, a continuation that is exactly "put X until T" runs, and its reply is the scheduler's plus a check-in
        // line. Only when the flow really ran (done); a question, a refusal or anything else in it keeps the full crisis reply.
        if (run.crisisRest && !cutOff && options.scheduleFlow && directAddShape(run.crisisRest)) {
            const ran = await options.scheduleFlow(run.crisisRest, clock(), { undo: run.undo ?? [] }).catch(() => undefined);
            if (ran?.outcome === "done") {
                run.afterCrisis = true;
                run.flow = ran;
                settleSchedule(run);
            }
        }
        const d = await decision;
        // 2026-10-20: a row the moment the desk fails (it was only written when the turn ended, 4m40 later, and never if it did not end).
        if ("error" in d || (d.fallback && d.fallback !== "code-first"))
            log({ stage: "decision", runId, message, decision: "error" in d ? { move: "escalate", fallback: d.error } : d });
        // A front-desk failure must not switch the flow off (it did once: "scrap the gym tmrw").
        if ("error" in d) {
            run.settled = { move: "escalate", fallback: d.error };
            return { providerOverride: workerProvider, modelOverride: workerModel };
        }
        run.settled = d;
        // r8 review 4 HIGH-1 (2026-10-16): the front desk read his reply as a device or lookup request ("turn off the lights"),
        // so it is not the title the add question asked for: nothing is booked and the turn routes normally.
        if (run.addAnswer?.kind === "run" && "title" in run.addAnswer.run && d.move === "tool")
            run.addAnswer = undefined;
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
            if (run && isCrisis(run.message) && !run.afterCrisis)
                return { handled: true, reply: { text: CRISIS_REPLY }, reason: "distress: fixed safety reply" };
            if (run && isOverwhelmed(run.message))
                return undefined;
            // A fact to save or a question about one is work: the drafts said "I've noted that" and saved nothing (2026-10-15).
            if (run && (keepsFact(run.message) || asksRecall(run.message)))
                return undefined;
            if (run && (RUNNING_LATE.test(run.message) || run.late))
                return undefined; // the calendar flow, never a drafted "no problem"
            // r8 review 4 MEDIUM-1 (2026-10-16): a draft must never answer the add question's yes ("Sure, done!" with nothing written).
            if (run?.addAnswer)
                return undefined;
            // 2026-10-16 r7: a draft keeps no claim about his day ("You've been coding for hours", q082).
            const draftText = withoutDayClaims(d?.answer ?? "");
            if (d?.move === "answer" && draftText && !CHANGE_REQUEST.test(run?.message ?? "") && !needsLiveData(run?.message ?? "") && !isSessionStart(run?.message ?? ""))
                return { handled: true, reply: { text: draftText }, reason: "front desk answered" };
            return undefined;
        });
        api.on("before_prompt_build", guardedPrompt(async (event, ctx) => {
            const run = runFor(event, ctx);
            if (!run?.settled || run.cloud)
                return undefined;
            // The workspace prompt written for Claude is ~17k tokens; on the 9B that cost 60-100 s a turn
            // (live, 2026-10-11). The worker gets what it was evaluated with instead: the tuned
            // instructions for this job, plus the time.
            // 2026-10-16 (speed audit): every system prompt below puts the stable text first and this clock, with the per-turn
            // facts, LAST. At the top it changed the prefix each minute and Ollama re-read the whole prompt (7.25 s against 0.05 s
            // on a 6.7k prompt; 3.67 s against 1.09 s on a 3.8k one). The wording of each part is unchanged, only its place.
            const now = `Now: ${clock()} (Europe/London). ${dateLine()}`;
            // Distress comes before every flow: "i literally cant do this anymore" got a canned "Want to take a
            // break?" with no question about his safety (live sweep, 2026-10-16). Fixed text, no tools.
            // Only in "on" mode: in shadow, or once the testing window closes, the configured (cloud) model answers
            // him itself, which is intended: the fixed reply exists to guard the small local models.
            if (isCrisis(run.message) && !run.afterCrisis)
                run.flow = { outcome: "say", kind: "plain", text: CRISIS_REPLY };
            // Overwhelmed but not a crisis: warmth and one small step. Left to the worker it searched his brain,
            // read two agendas and read him a quiz schedule (16 s, 2026-10-16). A change he asks for still runs.
            // Only when he asks for nothing else: "i'm so stressed, remind me at 3" still sets the reminder (review, 2026-10-16).
            if (!run.flow && isOverwhelmed(run.message) && !CHANGE_REQUEST.test(run.message) && !REMINDER.test(run.message) && !RUNNING_LATE.test(run.message) && !isSessionStart(run.message)
                && !LIVE_DATA.test(run.message) && !/\?\s*$/.test(run.message.trim()) && run.settled.move !== "tool") {
                run.provided = true;
                run.noTools = true;
                return { systemPrompt: `${LOCAL_IDENTITY}\n\n${OVERWHELMED_NOTE}\n\n${now}` };
            }
            // Half a spoken sentence: nothing is acted on; the rest arrives as a continuation.
            if (run.cutOff && !run.flow)
                run.flow = { outcome: "say", text: GO_ON, kind: "ask" };
            // A bare "cancel that" / "undo" with no change made in THIS chat has nothing to take back: ask, fixed text,
            // no tools (q092, 2026-10-16). A reminder just set, or one being asked about, owns the word instead.
            if (!run.flow && !run.cutOff && isBareUndo(run.message) && !changedRecently(run.sessionKey)
                && !(Date.now() - (lastReminder.get(run.sessionKey ?? "")?.set ?? 0) < CORRECTION_WINDOW_MS) && !reminderAsk.has(run.sessionKey ?? "")) {
                const other = recentOther(run.sessionKey);
                run.flow = { outcome: "say", kind: "ask", text: other ? OTHER_ASKS[other] : UNDO_NOTHING_TO_UNDO };
            }
            // 2026-10-20 re-run: a change the intent layer read is the schedule flow's before any other flow looks at it ("resume" is not a focus-session resume).
            if (!run.flow && !run.cutOff && run.codeFirst && options.scheduleFlow) {
                const flow = await options.scheduleFlow(run.message, clock(), { undo: run.undo ?? [], deadlineAt: flowDeadline(run.started), ...(run.ask ? { askContext: run.ask } : {}) })
                    .catch((e) => ({ outcome: "fallback", reason: String(e) }));
                if (flow.outcome !== "fallback") {
                    run.flow = flow;
                    markRead(run, /--date/.test("calls" in flow ? (flow.calls ?? []).join(" ") : "") || meansTomorrow(run.message) ? "day-tomorrow" : "day");
                    settleSchedule(run);
                }
                else
                    run.scheduleTried = true; // the flow (and its form) already had this message: not run a second time below
            }
            // q029 (2026-10-16 r8): "im running late" → code asks "how late?", the short answer is stitched to it, and
            // "yeah push everything after it" is the same late move, never a free exec for the 9B (it ran late 15, got
            // NOTHING WAS BOOKED and said "Your schedule has been adjusted"). Before the ignore line: "like 15 min" is "ignore".
            if (!run.flow && !run.cutOff && run.late && options.lateFlow) {
                const key = run.sessionKey ?? "";
                const done = run.late.kind === "confirm" ? run.late.last : undefined;
                if (run.late.kind === "ask") {
                    run.flow = { outcome: "say", kind: "ask", text: LATE_ASK };
                    if (key)
                        lateAsk.set(key, Date.now());
                }
                else if (done?.changed)
                    run.flow = { outcome: "say", kind: "plain", text: `That's already done. ${done.reply}` };
                else {
                    const minutes = run.late.kind === "run" ? run.late.minutes : done?.minutes ?? 0;
                    const flow = await options.lateFlow(minutes).catch((e) => ({ outcome: "fallback", reason: String(e) }));
                    if (flow.outcome !== "fallback") {
                        run.flow = flow;
                        if (flow.outcome === "say" && flow.text === LATE_TOO_SMALL && key)
                            lateAsk.set(key, Date.now());
                        if ("calls" in flow && flow.calls)
                            flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: flow.outputs?.[i] ?? "", exit: null }));
                        if (key && "calls" in flow && flow.calls)
                            lastLate.set(key, { minutes, at: Date.now(), changed: flow.outcome === "done", reply: flow.outcome === "done" ? flow.reply ?? "" : "", asked: flow.outcome === "say" && /\?\s*$/.test(flow.text) });
                        if (flow.outcome === "done" && flow.marks?.length)
                            recordChange(run.sessionKey, flow.marks);
                    }
                }
            }
            if (!run.flow && run.settled.move === "ignore" && isNotForOrion(run.message, !!run.spoken))
                run.flow = { outcome: "say", kind: "plain", text: NOT_CAUGHT };
            // A focus session is one fixed command: code runs orion-session and the reply is built from
            // its output. Left to the worker, it said "I've started a focus session" three times and
            // called nothing (2026-10-15). Before the scheduler, which "focus block" would also match.
            // The front desk's own session start counts too, unless his words rule one out (q051, q054).
            // Merge of r2-routing-polish (front-desk session start counts) with r2-front-desk-tools (a timer is
            // timer_set whatever the front desk picked): a front-desk "session start" for "set a timer for 25 min"
            // started a focus session before the tool move ran, so the hint never applies to a timer request.
            const hint = isTimerRequest(run.message) ? {} : sessionHint(run.settled);
            if (!run.flow && startsSession(run.message, hint) && options.sessionFlow) {
                run.flow = await options.sessionFlow(run.message, hint).catch((e) => ({ outcome: "fallback", reason: String(e) }));
                if (run.flow.outcome === "done") {
                    recordOther(run.sessionKey, "focus");
                    const outputs = run.flow.outputs;
                    run.flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: outputs[i] ?? "", exit: null }));
                }
            }
            // His wake alarm is orion-wake, not a reminder: "push my alarm to 12" became alarm_set "push my alarm" and
            // the phone's alarm never moved (live, 2026-10-16). Before the reminder block, which would catch "alarm".
            if (!run.flow && !run.cutOff && options.wakeFlow) {
                const woke = await options.wakeFlow(run.message, run.settled).catch((e) => ({ outcome: "fallback", reason: String(e) }));
                if (woke.outcome !== "fallback") {
                    run.flow = woke;
                    if (woke.outcome === "done")
                        woke.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: woke.outputs[i] ?? "", exit: null }));
                }
            }
            // "how much focus time is left": code reads the session (q049 said "15 minutes remaining" from nothing).
            // 2026-10-16 r7: only a message that names the session (q015 "nap block" is the calendar), or "what am i supposed to be
            // working on" (q050); with no session running that one falls through to the day read below.
            const statusAsk = asksCurrentTask(run.message) || asksFocusOn(run.message) || (run.settled.move === "tool" && run.settled.tool === "session" && run.settled.args?.do === "status" && asksFocusStatus(run.message));
            const todayAsk = asksFocusToday(run.message);
            if (!run.flow && !run.cutOff && (statusAsk || todayAsk) && options.sessionStatus) {
                const status = await options.sessionStatus().catch((e) => ({ outcome: "fallback", reason: String(e) }));
                // r8 (2026-10-16) q053/q050/q052: the status read is recorded, and code says the whole reply.
                if (status.outcome === "say" && status.calls)
                    status.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: status.outputs?.[i] ?? "", exit: null }));
                if (status.outcome === "say" && status.calls) {
                    run.provided = true;
                    run.codeRead = true;
                    markRead(run, "focus-status");
                }
                const noSession = status.outcome === "say" && /^No focus session/.test(status.text);
                if (todayAsk && !statusAsk && status.outcome === "say" && (noSession || status.calls)) {
                    // q052: today's focused minutes from the history file plus a session still running (see focusTodayTotal).
                    const now = (options.now ?? (() => new Date()))();
                    const rows = (options.focusHistory ?? (() => readFocusHistory()))();
                    const total = focusTodayTotal(rows, localDayKey(now), liveFocusSeconds(status.outputs?.[0] ?? ""));
                    run.tools.push({ canonical: "read focus-history.jsonl (today)", stdout: JSON.stringify(total), exit: null });
                    markRead(run, "focus-today");
                    run.flow = /^I couldn't check/.test(status.text) ? status : { outcome: "say", kind: "plain", text: focusTodayReply(total) };
                }
                else if (asksCurrentTask(run.message) && noSession && options.readDay) {
                    // q050: no session, so code names the block he is in now, else the next one today (never the 9B's guess).
                    const day = await options.readDay(false).catch(() => "");
                    const now = (options.now ?? (() => new Date()))();
                    // An empty read is a failed read as often as an empty day: then only the session status is said (r8 integration).
                    if (day.trim()) {
                        run.tools.push({ canonical: "read day (code)", stdout: day, exit: null });
                        markRead(run, "day");
                    }
                    run.flow = { outcome: "say", kind: "plain", text: day.trim() ? noSessionReply(day, `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`) : "No focus session is running right now." };
                }
                else if (!todayAsk || statusAsk)
                    run.flow = status;
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
                const plan = await planReminder({ message: followUp ?? run.message, now: (options.now ?? (() => new Date()))(),
                    extract: (m) => (options.extractReminder ? options.extractReminder(m, clock()) : Promise.resolve(null)),
                    list: options.listReminders ?? (async () => []), ...(last && Date.now() - last.set < CORRECTION_WINDOW_MS ? { last } : {}) }).catch(() => undefined);
                if (plan?.kind === "say") {
                    run.flow = { outcome: "say", kind: "plain", text: plan.text };
                    if (plan.pending && key)
                        reminderAsk.set(key, { text: followUp ?? run.message, at: Date.now(), ...(plan.askLabel ? { label: true } : {}) });
                }
                if (plan?.kind === "call") {
                    run.reminder = { args: plan.args, say: plan.reply, action: plan.action, ...(plan.label && plan.at ? { label: plan.label, at: plan.at } : {}) };
                    return { systemPrompt: `${LOCAL_IDENTITY}\n\nDo this for Nick now with ${taskRunCall(plan.args)}\nThen, only if the result shows it worked, reply: "${plan.reply}" If it did not, say so plainly.\n\n${now}`,
                        appendContext: `[ORION: ${taskRunNow(plan.args)}]` };
                }
                // A reminder turn the plan could not work out gets a fixed reply, never the old free-form prompt (review, 2026-10-16).
                if (!plan && REMINDER.test(run.message) && isReminderTurn(run.message))
                    run.flow = { outcome: "say", kind: "plain", text: REMINDER_UNCLEAR };
            }
            // A fact to keep goes to his "Nick" note, a question about one searches first (live sweep 2026-10-15:
            // drafts said "I've noted that" and saved nothing, the allergy became an alarm, the creatine habit a
            // calendar block, the insurance date went to the repair queue, and "whats my allergy" got an offer to look).
            if (!run.flow && !run.cutOff && (keepsFact(run.message) || asksRecall(run.message))) {
                const fact = keepsFact(run.message);
                const fetched = fact || !run.brain ? "" : brainSnippets(await Promise.race([run.brain, new Promise((r) => setTimeout(() => r(""), 4000))]));
                // The snippets are what he is answered from: not a claimed lookup (review, 2026-10-16).
                if (fetched) {
                    run.provided = true;
                    markRead(run, "notes");
                }
                // q064 (2026-10-16): the search snippet is the top of the Nick note, so a fact learned seconds ago, at the
                // bottom, never reached the worker. Recall reads the note directly and hands over what he told ORION.
                const learned = fact ? [] : learnedLines((options.nickNote ?? readNickNote)());
                if (!fact)
                    run.recall = { learned };
                if (learned.length) {
                    run.provided = true;
                    markRead(run, "learned");
                }
                const told = learned.length ? `\n\nWhat he told you (saved in his "Nick" note; only these are "you told me"):\n${learned.map((l) => `- ${l}`).join("\n")}` : "";
                return { systemPrompt: `${BRAIN_INSTRUCTIONS}\n\n${PRODUCTION_NOTES}\n\n${fact ? FACT_NOTE : RECALL_NOTE}${told}${fetched ? `\n\nFrom his notes and documents, matched to this message (NOT things he said; q056 2026-10-16: never "you told me" for these, say "your notes say"):\n${fetched}` : ""}\n\n${now}`,
                    appendContext: fact ? FACT_NOW : RECALL_NOW };
            }
            // q042 (2026-10-16 r8): "mark the oats one done" became supplement_take "oats" and "Done."; ticking a to-do off
            // is code's call (todo-done-flow.ts), before any front-desk tool move.
            if (!run.flow && !run.cutOff && options.todoDoneFlow && parseTodoDone(run.message)) {
                const ticked = await options.todoDoneFlow(run.message).catch((e) => ({ outcome: "fallback", reason: String(e) }));
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
                    run.flow = { outcome: "say", kind: "plain", text: deadlineReply(run.message, read, (options.now ?? (() => new Date()))()) };
                }
            }
            const moved = !run.flow && !run.cutOff ? toolDirective(run.settled, run.message) : null;
            if (moved?.kind === "say")
                run.flow = { outcome: "say", kind: "plain", text: moved.text };
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
                if (cannot)
                    run.flow = { outcome: "say", kind: "plain", text: cannot };
                else {
                    // q066 / q069 (2026-10-16 r8): a plain read is run by code and the worker only summarizes it ("I'm reading
                    // your last three texts now." with no tool). A failure or an empty result is code's exact line.
                    const req = options.messagesRead ? parseMessagesRead(run.message) : null;
                    const read = req && options.messagesRead ? await options.messagesRead(req).catch(() => null) : null;
                    if (req && read) {
                        read.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: read.outputs[i] ?? "", exit: null }));
                        markRead(run, req.kind === "gmail" ? "gmail" : "messages");
                        if (read.say || !read.data)
                            run.flow = { outcome: "say", kind: "plain", text: read.say ?? "I couldn't read that.", calls: read.calls, outputs: read.outputs };
                        else {
                            run.provided = true;
                            run.codeRead = true;
                            return { systemPrompt: `${LOCAL_IDENTITY}\n\n${readNote(req, read.data)}\n\n${now}`, appendContext: "[ORION: the read already ran — summarize it from the system prompt, do not call tools.]" };
                        }
                    }
                }
                if (!run.flow && isMessagesJob(run.message))
                    return { systemPrompt: `${GENERAL_INSTRUCTIONS}\n\n${MESSAGES_NOTE}\n\n${LIVE_NOTE}\n\n${now}` };
            }
            // H1 (r8 review 3, 2026-10-16): his answer to the add flow's own question is the flow's, never the worker's
            // (an unanchored add on "yes" / "laundry" was the live 5:50 PM bug). A title or yes runs through the flow with
            // what it stored; no declines; anything else cleared the question in before_model_resolve.
            if (!run.flow && !run.cutOff && run.addAnswer) {
                const a = run.addAnswer;
                if (a.kind === "decline")
                    run.flow = { outcome: "say", kind: "plain", text: ADD_DECLINED };
                else if (a.kind === "reask")
                    run.flow = { outcome: "say", kind: "ask", text: a.pending.ask, pending: a.pending };
                else {
                    run.flow = options.scheduleFlow
                        ? await options.scheduleFlow(run.message, clock(), { pending: a.run, deadlineAt: flowDeadline(run.started) }).catch((e) => ({ outcome: "fallback", reason: String(e) }))
                        : { outcome: "fallback", reason: "no scheduling flow wired" };
                    if (run.flow.outcome === "fallback")
                        run.flow = { outcome: "say", kind: "plain", text: "I couldn't finish that add. Tell me what to put on your day and when." };
                    markRead(run, a.run.when === "tomorrow" ? "day-tomorrow" : "day");
                }
                settleSchedule(run);
            }
            // Calendar changes run as a fixed sequence (schedule-flow.ts): code reads the day, the worker
            // fills one form, code runs the exact command; the worker only phrases the result.
            // Any statement about his day goes through the flow (a plan like "after my lab I'm going to…"
            // has no change verb, 2026-10-12); a question or anything the form cannot express falls back.
            const openAsk = run.ask && answersAsk(run.message, run.ask) ? run.ask : undefined;
            if ((SCHEDULING.test(run.message) || RUNNING_LATE.test(run.message) || LOGGING.test(run.message) || openAsk) && !isQuestion(run.message) && !run.flow && !run.scheduleTried && isCalendarTurn(run.message, run.settled, !!openAsk)) {
                // No built-in default: only the plugin entry point wires the real scheduler in (a test that
                // forgot a stub wrote a block called "B4" to Nick's real calendar, 2026-10-12).
                // The flow reads the day itself (q019, q024: its "no such block" came from that read): the log says so.
                let flowRan = false;
                run.flow = options.scheduleFlow
                    ? await options.scheduleFlow(run.message, clock(), { undo: run.undo ?? [], deadlineAt: flowDeadline(run.started), ...(openAsk ? { askContext: openAsk } : {}) }).then((r) => { flowRan = true; return r; }, (e) => ({ outcome: "fallback", reason: String(e) }))
                    : { outcome: "fallback", reason: "no scheduling flow wired" };
                if (flowRan)
                    markRead(run, meansTomorrow(run.message) ? "day-tomorrow" : "day");
                settleSchedule(run);
            }
            // r8b2 (2026-10-16) q006: "and after that?" follows the last day answer: code answers it from the day read.
            const dayMem = run.sessionKey ? dayMemory.get(run.sessionKey) : undefined;
            if (!run.flow && !run.cutOff && options.readDay && dayMem && Date.now() - dayMem.at < DAY_MEMORY_MS && isAfterThat(run.message)) {
                const tomorrow = dayMem.memory.tomorrow; // review 5 H2: the day the last answer was about, not today by default
                const day = await options.readDay(tomorrow).catch(() => "");
                const after = day ? codeDayAnswer(run.message, day, tomorrow, nowMinutes(options.now), dayMem.memory) : null;
                if (after) {
                    run.provided = true;
                    markRead(run, tomorrow ? "day-tomorrow" : "day");
                    run.flow = { outcome: "say", kind: "plain", text: after.text };
                    dayMemory.set(run.sessionKey, { at: Date.now(), memory: after.memory });
                }
            }
            // A question about his day: code reads the day and hands it over (it said "I can't see your schedule").
            if ((SCHEDULING.test(run.message) || asksCurrentTask(run.message)) && isQuestion(run.message) && options.readDay && !run.flow) {
                const tomorrow = meansTomorrow(run.message);
                const day = await options.readDay(tomorrow).catch(() => "");
                if (day) {
                    run.provided = true;
                    markRead(run, tomorrow ? "day-tomorrow" : "day");
                }
                // q015 (2026-10-16 r8): a question that names a kind of block the day does not have ("my nap block") is answered by code.
                const absent = day ? noBlockReply(run.message, day, tomorrow) : null;
                // q009/q013/q006 (2026-10-16 r8b2): a named block that IS there, "next class": code says the times and the time left.
                const present = day && !absent ? codeDayAnswer(run.message, day, tomorrow, nowMinutes(options.now)) : null;
                if (absent)
                    run.flow = { outcome: "say", kind: "plain", text: absent };
                else if (present) {
                    run.flow = { outcome: "say", kind: "plain", text: present.text };
                    if (run.sessionKey)
                        dayMemory.set(run.sessionKey, { at: Date.now(), memory: present.memory });
                }
                else if (day)
                    return { systemPrompt: `${LOCAL_IDENTITY}\n\nAnswer his question from this list only, in one or two short spoken sentences with 12-hour times; "All day:" lines are events with no time, say them as all day. ${DAY_QUESTION_NOTE} Do not call any tools.\n\nHis day${tomorrow ? " tomorrow" : ""}, read just now from his calendar:\n${day}\n\n${now}` };
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
                const exact = exactFor(run);
                return { systemPrompt: `${EXACT_REPLY_PROMPT}\n${exact}`,
                    appendContext: `[ORION scheduler — nothing was changed. Your whole reply must be exactly: ${exact}]` };
            }
            // Only a plain answer is handed over as a draft. "ask" goes to the worker with the job's
            // instructions (the 4B asked for times it could have read, 2026-10-12), and a request to change
            // his day is always work, whatever the front desk thought.
            // A lookup (weather, sun times, his texts, his day) never gets a draft: nothing checks a draft's facts.
            const lookup = needsLiveData(run.message);
            const draft = withoutDayClaims(run.settled.answer ?? "");
            if (run.settled.move === "answer" && draft && !CHANGE_REQUEST.test(run.message) && !lookup) {
                // Even a pure answer's draft can invent his day ("you've been coding for hours", q082) and the 9B
                // read it out as "The front desk says…" (live sweep 2026-10-15). Round 2 (q079, q101): still named
                // "the front desk drafted…", and "otherwise answer him yourself" swapped a right draft for the model's
                // name. The draft is now his reply, with no source and no licence to rewrite it.
                return { systemPrompt: `${LOCAL_IDENTITY}\n\nSend the reply you drafted, exactly, as your whole reply: no tools, word for word. If it states something about Nick (what he has been doing, his day, his messages) or live facts (weather, sun times) that you were not told here, leave that out. Never mention the draft or the front desk.\n\nYou drafted this reply: "${draft}".\n\n${now}` };
            }
            const fetched = run.brain ? brainSnippets(await Promise.race([run.brain, new Promise((r) => setTimeout(() => r(""), 4000))])) : "";
            // Snippets answer questions about his notes, never live data: "I checked the weather" beside a weather
            // note is still made up (review, 2026-10-16).
            if (fetched && !LIVE_DATA.test(run.message) && !asksCurrentTask(run.message)) {
                run.provided = true;
                markRead(run, "notes");
            }
            const brainFetched = fetched ? `\n\nFrom his brain, matched to this message (may help):\n${fetched}` : "";
            const askNote = run.settled.move === "ask" && run.settled.answer
                // "The front desk mentioned they don't have it either" (q063, sweep 2026-10-15): no source named.
                ? `\n\nYou might need to ask: "${run.settled.answer}". Ask only if no tool can tell you; otherwise do the job.` : "";
            const ignoreNote = run.settled.move === "ignore" ? `\n\n${IGNORE_NOTE}` : "";
            // H6 (r8b2, 2026-10-16): the worker's user message is only the rest of a cut-off request ("…cut off, this is the rest"); give it the whole.
            const joinedNote = run.stitched ? `[ORION: his request came in two parts. The whole request, joined: "${run.message.slice(0, 600)}". Answer that, not only the last part.]` : undefined;
            return { systemPrompt: `${instructionsFor(run.settled, run.message)}\n\n${PRODUCTION_NOTES}\n\n${LOOK_IT_UP}${lookup ? `\n\n${LIVE_NOTE}` : ""}${ignoreNote}${brainFetched}${askNote}\n\n${now}`, ...(joinedNote ? { appendContext: joinedNote } : {}) };
        }), { timeoutMs: HOOK_TIMEOUT_MS });
    }
    // The text that must reach Nick for a run (the scheduler's own reply, or an honest stop), applied at
    // delivery: the 9B paraphrased it from session history ("Done: grind leetcode 6:15…" after a clear).
    const finalText = new Map();
    const remember = (keys, text) => { for (const k of keys)
        if (k)
            finalText.set(k, { text, at: Date.now() }); };
    if (on)
        api.on("reply_payload_sending", (event) => {
            const keys = [str(event.runId) ?? "", `session:${str(event.sessionKey) ?? ""}`];
            const hit = keys.map((k) => finalText.get(k)).find((v) => v && Date.now() - v.at < 120000);
            if (!hit) {
                // The host's raw "Exec failed" line is never spoken (q059, 2026-10-16).
                const raw = str((event.payload ?? {}).text);
                return raw && stripExecFailed(raw) !== raw ? { payload: { ...event.payload, text: stripExecFailed(raw) }, reason: "orion-control: no raw exec failure" } : undefined;
            }
            keys.forEach((k) => finalText.delete(k));
            const payload = (event.payload ?? {});
            return { payload: { ...payload, text: hit.text }, reason: "orion-control: the scheduler's own reply" };
        });
    // Second guard (2026-10-16 re-run, q092): whatever the model decides, `orion-reschedule undo` does not run in
    // a session that has changed nothing: it would revert a change from an earlier day. OpenClaw's
    // before_tool_call can block one call with its own reason (the same hook exec-routing.ts uses).
    if (on)
        api.on("before_tool_call", (event, ctx) => {
            if (pick(event, ctx, "toolName") !== "exec")
                return undefined;
            const command = str(event.params?.command) ?? "";
            if (!UNDO_COMMAND.test(command))
                return undefined;
            const sessionKey = pick(event, ctx, "sessionKey") ?? runFor(event, ctx)?.sessionKey ?? "";
            if (INTERNAL.test(sessionKey) || changedRecently(sessionKey))
                return undefined;
            return { block: true, blockReason: "Orion undo guard: this chat has not changed his calendar, so there is nothing of THIS conversation to undo, and `orion-reschedule undo` would reverse a change from an earlier day. Do not run it. Ask Nick what he wants cancelled." };
        });
    // 2026-10-16 (tool wiring): the worker's orion_task_run call for the directive's action carries the code-built
    // arguments, whatever it wrote (r02: routing said 21:00, the worker's call said 09:00). Rewritten, or blocked
    // with the exact arguments restated.
    if (on)
        api.on("before_tool_call", (event, ctx) => {
            const run = runFor(event, ctx);
            const toolName = pick(event, ctx, "toolName");
            const expected = run?.directive ?? run?.reminder;
            if (!run || !toolName || !expected || !expected.action)
                return undefined;
            return guardTaskRun(toolName, event.params, { action: expected.action, args: expected.args });
        });
    // Live run 3 (2026-10-21) backstop: the worker's own scheduler write must start at a time Nick said (time-backstop.ts), or it does not run.
    if (on)
        api.on("before_tool_call", (event, ctx) => {
            if (pick(event, ctx, "toolName") !== "exec")
                return undefined;
            const run = runFor(event, ctx);
            const writes = writesIn(str(event.params?.command) ?? "");
            if (!run || !writes.length)
                return undefined;
            const now = (options.now ?? (() => new Date()))();
            const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            const off = writes.map((args) => {
                const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined;
                const other = !!date && date !== "today" && date !== iso;
                return timeMismatch(run.message, [args], { day: other ? "tomorrow" : "today", now: other ? null : now.getHours() * 60 + now.getMinutes() });
            }).find(Boolean);
            return off ? { block: true, blockReason: `Orion time check: ${off} Do not run another command; tell Nick exactly this.` } : undefined;
        });
    // 2026-10-19 backstop: the worker reached for `orion-reschedule <write>` by name (the tool guard refuses it). The run remembers it, so
    // the reply is never "I can't" / "I need you to confirm" after he already asked: see heldChange in before_agent_finalize.
    if (on)
        api.on("before_tool_call", (event, ctx) => {
            if (pick(event, ctx, "toolName") !== "exec")
                return undefined;
            const command = (str(event.params?.command) ?? "").trim();
            const run = runFor(event, ctx);
            if (run && /^orion-reschedule\s+(?!show\b|undo\b)[a-z]/.test(command))
                run.refusedWrite = command;
            return undefined;
        });
    api.on("after_tool_call", (event, ctx) => {
        const run = runFor(event, ctx);
        const toolName = pick(event, ctx, "toolName");
        if (!run || !toolName)
            return;
        if (toolName === "exec" && run.sessionKey) {
            const command = str(event.params?.command) ?? "";
            if (RESCHEDULE_WRITE.test(command) && !NOTHING_CHANGED.test(resultText(event.result ?? event.output)))
                recordChange(run.sessionKey, []);
            if (UNDO_COMMAND.test(command))
                forgetReplan(run.sessionKey); // an undo ends the last reschedule request
        }
        run.hostTools = (run.hostTools ?? 0) + 1;
        run.tools.push({ canonical: canonicalCall(toolName, event.params), stdout: resultText(event.result ?? event.output), exit: null });
        const made = run.tools[run.tools.length - 1];
        const action = run.directive?.action;
        if ((action === "timer_set" || action === "supplement_take") && madeTaskRunCall(made, action) && outcomeOf(made) === "success")
            recordOther(run.sessionKey, action === "timer_set" ? "timer" : "supplement");
    });
    api.on("before_agent_finalize", async (event, ctx) => {
        const runId = pick(event, ctx, "runId") ?? "";
        const run = runFor(event, ctx);
        traceLine("before_agent_finalize", event, ctx, { found: !!run });
        if (!run)
            return undefined;
        const done = () => { runs.delete(runId); runs.delete(`session:${pick(event, ctx, "sessionKey") ?? ""}`); };
        // What this run must deliver: kept for reply_payload_sending (channel routes) and put in place for the agent CLI.
        let owed;
        // OpenClaw ignores a "revise" once any tool has run in the turn and sends the original reply (live sweep
        // 2026-10-15, 16 items: q003 q030 q102 ...). Then the honest line must go in place now, not via a retry.
        const hostDrops = event.hadDeterministicSideEffect === true;
        try {
            const reply = str(event.lastAssistantMessage) ?? "";
            const allFindings = checkWork({ reply, turnResults: run.tools, finished: reply.trim().length > 0, changeRequest: CHANGE_REQUEST.test(run.message) && !/\?\s*$/.test(run.message.trim()) && run.flow?.outcome !== "say", dictated: run.flow?.outcome === "done" || run.flow?.outcome === "say" || run.noTools === true, provided: run.provided ?? false });
            // H4 (r8 review 1, 2026-10-16): when only CODE read (gmail/messages/deadlines/focus) and handed the worker the data, a summary
            // that says "found/confirmed/booked" is the data talking, not a claimed write: no done-claim finding, no replaced reply.
            const codeReadOnly = !run.hostTools && run.provided === true && run.codeRead === true;
            const findings = codeReadOnly ? allFindings.filter((f) => !FALSE_CLAIM.test(f)) : allFindings;
            run.findings.push(findings);
            // A revise returns before the end of this hook; it is logged first so no turn goes unrecorded (those 16 had routing null).
            const record = async (extra = {}) => {
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
                if (called && run.reminder.label && run.reminder.at && run.sessionKey)
                    lastReminder.set(run.sessionKey, { label: run.reminder.label, at: run.reminder.at, set: Date.now() });
                if (!called && run.passes < 2 && !hostDrops) {
                    run.passes += 1;
                    await record({ revised: true });
                    return { action: "revise", reason: "the reminder was not set", retry: { instruction: `You have NOT set the reminder yet — no tool was called. Call the tool_call tool now with id "openclaw:orion-control:orion_task_run" and args exactly ${run.reminder.args}, then reply.`, idempotencyKey: `${runId}:reminder:${run.passes}`, maxAttempts: 1 } };
                }
                if (!called) {
                    owed = action === "reminder_cancel" ? "I didn't manage to cancel that reminder — nothing was changed. Can you say it again?" : "I didn't manage to set that reminder — nothing was set. Can you say it again?";
                    remember([runId, sessionKeyNow], owed);
                }
            }
            // 2026-10-19 backstop: the worker was refused `orion-reschedule <write>` and no flow acted. Its reply is never "I can't" or "I need you to
            // confirm" (he had confirmed): the sentence the guard asked it to write is read by the schedule flow (all its guards), else an honest line.
            if (on && run.refusedWrite && (!run.flow || run.flow.outcome === "fallback") && !run.cutOff
                && (CHANGE_REQUEST.test(run.message) || (!!run.ask?.suggest && isYes(run.message.replace(/[.!?…]+$/, ""))))) {
                run.flow = await heldChange(run, reply);
                settleSchedule(run);
                run.passes = Math.max(run.passes, 1); // code says it now: no revise round
                markRead(run, "day");
            }
            if (on && (run.flow?.outcome === "done" || run.flow?.outcome === "say")) {
                const expected = exactFor(run);
                owed = expected;
                remember([runId, sessionKeyNow], expected);
                const squash = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
                if (!squash(reply).includes(squash(expected).slice(0, 60)) && run.passes < 1 && !hostDrops) {
                    run.passes += 1;
                    await record({ revised: true });
                    return { action: "revise", reason: "reply must be the scheduler's", retry: { instruction: `Ignore the earlier conversation. Your whole reply must be exactly this text, nothing before or after, no tools: ${expected}`, idempotencyKey: `${runId}:exact-reply`, maxAttempts: 1 } };
                }
            }
            if (on && run.directive && run.passes < 2 && !directiveCalled(run) && !hostDrops) {
                run.passes += 1;
                await record({ revised: true });
                return { action: "revise", reason: "the tool move was not carried out", retry: { instruction: `You have NOT done it yet — no tool was called. Call the tool_call tool now with id "openclaw:orion-control:orion_task_run" and args exactly ${run.directive.args}, then reply from its result.`, idempotencyKey: `${runId}:tool-move:${run.passes}`, maxAttempts: 1 } };
            }
            // 2026-10-20 re-run: a line code wrote (flow "say") is final, like a change code made. The claims check read "…and I'll put it in" in code's own
            // "Piano practice isn't on your day" as a false claim and swapped it for the generic "didn't manage" line.
            // A worker that still ran tools under a code "say" is checked as before.
            const flowActed = run.flow?.outcome === "done" || (run.flow?.outcome === "say" && !(run.hostTools ?? 0));
            // q029 (2026-10-16 r8): a revise is ignored once a tool ran (the 9B's exec of `late 15` printed NOTHING WAS BOOKED and
            // "Your schedule has been adjusted" went out, though the check had found it). With a tool already run, the honest
            // line goes in place NOW, from the scheduler's own words when it says nothing was booked/changed.
            const honestNow = on && !flowActed && !run.reminder && ((run.hostTools ?? 0) > 0 || hostDrops) && findings.some((f) => FALSE_CLAIM.test(f))
                ? nothingMovedReply(run.tools.filter((t) => /orion-reschedule/.test(t.canonical)).slice(-1).map((t) => t.stdout), /\b(late|move|push)\b/.test(run.tools.filter((t) => /orion-reschedule/.test(t.canonical)).at(-1)?.canonical ?? "") ? "I couldn't move anything, so nothing was moved" : "I couldn't make that change, so nothing on your calendar was changed")
                    ?? honestLine(SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical)))
                : undefined;
            if (honestNow) {
                owed = honestNow;
                remember([runId, sessionKeyNow], honestNow);
            }
            if (on && findings.length > 0 && run.passes < 2 && !flowActed && !hostDrops && !honestNow) {
                run.passes += 1;
                await record({ revised: true });
                const calendar = SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical));
                const claimed = findings.some((f) => FALSE_CLAIM.test(f));
                const lookedUp = !claimed && findings.some((f) => LOOKUP_CLAIM.test(f));
                // "Undo" only after this turn wrote something: told to undo with nothing to undo, the 9B could take
                // back an earlier turn's change from the journal (review, 2026-10-16).
                const stop = wroteThisTurn(run.tools) ? HONEST_STOP : HONEST_STOP_NO_WRITE;
                const instruction = run.passes === 1 ? retryInstruction(findings)
                    : claimed ? `${stop}\nIgnore the earlier conversation. Your whole reply must be exactly this text, nothing before or after: ${honestLine(calendar)}`
                        : lookedUp ? `${stop}\nIgnore the earlier conversation. Your whole reply must be exactly this text, nothing before or after: ${LOOKUP_HONEST}`
                            : stop;
                return { action: "revise", reason: `work check: ${findings.join(", ")}`, retry: { instruction, idempotencyKey: `${runId}:work-check:${run.passes}`, maxAttempts: 1 } };
            }
            // Out of retries and still claiming something the tools don't show: deliver an honest line instead.
            if (on && !flowActed && !run.reminder && !honestNow && findings.some((f) => FALSE_CLAIM.test(f))) {
                owed = honestLine(SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical)));
                remember([runId, sessionKeyNow], owed);
            }
            else if (on && !flowActed && !run.reminder && findings.some((f) => LOOKUP_CLAIM.test(f))) {
                // "I checked the weather… no rain" with no lookup, after both retries (review, 2026-10-16).
                owed = LOOKUP_HONEST;
                remember([runId, sessionKeyNow], owed);
            }
            else if (on && !flowActed && !run.reminder && findings.some((f) => f === "denies messages it shows")) {
                // q065 (2026-10-16): still "no one texted you" beside his messages after both retries.
                owed = MESSAGES_UNSURE;
                remember([runId, sessionKeyNow], owed);
            }
            // Out of retries and the call was never made: say so (not "I checked the weather…", q007).
            // Merge of r2-front-desk-tools (tool-move fail line) with 9a3a25a (LOOKUP_HONEST): a missed tool move whose
            // reply also claimed a lookup ("I checked the weather…", q007) owes both — that nothing was checked, and why.
            // Another tool succeeded this turn ("took my creatine" logged by exec orion-log): the worker's reply stands
            // (it went through the work check above), not the fail line (review, 2026-10-16).
            if (on && run.directive && !directiveCalled(run) && !anotherToolSucceeded(run.tools, run.directive.action)) {
                const claimedLookup = findings.some((f) => LOOKUP_CLAIM.test(f));
                owed = claimedLookup ? `${LOOKUP_UNCHECKED} ${run.directive.failLine}` : run.directive.failLine;
                remember([runId, sessionKeyNow], owed);
            }
            // Recall (2026-10-16): a refused search never reaches him as "Exec failed" or a guess (q059), and a document's
            // words are not "you told me" (q056).
            if (on && run.recall && !owed) {
                if (searchRefused(run.tools.map((t) => t.stdout)) && !run.recall.learned.length)
                    owed = SEARCH_UNAVAILABLE;
                else {
                    const clean = reframeDocumentRecall(stripExecFailed(reply), run.message, run.recall.learned);
                    if (clean && clean !== reply)
                        owed = clean;
                }
                if (owed)
                    remember([runId, sessionKeyNow], owed);
            }
            // H4 (r8b2, 2026-10-16) q069/q070: raw CLI text (URLs, "Exec failed", script paths, tool banners) never reaches him; only
            // here can it be fixed on the Mac chat / phone route (reply_payload_sending never runs there).
            if (on && !owed && reply.trim()) {
                const clean = sanitizeReply(reply, { mailFailed: mailReadFailed(run.tools) });
                if (clean !== reply) {
                    owed = clean;
                    remember([runId, sessionKeyNow], owed);
                }
            }
            if (on && owed)
                putReplyInPlace(event.messages, owed);
            await record();
            done();
        }
        catch (error) {
            api.logger?.warn?.(`[orion-control] local routing finalize failed: ${error instanceof Error ? error.message : String(error)}`);
            done();
        }
        return undefined;
    });
    // 2026-10-20: a turn that ends in an error, an abort or a host timeout never reaches before_agent_finalize, so it left no row at all (the
    // front desk's failure was only written when the turn ended). A run still open at agent_end is logged here, with how it ended.
    api.on("agent_end", (event, ctx) => {
        const run = runFor(event, ctx);
        if (!run)
            return undefined;
        const runId = pick(event, ctx, "runId") ?? "";
        const flow = run.flow;
        log({ stage: "agent_end", runId, message: run.message, decision: run.settled ?? { move: "escalate", fallback: "unsettled" },
            flow: flow ? { outcome: flow.outcome, ..."reason" in flow ? { reason: flow.reason } : {} } : null, success: event.success !== false, error: str(event.error) ?? null,
            tools: run.tools.length, cloud: run.cloud ?? false, turnMs: typeof event.durationMs === "number" ? event.durationMs : Date.now() - run.started });
        runs.delete(runId);
        runs.delete(`session:${pick(event, ctx, "sessionKey") ?? run.sessionKey ?? ""}`);
        return undefined;
    });
}
