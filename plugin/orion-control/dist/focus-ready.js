/*
 "I'm ready to work" (2026-11-04). Nick: "I get home, I tell him I'm ready to work. He uses the current task at hand and starts a focus
 session, automatically allows Safari because I'll need it obviously, and lets me see if there's anything else I need. He notes down
 what apps I need to complete that task for future use. Let's say I finish before the 50 minutes: he can start the break early, or help
 shift into a new task."

   ready   the work block on his plan now (else the next one today, else the nearest deadline), a focus session on it with the standard
           50/10 (the block's own length when it is not that), and the apps its profile says (orion-focus-profile). The reply asks once
           whether he needs anything else; naming apps adds them to this session AND to that task's profile for next time.
   done    "done", "finished the resume": the session is ended (the focus time is kept), the task ticked off when he said he finished it,
           and ONE question: break now, or the next task. Then it does it.
   site    "i need youtube for this": that site is allowed for the rest of this session (orion-focus-sites allow).
 Code runs every call and every sentence of the reply comes from what the scripts returned. The only state kept between turns is the one
 question just asked (focus-ready-pending.json, so the Mac app's Done early button can ask it too).
*/
import { isSignOff } from "./sign-off.js";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSessionJson } from "./session-json.js";
import { runBreak } from "./break-intent.js";
import { topDeadline } from "./focus-moves.js";
import { toMin } from "./intent-time.js";
import { content, hasAppsLead, isDoneMessage, isReadyMessage, readAppsReply, readEarlyAnswer, readSiteOverride } from "./focus-ready-parse.js";
export { isDoneMessage, isReadyMessage, readAppsReply, readEarlyAnswer, readSiteOverride } from "./focus-ready-parse.js";
const PENDING_MS = 20 * 60_000;
const LIVE = new Set(["running", "paused", "waiting-for-return"]);
const STANDARD = { min: 45, max: 60 };
const WORK_KINDS = new Set(["study", "deadline", "work", "side_project"]);
const WORK_TITLE = /\b(?:study|revis\w*|homework|hw|problem set|pset|essay|assignment|coursework|reading|project|resume|cv|lab|brief|paper|report|code|coding|leetcode|applications?|thesis|[A-Z]{2,5}\d{3,5})\b/i;
const say = (text, kind = "plain", calls = [], outputs = []) => ({ outcome: "say", kind, text, ...(calls.length ? { calls, outputs } : {}) });
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const minutesOf = (seconds) => Math.max(1, Math.round(Number(seconds ?? 0) / 60));
const parse = parseSessionJson;
const json = async (run, args) => { const r = await run(args).catch(() => ({ stdout: "", code: 1 })); return r.code === 0 ? parse(r.stdout) : null; };
const record = (ran, tool, args, stdout) => { ran.calls.push(`exec ${tool} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`); ran.outputs.push(stdout); };
async function session(deps, args, ran) {
    const out = await deps.exec([...args, "--json"]).catch(() => ({ stdout: "", code: 1 }));
    record(ran, "orion-session", [...args, "--json"], out.stdout);
    const state = parse(out.stdout);
    return out.code === 0 && state && state.ok !== false ? state : null;
}
const isWork = (b) => b.kind !== "class" && !b.fixed && (WORK_KINDS.has(b.kind ?? "") || (!b.kind || b.kind === "other") && WORK_TITLE.test(b.title));
/** "50/10 unless the plan says otherwise": the block's own length, unless it is about the standard 50-60. */
const lengthFor = (minutes) => (minutes >= STANDARD.min && minutes <= STANDARD.max) || minutes < 10 ? undefined : Math.min(240, minutes);
async function pickTask(deps, not) {
    const day = deps.readDay ? await deps.readDay().catch(() => undefined) : undefined;
    const at = deps.now.getHours() * 60 + deps.now.getMinutes();
    const skip = not?.toLowerCase();
    const work = (day?.blocks ?? []).filter((b) => isWork(b) && toMin(b.end) - at >= 10 && b.title.toLowerCase() !== skip).sort((a, b) => toMin(a.start) - toMin(b.start));
    const current = work.find((b) => toMin(b.start) <= at);
    const block = current ?? work[0];
    if (block) {
        const minutes = current ? toMin(block.end) - at : toMin(block.end) - toMin(block.start);
        const len = lengthFor(minutes);
        return { task: block.title, ...(len !== undefined ? { minutes: len } : {}) };
    }
    const due = deps.readDeadlines ? await deps.readDeadlines().catch(() => undefined) : undefined;
    const title = topDeadline(due, deps.now);
    return title && title.toLowerCase() !== skip ? { task: title } : undefined;
}
async function allowedFor(deps, task, ran) {
    const pick = await json(deps.profile, ["pick", task, "--json"]);
    const raw = (Array.isArray(pick?.apps) ? pick.apps : [{ name: "Safari", bundleId: "com.apple.Safari" }]);
    record(ran, "orion-focus-profile", ["pick", task, "--json"], JSON.stringify(pick ?? {}));
    const resolved = await Promise.all(raw.map(async (a) => ({ name: a.name, id: a.bundleId ?? (await deps.resolveApp(a.name).catch(() => null)) })));
    return {
        names: resolved.filter((r) => r.id).map((r) => r.name), ids: resolved.flatMap((r) => (r.id ? [r.id] : [])),
        domains: Array.isArray(pick?.domains) ? pick.domains : [], missing: resolved.filter((r) => !r.id).map((r) => r.name),
    };
}
async function startWork(deps, pick) {
    const ran = { calls: [], outputs: [] };
    const status = await session(deps, ["status"], ran);
    if (status && LIVE.has(String(status.status ?? ""))) {
        return say(`A focus session is already running, ${minutesOf(status.remainingSeconds)} minutes left. I haven't changed it.`, "plain", ran.calls, ran.outputs);
    }
    const started = await session(deps, ["start", pick.task, ...(pick.minutes ? ["--minutes", String(pick.minutes)] : [])], ran);
    if (!started || !LIVE.has(String(started.status ?? "")))
        return say(`I couldn't start the focus session on ${pick.task}, so nothing is running.`, "plain", ran.calls, ran.outputs);
    // A new session never inherits an old guard (focus-web.json): clear it first, set it only once the apps are really armed.
    const cleared = await deps.sites(["clear", "--json"]).catch(() => ({ stdout: "", code: 1 }));
    record(ran, "orion-focus-sites", ["clear", "--json"], cleared.stdout);
    const allowed = await allowedFor(deps, pick.task, ran);
    let armed = false;
    if (allowed.ids.length)
        armed = !!(await session(deps, ["arm", "--level", "gentle", "--allow", allowed.ids.join(",")], ran));
    if (armed) {
        const args = ["set", "--task", pick.task, "--apps", allowed.ids.join(","), "--names", allowed.names.join(","), "--domains", allowed.domains.join(",")];
        const out = await deps.sites(args).catch(() => ({ stdout: "", code: 1 }));
        record(ran, "orion-focus-sites", args, out.stdout);
    }
    deps.pending.set({ kind: "apps", task: pick.task, at: deps.now.getTime() });
    const miss = allowed.missing.length ? ` I couldn't find ${listed(allowed.missing)}.` : "";
    const line = armed ? `Allowed: ${listed(allowed.names)}.${miss} Need anything else?` : `I couldn't set the allowed apps, so nothing is blocked.${miss}`;
    return { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Starting ${minutesOf(started.remainingSeconds)} min on ${pick.task}. ${line}` };
}
async function ready(deps) {
    const pick = await pickTask(deps);
    if (!pick) {
        deps.pending.set({ kind: "task", at: deps.now.getTime() });
        return say("What are we working on?", "ask");
    }
    return startWork(deps, pick);
}
// -- the apps reply -------------------------------------------------------------------------------------------------------------------
async function addApps(deps, pending, said, led) {
    const task = pending.task ?? "this";
    const ran = { calls: [], outputs: [] };
    const found = [], missing = [];
    for (const word of said) {
        const id = await deps.resolveApp(word).catch(() => null);
        if (id)
            found.push({ name: cap(word), id });
        else
            missing.push(cap(word));
    }
    // A bare reply ("weather") that is not an app is not an answer to the question: leave it for the rest of ORION.
    if (!found.length && !led)
        return null;
    deps.pending.set(undefined);
    if (!found.length)
        return say(`I couldn't find ${listed(missing)}, so the allowed apps are as they were.`);
    const shown = (await json(deps.sites, ["show", "--json"]));
    const current = Array.isArray(shown?.allowedApps) ? shown.allowedApps : [];
    const ids = found.map((f) => f.id), names = found.map((f) => f.name);
    const all = [...new Set([...current, ...ids])];
    const armed = await session(deps, ["arm", "--level", "gentle", "--allow", all.join(",")], ran);
    if (!armed)
        return say(`I couldn't change the allowed apps just now, so they're as they were.`, "plain", ran.calls, ran.outputs);
    const addArgs = ["add-apps", "--apps", ids.join(","), "--names", names.join(",")];
    const added = await deps.sites(addArgs).catch(() => ({ stdout: "", code: 1 }));
    record(ran, "orion-focus-sites", addArgs, added.stdout);
    const remember = ["remember", task, "--apps", ids.join(",")];
    const kept = await deps.profile(remember).catch(() => ({ stdout: "", code: 1 }));
    record(ran, "orion-focus-profile", remember, kept.stdout);
    const miss = missing.length ? ` I couldn't find ${listed(missing)}.` : "";
    const memory = kept.code === 0 ? `, and I'll remember them for ${task}` : ", but I couldn't save them for next time";
    return { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Added ${listed(names)} for this session${memory}.${miss}` };
}
// -- finishing early ------------------------------------------------------------------------------------------------------------------
const FILLER = new Set(["the", "my", "a", "an", "some", "to", "on", "for", "of"]);
async function tickOff(deps, task, ran) {
    const keyWords = task.toLowerCase().split(/\s+/).filter((w) => !FILLER.has(w)).join(" ");
    for (const words of [...new Set([task.toLowerCase(), keyWords])]) {
        const out = await deps.tasks(["done", words]).catch(() => ({ stdout: "", code: 1 }));
        record(ran, "orion-tasks", ["done", words], out.stdout);
        const ticked = /Changed "(.+?)": done/.exec(out.stdout);
        if (out.code === 0 && ticked?.[1])
            return ticked[1];
    }
    return undefined;
}
const aboutTask = (object, task) => {
    const said = content(object ?? "").filter((w) => !/^(?:it|this|that|work|everything|all|task|session|focus|block)$/.test(w));
    return said.length === 0 || said.some((w) => content(task).some((t) => t.includes(w) || w.includes(t)));
};
async function finishEarly(deps, done) {
    const ran = { calls: [], outputs: [] };
    const status = await session(deps, ["status"], ran);
    if (!status || !LIVE.has(String(status.status ?? "")))
        return { outcome: "fallback", reason: "no session to finish" };
    const task = typeof status.task === "string" && status.task && status.task !== "Focus" ? status.task : "";
    if (!aboutTask(done.object, task))
        return { outcome: "fallback", reason: "done with something else" };
    if (!(await session(deps, ["finish"], ran)))
        return say("I couldn't end the focus session just now, so it's still running.", "plain", ran.calls, ran.outputs);
    const ticked = done.markDone && task ? await tickOff(deps, task, ran) : undefined;
    const marked = done.markDone && !!task;
    const next = await pickTask(deps, task || undefined);
    deps.pending.set({ kind: "early", ...(task ? { task } : {}), ...(next ? { next: next.task } : {}), marked: !!ticked, at: deps.now.getTime() });
    const tick = ticked ? `, I ticked off "${ticked}"` : marked && task ? `. I couldn't find a to-do called "${task.toLowerCase()}" to tick off` : "";
    const ask = next ? `Start your break now, or move to ${next.task}?` : "Start your break now?";
    return { outcome: "say", kind: "ask", text: `Nice${tick}${tick.startsWith(".") ? " " : ". "}${ask}`.replace(/^Nice, I ticked off ("[^"]+")\. /, 'Nice, I ticked off $1. '), calls: ran.calls, outputs: ran.outputs };
}
async function answerEarly(deps, pending, message) {
    const next = pending.next ?? (pending.askNext ? (await pickTask(deps, pending.task))?.task : undefined);
    const answer = readEarlyAnswer(message, !!next, next);
    if (!answer)
        return null;
    deps.pending.set(undefined);
    const ran = { calls: [], outputs: [] };
    const ticked = answer.mark && !pending.marked && pending.task ? await tickOff(deps, pending.task, ran) : undefined;
    const lead = ticked ? `Ticked off "${ticked}". ` : "";
    if (answer.choice === "end")
        return say(`${lead}Okay, you're done for now.`, "plain", ran.calls, ran.outputs);
    if (answer.choice === "next" && next) {
        const flow = await startWork(deps, { task: next, ...(await lengthOf(deps, next)) });
        return lead && flow.outcome === "done" ? { ...flow, reply: `${lead}${flow.reply ?? ""}` } : flow;
    }
    const out = await runBreak({ kind: "break", minutes: 10, work: 50, restart: true, assumed: false }, { exec: deps.exec, now: deps.now, ...(next ? { task: next } : {}), mayStart: true });
    if (!out.flow)
        return say("I couldn't start the break just now.", "plain", ran.calls, ran.outputs);
    if (out.flow.outcome === "done")
        return { ...out.flow, calls: [...ran.calls, ...out.flow.calls], outputs: [...ran.outputs, ...out.flow.outputs], reply: `${lead}${out.flow.reply ?? ""}` };
    return out.flow;
}
const lengthOf = async (deps, title) => {
    const picked = await pickTask(deps);
    return picked && picked.task === title && picked.minutes ? { minutes: picked.minutes } : {};
};
// -- the override ---------------------------------------------------------------------------------------------------------------------
async function allowSite(deps, site) {
    const ran = { calls: [], outputs: [] };
    const status = await session(deps, ["status"], ran);
    if (!status || !LIVE.has(String(status.status ?? "")))
        return { outcome: "fallback", reason: "no session" };
    const out = await deps.sites(["allow", site, "--json"]).catch(() => ({ stdout: "", code: 1 }));
    record(ran, "orion-focus-sites", ["allow", site, "--json"], out.stdout);
    const domain = typeof parse(out.stdout)?.domain === "string" ? String(parse(out.stdout).domain) : "";
    if (out.code !== 0 || !domain)
        return say(`I couldn't allow ${site} just now, so it's still off limits.`, "plain", ran.calls, ran.outputs);
    return { outcome: "done", calls: ran.calls, outputs: ran.outputs, reply: `Okay, ${domain} is allowed for the rest of this session.` };
}
/** One turn about starting or ending work. A fallback means the message is not about this, and nothing was touched. */
export async function runFocusReady(message, deps) {
    const fallback = { outcome: "fallback", reason: "not a work start or end" };
    const site = readSiteOverride(message);
    if (site)
        return allowSite(deps, site);
    const openQuestion = deps.pending.get();
    if (isSignOff(message, { pending: !!openQuestion && deps.now.getTime() - openQuestion.at <= PENDING_MS }))
        return fallback; // w20 r6: "ok last one, cheers" is thanks, not the apps he was asked for
    const done = isDoneMessage(message);
    if (done)
        return finishEarly(deps, done);
    const pending = deps.pending.get();
    const fresh = pending && deps.now.getTime() - pending.at <= PENDING_MS ? pending : undefined;
    if (isReadyMessage(message))
        return deps.mayStart ? ready(deps) : fallback;
    if (!fresh)
        return fallback;
    if (fresh.kind === "early")
        return (await answerEarly(deps, fresh, message)) ?? fallback;
    if (fresh.kind === "apps") {
        const reply = readAppsReply(message);
        if (!reply)
            return fallback;
        if (reply.none) {
            deps.pending.set(undefined);
            return say("Locked in. Go.");
        }
        return (await addApps(deps, fresh, reply.apps, hasAppsLead(message))) ?? fallback;
    }
    // kind "task": what are we working on? Any short statement that is not a question names it.
    const named = message.trim().replace(/^(?:ok(?:ay)?|um|uh|its|it'?s|the|my|just)\s+/i, "").replace(/[.!]+$/, "").trim();
    if (!deps.mayStart || !named || /\?/.test(message) || named.split(/\s+/).length > 8)
        return fallback;
    deps.pending.set(undefined);
    return startWork(deps, { task: /^the econ/i.test(message.trim()) || /^(?:the|my)\s/i.test(message.trim()) ? message.trim().replace(/[.!]+$/, "") : named });
}
// -- live wiring (index.ts only) ----------------------------------------------------------------------------------------------------------
const SCRIPTS = "/Users/nickmadaio/Desktop/ORION/scripts";
const runFile = (file, args, timeout) => new Promise((resolve) => execFile(process.execPath, [file, ...args], { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({
    stdout: error ? String(stderr || stdout || error.message) : String(stdout), code: error ? (typeof error.code === "number" ? error.code : 1) : 0
})));
export const liveFocusProfile = (args) => runFile(join(SCRIPTS, "orion-focus-profile"), args, 15000);
export const liveFocusSites = (args) => runFile(join(SCRIPTS, "orion-focus-sites"), args, 15000);
export const liveTasksRun = (args) => runFile(join(SCRIPTS, "orion-tasks"), args, 30000);
const pendingFile = () => join(process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled"), "focus-ready-pending.json");
/** The one open question, kept in a file so the Mac app (the Done early button) and this plugin share it. */
export const livePending = {
    get: () => { try {
        const p = JSON.parse(readFileSync(pendingFile(), "utf8"));
        return p && typeof p.at === "number" ? p : undefined;
    }
    catch {
        return undefined;
    } },
    set: (p) => {
        try {
            mkdirSync(join(pendingFile(), ".."), { recursive: true });
            const tmp = `${pendingFile()}.${process.pid}.tmp`;
            writeFileSync(tmp, JSON.stringify(p ?? {}));
            renameSync(tmp, pendingFile());
        }
        catch { /* an unwritable question is simply not remembered */ }
    },
};
