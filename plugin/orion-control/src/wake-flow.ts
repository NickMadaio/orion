/*
 His phone's wake alarm, moved by code (live, 2026-10-16 01:45Z).

 "Yea yea I know, just wrapping up my work now. Then sleep. Push my alarm to 12": the front desk read it
 right (tool wake, at 12:00) but nothing turned a wake move into a call. The worker filed alarm_set
 "push my alarm" and said "Reminder set for Friday at 12:00 PM" while the real iPhone wake alarm never
 moved. The wake alarm is one fixed command (scripts/orion-wake HH:MM | clear | nothing), so, like
 session-flow, code runs it and the reply is built from its output.

 Not this: a reminder ("remind me at 5"), a timer, or a repeating alarm (orion-wake sets one, the next
 time only). With no am/pm, 1-11 is the morning (a wake alarm) and 12 is noon; orion-wake itself picks
 the next occurrence after now.
*/
import { execFile } from "node:child_process";
import type { Decision } from "./front-desk.js";
import { ampm12 } from "./reminder-flow.js";
import type { FlowResult } from "./schedule-flow.js";
import { isTimerRequest } from "./tool-moves.js";

export type WakeExec = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type WakeRequest = { kind: "set"; time: string } | { kind: "clear" } | { kind: "read" } | { kind: "repeat" } | { kind: "ask" } | { kind: "bedtime" };
export const ORION_WAKE = "/Users/nickmadaio/Desktop/ORION/scripts/orion-wake";

const ALARM_WORD = /\b(?:my|the)\s+(?:(?:normal|usual|regular|automatic|auto|wake(?:[- ]?up)?|morning|phone)\s+)*alarm\b|\bwake[- ]?up\s+(?:alarm|time|call)\b|\balarm\s+(?:to|for|at)\s+\d/i;
const WAKE_ME = /\bwake me(?:\s+up)?\b/i;
const REMINDER_WORDS = /\b(remind|reminder|ping me|nudge me|don'?t let me forget)\b/i;
const CLEAR = /\b(clear|cancel|reset|remove|delete|turn off|go back|back to)\b|\b(normal|usual|regular|automatic|auto)\s+(?:wake[- ]?up\s+)?alarm\b/i;
const READ = /\b(what|whats|what's|when|which)\b.*\b(alarm|wake)|\bis my alarm set\b/i;
const REPEATS = /\b(weekdays?|weekends?|every ?day|daily|every (?:morning|night|week|mon|tue|wed|thu|fri|sat|sun)\w*|each (?:morning|day))\b/i;
const MERIDIEM = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i;
const CLOCK24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const BARE = /\b(?:to|for|at|by|around)\s+(\d{1,2})\b(?!\s*(?:min|mins|minutes|hours?|hrs?|h\b|%))/i;
// "going to bed now" moved the alarm to 07:00, a time only the 4B front desk produced (live, 2026-10-19 01:43).
const BEDTIME = /\b(going to (?:bed|sleep)|off to (?:bed|sleep)|heading to bed|time for bed|good ?night|night night|turning in|hitting the hay|calling it a night|sleep now)\b/i;
// A bare time typed straight after ORION asked what time: "7", "7am", "at 7:30".
const ANSWER = /^\W*(?:(?:at|to|for)\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\W*$/i;
const IT_TO = /\b(?:make|move|push|change|set)\s+(?:it|that)(?:\s+(?:to|for|at))?\s+(\d{1,2})\b(?!\s*(?:min|mins|minutes|hours?|hrs?|h\b|%))/i;
const pad = (n: number) => String(n).padStart(2, "0");

/** The time he named after the alarm words, as HH:MM; undefined when he named none. */
function namedTime(message: string): string | undefined {
  const at = Math.max(0, message.search(/\balarm\b|\bwake\b/i));
  const tail = message.slice(at);
  const m = MERIDIEM.exec(tail);
  if (m?.[1]) { const h = Number(m[1]) % 12 + (/^p/i.test(m[3] ?? "") ? 12 : 0); return Number(m[1]) > 12 ? undefined : `${pad(h)}:${m[2] ?? "00"}`; }
  const c = CLOCK24.exec(tail);
  if (c?.[1] && c[2]) return `${pad(Number(c[1]))}:${c[2]}`;
  const b = BARE.exec(tail) ?? IT_TO.exec(tail);
  if (b?.[1]) {
    const h = Number(b[1]);
    if (h > 23) return undefined;
    return `${pad(h)}:00`; // 12 is noon, 1-11 the morning, 13-23 as said
  }
  return undefined;
}

/** The time in a direct answer to "what time?", as HH:MM; undefined when the reply is not just a time. */
function answeredTime(message: string): string | undefined {
  const m = ANSWER.exec(message.trim());
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  if (m[3]) return n < 1 || n > 12 ? undefined : `${pad(n % 12 + (/^p/i.test(m[3]) ? 12 : 0))}:${m[2] ?? "00"}`;
  return n > 23 ? undefined : `${pad(n)}:${m[2] ?? "00"}`;
}

/** What he asked of his wake alarm, or null when it is not about it. A time comes only from his words (or his direct
 *  answer to ORION's question, `answering`), never from the front desk's args. `now` is kept for the call site's symmetry. */
export function parseWake(message: string, decision: Decision | undefined, _now: Date, answering = false): WakeRequest | null {
  if (isTimerRequest(message) || REMINDER_WORDS.test(message)) return null;
  const fromDesk = decision?.move === "tool" && decision.tool === "wake";
  const named = ALARM_WORD.test(message) || WAKE_ME.test(message);
  if (answering && !named) { const at = answeredTime(message); if (at) return { kind: "set", time: at }; }
  if (!fromDesk && !named) return null;
  if (!named && BEDTIME.test(message)) return fromDesk ? { kind: "bedtime" } : null;
  if (REPEATS.test(message)) return { kind: "repeat" };
  const time = namedTime(message);
  if (!time && ALARM_WORD.test(message) && CLEAR.test(message)) return { kind: "clear" };
  if (!time && READ.test(message)) return { kind: "read" };
  if (time) return !fromDesk && /\?\s*$/.test(message.trim()) ? null : { kind: "set", time };
  return fromDesk && named ? { kind: "ask" } : null; // never the front desk's args.at
}

const say = (text: string): FlowResult => ({ outcome: "say", kind: "plain", text });
const firstLine = (s: string) => s.trim().split("\n")[0]?.replace(/^orion-wake:\s*/, "").slice(0, 160) || "no reply from orion-wake";

/** One wake request, end to end; the reply is built only from orion-wake's output. */
export async function runWakeFlow({ message, decision, now, exec, answering = false }: { message: string; decision?: Decision; now: Date; exec: WakeExec; answering?: boolean }): Promise<FlowResult> {
  const req = parseWake(message, decision, now, answering);
  if (!req) return { outcome: "fallback", reason: "not a wake alarm request" };
  if (req.kind === "repeat") return say("I can't set repeating alarms yet, so nothing was changed. Want a one-off wake alarm for the next one instead?");
  if (req.kind === "ask") return { outcome: "say", kind: "ask", text: "What time should I set your wake alarm for?" };
  if (req.kind === "bedtime") {
    // He said goodnight, not a time: the alarm is read, never changed.
    const read = await exec([]).catch(() => ({ stdout: "", code: 1 }));
    const set = read.code === 0 ? /^Wake-up set for (.+?) \(asked/.exec(read.stdout.trim()) : null;
    return say(set?.[1] ? `Goodnight. Your wake alarm is still set for ${set[1]}.` : "Goodnight.");
  }
  const args = req.kind === "set" ? [req.time] : req.kind === "clear" ? ["clear"] : [];
  const result = await exec(args);
  const out = result.stdout.trim();
  if (req.kind === "read") {
    if (result.code !== 0) return say(`I couldn't read your wake alarm: ${firstLine(out)}.`);
    const set = /^Wake-up set for (.+?) \(asked/.exec(out);
    return say(set?.[1] ? `Your wake alarm is set for ${set[1]}.` : "You have no manual wake alarm; your phone uses the automatic one (your first class minus get-ready time).");
  }
  if (result.code !== 0) return say(`I couldn't ${req.kind === "clear" ? "clear" : "set"} your wake alarm: ${firstLine(out)}. Nothing was changed.`);
  const calls = [`exec orion-wake ${args.join(" ")}`];
  if (req.kind === "clear") return /^Cleared/.test(out) ? { outcome: "done", calls, outputs: [out], reply: "Your wake alarm is back to automatic." } : say(`I couldn't clear your wake alarm: ${firstLine(out)}.`);
  const when = ampm12(req.time);
  if (/^Sent to/.test(out)) return { outcome: "done", calls, outputs: [out], reply: `Your wake alarm is now ${when}.` };
  if (/^Saved an alarm/.test(out)) return say(`I saved your wake alarm for ${when}, but the phone link on this Mac isn't running, so your iPhone hasn't received it yet.`);
  return say(`I couldn't confirm your wake alarm for ${when}: ${firstLine(out)}.`);
}

const runFile = (file: string, args: string[], timeout: number): Promise<{ stdout: string; code: number }> =>
  new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({
    stdout: error ? String(stderr || stdout || error.message) : String(stdout),
    code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
  })));

/** The real flow: scripts/orion-wake. Wired in by index.ts only. */
let askedAt = 0; // when ORION last asked "what time?", so his next bare time is read as the answer
const ANSWER_WINDOW_MS = 5 * 60_000;
export const liveWakeFlow = async (message: string, decision?: Decision): Promise<FlowResult> => {
  const answering = Date.now() - askedAt < ANSWER_WINDOW_MS;
  const result = await runWakeFlow({ message, ...(decision ? { decision } : {}), now: new Date(), answering, exec: (args) => runFile(ORION_WAKE, args, 15000) });
  askedAt = result.outcome === "say" && result.kind === "ask" ? Date.now() : 0;
  return result;
};
