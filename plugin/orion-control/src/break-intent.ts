/*
 "need a break" (gate run-1031202318, cluster 2: foc-pomodoro-break-v/c).

 What the gate saw: a break started a focus session, and the reply said "I couldn't set the break timer, nothing is running". Two faults:
 the reply was a template over an unread result (session-json.ts: the reply was never parsed), and a break should not START a session at all.

 A break, by what he said (wave 4 review, finding 1: "i need a break" with nothing running started a 50-minute block):
   a running block      paused, never finished (its time is kept), and a return nudge at now + N (N is the length he said, else 10)
   a paused block       left as it is, the same nudge
   nothing running      the alarm-only reply. Only an explicit "... then restart the session" on a turn that may start (typed, or
                        addressed to ORION) starts the break-then-block sequence (orion-session start --sequence "N break, W work")
   unreadable session   the nudge only, and it says it couldn't read the session
 A break from a person, a class or a relationship, an idiom ("give me a break") or "we" is not his rest at all.
 Every sentence of the reply comes from what orion-session returned this turn; when a call fails, the session is read again before saying
 what is or is not running.
*/
import type { FlowResult } from "./schedule-flow.js";
import type { SessionExec } from "./session-flow.js";
import { parseSessionJson, type SessionState } from "./session-json.js";

export type BreakMove = { kind: "break"; minutes: number; work: number; restart: boolean; assumed: boolean };
export type BreakOutcome = {
  flow?: FlowResult;
  reminder?: { args: string; say: string; action: "alarm_set"; label: string; at: string };
  /** The session calls made before a reminder the worker sets (recorded as this turn's tool calls). */
  calls?: string[]; outputs?: string[];
  writes?: number;
};

const DEFAULT_MINUTES = 10;
const WORK_MINUTES = 50;
const WORD_NUM: Record<string, number> = { five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40 };
const ASKS = /\b(?:need|needa|want|wanna|take|taking|takin|gonna take|going to take|gonna grab|grab|have|get|can i|could i|may i|let me|lemme|time for|gimme|give me|im taking|i'?m taking|requesting)\b|^break\b|\bbreak time\b/i;
// Not a request for a rest: "break down", a question about one, a refusal, a meal break, a streak.
const NOT_A_BREAK = /\bbreak(?:ing)?\s+(?:down|up|into|in|out|through|even|off|the (?:ice|rules|habit|cycle)|my (?:streak|fast))\b|\b(?:no|dont|don't|do not|didnt|didn't|never|skip|skipping|without|not)\b[^.]{0,20}\bbreaks?\b|\b(?:lunch|dinner|coffee|spring|winter|summer|fall|reading|study)\s+break\b|\bcoffee\b|\?|\b(?:when|what|how long|how much|why)\b/i;
// Not his own rest: a break from someone or something that is not an activity, "we"/"us", an idiom. By category, never by phrase.
const NOT_HIS = /\b(?:we|us|our|let'?s|each other)\b|\b(?:catch|cut|lucky|big)\s+(?:me\s+)?(?:a|some)?\s*break\b|\b(?:lucky|big) break\b/i;
const IDIOM = /\b(?:give me|gimme|gimmie)\s+a\s+break\b/i;
/** What a "break from X" is from may be work he is resting from (an activity, his study things, "it"/"this" alone); anything else is a person, class or relationship. */
const FROM_REST = /^(?:(?:my|the|this|that|all (?:this|the|that))\s+)?(?:work\w*|stud\w*|revis\w*|homework|hw|coursework|psets?|problem sets?|essays?|assignments?|reading|screens?|laptop|desk|code|coding|\w+ing)\b|^(?:it|this|that|everything)\s*(?:$|[,.!]|(?:for|then|and|till|until|pls|please|lol|rn)\b)/i;
function notHisRest(m: string): boolean {
  if (NOT_HIS.test(m)) return true;
  if (IDIOM.test(m) && lengthOf(m) === undefined) return true;
  const from = /\bbreak from\s+(.*)$/.exec(m);
  return !!from && !FROM_REST.test(from[1]!.trim());
}
const RESTART = /\b(?:then|and then|after(?: that)?|and)\s+(?:(?:please|pls)\s+)?(?:restart|start(?: it)? (?:again|back up)|resume|continue|come back|go again|get back|back to|back on|pick (?:it|things) (?:back )?up)\b/i;

function lengthOf(m: string): number | undefined {
  if (/\b(?:half an hour|half hour|30 ?min)\b/.test(m)) return 30;
  if (/\b(?:an hour|1 ?h(?:ou)?r)\b/.test(m)) return 60;
  const digits = /(?:^|[^\d])(\d{1,3})\s*(?:-\s*)?(?:min(?:ute)?s?|m)\b/.exec(m) ?? /\bbreak\s+(?:for|of)\s+(\d{1,3})\b/.exec(m);
  if (digits?.[1]) return Number(digits[1]);
  const word = /\b(five|ten|fifteen|twenty|thirty|forty)(?:\s+(?:min(?:ute)?s?))?\s+break\b|\bbreak\s+(?:for|of)\s+(five|ten|fifteen|twenty|thirty|forty)\b/.exec(m);
  const named = word?.[1] ?? word?.[2];
  return named ? WORD_NUM[named] : undefined;
}

/** A request to rest, or null. Never a question about a break, a refusal, or a meal. */
export function readBreak(message: string): BreakMove | null {
  const m = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!/\bbreak\b/.test(m) || m.split(" ").length > 16 || NOT_A_BREAK.test(m) || !ASKS.test(m) || notHisRest(m)) return null;
  const said = lengthOf(m);
  const minutes = Math.min(60, Math.max(1, said ?? DEFAULT_MINUTES));
  return { kind: "break", minutes, work: /\bpomodoro\b/.test(m) ? 25 : WORK_MINUTES, restart: RESTART.test(m) || /\brestart\b/.test(m), assumed: said === undefined };
}

const RUNNING = new Set(["running", "paused", "waiting-for-return"]);
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${(d.getHours() + 11) % 12 + 1}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minutesOf = (seconds: unknown) => Math.max(1, Math.round(Number(seconds ?? 0) / 60));
const say = (text: string, ran: Ran): FlowResult => ({ outcome: "say", kind: "plain", text, ...(ran.calls.length ? { calls: ran.calls, outputs: ran.outputs } : {}) });

type Ran = { calls: string[]; outputs: string[] };
async function call(exec: SessionExec, args: string[], ran: Ran): Promise<SessionState | null> {
  const out = await exec([...args, "--json"]).catch(() => ({ stdout: "", code: 1 }));
  ran.calls.push(`exec orion-session ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")} --json`); ran.outputs.push(out.stdout);
  const state = parseSessionJson(out.stdout);
  return out.code === 0 && state && state.ok !== false ? state : null;
}

/** What the session is doing now, read again: "running" / "none", or "unknown" when the read itself failed. */
async function sessionNow(exec: SessionExec, ran: Ran): Promise<"running" | "none" | "unknown"> {
  const state = await call(exec, ["status"], ran);
  return !state ? "unknown" : RUNNING.has(String(state.status ?? "")) ? "running" : "none";
}

const lengthNote = (move: BreakMove) => (move.assumed ? ` (${move.minutes} minutes is my default; tell me if you want a different length)` : "");

async function startSequence(move: BreakMove, exec: SessionExec, now: Date, task: string, ran: Ran): Promise<BreakOutcome> {
  const state = await call(exec, ["start", task, "--sequence", `${move.minutes} break, ${move.work} work`], ran);
  if (state && RUNNING.has(String(state.status ?? ""))) {
    const then = task === "Focus" ? `Then a ${move.work}-minute focus block starts by itself.` : `Then ${task} starts again by itself, ${move.work} minutes.`;
    return { flow: { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Break till ${clock(new Date(now.getTime() + move.minutes * 60_000))}${lengthNote(move)}. ${then} Say "stop the session" if you're done for now.` }, writes: 1 };
  }
  const after = await sessionNow(exec, ran);
  const where = after === "running" ? "A session is running, but not the break timer I tried to set." : after === "none" ? "No session is running now." : "I can't tell what the session is doing right now.";
  return { flow: say(`The break timer didn't start. ${where}`, ran) };
}

function nudge(move: BreakMove, now: Date, task: string, lead: string, back: string, ran: Ran): BreakOutcome {
  const at = new Date(now.getTime() + move.minutes * 60_000);
  const label = `back from break: ${task === "Focus" ? "next block" : task}`;
  const text = `${lead}Break till ${clock(at)}${lengthNote(move)}. I'll nudge you then; ${back}.`;
  return { reminder: { action: "alarm_set", label, at: isoLocal(at), args: JSON.stringify({ steps: [{ action: "alarm_set", at: isoLocal(at), label }] }), say: text }, calls: ran.calls, outputs: ran.outputs };
}
const backTo = (task: string) => `then ${task === "Focus" ? "it's back to your next block" : `it's back to ${task}`}`;

/** Carries a break out and says only what orion-session returned. A running block is paused (never finished); nothing starts unless asked. */
export async function runBreak(move: BreakMove, deps: { exec: SessionExec; now: Date; task?: string; /** typed, or addressed to ORION */ mayStart?: boolean }): Promise<BreakOutcome> {
  const { exec, now } = deps;
  const ran: Ran = { calls: [], outputs: [] };
  const status = await call(exec, ["status"], ran);
  const state = String(status?.status ?? "");
  const task = typeof status?.task === "string" && status.task && status.task !== "Focus" ? status.task : deps.task ?? "Focus";
  if (!status) return nudge(move, now, task, "I couldn't read your focus session just now, so I haven't touched it. ", backTo(task), ran);
  if (state === "running" && status.phase !== undefined && status.phase !== "focus") {
    return { flow: say(`You're already on a break: ${minutesOf(status.remainingSeconds)} minutes left, and the session picks you back up by itself.`, ran) };
  }
  if (state === "running") {
    // The engine's own break-now (orion-session break): the block ends, its break starts, the next block follows by itself.
    // Refused when no break is planned after this block; only then does the old pause-plus-reminder apply.
    const broke = await call(exec, ["break"], ran);
    if (broke && String(broke.phase) === "rest") {
      let rest = Number(broke.remainingSeconds ?? 0) / 60;
      if (!move.assumed && move.minutes < rest && (await call(exec, ["shorten", String(move.minutes)], ran))) rest = move.minutes;
      const len = rest > 0 ? ` ${Math.max(1, Math.round(rest))} minutes,` : "";
      return { flow: { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Break started:${len || ""} then your next focus block starts by itself.`.replace("started: then", "started, then") }, writes: 1 };
    }
    const left = minutesOf(status.remainingSeconds);
    if (!(await call(exec, ["pause"], ran))) return { flow: say(`I couldn't pause ${task} just now, so it's still running (${left} minutes left) and I haven't set a return reminder.`, ran) };
    return nudge(move, now, task, `Paused ${task} with ${left} minutes left. `, `say resume and the ${task} block carries on`, ran);
  }
  if (RUNNING.has(state)) return nudge(move, now, task, `${task} is already paused. `, `say resume and the ${task} block carries on`, ran);
  // Nothing running: a break starts nothing, unless he asked for the session back and this turn may start one.
  if (move.restart && deps.mayStart === true) return startSequence(move, exec, now, task, ran);
  return nudge(move, now, task, "", backTo(task), ran);
}
