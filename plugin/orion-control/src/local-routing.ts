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
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { decide, keepWarm, FRONT_DESK_CTX, type Decision } from "./front-desk.js";
import { FRONT_DESK_MODEL } from "./front-desk-prompt.js";
import { BRAIN_INSTRUCTIONS, GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS, WORKER_MODEL } from "./job-instructions.js";
import { checkWork, retryInstruction, type ToolResult } from "./work-check.js";
import { isSessionStart } from "./session-flow.js";
import { CRISIS_REPLY, OVERWHELMED_NOTE, isCrisis, isOverwhelmed } from "./distress.js";
import { FORM_OPTIONS, RESCHEDULE, TOMORROW, LATE_NIGHT_UNTIL, meansTomorrow, blockList, runScheduleFlow, spokenReply, type FlowResult } from "./schedule-flow.js";

export type LocalRoutingMode = "off" | "shadow" | "on";
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type HookApi = { on: (name: string, fn: Handler) => unknown; logger?: { warn?: (m: string) => void } };

export type LocalRoutingOptions = {
  mode: LocalRoutingMode;
  logPath: string;
  decideImpl?: (input: { message: string; clock: string }) => Promise<Decision>;
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
  scheduleFlow?: (message: string, clock: string, opts?: { undo?: string[] }) => Promise<FlowResult>;
  /** Starts a focus session from his words (tests pass a stub; wired from index.ts). */
  sessionFlow?: (message: string) => Promise<FlowResult>;
  /** Pulls {time "HH:MM", label} out of a reminder request (tests pass a stub; wired from index.ts). */
  extractReminder?: (message: string) => Promise<{ time: string; label: string } | null>;
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

type Run = {
  message: string;
  decision: Promise<Decision | { error: string }>;
  settled?: Decision;
  tools: ToolResult[];
  started: number;
  passes: number;
  findings: string[][];
  cloud?: boolean;
  /** A reminder the worker must set: the exact orion_task_run arguments and what to tell him. */
  reminder?: { args: string; say: string };
  brain?: Promise<string>;
  flow?: FlowResult;
  sessionKey?: string;
  /** Spoken and trailing off mid-sentence: nothing is done until the rest arrives. */
  cutOff?: boolean;
  /** Changes the cut-off first half of this request made, to take back before acting on the whole. */
  undo?: string[];
};

const INTERNAL = /\b(?:cron|heartbeat|doctor|test|subagent|eval)\b/i;
// One spoken request can arrive as two turns: the app sends what it heard when he pauses, and the rest
// with this marker (native AppState.send). 2026-10-15: the first half ("…so if you can go ahead and")
// changed his day on its own, and the second half was read without the first.
const CONTINUING = /^\(Continuing — my last message was cut off[^)]*\)\s*/;
const SPOKEN = /Nick SAID this out loud/;
// A spoken message that ends on a word a sentence cannot end on ("…go ahead and", "…move the").
const TRAILS_OFF = /\b(and|or|but|so|because|cause|then|if|to|the|a|an|my|your|with|of|from|um|uh)\s*[,–—-]*\s*$/i;
export const GO_ON = "Go on.";
const STITCH_WINDOW_MS = 3 * 60_000;
const MARKERS = ["--- Nick's message follows ---", "User message:\n"];
// Word STEMS, not whole words: "studying", "shorter", "ditch", "nuke", "stick" missed the flow and the old
// loop answered "Done" for changes it never made (live gauntlet, 2026-10-12).
const SCHEDULING = /\b(schedul|reschedul|plan|calendar|day\b|today|tonight|tomorrow|morning|afternoon|evening|block|move|push|pull|swap|resiz|extend|shorten|shorter|longer|clear|drop|ditch|nuke|scrap|cancel|skip|free|fit|stick|put|add|slot|book|class|lab\b|lectur|seminar|stud|revis|gym|nap|dinner|lunch|breakfast|meeting|appointment|undo|commute|after my|before my|between|out from|leaving at|leetcode|deck|presentation)\w*|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;
const REMINDER = /\b(remind me|reminder|set an? alarm|alarm (for|at)|wake me|ping me|nudge me|don'?t let me forget)\b/i;
// "schedule me for…", "move X", "put X between…", "change of plans": work, never a drafted reply.
const CHANGE_REQUEST = /\b(schedul\w*|reschedul\w*|move|put|add|book|fit|clear|cancel|push|pull|swap|replace|rebuild|redo|plan (my|the)|change of plans|shorten|extend|resize|drop|skip)\b/i;
// Live data the front desk cannot know: its "answer" drafts made these up and went out unchecked
// ("Sunset is at 6:42 PM today.", "it's still warm outside", "I haven't seen any new messages"; live sweep
// 2026-10-15). A message about these is a lookup: the worker gets the job's tools and no draft.
const LIVE_DATA = /\b(weather|forecast|rain\w*|snow\w*|sunny|temperature|degrees|(cold|warm|hot|dark) (out|outside)|jacket|coat|umbrella|sunset|sunrise|sun (sets?|rises?|goes down|comes up)|texts?|texted|messages?|messaged|emails?|emailed|inbox|missed calls?|voicemails?)\b|\bmy (calendar|day|schedule|agenda|session|supplements?|to-?dos?|tasks|reminders|alarms?)\b/i;
const LIVE_NOTE = "This needs live data (weather, sun times, his messages, his day). Answer only from what a tool returns just now; if none of your tools can get it, say \"I can't check that right now.\" Never guess it.";
// 2026-10-15 sweep: SCHEDULING alone ran the calendar flow, whatever the front desk decided. "text myself
// bring the charger to lab" booked "bring the charger" at 11:45 PM, "add a todo to email prof…" ran add … 0,
// "focus mode on for an hour" added a "focus mode" block, "i take creatine every morning at 8" added creatine,
// and "cancel that" / "make it longer" (no history reaches the form) dropped and resized "finish resume".
const CALENDAR_TOOLS = new Set(["reschedule", "agenda"]);
// A message to send or something to capture, not a block: "text myself…", "email prof…", "add a todo…".
const SEND_OR_CAPTURE = /^(?:(?:hey|ok(?:ay)?|so|please|pls|orion|can you|could you|would you)[,\s]+)*(?:text|message|imessage|email|send|remind|note|jot)\b|\bto-?dos?\b|\bto do list\b/i;
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
/** Whether this turn is a change to his calendar at all, whatever words it shares with one. */
export function isCalendarTurn(message: string, settled: Decision): boolean {
  if (settled.move === "tool" && !CALENDAR_TOOLS.has(settled.tool ?? "")) return false;
  if (SEND_OR_CAPTURE.test(message) || BOOK_ELSEWHERE.test(message)) return false;
  if (HABIT.test(message) && !CHANGE_REQUEST.test(message)) return false;
  if (settled.move === "ask" && NAMES_NOTHING(message)) return false;
  return true;
}
const BRAIN = /\b(remember|note|notes|brain|wrote|write down|repair (queue|list)|bug|save (that|this|it))\b/i;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const pick = (event: Record<string, unknown>, ctx: Record<string, unknown>, key: string) => str(event[key]) ?? str(ctx[key]);

/** Nick's own words: the part after a channel brief, if the message carries one. */
export function userText(prompt: string): string {
  for (const marker of MARKERS) if (prompt.includes(marker)) return prompt.split(marker).pop()!.trim();
  return prompt.trim();
}

/** "Sat 18:05" in local time, the clock format the front desk was evaluated with. */
export function localClock(now = new Date()): string {
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
  if (["agenda", "reschedule", "tasks"].includes(decision?.tool ?? "") || SCHEDULING.test(message)) return SCHEDULING_INSTRUCTIONS;
  return GENERAL_INSTRUCTIONS;
}

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
const defaultBrainSearch = (query: string): Promise<string> => new Promise((resolve) => {
  execFile(ORION_BRAIN, ["search", query.slice(0, 200)], { timeout: 8000, maxBuffer: 1 << 20 }, (_e, stdout) => resolve(String(stdout ?? "")));
});

// 2026-10-15 sweep: only a trailing "?" made a question, so "whats on tomorrow morning" and "uh whats next
// on my schedule" went to the change flow ("a question, not a change") and the worker, with no rule for
// it, read 1:30 PM and 3:30 PM out as "morning" (q014). A message that opens with a question word (after
// a filler) is a question too, unless it also asks for a change ("my schedule" is a noun, not a verb).
// "do"/"does" only before a pronoun ("do my laundry at 6" is a plan); "how about" / "what if" suggest.
const QUESTION_OPENER = /^(?:(?:uh+|um+|so|ok(?:ay)?|hey|orion|and|but|wait)[,\s]+)*(?:(?!how about|what if)(?:what|whats|what's|when|whens|when's|how|is|are|which|who)|do(?:es)?\s+(?:i|we|my|he|she|they))\b/i;
export const isQuestion = (message: string): boolean =>
  /\?\s*$/.test(message.trim()) || (QUESTION_OPENER.test(message.trim()) && !CHANGE_REQUEST.test(message.replace(/\b(my|the|his|your) schedule\b/gi, "")));
// The day read has no window rule of its own: "tomorrow morning" listed afternoon classes (q014).
const DAY_QUESTION_NOTE = "Morning means before 12:00, afternoon 12:00 to 17:00, evening after 17:00: list only what falls in the window he names. \"Next\" means the first block that has not already happened. For \"how long until\", count from Now. If nothing in the list matches, say so and name what is there.";

/** His day as a numbered list, read from the scheduler (wired in by index.ts). */
export const liveReadDay = (tomorrow: boolean): Promise<string> => new Promise((resolve) => execFile(RESCHEDULE, ["show", "--json", ...(tomorrow ? ["--date", "tomorrow"] : [])], { timeout: 30000 }, (_e, stdout) => {
  try { resolve(blockList(JSON.parse(String(stdout)))); } catch { resolve(""); }
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
export const liveScheduleFlow = (message: string, clock: string, opts: { undo?: string[] } = {}): Promise<FlowResult> => runScheduleFlow({
  message, clock, undo: opts.undo ?? [], undoTop: () => undoJournalTop(),
  exec: (args) => new Promise((resolve) => execFile(RESCHEDULE, args, { timeout: 60000, maxBuffer: 1 << 20 }, (e, stdout, stderr) =>
    resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? 1 : 0 }))),
  ask: async (system, user, schema) => {
    try {
      const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: WORKER_MODEL, stream: false, think: false, format: schema, options: FORM_OPTIONS, keep_alive: "24h",
          messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: AbortSignal.timeout(30000) });
      const body = (await res.json()) as { message?: { content?: string } };
      return JSON.parse(body.message?.content ?? "");
    } catch { return null; }
  },
});

/** What Nick must hear after the scheduling flow: the scheduler's own lines, or its "can't"/question. */
function exactReply(flow: FlowResult): string {
  if (flow.outcome === "done") return flow.reply ?? spokenReply(flow.outputs);
  if (flow.outcome === "say") return flow.kind === "ask" || flow.kind === "plain" ? flow.text : `That doesn't fit: ${flow.text.replace(/^(that|it) (can't|cannot) be done[:,]?\s*/i, "")}`;
  return "";
}

const ampm12 = (t: string): string => { const [h, m] = t.split(":").map(Number); return `${((h ?? 0) + 11) % 12 + 1}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };

/** The real reminder extraction (worker via Ollama, form-constrained). Wired in by index.ts only. */
export const liveExtractReminder = async (message: string): Promise<{ time: string; label: string } | null> => {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model: WORKER_MODEL, stream: false, think: false, options: FORM_OPTIONS, keep_alive: "24h",
        format: { type: "object", properties: { time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }, label: { type: "string", maxLength: 100 } }, required: ["time", "label"] },
        messages: [{ role: "system", content: "From Nick's message, give the time of day for his reminder (24-hour HH:MM; \"around 11\" or \"11 am\" = 11:00, \"5ish\" in the afternoon = 17:00) and a short label of what it is for, in his words. JSON only: {\"time\":\"HH:MM\",\"label\":\"…\"}" }, { role: "user", content: message }] }) });
    const out = JSON.parse(((await res.json()) as { message?: { content?: string } }).message?.content ?? "");
    return /^\d{2}:\d{2}$/.test(out.time) && out.label ? out : null;
  } catch { return null; }
};

const LOCAL_IDENTITY = "You are ORION, Nick's personal assistant on his Mac and iPhone. Reply in one to three short sentences, the way you would say it out loud: no lists, no markdown, times like 8:15 PM. Never say something happened unless a tool result shows it did.";

/** "Today is Sunday 2026-10-11; tomorrow is Monday 2026-10-12." — so --date never needs arithmetic. */
export function dateLine(now = new Date()): string {
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
export const honestLine = (calendar: boolean): string => calendar
  ? "I didn't manage to make that change — nothing on your calendar changed. Can you say it again?"
  : "I didn't actually do that — nothing was started or changed. Can you say it again?";
const FALSE_CLAIM = /claims what the tools|promised but did not act/;

/** Puts the text that must reach Nick into the turn's last assistant message (the one the host builds the
 *  reply from). Sweep 2026-10-15 (q006, q042, q055, q057, q067, q091): on `openclaw agent --json` —
 *  the Mac chat and phone — reply_payload_sending never runs, before_agent_finalize can only revise, and
 *  before_message_write rewrites only the transcript copy, written before the check runs; the reply is
 *  read afterwards from this same message object, so it is changed in place (the one deliberate
 *  mutation here: the host owns the object). "buy more oats has been marked as done" went out after
 *  three flagged passes. Thinking and tool blocks are kept; the text blocks become this one. */
export function putReplyInPlace(messages: unknown, text: string): boolean {
  const last = Array.isArray(messages) ? [...messages].reverse().find((m) => (m as { role?: unknown })?.role === "assistant") as { content?: unknown } | undefined : undefined;
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

export function registerLocalRouting(api: HookApi, options: LocalRoutingOptions): void {
  if (options.mode === "off") return;
  let on = options.mode === "on";
  // A deliberate, time-boxed test window (Nick testing local models himself): at most 48 h ahead.
  const testing = options.testingUntil ? Date.parse(options.testingUntil) : NaN;
  const testingActive = Number.isFinite(testing) && testing > Date.now() && testing - Date.now() <= 48 * 3600000;
  // Checked again on every turn below: a window that ended mid-session must not keep "on" running.
  const windowOpen = () => !Number.isFinite(testing) || Date.now() < testing;
  if (on && testingActive) api.logger?.warn?.(`[orion-control] localRouting "on" under a TESTING WINDOW until ${options.testingUntil} — acceptance not required`);
  if (on && !testingActive && options.acceptancePath !== undefined) {
    const verdict = acceptanceVerdict(options.acceptancePath);
    if (!verdict.ok) {
      api.logger?.warn?.(`[orion-control] localRouting "on" REFUSED — ${verdict.why}. Running shadow: the configured model answers.`);
      on = false;
      options = { ...options, mode: "shadow" };
    }
  }
  const { logPath, decideImpl = (input) => decide(input), clock = () => localClock(), finalizeWaitMs = 5000, workerProvider = "ollama", workerModel = WORKER_MODEL } = options;
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
  const runs = new Map<string, Run>();
  /** Per session: his last message (stitched) and the scheduler changes it made. */
  const lastTurn = new Map<string, { text: string; at: number; marks: string[] }>();
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

  api.on("before_model_resolve", async (event, ctx) => {
    const runId = pick(event, ctx, "runId");
    const sessionKey = pick(event, ctx, "sessionKey") ?? "";
    const raw = str(event.prompt);
    traceLine("before_model_resolve", event, ctx, { hasPrompt: !!raw });
    if (!raw || INTERNAL.test(sessionKey)) return undefined;
    // The rest of a cut-off spoken request is read together with its first half, as one request.
    const said = userText(raw);
    const before = sessionKey ? lastTurn.get(sessionKey) : undefined;
    const stitch = CONTINUING.test(said) && before && Date.now() - before.at < STITCH_WINDOW_MS ? before : undefined;
    const message = stitch ? `${stitch.text} ${said.replace(CONTINUING, "")}` : said;
    const cutOff = SPOKEN.test(raw) && TRAILS_OFF.test(message);
    if (sessionKey) lastTurn.set(sessionKey, { text: message, at: Date.now(), marks: [] });
    const decision = cutOff
      ? Promise.resolve<Decision>({ move: "ask", answer: GO_ON })
      : Promise.resolve()
        .then(() => decideImpl({ message, clock: clock() }))
        .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
    const run: Run = { message, decision, tools: [], started: Date.now(), passes: 0, findings: [], sessionKey, cutOff, undo: stitch?.marks ?? [],
      ...(on && !cutOff ? { brain: (options.brainSearch ?? defaultBrainSearch)(message).catch(() => "") } : {}) };
    if (runId) runs.set(runId, run);
    if (sessionKey) runs.set(`session:${sessionKey}`, run);
    if (!on) return undefined; // shadow: fire and forget
    if (options.testingUntil && !windowOpen()) return undefined; // the testing window closed: back to shadow
    const d = await decision;
    // A front-desk failure must not switch the flow off (it did once: "scrap the gym tmrw").
    if ("error" in d) { run.settled = { move: "escalate", fallback: d.error }; return { providerOverride: workerProvider, modelOverride: workerModel }; }
    run.settled = d;
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
      if (run && isCrisis(run.message)) return { handled: true, reply: { text: CRISIS_REPLY }, reason: "distress: fixed safety reply" };
      if (run && isOverwhelmed(run.message)) return undefined;
      if (d?.move === "answer" && d.answer && !CHANGE_REQUEST.test(run?.message ?? "") && !LIVE_DATA.test(run?.message ?? "") && !isSessionStart(run?.message ?? "")) return { handled: true, reply: { text: d.answer }, reason: "front desk answered" };
      return undefined;
    });

    api.on("before_prompt_build", async (event, ctx) => {
      const run = runFor(event, ctx);
      if (!run?.settled || run.cloud) return undefined;
      // The workspace prompt written for Claude is ~17k tokens; on the 9B that cost 60-100 s a turn
      // (live, 2026-10-11). The worker gets what it was evaluated with instead: the tuned
      // instructions for this job, plus the time.
      const now = `Now: ${clock()} (Europe/London). ${dateLine()}`;
      // Distress comes before every flow: "i literally cant do this anymore" got a canned "Want to take a
      // break?" with no question about his safety (live sweep, 2026-10-16). Fixed text, no tools.
      if (isCrisis(run.message)) run.flow = { outcome: "say", kind: "plain", text: CRISIS_REPLY };
      // Overwhelmed but not a crisis: warmth and one small step. Left to the worker it searched his brain,
      // read two agendas and read him a quiz schedule (16 s, 2026-10-16). A change he asks for still runs.
      if (!run.flow && isOverwhelmed(run.message) && !CHANGE_REQUEST.test(run.message)) {
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\n${OVERWHELMED_NOTE}` };
      }
      // Half a spoken sentence: nothing is acted on; the rest arrives as a continuation.
      if (run.cutOff && !run.flow) run.flow = { outcome: "say", text: GO_ON, kind: "ask" };
      // A focus session is one fixed command: code runs orion-session and the reply is built from
      // its output. Left to the worker, it said "I've started a focus session" three times and
      // called nothing (2026-10-15). Before the scheduler, which "focus block" would also match.
      if (!run.flow && isSessionStart(run.message) && options.sessionFlow) {
        run.flow = await options.sessionFlow(run.message).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }));
        if (run.flow.outcome === "done") {
          const outputs = run.flow.outputs;
          run.flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: outputs[i] ?? "", exit: null }));
        }
      }
      // A reminder at a time is ORION's alarm_set action, never a to-do: "remind me tomorrow around 11"
      // became orion-tasks add … --at 11:00, a to-do booked at 5:50 PM, and the reply said 11 (2026-10-13).
      if (REMINDER.test(run.message) && !run.cutOff && !run.flow) {
        const day = new Date(Date.now() + (meansTomorrow(run.message) ? 86400000 : 0));
        const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        const weekday = day.toLocaleDateString("en-GB", { weekday: "long" });
        // Code works out the exact call; the worker makes it (through the normal orion_task_run gate).
        const got = options.extractReminder ? await options.extractReminder(run.message).catch(() => null) : null;
        if (got?.time && got.label) {
          run.reminder = { args: JSON.stringify({ steps: [{ action: "alarm_set", at: `${ymd}T${got.time}`, label: got.label }] }), say: `${weekday} at ${ampm12(got.time)}: ${got.label}` };
          return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\nSet Nick's reminder now with ONE orion_task_run call using exactly these arguments:\n${run.reminder.args}\nThen, only if the result shows it was set, reply: "Reminder set for ${run.reminder.say}." If it was not set, say so plainly.`,
            appendContext: `[ORION: call orion_task_run now with exactly ${run.reminder.args} — do not reply before calling it.]` };
        }
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\nNick wants a reminder at a time. The day is ${weekday} ${ymd}. Set it with ONE orion_task_run call: {"steps":[{"action":"alarm_set","at":"${ymd}T<HH:MM>","label":"<what it is for>"}]}. Never use orion-tasks. Reply only after the tool result shows it was set.` };
      }
      // Calendar changes run as a fixed sequence (schedule-flow.ts): code reads the day, the worker
      // fills one form, code runs the exact command; the worker only phrases the result.
      // Any statement about his day goes through the flow (a plan like "after my lab I'm going to…"
      // has no change verb, 2026-10-12); a question or anything the form cannot express falls back.
      if (SCHEDULING.test(run.message) && !isQuestion(run.message) && !run.flow && isCalendarTurn(run.message, run.settled)) {
        // No built-in default: only the plugin entry point wires the real scheduler in (a test that
        // forgot a stub wrote a block called "B4" to Nick's real calendar, 2026-10-12).
        run.flow = options.scheduleFlow
          ? await options.scheduleFlow(run.message, clock(), { undo: run.undo ?? [] }).catch((e: unknown) => ({ outcome: "fallback" as const, reason: String(e) }))
          : { outcome: "fallback", reason: "no scheduling flow wired" };
        if (run.flow.outcome === "done") {
          run.flow.calls.forEach((canonical, i) => run.tools.push({ canonical, stdout: (run.flow as { outputs: string[] }).outputs[i] ?? "", exit: null }));
          const turn = run.sessionKey ? lastTurn.get(run.sessionKey) : undefined;
          if (turn && run.sessionKey) lastTurn.set(run.sessionKey, { ...turn, marks: run.flow.marks ?? [] });
        }
      }
      // A question about his day: code reads the day and hands it over (it said "I can't see your schedule").
      if (SCHEDULING.test(run.message) && isQuestion(run.message) && options.readDay && !run.flow) {
        const tomorrow = meansTomorrow(run.message);
        const day = await options.readDay(tomorrow).catch(() => "");
        if (day) return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\nHis day${tomorrow ? " tomorrow" : ""}, read just now from his calendar:\n${day}\n\nAnswer his question from this list only, in one or two short spoken sentences with 12-hour times. ${DAY_QUESTION_NOTE} Do not call any tools.` };
      }
      if (run.flow?.outcome === "done") {
        // The reply is built by code from the scheduler's lines; the worker repeats it (left to phrase it,
        // it said "before you head to the spit" for a plan that starts there, 2026-10-12). It goes in the
        // LATEST message too: from the system prompt alone the 9B paraphrased old turns (live gauntlet).
        const exact = exactReply(run.flow);
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\nYou already made this change. Reply to Nick with exactly this text and nothing else, and do not call any tools:\n${exact}`,
          appendContext: `[ORION scheduler — already done. Your whole reply must be exactly: ${exact}]` };
      }
      if (run.flow?.outcome === "say") {
        const exact = exactReply(run.flow);
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\nReply to Nick with exactly this text and nothing else, and do not call any tools:\n${exact}`,
          appendContext: `[ORION scheduler — nothing was changed. Your whole reply must be exactly: ${exact}]` };
      }
      // Only a plain answer is handed over as a draft. "ask" goes to the worker with the job's
      // instructions (the 4B asked for times it could have read, 2026-10-12), and a request to change
      // his day is always work, whatever the front desk thought.
      // A lookup (weather, sun times, his texts, his day) never gets a draft: nothing checks a draft's facts.
      const lookup = LIVE_DATA.test(run.message);
      if (run.settled.move === "answer" && run.settled.answer && !CHANGE_REQUEST.test(run.message) && !lookup) {
        // Even a pure answer's draft can invent his day ("you've been coding for hours", q082) and the 9B
        // read it out as "The front desk says…" (live sweep 2026-10-15).
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\nThe front desk drafted this reply: "${run.settled.answer}". If it is right for Nick's message, send exactly that (no tools); otherwise answer him briefly yourself. If it states something about Nick (what he has been doing, his day, his messages) or live facts (weather, sun times) that you were not told here, leave that out. Never mention the draft or the front desk.` };
      }
      const fetched = run.brain ? brainSnippets(await Promise.race([run.brain, new Promise<string>((r) => setTimeout(() => r(""), 4000))])) : "";
      const brainNote = `\n\n${LOOK_IT_UP}${fetched ? `\n\nFrom his brain, matched to this message (may help):\n${fetched}` : ""}`;
      const askNote = run.settled.move === "ask" && run.settled.answer
        ? `\n\nThe front desk thought you might need to ask: "${run.settled.answer}". Ask only if no tool can tell you; otherwise do the job.` : "";
      return { systemPrompt: `${instructionsFor(run.settled, run.message)}\n\n${PRODUCTION_NOTES}${brainNote}\n\n${now}${askNote}${lookup ? `\n\n${LIVE_NOTE}` : ""}` };
    });
  }

  // The text that must reach Nick for a run (the scheduler's own reply, or an honest stop), applied at
  // delivery: the 9B paraphrased it from session history ("Done: grind leetcode 6:15…" after a clear).
  const finalText = new Map<string, { text: string; at: number }>();
  const remember = (keys: string[], text: string) => { for (const k of keys) if (k) finalText.set(k, { text, at: Date.now() }); };
  if (on) api.on("reply_payload_sending", (event) => {
    const keys = [str(event.runId) ?? "", `session:${str(event.sessionKey) ?? ""}`];
    const hit = keys.map((k) => finalText.get(k)).find((v) => v && Date.now() - v.at < 120000);
    if (!hit) return undefined;
    keys.forEach((k) => finalText.delete(k));
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    return { payload: { ...payload, text: hit.text }, reason: "orion-control: the scheduler's own reply" };
  });

  api.on("after_tool_call", (event, ctx) => {
    const run = runFor(event, ctx);
    const toolName = pick(event, ctx, "toolName");
    if (!run || !toolName) return;
    run.tools.push({ canonical: canonicalCall(toolName, event.params), stdout: resultText(event.result ?? event.output), exit: null });
  });

  api.on("before_agent_finalize", async (event, ctx) => {
    const runId = pick(event, ctx, "runId") ?? "";
    const run = runFor(event, ctx);
    traceLine("before_agent_finalize", event, ctx, { found: !!run });
    if (!run) return undefined;
    const done = () => { runs.delete(runId); runs.delete(`session:${pick(event, ctx, "sessionKey") ?? ""}`); };
    // What this run must deliver: kept for reply_payload_sending (channel routes) and put in place for the agent CLI.
    let owed: string | undefined;
    try {
      const reply = str(event.lastAssistantMessage) ?? "";
      const findings = checkWork({ reply, turnResults: run.tools, finished: reply.trim().length > 0, changeRequest: CHANGE_REQUEST.test(run.message) && !/\?\s*$/.test(run.message.trim()) && run.flow?.outcome !== "say", dictated: run.flow?.outcome === "done" || run.flow?.outcome === "say" });
      run.findings.push(findings);
      // After the scheduling flow acted, its result is final: the worker only reports it (a retry
      // with tools let the model act on its own).
      const sessionKeyNow = `session:${pick(event, ctx, "sessionKey") ?? ""}`;
      if (on && run.reminder) {
        const called = run.tools.some((t) => t.canonical.startsWith("orion_task_run") && /alarm_set/.test(t.canonical));
        if (!called && run.passes < 2) {
          run.passes += 1;
          return { action: "revise", reason: "the reminder was not set", retry: { instruction: `You have NOT set the reminder yet — no tool was called. Call orion_task_run now with exactly ${run.reminder.args}, then reply.`, idempotencyKey: `${runId}:reminder:${run.passes}`, maxAttempts: 1 } };
        }
        if (!called) { owed = "I didn't manage to set that reminder — nothing was set. Can you say it again?"; remember([runId, sessionKeyNow], owed); }
      }
      if (on && (run.flow?.outcome === "done" || run.flow?.outcome === "say")) {
        const expected = exactReply(run.flow);
        owed = expected;
        remember([runId, sessionKeyNow], expected);
        const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (!squash(reply).includes(squash(expected).slice(0, 60)) && run.passes < 1) {
          run.passes += 1;
          return { action: "revise", reason: "reply must be the scheduler's", retry: { instruction: `Ignore the earlier conversation. Your whole reply must be exactly this text, nothing before or after, no tools: ${expected}`, idempotencyKey: `${runId}:exact-reply`, maxAttempts: 1 } };
        }
      }
      const flowActed = run.flow?.outcome === "done";
      if (on && findings.length > 0 && run.passes < 2 && !flowActed) {
        run.passes += 1;
        const calendar = SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical));
        const claimed = findings.some((f) => FALSE_CLAIM.test(f));
        const instruction = run.passes === 1 ? retryInstruction(findings)
          : claimed ? `${HONEST_STOP}\nIgnore the earlier conversation. Your whole reply must be exactly this text, nothing before or after: ${honestLine(calendar)}`
          : HONEST_STOP;
        return { action: "revise", reason: `work check: ${findings.join(", ")}`, retry: { instruction, idempotencyKey: `${runId}:work-check:${run.passes}`, maxAttempts: 1 } };
      }
      const decision = run.settled ?? (await settle(run));
      // Out of retries and still claiming something the tools don't show: deliver an honest line instead.
      if (on && !flowActed && !run.reminder && findings.some((f) => FALSE_CLAIM.test(f))) {
        owed = honestLine(SCHEDULING.test(run.message) || run.tools.some((t) => /orion-reschedule/.test(t.canonical)));
        remember([runId, sessionKeyNow], owed);
      }
      if (on && owed) putReplyInPlace(event.messages, owed);
      log({ runId, message: run.message, decision, flow: run.flow ? { outcome: run.flow.outcome, ...("calls" in run.flow ? { calls: run.flow.calls } : {}), ...("reason" in run.flow ? { reason: run.flow.reason } : {}), ...("undone" in run.flow && run.flow.undone ? { undone: run.flow.undone } : {}) } : null,
        ...(run.cutOff ? { heldCutOff: true } : {}), cloud: run.cloud ?? false, model: str(event.model) ?? null, tools: run.tools.length, findings: run.findings, passes: run.passes,
        ...(on ? { escalationNeeded: findings.length > 0 } : {}), turnMs: Date.now() - run.started });
      done();
    } catch (error) {
      api.logger?.warn?.(`[orion-control] local routing finalize failed: ${error instanceof Error ? error.message : String(error)}`);
      done();
    }
    return undefined;
  });
}
