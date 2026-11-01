/*
 Focus phrases, each to the one real call (2026-10-31, gate run-1031133008 cluster 6).

 What the gate saw: "starting in 10" started a 50-minute session (it is a stall: a nudge at +10); "ya in a sec" got "I'll wait for
 you to be ready"; "need a break" and "take a 10 min break then restart the session" paused (no timer) or leaked "Exec failed:
 orion-session pause"; "block my distracting stuff while i study" moved a study block and said "Done"; "actually keep going for a
 bit" claimed an extension with no session; "im on tiktok instead of studying" logged tiktok on the calendar; "didnt do youtube
 stuff today" asked "since when?".

 Each phrase maps to one call whose result code reads before anything is said:
   stall        a reminder at now + N ("in a sec" = 5) to start the block he should be in            (alarm_set, via the worker)
   break        a timed break that hands back to work by itself: orion-session start --sequence "N break, W work"
                (a running session is finished first; its focus time is kept in the history)
   extend       the running session's time left + N, as one session from now; no session: said, and offered
   block        honest: single apps cannot be blocked from chat; a focus session is offered (yes starts it)
   doomscroll   a 25-minute session on what he should be doing, now (an intervention, reversible: "end the session")
   side-missed  an hour of the side project tonight (his daily rule), or first thing tomorrow when tonight has no room
*/
import { notBooked, refused, sideNotes, wrote } from "./scheduler-out.js";
import { parseSessionJson } from "./session-json.js";
import { readBreak, runBreak } from "./break-intent.js";
import { ampm, toMin } from "./intent-time.js";
const ACK = String.raw `^(?:(?:ya|yah|yeah|yea|yep|yup|ok(?:ay)?|k|sure|fine|alright|aight|mhm|uh huh|hmm)[,.!\s]+)*`;
const STALL = new RegExp(`${ACK}(?:(?:i'?ll\\s+|im\\s+|i'?m\\s+|gonna\\s+)?(?:start(?:ing)?(?:\\s+it)?|get(?:ting)?\\s+(?:on it|started|going)|on it|doing it|do it|be there)\\s+)?(?:in\\s+(?:a\\s+)?(sec|second|min|minute|bit|moment|few|(\\d{1,2}))(?:\\s*(?:mins?|minutes?|m|secs?))?|(\\d{1,2})\\s*more\\s*(?:mins?|minutes?)|after this(?:\\s+(?:video|episode|one|game|round))?|(?:give me|gimme|gimmie) (?:a (?:sec|second|minute|min)|(\\d{1,2})\\s*(?:mins?|minutes?)?))\\s*(?:lol|haha)?[.!]*$`, "i");
const EXTEND = /^(?:(?:actually|ok(?:ay)?|yeah|nah|wait|hmm|no)[,\s]+)*(?:keep (?:going|it going|the (?:session|timer|focus(?: session)?) going)|(?:give me |i need |i want )?(?:another|a few more|(\d{1,3}) more)(?:\s*(?:min(?:ute)?s?|m))?|extend (?:it|this|the session|my session|my focus(?: session)?)(?: by (\d{1,3})\s*(?:min(?:ute)?s?|m))?|(?:a )?(?:bit|little) longer|not done yet)(?:\s+(?:for a bit|a bit longer|a little longer|longer|please|pls|on this))*\s*[.!]*$/i;
const EXTEND_NEEDS = /\b(?:for a bit|a bit longer|a little longer|longer|more|another|extend|not done yet)\b/i;
const BLOCK = /\b(?:block|lock|hide|shut off|cut off|stop me (?:from )?(?:using|opening|going on))\b[^.?!]{0,40}\b(?:apps?|distract\w*|instagram|insta|tiktok|youtube|reddit|twitter|social media|games?|websites?|sites?|stuff|my phone)\b/i;
const NOT_BLOCK = /\bblock (?:off|out)\b|\bcalendar\b|\btime block\b|\bstudy block\b/i;
const APPS = String.raw `(?:my phone|tiktok|tik tok|instagram|insta|youtube|yt|reddit|twitter|x|snapchat|snap|netflix|shorts|reels|discord)`;
const DOOM = new RegExp(String.raw `\b(?:i'?m|im|i am|i'?ve been|ive been|been|was|i keep|keep)\s+(?:on|scrolling(?: on)?|watching|stuck on|doomscrolling(?: on)?|going on|wasting time on)\s+(${APPS})\b`, "i");
const DOOM_GUILT = /\binstead\b|\bshould(?:'?ve| have| be)\b|\bsupposed to\b|\bnot (?:studying|working)\b|\bprocrastinat\w*|\bagain\b|\bfor (?:\d+|an?|like)\b|\bhelp\b/i;
const SIDE_MISSED = /\b(?:didn'?t|did not|didnt|haven'?t|havent|have not|never)\s+(?:do|get to|work on|touch|start|film|edit|get around to)\s+(?:any\s+|my\s+|the\s+|on\s+)?(youtube(?: stuff)?|side project|video|editing|content|channel|the channel)\b/i;
const WORD_MIN = { sec: 5, second: 5, min: 5, minute: 5, bit: 5, moment: 5, few: 5 };
/** The focus phrase in his message, or null. Never a request that also names a session start ("start a 25 min session…"). */
export function readFocusMove(message) {
    const m = message.trim().replace(/\s+/g, " ");
    const stall = STALL.exec(m);
    if (stall) {
        const n = Number(stall[2] ?? stall[3] ?? stall[4]);
        return { kind: "stall", minutes: Number.isFinite(n) && n > 0 ? Math.min(60, n) : (stall[1] ? WORD_MIN[stall[1].toLowerCase()] ?? 5 : /\b(?:sec|second|min|minute)\b/i.test(stall[0]) ? 5 : 10) }; // REV2 NICE: "give me a sec" is 5
    }
    const brk = readBreak(m);
    if (brk)
        return brk;
    const ext = EXTEND.exec(m);
    if (ext && EXTEND_NEEDS.test(m))
        return { kind: "extend", minutes: Math.min(120, Number(ext[1] ?? ext[2] ?? 25)) };
    if (BLOCK.test(m) && !NOT_BLOCK.test(m))
        return { kind: "block" };
    const doom = DOOM.exec(m);
    if (doom && DOOM_GUILT.test(m) && !/\b(?:start|begin|set)\b/i.test(m)) {
        const instead = /\binstead of\s+(?:doing\s+|my\s+|the\s+)?([a-z][a-z ]{1,30}?)(?=[.,!?]|$|\s+(?:and|but|lol|rn|right now)\b)/i.exec(m)?.[1];
        return { kind: "doomscroll", app: doom[1], ...(instead ? { instead } : {}) };
    }
    const side = SIDE_MISSED.exec(m);
    if (side && !/\?\s*$/.test(m))
        return { kind: "side-missed", label: /youtube|video|editing|content|channel/i.test(side[1]) ? "YouTube" : "Side project" };
    return null;
}
const parse = parseSessionJson;
const RUNNING = new Set(["running", "paused", "waiting-for-return"]);
const ARMED = new Set(["gentle", "guided", "firm", "shield"]);
const pad = (n) => String(n).padStart(2, "0");
const clock = (d) => `${(d.getHours() + 11) % 12 + 1}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
const plus = (now, min) => new Date(now.getTime() + min * 60_000);
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const GENERIC = /^(?:studying|study|work|working|stuff|homework|things|it)$/i;
const say = (text, calls = [], outputs = []) => ({ outcome: "say", kind: "plain", text, ...(calls.length ? { calls, outputs } : {}) });
/** Kinds of block a focus session belongs to: study, deadline work, the side project, or a block titled as coursework. */
const WORK_KINDS = new Set(["study", "deadline", "work", "side_project"]);
const WORK_TITLE = /\b(?:study|revis\w*|homework|hw|problem set|pset|essay|assignment|coursework|reading|project|[A-Z]{2,5}\d{3,5})\b/i;
/** The study or work block on his calendar right now, with at least ten minutes left; never a class, gym, meal or rest. */
export function currentWorkBlock(day, now) {
    const at = now.getHours() * 60 + now.getMinutes();
    const b = day?.blocks.find((x) => toMin(x.start) <= at && toMin(x.end) - at >= 10 && x.kind !== "class" && !x.fixed
        && (WORK_KINDS.has(x.kind ?? "") || (!x.kind || x.kind === "other") && WORK_TITLE.test(x.title)));
    return b ? { title: b.title, end: b.end } : undefined;
}
async function call(exec, args, ran) {
    const out = await exec([...args, "--json"]).catch(() => ({ stdout: "", code: 1 }));
    ran.calls.push(`exec orion-session ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")} --json`);
    ran.outputs.push(out.stdout);
    const state = parse(out.stdout);
    return out.code === 0 && state && state.ok !== false ? state : null;
}
const started = (state) => !!state && RUNNING.has(String(state.status ?? ""));
const taskOf = (status, fallback) => (typeof status.task === "string" && status.task && status.task !== "Focus" ? status.task : fallback) ?? "Focus";
/** Carries the move out and says only what the session or the scheduler shows. */
export async function runFocusMove(move, deps) {
    const { now } = deps;
    const ran = { calls: [], outputs: [] };
    if (move.kind === "stall") {
        const at = plus(now, move.minutes);
        const label = `start ${deps.task ?? "focus"}`;
        return { reminder: { action: "alarm_set", label, at: isoLocal(at), args: JSON.stringify({ steps: [{ action: "alarm_set", at: isoLocal(at), label }] }), say: `Okay, ${move.minutes} minutes. I'll nudge you at ${clock(at)} to start ${deps.task ?? "focusing"}, and then it's go time.` } };
    }
    if (move.kind === "side-missed") {
        if (!deps.run)
            return {};
        const late = now.getHours() * 60 + now.getMinutes() >= 22 * 60 + 30;
        const args = ["add", move.label, "60", ...(late ? ["--date", "tomorrow"] : [])];
        const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
        ran.calls.push(`exec orion-reschedule add "${move.label}" 60${late ? " --date tomorrow" : ""}`);
        ran.outputs.push(out.stdout);
        // REV2 finding 1: its own block not fitting is the failure; anything else the run moved to fit it is said, never hidden.
        const own = notBooked(out.stdout, move.label);
        const placed = new RegExp(String.raw `${move.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*?(\d{1,2}:\d{2})\s*(?:–|-|to)\s*(\d{1,2}:\d{2})`, "i").exec(out.stdout);
        const when = placed ?? /(\d{1,2}:\d{2})\s*(?:–|-|to)\s*(\d{1,2}:\d{2})/.exec(out.stdout);
        if (refused(out) || own || !when) {
            let left = 0;
            if (wrote(out)) {
                const back = await deps.run("orion-reschedule", ["undo"]).catch(() => ({ stdout: "", code: 1 }));
                ran.calls.push("exec orion-reschedule undo");
                ran.outputs.push(back.stdout);
                if (back.code !== 0)
                    left = 1;
            }
            return { flow: say(`There's no hour left for ${move.label} ${late ? "tomorrow" : "tonight"} without moving gym or study, so ${left ? "I tried and couldn't fully put it back; check your calendar" : "nothing changed"}. Want it first thing tomorrow instead?`, ran.calls, ran.outputs), ...(left ? { writes: 1 } : {}) };
        }
        const at = (t) => { const [h, mm] = t.split(":").map(Number); return clock(new Date(2000, 0, 1, h ?? 0, mm ?? 0)); };
        const also = sideNotes(move.label, [out.stdout]);
        return { flow: { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Still time ${late ? "tomorrow" : "tonight"}: ${move.label} booked ${at(when[1])}–${at(when[2])}, your hour for the day.${also.length ? ` To fit it: ${also.join("; ")}.` : ""} Say "undo" to take it off.` }, writes: 1 };
    }
    if (!deps.exec)
        return {};
    // break: break-intent.ts reads the session itself (a timed break that hands back to the block; run-1101020721)
    if (move.kind === "break")
        return runBreak(move, { exec: deps.exec, now, ...(deps.task ? { task: deps.task } : {}) });
    const status = await call(deps.exec, ["status"], ran) ?? {};
    const running = RUNNING.has(String(status.status ?? ""));
    const task = taskOf(status, deps.task);
    if (move.kind === "block") {
        if (running && ARMED.has(String(status.enforcement ?? "")))
            return { flow: say(`Enforcement is already on for your ${task} session: only the apps you allowed get through.`, ran.calls, ran.outputs) };
        return { flow: say(`I can't block single apps from chat, so nothing's blocked yet. ${running ? `Your ${task} session is running; in Orion, firm mode on it only lets your work apps through.` : "Want me to start a focus session now? In Orion, firm mode on it only lets your work apps through."}`, ran.calls, ran.outputs), ...(running ? {} : { pendingSession: `start a focus session on ${task}` }) };
    }
    if (move.kind === "doomscroll") {
        // A confession is a nudge back to the current block, never a new session unless he asks for one (gate cluster 2).
        const block = move.instead && !GENERIC.test(move.instead.trim()) ? move.instead.trim() : deps.task;
        if (running)
            return { flow: say(`Your ${task} session is still running, ${Math.max(1, Math.round(Number(status.remainingSeconds ?? 0) / 60))} minutes left. Put ${move.app} down and get back to it.`, ran.calls, ran.outputs) };
        const known = Object.keys(status).length > 0;
        // Wave 6 B (orchestrator decision): a study or work block current on his calendar is restarted as a focus session, said in one line.
        const current = known && deps.readDay ? currentWorkBlock(await deps.readDay().catch(() => undefined), now) : undefined;
        if (current) {
            const state = await call(deps.exec, ["start", current.title, "--until", current.end], ran);
            if (started(state)) {
                const left = Number(state?.remainingSeconds);
                const until = Number.isFinite(left) && left > 0 ? clock(plus(now, Math.round(left / 60))) : ampm(toMin(current.end));
                return { flow: { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Put ${move.app} down: I've restarted a focus session on ${current.title} until ${until}.` } };
            }
        }
        const back = block ? `get back to ${block}` : "get back to your block";
        if (!known)
            return { flow: say(`Put ${move.app} down and ${back}.`, ran.calls, ran.outputs) };
        return { flow: say(`Put ${move.app} down and ${back}. No focus session is running right now; want 25 minutes on ${block ?? "it"}? Say yes and I'll start it.`, ran.calls, ran.outputs), pendingSession: `start a 25 min focus session${block ? ` on ${block}` : ""}` };
    }
    if (move.kind === "extend") {
        if (!running)
            return { flow: say(`No focus session is running, so there's nothing to extend. Want ${move.minutes} more minutes on ${task === "Focus" ? "it" : task}? Say yes and I'll start it.`, ran.calls, ran.outputs), pendingSession: `start a ${move.minutes} min focus session on ${task}` };
        const left = Math.max(0, Math.round(Number(status.remainingSeconds ?? 0) / 60));
        const total = Math.max(10, left + move.minutes);
        const done = await call(deps.exec, ["finish"], ran);
        if (!done)
            return { flow: say(`I couldn't extend it just now, so your session is unchanged: ${left} minutes left.`, ran.calls, ran.outputs) };
        const state = await call(deps.exec, ["start", task, "--minutes", String(total)], ran);
        if (!started(state))
            return { flow: say(`I couldn't restart ${task} for longer, so the session has ended; your focus time so far is saved. Say "start a focus session" to go again.`, ran.calls, ran.outputs) };
        return { flow: { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Extended: ${task} now runs until ${clock(plus(now, total))}, ${move.minutes} minutes more.` } };
    }
    return {};
}
