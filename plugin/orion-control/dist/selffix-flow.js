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
import { dueParked, openOffer, parkedAny, readFixItems } from "./selffix-store.js";
const WHY = [
    /\bwhy\s*(?:did|didn'?t|didnt|would|wouldn'?t|wont|won'?t|cant|can'?t|couldn'?t|do|dont|don'?t)\s+(?:you|u|ya|yu)\b/,
    /\bwhy'?d\s+(?:you|u|ya|yu)\b/,
    /\bwhy\s+(?:you|u)\s+(?:say|said|do|did|open|close|tell|go|ignore|reply|answer)\w*/,
    /\b(?:that|thats|that's|it|this)\s*(?:was|is|wasn'?t|isn'?t)?\s*(?:so\s+|just\s+|totally\s+)?(?:wrong|not right|not what i (?:asked|said|wanted|meant))\b/,
    /\b(?:you|u|orion)\s+(?:messed|screwed|mucked|fucked|f+ed)\s+(?:that\s+|it\s+|this\s+)?up\b/,
    /\b(?:you|u)\s+(?:got|did)\s+(?:that|it|this)\s+wrong\b/,
    /\bwhat\s+(?:went|was)\s+wrong\b/,
];
const NO = /^(?:no|nah|nope|no thanks|no thx|dont|don'?t|skip it|skip|drop it|forget it|nvm|never ?mind|not needed|leave it|no need)\b/;
const LATER = /\b(?:later|tonight|tomorrow|tmrw|tmr|this evening|evening|after (?:class|dinner|gym|work|lunch)|not now|when i'?m free|in the morning|some ?other ?time|next week|snooze|at \d)/;
const NOW = /^(?:yes|yeah|yep|yup|ya|yea|sure|ok(?:ay)?|do it|go(?: ahead)?|now|right now|start(?: it| now)?|asap|please|pls|yes please|go for it|let'?s go|lets go|get on it)\b/;
const START_FIX = /\b(?:start|run|launch|begin|kick off|get on)\s+(?:the|that|my|ur|your)\s+(?:self[- ]?)?(?:fix|fix project|repair)\b/;
const REQUEST = /\b(?:move|add|put|book|schedule|reschedule|cancel|remind|text|email|play|clear|delete|remove|log|push)\b|\b(?:can|could|would|will) (?:you|u)\b|\bturn (?:on|off)\b/;
const OWN_QUESTION = /^(?:what|whats|what's|when|where|who|whos|how|why|is|are|do|does|did|can|could|should|will)\b[^?]*\?\s*$/;
const low = (s) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const wordCount = (s) => s.split(" ").filter(Boolean).length;
export const asksWhy = (message) => { const m = low(message); return wordCount(m) <= 28 && WHY.some((p) => p.test(m)); };
/** The time a "later" answer names ("tomorrow at 9", "tonight at 8"): an ISO instant, or undefined to take the default evening slot. */
export function laterAt(message, now) {
    const m = low(message);
    const clock = m.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    const tomorrow = /\b(?:tomorrow|tmrw|tmr)\b/.test(m);
    const evening = /\b(?:tonight|this evening|evening)\b/.test(m);
    const morning = /\b(?:morning)\b/.test(m);
    let h;
    let min = 0;
    if (clock) {
        h = Number(clock[1]);
        min = Number(clock[2] ?? 0);
        if (h > 23 || min > 59)
            return undefined;
        if (clock[3])
            h = h % 12 + (clock[3] === "pm" ? 12 : 0);
        else if (evening)
            h = h < 12 ? h % 12 + 12 : h;
        else if (!morning && !tomorrow && h >= 1 && h <= 6)
            h += 12;
    }
    else if (morning)
        h = 9;
    else if (tomorrow) {
        h = 19;
        min = 30;
    }
    if (h === undefined)
        return undefined;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (tomorrow ? 1 : 0), h, min);
    if (d.getTime() <= now.getTime())
        d.setDate(d.getDate() + 1);
    return d.toISOString();
}
/** What this message does to the fix offers, if anything. Reads only. */
export function readSelffixMove(message, ctx) {
    const m = low(message);
    if (!m)
        return undefined;
    const items = ctx.items ?? readFixItems(ctx.stateDir);
    const offer = openOffer(items, ctx.now);
    const due = dueParked(items, ctx.now);
    const waiting = offer ?? due;
    if (START_FIX.test(m)) {
        const p = due ?? parkedAny(items);
        if (p)
            return { kind: "start", id: p.id };
    }
    if (waiting && wordCount(m) <= 12 && !REQUEST.test(m) && !OWN_QUESTION.test(m) && !(wordCount(m) > 3 && m.endsWith("?"))) {
        if (NO.test(m))
            return { kind: "no", id: waiting.id };
        if (LATER.test(m) && !/^now\b/.test(m)) {
            const at = laterAt(m, ctx.now);
            return { kind: "later", id: waiting.id, ...(at ? { at } : {}), ...(waiting.status === "parked" ? { reparking: true } : {}) };
        }
        if (NOW.test(m))
            return waiting.status === "parked" ? { kind: "start", id: waiting.id } : { kind: "now", id: waiting.id };
    }
    if (!ctx.outreach && asksWhy(m))
        return { kind: "why", about: message.trim() };
    return undefined;
}
async function call(run, script, args, log, input) {
    const out = await run(script, args, input).catch(() => ({ stdout: "", code: 1 }));
    log.calls.push(`exec ${script} ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    log.outputs.push(out.stdout);
    if (out.code !== 0)
        return undefined;
    try {
        return JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "");
    }
    catch {
        return undefined;
    }
}
/** "tonight at 7:30 PM", "tomorrow at 7:30 PM", "Friday at 7:30 PM". */
export function spokenWhen(iso, now) {
    const d = new Date(iso);
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const ymd = (x) => x.toLocaleDateString("en-CA");
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (ymd(d) === ymd(now))
        return `${d.getHours() >= 17 ? "tonight" : "today"} at ${time}`;
    if (ymd(d) === ymd(tomorrow))
        return `tomorrow at ${time}`;
    return `${d.toLocaleDateString("en-GB", { weekday: "long" })} at ${time}`;
}
const SAFE = "It runs through the normal project pipeline with its reviews, so nothing edits my live code directly.";
const STATUS_WORDS = { offered: "waiting for your answer", parked: "parked, waiting for you to start it", started: "already running", candidate: "queued" };
export async function runSelffixMove(move, run, now = new Date()) {
    const log = { text: "", calls: [], outputs: [] };
    switch (move.kind) {
        case "why": {
            const found = await call(run, "orion-selfcheck", ["why", "--about", move.about, "--exclude", move.about, "--json"], log);
            if (!found)
                return { ...log, text: "I couldn't read back my own recent turns just now, so I can't tell you why yet. Try me again in a minute." };
            const d = found.diagnosis;
            if (!d)
                return { ...log, text: "I have no recent turns on record to look at, so I can't say why." };
            if (!d.fixable)
                return { ...log, text: d.says };
            const offer = await call(run, "orion-selffix", ["propose", "--stdin"], log, JSON.stringify(d));
            if (!offer)
                return { ...log, text: `${d.says} I couldn't set up a fix offer just now.` };
            if (offer.status === "duplicate")
                return { ...log, text: `${d.says} I already have a fix project for this (${STATUS_WORDS[offer.item?.status] ?? "open"}), so I won't open another.` };
            if (offer.status === "declined-before")
                return { ...log, text: `${d.says} You told me not to open a fix for this one recently, so I'll leave it unless you say otherwise.` };
            return { ...log, text: `${d.says} I can open a fix project for this. Start on it now, or later?` };
        }
        case "now": {
            const out = await call(run, "orion-selffix", ["accept", move.id, "--now"], log);
            if (!out)
                return { ...log, text: "I couldn't create the fix project just now, so nothing was started. Say 'now' again in a bit." };
            if (out.status === "started")
                return { ...log, text: `Okay, starting the fix project now. ${SAFE} I'll tell you when it needs you.` };
            return { ...log, text: `I made the fix project but it didn't start (${String(out.reason ?? "it was refused").slice(0, 140)}). I parked it and I'll remind you ${spokenWhen(String(out.remindAt), now)}. ${SAFE}` };
        }
        case "later": {
            const out = await call(run, "orion-selffix", ["accept", move.id, "--later", ...(move.at ? ["--at", move.at] : [])], log);
            if (!out)
                return { ...log, text: "I couldn't set that up just now, so nothing was created. Tell me again in a bit." };
            return { ...log, text: `Okay, I made the fix project and parked it. It won't run until you say so. I'll remind you ${spokenWhen(String(out.remindAt), now)}. ${SAFE}` };
        }
        case "no": {
            const out = await call(run, "orion-selffix", ["decline", move.id], log);
            return { ...log, text: out ? "Okay, dropped it. I won't offer a fix for that again for a week." : "Okay. I couldn't record that just now, so I may ask once more." };
        }
        case "start": {
            const out = await call(run, "orion-selffix", ["start", move.id], log);
            if (!out)
                return { ...log, text: "I couldn't start the fix project just now. Nothing changed." };
            if (out.status === "started")
                return { ...log, text: `Okay, starting the fix project now. ${SAFE}` };
            return { ...log, text: `It didn't start (${String(out.reason ?? "it was refused").slice(0, 140)}), so it stays parked. I'll remind you ${spokenWhen(String(out.remindAt), now)}.` };
        }
    }
}
/** The real scripts (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export const liveSelffixRun = (stateDir) => (script, args, input) => new Promise((resolve) => {
    const child = execFile(scriptPath(script), args, { timeout: 60000, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 }));
    if (input !== undefined)
        child.stdin?.end(input);
    else
        child.stdin?.end();
});
