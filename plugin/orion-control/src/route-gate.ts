/*
 The shared "did I understand" gate for deterministic routes (w20 routegate, 2026-11-04).

 The tube audit (2026-11-04, root cause 2): each code-first route (workout, mouse, wake, ignore, the desk's tool moves) took turns it did
 not understand and acted or answered with a template. "put gym at 10-11" logged a 60-minute workout, "can you set button six to f thirteen"
 got a status dump, narration started a focus session, a question was ignored. One rule fixes the family:

   A route may act only if EVERY slot it needs came from his words (all-or-nothing). Otherwise it steps aside and the turn
   falls through to the model with tools.

 Pure helpers only. Routes call `allSlots` for their own slots; local-routing.ts calls `gateDecision` on the front desk's move and
 `schedulingAsk` before the routes that must never take a calendar ask.
*/
import type { Decision } from "./front-desk.js";

const flat = (s: string): string => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();

/** Every slot present, else null. Empty strings and undefined are missing. */
export function allSlots<T extends Record<string, unknown>>(slots: T): { [K in keyof T]: NonNullable<T[K]> } | null {
  for (const v of Object.values(slots)) if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return null;
  return slots as { [K in keyof T]: NonNullable<T[K]> };
}

/** Whether a value the front desk (or any reader) produced appears in his words: every word of it of 3+ letters, or every number. */
export function inHisWords(message: string, value: unknown): boolean {
  const said = flat(message);
  const v = flat(String(value ?? ""));
  if (!v) return false;
  if (said.includes(v)) return true;
  const words = v.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /^\d+$/.test(w));
  if (!words.length) return false;
  return words.every((w) => said.includes(w.length > 5 ? w.slice(0, 5) : w));
}

const CLOCK = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|noon|midnight)`;
const RANGE = new RegExp(String.raw`\b(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to|until|till)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b`, "i");
const AT_TIME = new RegExp(String.raw`\b(?:at|around|by|from|until|till)\s+(?:${CLOCK}|\d{1,2}\b)(?!\s*(?:min|mins|minutes|hours?|hrs?|%|times))|\b${CLOCK}`, "i");
const PLACE_VERB = /\b(?:add|put|place|pencil|schedule|book|block|set up|set|plan|stick|throw|fit|push|move|slot|reserve)\b/i;
const FOR_AN_HOUR = /\bfor (?:an? hour|\d+ ?(?:min|mins|minutes|hours?|hrs?))\b/i;
/** A past-tense or "I did" signal: he is telling ORION what happened, not what to put on the calendar. */
export const PAST_TENSE = /\b(?:i|ive|i've|just|already|finally|today i)\s+(?:just\s+|already\s+|finally\s+)?(?:did|done|finished|completed|went|ran|jogged|swam|lifted|hit|worked out|trained|played|got back|came back|had|was at|been to|crushed|smashed)\b|\b(?:did|finished|completed|crushed|smashed|ran|lifted|worked out|went)\b.{0,30}\b(?:today|earlier|this (?:morning|afternoon|evening)|last night|yesterday|just now)\b|\bjust (?:did|finished|got back|came back|left)\b|\b(?:got|came|was) back from\b/i;

/**
 * A calendar ask: a placing verb and a clock time, range or length ("put gym at 10-11", "add marketing from 7-9:30pm", "schedule a run for an hour at 6").
 * The workout, food, apps, shutdown and mouse routes never take one, whatever nouns it contains.
 */
export function schedulingAsk(message: string): boolean {
  const m = flat(message);
  if (PAST_TENSE.test(m) || /\btimer\b/.test(m)) return false;
  return PLACE_VERB.test(m) && (RANGE.test(m) || AT_TIME.test(m) || FOR_AN_HOUR.test(m));
}

const QUESTION_START = /^(?:please |pls |hey |ok |okay |so |and |but )*(?:can|could|would|will|do|does|did|are|is|am|was|were|have|has|what|whats|what's|why|how|when|where|who|which|should|shall)\b/i;
/** A direct question: ends in "?" or opens like one. */
export const isDirectQuestion = (message: string): boolean => { const m = flat(message); return /\?\s*$/.test(m) || QUESTION_START.test(m); };

// Side-effect desk moves need his verb aimed at that thing in his words. One entry per tool; a tool not listed here is a read or is gated elsewhere.
const START = String.raw`(?:start|begin|kick off|launch|run|do|go|let'?s|lets|put me|get me|set up|set|lock in|time me|need|want)`;
const OPEN = /\b(?:re-?open|open|launch|start|pull up|bring up|bring|go to|switch to|load|run|fire up|show me)\b/i;
const FOCUS_THING = /\b(?:focus|session|pomodoro|deep work|work(?:ing)? on|study(?:ing)?|grind|lock in|block)\b/i;
const SESSION_VERB = new RegExp(String.raw`\b${START}\b|\b(?:stop|end|finish|pause|resume|extend|cancel|check|how long|status|what'?s)\b`, "i");
const LIGHTS_VERB = /\b(?:turn|switch|put|set|dim|brighten|make|kill|lights?|lamp|bright|darker|colou?r)\b/i;
const MEDIA_VERB = /\b(?:play|pause|skip|next|previous|stop|resume|volume|louder|quieter|mute|unmute|queue|put on|turn|music|song|track|shuffle)\b/i;
const BROWSER_VERB = /\b(?:open|go to|search|google|look up|pull up|visit|navigate|load|bring up|browse|youtube)\b|\.(?:com|org|net|io|edu|co)\b|\bhttps?:/i;
const SIDE_EFFECT_TOOLS = new Set(["session", "app_open", "browser", "lights", "media", "wake", "alarm", "log_intake", "repair_note", "phone_time"]);

function toolUnderstood(tool: string, args: Record<string, unknown>, message: string): boolean {
  const m = flat(message);
  switch (tool) {
    case "session": {
      const doing = String(args.do ?? "");
      if (doing === "status" || doing === "read") return true;
      if (doing && doing !== "start") return SESSION_VERB.test(m) && /\b(?:session|focus|pomodoro|it|timer)\b/.test(m);
      return SESSION_VERB.test(m) && (FOCUS_THING.test(m) || (typeof args.task === "string" && args.task.trim() !== "" && inHisWords(m, args.task)));
    }
    case "app_open": return OPEN.test(m) && args.application !== undefined && inHisWords(m, args.application);
    case "browser": return BROWSER_VERB.test(m);
    case "lights": return LIGHTS_VERB.test(m);
    case "media": return MEDIA_VERB.test(m);
    default: return true; // wake/alarm are parsed from his words by their own flows; the rest are read or logged only with his phrasing elsewhere
  }
}

/**
 * The front desk's move, gated:
 *  - a side-effect tool move whose verb is not aimed at that thing in his words becomes an escalation (the worker reads his words, with tools);
 *  - "ignore" never silences a typed or phone message, and never a direct question, spoken or not.
 */
export function gateDecision(decision: Decision, message: string, spoken: boolean, filler = false): Decision {
  if (decision.move === "tool" && SIDE_EFFECT_TOOLS.has(decision.tool ?? "")) {
    if (!toolUnderstood(decision.tool ?? "", (decision.args ?? {}) as Record<string, unknown>, message)) {
      const { tool: _t, args: _a, say: _s, ...rest } = decision;
      return { ...rest, move: "escalate", tier: "standard", fallback: "gate: tool move not aimed at a thing in his words" };
    }
  }
  // `filler`: a typed "hm" / "asdf" that local-routing answers with a fixed "didn't catch that" (still a reply, never silence).
  if (decision.move === "ignore" && (isDirectQuestion(message) || (!spoken && !filler))) {
    const { say: _s, ...rest } = decision;
    return { ...rest, move: "escalate", tier: "standard", fallback: "gate: ignore never silences a typed turn or a question" };
  }
  return decision;
}
