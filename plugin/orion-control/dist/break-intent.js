import { parseSessionJson } from "./session-json.js";
const DEFAULT_MINUTES = 10;
const WORK_MINUTES = 50;
const WORD_NUM = { five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40 };
const ASKS = /\b(?:need|needa|want|wanna|take|taking|takin|gonna take|going to take|gonna grab|grab|have|get|can i|could i|may i|let me|lemme|time for|gimme|give me|im taking|i'?m taking|requesting)\b|^break\b|\bbreak time\b/i;
// Not a request for a rest: "break down", a question about one, a refusal, a meal break, a streak.
const NOT_A_BREAK = /\bbreak(?:ing)?\s+(?:down|up|into|in|out|through|even|off|the (?:ice|rules|habit|cycle)|my (?:streak|fast))\b|\b(?:no|dont|don't|do not|didnt|didn't|never|skip|skipping|without|not)\b[^.]{0,20}\bbreaks?\b|\b(?:lunch|dinner|coffee|spring|winter|summer|fall|reading|study)\s+break\b|\bcoffee\b|\?|\b(?:when|what|how long|how much|why)\b/i;
const RESTART = /\b(?:then|and then|after(?: that)?|and)\s+(?:(?:please|pls)\s+)?(?:restart|start(?: it)? (?:again|back up)|resume|continue|come back|go again|get back|back to|back on|pick (?:it|things) (?:back )?up)\b/i;
function lengthOf(m) {
    if (/\b(?:half an hour|half hour|30 ?min)\b/.test(m))
        return 30;
    if (/\b(?:an hour|1 ?h(?:ou)?r)\b/.test(m))
        return 60;
    const digits = /(?:^|[^\d])(\d{1,3})\s*(?:-\s*)?(?:min(?:ute)?s?|m)\b/.exec(m) ?? /\bbreak\s+(?:for|of)\s+(\d{1,3})\b/.exec(m);
    if (digits?.[1])
        return Number(digits[1]);
    const word = /\b(five|ten|fifteen|twenty|thirty|forty)(?:\s+(?:min(?:ute)?s?))?\s+break\b|\bbreak\s+(?:for|of)\s+(five|ten|fifteen|twenty|thirty|forty)\b/.exec(m);
    const named = word?.[1] ?? word?.[2];
    return named ? WORD_NUM[named] : undefined;
}
/** A request to rest, or null. Never a question about a break, a refusal, or a meal. */
export function readBreak(message) {
    const m = message.trim().toLowerCase().replace(/\s+/g, " ");
    if (!/\bbreak\b/.test(m) || m.split(" ").length > 16 || NOT_A_BREAK.test(m) || !ASKS.test(m))
        return null;
    const said = lengthOf(m);
    const minutes = Math.min(60, Math.max(1, said ?? DEFAULT_MINUTES));
    return { kind: "break", minutes, work: /\bpomodoro\b/.test(m) ? 25 : WORK_MINUTES, restart: RESTART.test(m) || /\brestart\b/.test(m), assumed: said === undefined };
}
const RUNNING = new Set(["running", "paused", "waiting-for-return"]);
const pad = (n) => String(n).padStart(2, "0");
const clock = (d) => `${(d.getHours() + 11) % 12 + 1}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minutesOf = (seconds) => Math.max(1, Math.round(Number(seconds ?? 0) / 60));
const say = (text, ran) => ({ outcome: "say", kind: "plain", text, ...(ran.calls.length ? { calls: ran.calls, outputs: ran.outputs } : {}) });
async function call(exec, args, ran) {
    const out = await exec([...args, "--json"]).catch(() => ({ stdout: "", code: 1 }));
    ran.calls.push(`exec orion-session ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")} --json`);
    ran.outputs.push(out.stdout);
    const state = parseSessionJson(out.stdout);
    return out.code === 0 && state && state.ok !== false ? state : null;
}
/** What the session is doing now, read again: "running" / "none", or "unknown" when the read itself failed. */
async function sessionNow(exec, ran) {
    const state = await call(exec, ["status"], ran);
    return !state ? "unknown" : RUNNING.has(String(state.status ?? "")) ? "running" : "none";
}
const lengthNote = (move) => (move.assumed ? ` (${move.minutes} minutes is my default; tell me if you want a different length)` : "");
async function restartAfter(move, exec, now, task, status, ran) {
    const running = !!status && RUNNING.has(String(status.status ?? ""));
    if (running && !(await call(exec, ["finish"], ran)))
        return { flow: say(`I couldn't end the session for the break, so it's still going.`, ran) };
    const state = await call(exec, ["start", task, "--sequence", `${move.minutes} break, ${move.work} work`], ran);
    if (state && RUNNING.has(String(state.status ?? ""))) {
        const then = task === "Focus" ? `Then a ${move.work}-minute focus block starts by itself.` : `Then ${task} starts again by itself, ${move.work} minutes.`;
        return { flow: { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Break till ${clock(new Date(now.getTime() + move.minutes * 60_000))}${lengthNote(move)}. ${then} Say "stop the session" if you're done for now.` }, writes: 1 };
    }
    const after = await sessionNow(exec, ran);
    const where = after === "running" ? "A session is running, but not the break timer I tried to set." : after === "none" ? "No session is running now." : "I can't tell what the session is doing right now.";
    return { flow: say(`The break timer didn't start. ${where}${running ? " Your earlier session was ended and its focus time is saved." : ""}`, ran) };
}
/** Carries a break out and says only what orion-session returned: a timed break that hands back to the block by itself. */
export async function runBreak(move, deps) {
    const { exec, now } = deps;
    const ran = { calls: [], outputs: [] };
    const status = await call(exec, ["status"], ran);
    const state = String(status?.status ?? "");
    const task = typeof status?.task === "string" && status.task && status.task !== "Focus" ? status.task : deps.task ?? "Focus";
    if (move.restart)
        return restartAfter(move, exec, now, task, status, ran);
    if (state === "running" && status?.phase !== undefined && status.phase !== "focus") {
        return { flow: say(`You're already on a break: ${minutesOf(status.remainingSeconds)} minutes left, and the session picks you back up by itself.`, ran) };
    }
    // run-1101020721 foc-pomodoro-break-v: a vague break is the same timed break as "then restart": code starts it and says it. Handing the
    // return alarm to the worker said "tomorrow" and never resumed the block. Only an unreadable session falls back to a nudge.
    if (status)
        return restartAfter(move, exec, now, task, status, ran);
    const at = new Date(now.getTime() + move.minutes * 60_000);
    const label = `back from break: ${task === "Focus" ? "next block" : task}`;
    const resume = `then ${task === "Focus" ? "it's back to your next block" : `it's back to ${task}`}`;
    const text = `I couldn't read your focus session just now, so I haven't touched it. Break till ${clock(at)}${lengthNote(move)}. I'll nudge you then; ${resume}.`;
    return { reminder: { action: "alarm_set", label, at: isoLocal(at), args: JSON.stringify({ steps: [{ action: "alarm_set", at: isoLocal(at), label }] }), say: text }, calls: ran.calls, outputs: ran.outputs };
}
