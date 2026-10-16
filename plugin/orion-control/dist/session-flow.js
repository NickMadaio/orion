/*
 Focus sessions, started by code (2026-10-15).

 Nick said "start a focus session" and the 9B replied "I've started a focus session for you"
 three times without calling a single tool. The work check caught the claim each time, but on
 the Mac chat route (`openclaw agent --json`) there is no delivery stage to swap the honest
 line in, so the lie reached him. A focus session is one fixed command, so — like the
 scheduler — code runs it and the worker only repeats what the script's reply shows.

 Orion.app owns the session; `orion-session` is its client over the app's socket. Nothing here
 writes session state. A start while one is already running is reported, never a restart, so
 the second half of a cut-off request ("…and I need Safari") only adds the apps.

 Apps he names are allowed through `arm --level gentle` (the script's default level): naming
 them IS the confirmation `orion-session preflight` asks for. An app that cannot be found is
 named back, never silently dropped.
*/
import { execFile } from "node:child_process";
export const ORION_SESSION = "/Users/nickmadaio/Desktop/ORION/scripts/orion-session";
const DEFAULT_TASK = "Focus";
const RUNNING_STATES = new Set(["running", "paused", "waiting-for-return"]);
const ARMED_LEVELS = new Set(["gentle", "guided", "firm", "shield"]);
const START = /\b(start|begin|kick(?:\s|-)?off|launch|fire up|spin up|set up|open)\b[^.?!]{0,40}?\b(focus|work|study|deep work)(?:\s+(session|block|mode|time))?\b|\block me in\b/i;
// "focus mode on for an hour, leetcode" has no start verb and became a calendar block (q051, sweep 2026-10-15).
const MODE_ON = /\b(focus|study|work|deep work)\s+mode\s+on\b/i;
// Not now, or not a session: a future start belongs to the calendar path; these words end or query one.
// "remind me to start work in 20 min" is a reminder, not a session now (review, 2026-10-16).
const NOT_A_START = /\b(end|stop|finish|pause|cancel|abandon|calendar|schedule|tomorrow|remind|ping|nudge|at \d{1,2}(:\d{2})?)\b/i;
// "Resume" the verb only: "start focus for the resume" (his CV, q054) was refused as resuming a session,
// and the worker then called a tool named orion-session ten times.
const RESUMES = /^\W*(?:(?:ok(?:ay)?|please|pls|can you|could you)[,\s]+)*resume\b|\bresume\s+(?:(?:the|my|our)\s+)?(?:session|focus(?:ing)?|timer|it|block)\b/i;
const ruledOut = (message) => NOT_A_START.test(message) || RESUMES.test(message);
export const isSessionStart = (message) => (START.test(message) || MODE_ON.test(message)) && !ruledOut(message);
/** His words start a session, or the front desk read a start and nothing in his words rules one out. */
export const startsSession = (message, hint = {}) => isSessionStart(message) || (!!hint.start && !ruledOut(message));
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function readMinutes(message) {
    const m = message.toLowerCase();
    if (/\b(an|one) hour and a half\b/.test(m))
        return 90;
    if (/\bhalf an hour\b/.test(m))
        return 30;
    const hours = /\bfor (\d+(?:\.\d+)?|one|two|three|four|five|six|an?)\s*(?:hours?|hrs?|h)\b/.exec(m);
    if (hours?.[1])
        return Math.round((WORD_NUMBERS[hours[1]] ?? (/^an?$/.test(hours[1]) ? 1 : Number(hours[1]))) * 60);
    const minutes = /\b(?:for|like|about|around) (\d+)\s*(?:minutes?|mins?|m)\b/.exec(m);
    return minutes?.[1] ? Number(minutes[1]) : undefined;
}
function readUntil(message) {
    const m = /\buntil (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(message);
    if (!m?.[1])
        return undefined;
    const hour = Number(m[1]) % 12;
    const meridiem = m[3]?.toLowerCase().replace(/\./g, "");
    // No am/pm: a session runs into the evening far more often than past midnight.
    const pm = meridiem ? meridiem === "pm" : hour >= 1 && hour <= 7;
    return `${String(hour + (pm ? 12 : 0)).padStart(2, "0")}:${m[2] ?? "00"}`;
}
const STOP_TO_TASK = /(?=\s+(?:for|until|with|and I|I need)\b|[.,?!]|$)/.source;
// "start focus for the resume" names the task (q054); "for the next hour" names a length.
const FOR_THE_TASK = new RegExp(`\\bfor\\s+((?:the|my)\\s+.+?)${STOP_TO_TASK}`, "i");
const DURATION_WORDS = /\b(hours?|minutes?|mins?|rest|next|day|morning|afternoon|evening|night)\b/i;
function readTask(message) {
    const named = new RegExp(`\\bwork(?:ing)? on\\s+(.+?)${STOP_TO_TASK}`, "i").exec(message)
        ?? new RegExp(`\\bon\\s+((?:the|my)\\s+.+?)${STOP_TO_TASK}`, "i").exec(message)
        ?? FOR_THE_TASK.exec(message);
    const task = named?.[1]?.trim();
    return task && !/\b(calendar|phone|mac)\b/i.test(task) && !DURATION_WORDS.test(task) ? task : DEFAULT_TASK;
}
// Words that can follow "use/need/with" without naming an app.
const NOT_AN_APP = /^(to|a|an|some|more|it|this|that|those|these|them|me|my|i|you|time|work|focus|session|break|hours?|minutes?|mins?|help|everything|nothing|anything)$/i;
function readApps(message) {
    const clause = /\b(?:use|allow|allowed|need|keep|with)\s+(.*)$/is.exec(message)?.[1] ?? "";
    const names = clause
        .split(/[.,;!?]|\band\b|\bplus\b|\balso\b|\bor\b/i)
        .map((part) => part.trim().replace(/^(the|my)\s+/i, ""))
        .filter((part) => /^[a-z][\w.+-]*(\s[a-z][\w.+-]*)?$/i.test(part))
        .filter((part) => !part.split(/\s/).some((word) => NOT_AN_APP.test(word)))
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
    return [...new Set(names)];
}
/** His request, or null. A front-desk start (hint.start) counts only when nothing in his words rules a start out. */
export function parseSessionRequest(message, hint = {}) {
    if (!startsSession(message, hint))
        return null;
    const minutes = readMinutes(message) ?? hint.minutes;
    const until = minutes === undefined ? readUntil(message) : undefined;
    const task = readTask(message);
    return { task: task === DEFAULT_TASK && hint.task ? hint.task : task, ...(minutes !== undefined ? { minutes } : {}), ...(until ? { until } : {}), apps: readApps(message) };
}
const parse = (stdout) => {
    try {
        const value = JSON.parse(stdout);
        return value && typeof value === "object" ? value : null;
    }
    catch {
        return null;
    }
};
const reason = (stdout) => stdout.trim().split("\n")[0]?.replace(/^orion-session:\s*/, "").slice(0, 160) || "no reply from Orion";
const minutesOf = (seconds) => Math.max(1, Math.round(Number(seconds ?? 0) / 60));
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "");
function sessionLine(state) {
    const total = Number(state.totalBlocks ?? 1);
    const left = `${minutesOf(state.remainingSeconds)} minutes`;
    return total > 1 ? `block ${String(state.blockNumber ?? 1)} of ${total}, ${left}` : left;
}
async function allowApps(apps, exec, resolveApp) {
    const resolved = await Promise.all(apps.map(async (name) => ({ name, id: await resolveApp(name).catch(() => null) })));
    const found = resolved.filter((r) => !!r.id);
    const missing = resolved.filter((r) => !r.id).map((r) => r.name);
    const missingLine = missing.length ? ` I couldn't find ${listed(missing)}.` : "";
    if (found.length === 0)
        return { call: null, output: "", line: missingLine.trim() };
    const args = ["arm", "--level", "gentle", "--allow", found.map((r) => r.id).join(","), "--json"];
    const result = await exec(args);
    const ok = result.code === 0 && parse(result.stdout)?.ok !== false;
    const names = found.map((r) => r.name);
    const line = ok
        ? `${listed(names)} ${names.length > 1 ? "are" : "is"} allowed.${missingLine}`
        : `I couldn't set the allowed apps: ${reason(result.stdout)}.${missingLine}`;
    return { call: args, output: result.stdout, line };
}
/** One start request, end to end. Returns a FlowResult whose reply is built only from script output. */
export async function runSessionFlow({ message, hint, exec, resolveApp }) {
    const request = parseSessionRequest(message, hint);
    if (!request)
        return { outcome: "fallback", reason: "not a session start" };
    const status = parse((await exec(["status", "--json"])).stdout) ?? {};
    const running = RUNNING_STATES.has(String(status.status ?? ""));
    if (running && request.apps.length === 0) {
        return { outcome: "say", kind: "plain", text: `A focus session is already running — ${sessionLine(status)} left.` };
    }
    // `arm` REPLACES the allowlist and the level, and status does not report the list, so arming
    // an armed session would silently drop apps he allowed earlier and reset his level.
    if (running && ARMED_LEVELS.has(String(status.enforcement ?? ""))) {
        return { outcome: "say", kind: "plain", text: `A focus session is already running — ${sessionLine(status)} left. Enforcement is already on, so I didn't change which apps are allowed.` };
    }
    const calls = [];
    const outputs = [];
    let opening = "Your focus session is already running.";
    if (!running) {
        const args = ["start", request.task, ...(request.minutes ? ["--minutes", String(request.minutes)] : []), ...(request.until ? ["--until", request.until] : []), "--json"];
        const result = await exec(args);
        const state = parse(result.stdout);
        if (result.code !== 0 || !state || state.ok === false || !RUNNING_STATES.has(String(state.status ?? ""))) {
            return { outcome: "say", kind: "plain", text: `I couldn't start the focus session: ${reason(result.stdout)}. Nothing is running.` };
        }
        calls.push(args);
        outputs.push(result.stdout);
        opening = `Your focus session is running: ${sessionLine(state)}.`;
    }
    const apps = request.apps.length ? await allowApps(request.apps, exec, resolveApp) : null;
    if (apps?.call) {
        calls.push(apps.call);
        outputs.push(apps.output);
    }
    return {
        outcome: "done",
        calls: calls.map((args) => `exec orion-session ${args.join(" ")}`),
        outputs,
        reply: [opening, apps?.line].filter(Boolean).join(" "),
    };
}
/** "how much focus time is left", read by code (sweep 2026-10-15, q049/q053: the worker called nothing
 *  and said "still active with 15 minutes remaining"). A read only: nothing is started or changed. */
export async function runSessionStatus({ exec }) {
    const result = await exec(["status", "--json"]);
    // q053 (2026-10-16 r8): the read is recorded (calls/outputs) so the turn shows a tool ran, not an unread claim.
    const say = (text) => ({ outcome: "say", kind: "plain", text, calls: ["exec orion-session status --json"], outputs: [result.stdout] });
    const state = parse(result.stdout);
    if (result.code !== 0 || !state || state.ok === false) {
        return say(`I couldn't check your focus session: ${reason(result.stdout)}.`);
    }
    const status = String(state.status ?? "");
    const on = typeof state.task === "string" && state.task && state.task !== DEFAULT_TASK ? ` on ${state.task}` : "";
    if (status === "running") {
        const what = state.phase === "focus" || state.phase === undefined ? `Your focus session${on} is running: ${sessionLine(state)} left.` : `You're on a break: ${minutesOf(state.remainingSeconds)} minutes left.`;
        return say(what);
    }
    if (status === "paused")
        return say(`Your focus session${on} is paused.`);
    if (status === "waiting-for-return")
        return say("Your break is over — the session is waiting for you to come back.");
    return say("No focus session is running right now.");
}
/** argv only, no shell. A failing orion-session explains itself on stderr, so that is what comes back. */
const runFile = (file, args, timeout) => new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({
    stdout: error ? String(stderr || stdout || error.message) : String(stdout),
    code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
})));
// The name is one or two plain words (readApps), so it cannot close the AppleScript string.
const liveResolveApp = async (name) => {
    const result = await runFile("/usr/bin/osascript", ["-e", `id of application "${name}"`], 4000);
    const id = result.stdout.trim();
    return result.code === 0 && /^[\w.-]+$/.test(id) ? id : null;
};
/** The real flow: Orion.app's session socket through orion-session. Wired in by index.ts only. */
export const liveSessionFlow = (message, hint) => runSessionFlow({ message, ...(hint ? { hint } : {}), exec: (args) => runFile(ORION_SESSION, args, 15000), resolveApp: liveResolveApp });
/** The real status read (orion-session status --json). Wired in by index.ts only. */
export const liveSessionStatus = () => runSessionStatus({ exec: (args) => runFile(ORION_SESSION, args, 15000) });
