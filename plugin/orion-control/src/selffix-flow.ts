/*
 "Why did you do that?", and the fix project that can follow (w19 selffix, 2026-11-04). Nick: "he should be able to tell me why he does
 something wrong ... and be able to fix it ... he asks if I want him to get on the fix now or later".

   why       "why did you do that" / "why'd you say X" / "that was wrong" / "you messed up" / "why didn't you open safari":
             orion-selfcheck why reads his own last turns (replies, routes, tool results) and returns a first-person diagnosis. Code words
             the answer from that record, never the model. A fixable cause is offered as a fix project: "Start on it now, or later?"
             (orion-selffix propose; nothing is created yet, and an open or recently declined fix for the same issue is not offered twice).
   now       his answer to the offer: orion-selffix accept --now creates the project from the plan and starts its run.
   later     "later" / "tonight" / "tomorrow at 9": accept --later parks it and schedules a reminder (default this evening, 19:30).
   no        drops it and records the decision.
   start     "yes" to the reminder, or "start the fix project": starts the parked project.

 The fix runs through the normal project pipeline with its reviews. It never edits live code directly, and the reply says so.
*/
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
import { dueParked, openOffer, parkedAny, readFixItems, type FixItem } from "./selffix-store.js";

export type SelffixRun = (script: "orion-selfcheck" | "orion-selffix", args: string[], input?: string) => Promise<{ stdout: string; code: number }>;
export type SelffixMove =
  | { kind: "why"; about: string }
  | { kind: "now"; id: string }
  | { kind: "later"; id: string; at?: string; reparking?: boolean }
  | { kind: "no"; id: string }
  | { kind: "start"; id: string };
/** `offered`: the reply ends in "now or later?", so his next bare answer is about this offer. */
export type SelffixOut = { text: string; calls: string[]; outputs: string[]; offered?: boolean };
/** `bound`: the offer (or the reminder to start it) was ORION's last message in this chat, so a bare answer is about it. Set by the caller. */
export type SelffixCtx = { stateDir: string; now: Date; outreach?: boolean; items?: FixItem[]; bound?: boolean };

const WHY = [
  /\bwhy\s*(?:did|didn'?t|didnt|would|wouldn'?t|wont|won'?t|cant|can'?t|couldn'?t|do|dont|don'?t)\s+(?:you|u|ya|yu)\b/,
  /\bwhy'?d\s+(?:you|u|ya|yu)\b/,
  /\bwhy\s+(?:you|u)\s+(?:say|said|do|did|open|close|tell|go|ignore|reply|answer)\w*/,
  /\b(?:that|thats|that's|it|this)\s*(?:was|is|wasn'?t|isn'?t)?\s*(?:so\s+|just\s+|totally\s+)?(?:wrong|not right|not what i (?:asked|said|wanted|meant))\b/,
  /\b(?:you|u|orion)\s+(?:messed|screwed|mucked|fucked|f+ed)\s+(?:that\s+|it\s+|this\s+)?up\b/,
  /\b(?:you|u)\s+(?:got|did)\s+(?:that|it|this)\s+wrong\b/,
  /\bwhat\s+(?:went|was)\s+wrong\b/,
];
// An answer to the offer is a BARE answer: every word is one of these, and one core word says which. Anything else ("ok set a 25 min timer",
// "tomorrow i have a quiz", "start my focus session") is a different turn, never an answer.
const words = (core: string, filler: string): { all: Set<string>; core: Set<string> } => ({ core: new Set(core.split(" ")), all: new Set(`${core} ${filler}`.split(" ")) });
const NOW_W = words("yes yeah yep yup ya yea sure ok okay do go start now asap please pls", "it ahead right for lets let's get on");
const NO_W = words("no nah nope skip nvm nevermind never drop forget leave dont don't", "thanks thx it mind pls please not needed need");
const LATER_W = words("later tonight tomorrow tmrw tmr evening morning night after snooze week at", "not now this in the dinner class gym work lunch next some other time yes yeah ok okay sure pls please am pm");
const CLOCK_TOKEN = /^\d{1,2}(?::\d{2})?(?:am|pm)?$/;
const bare = (m: string, set: { all: Set<string>; core: Set<string> }): boolean => {
  const ws = m.replace(/[.!,]+/g, " ").split(" ").filter(Boolean);
  return ws.length > 0 && ws.length <= 5 && ws.every((w) => set.all.has(w) || (set === LATER_W && CLOCK_TOKEN.test(w))) && ws.some((w) => set.core.has(w) || (set === LATER_W && CLOCK_TOKEN.test(w) && ws.includes("at")));
};
const START_FIX = /\b(?:start|run|launch|begin|kick off|get on)\s+(?:the|that|my|ur|your)\s+(?:self[- ]?)?(?:fix|fix project|repair)\b/;

const low = (s: string): string => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const wordCount = (s: string): number => s.split(" ").filter(Boolean).length;
// "why did you put X first / schedule X before Y" asks about his plan, which the plan-why flow answers from the plan itself.
const PLAN_WHY = /\bwhy\b.*\b(?:put|puts|placed?|schedule[ds]?|moved?|order(?:ed)?|list(?:ed)?)\b.*\b(?:first|last|before|after|at|there|then|so (?:late|early))\b/;
export const asksWhy = (message: string): boolean => { const m = low(message); return wordCount(m) <= 28 && !PLAN_WHY.test(m) && WHY.some((p) => p.test(m)); };

/** The time a "later" answer names ("tomorrow at 9", "tonight at 8"): an ISO instant, or undefined to take the default evening slot. */
export function laterAt(message: string, now: Date): string | undefined {
  const m = low(message);
  const clock = m.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  const tomorrow = /\b(?:tomorrow|tmrw|tmr)\b/.test(m);
  const evening = /\b(?:tonight|this evening|evening)\b/.test(m);
  const morning = /\b(?:morning)\b/.test(m);
  let h: number | undefined; let min = 0;
  if (clock) {
    h = Number(clock[1]); min = Number(clock[2] ?? 0);
    if (h > 23 || min > 59) return undefined;
    if (clock[3]) h = h % 12 + (clock[3] === "pm" ? 12 : 0);
    else if (evening) h = h < 12 ? h % 12 + 12 : h;
    else if (!morning && !tomorrow && h >= 1 && h <= 6) h += 12;
  } else if (morning) h = 9;
  else if (tomorrow) { h = 19; min = 30; }
  if (h === undefined) return undefined;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (tomorrow ? 1 : 0), h, min);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** What this message does to the fix offers, if anything. Reads only. */
export function readSelffixMove(message: string, ctx: SelffixCtx): SelffixMove | undefined {
  const m = low(message);
  if (!m) return undefined;
  const items = ctx.items ?? readFixItems(ctx.stateDir);
  const offer = openOffer(items, ctx.now);
  const due = dueParked(items, ctx.now);
  const waiting = offer ?? due;
  if (START_FIX.test(m)) { const p = due ?? parkedAny(items); if (p) return { kind: "start", id: p.id }; }
  if (waiting && ctx.bound === true) {
    if ((bare(m, LATER_W) || /^not now[.!]*$/.test(m)) && !/^now$/.test(m)) { const at = laterAt(m, ctx.now); return { kind: "later", id: waiting.id, ...(at ? { at } : {}), ...(waiting.status === "parked" ? { reparking: true } : {}) }; }
    if (bare(m, NO_W)) return { kind: "no", id: waiting.id };
    if (bare(m, NOW_W)) return waiting.status === "parked" ? { kind: "start", id: waiting.id } : { kind: "now", id: waiting.id };
  }
  if (!ctx.outreach && asksWhy(m)) return { kind: "why", about: message.trim() };
  return undefined;
}

async function call(run: SelffixRun, script: "orion-selfcheck" | "orion-selffix", args: string[], log: SelffixOut, input?: string): Promise<Record<string, any> | undefined> {
  const out = await run(script, args, input).catch(() => ({ stdout: "", code: 1 }));
  log.calls.push(`exec ${script} ${args.map((a) => JSON.stringify(a)).join(" ")}`);
  log.outputs.push(out.stdout);
  if (out.code !== 0) return undefined;
  try { return JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "") as Record<string, any>; } catch { return undefined; }
}

/** "tonight at 7:30 PM", "tomorrow at 7:30 PM", "Friday at 7:30 PM". */
export function spokenWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const ymd = (x: Date): string => x.toLocaleDateString("en-CA");
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (ymd(d) === ymd(now)) return `${d.getHours() >= 17 ? "tonight" : "today"} at ${time}`;
  if (ymd(d) === ymd(tomorrow)) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "long" })} at ${time}`;
}

const SAFE = "It runs through the normal project pipeline with its reviews, so nothing edits my live code directly.";
const STATUS_WORDS: Record<string, string> = { offered: "waiting for your answer", parked: "parked, waiting for you to start it", started: "already running", candidate: "queued" };

export async function runSelffixMove(move: SelffixMove, run: SelffixRun, now: Date = new Date()): Promise<SelffixOut> {
  const log: SelffixOut = { text: "", calls: [], outputs: [] };
  switch (move.kind) {
    case "why": {
      const found = await call(run, "orion-selfcheck", ["why", "--about", move.about, "--exclude", move.about, "--json"], log);
      if (!found) return { ...log, text: "I couldn't read back my own recent turns just now, so I can't tell you why yet. Try me again in a minute." };
      const d = found.diagnosis as { says: string; fixable: boolean } | null;
      if (!d) return { ...log, text: "I have no recent turns on record to look at, so I can't say why." };
      if (!d.fixable) return { ...log, text: d.says };
      const offer = await call(run, "orion-selffix", ["propose", "--stdin"], log, JSON.stringify(d));
      if (!offer) return { ...log, text: `${d.says} I couldn't set up a fix offer just now.` };
      if (offer.status === "duplicate") return { ...log, text: `${d.says} I already have a fix project for this (${STATUS_WORDS[offer.item?.status as string] ?? "open"}), so I won't open another.` };
      if (offer.status === "declined-before") return { ...log, text: `${d.says} You told me not to open a fix for this one recently, so I'll leave it unless you say otherwise.` };
      return { ...log, offered: true, text: `${d.says} I can open a fix project for this. Start on it now, or later?` };
    }
    case "now": {
      const out = await call(run, "orion-selffix", ["accept", move.id, "--now"], log);
      if (!out) return { ...log, text: "I couldn't create the fix project just now, so nothing was started. Say 'now' again in a bit." };
      if (out.status === "started") return { ...log, text: `Okay, starting the fix project now. ${SAFE} I'll tell you when it needs you.` };
      return { ...log, text: `I made the fix project but it didn't start (${String(out.reason ?? "it was refused").slice(0, 140)}). I parked it and I'll remind you ${spokenWhen(String(out.remindAt), now)}. ${SAFE}` };
    }
    case "later": {
      const out = await call(run, "orion-selffix", ["accept", move.id, "--later", ...(move.at ? ["--at", move.at] : [])], log);
      if (!out) return { ...log, text: "I couldn't set that up just now, so nothing was created. Tell me again in a bit." };
      return { ...log, text: `Okay, I made the fix project and parked it. It won't run until you say so. I'll remind you ${spokenWhen(String(out.remindAt), now)}. ${SAFE}` };
    }
    case "no": {
      const out = await call(run, "orion-selffix", ["decline", move.id], log);
      return { ...log, text: out ? "Okay, dropped it. I won't offer a fix for that again for a week." : "Okay. I couldn't record that just now, so I may ask once more." };
    }
    case "start": {
      const out = await call(run, "orion-selffix", ["start", move.id], log);
      if (!out) return { ...log, text: "I couldn't start the fix project just now. Nothing changed." };
      if (out.status === "started") return { ...log, text: `Okay, starting the fix project now. ${SAFE}` };
      return { ...log, text: `It didn't start (${String(out.reason ?? "it was refused").slice(0, 140)}), so it stays parked. I'll remind you ${spokenWhen(String(out.remindAt), now)}.` };
    }
  }
}

/** The real scripts (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export const liveSelffixRun = (stateDir?: string): SelffixRun => (script, args, input) => new Promise((resolve) => {
  const child = execFile(scriptPath(script), args, { timeout: 60000, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } },
    (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 }));
  if (input !== undefined) child.stdin?.end(input); else child.stdin?.end();
});
