/*
 Blocking and unblocking his phone's app groups from chat, by code (W10-G, 2026-11-02). phone-block-read.ts reads what he said; this runs
 scripts/orion-phone-time block|unblock with fixed arguments (no shell) and builds the reply from what the script printed. Nothing is
 claimed that the script did not confirm: a refusal or a failed run says nothing was blocked.
*/
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ORION_WAKE } from "./wake-flow.js";
import { pluginNow } from "./plugin-clock.js";
import { GROUPS, GROUP_LABEL, LIST_NAME, MAX_MINUTES, clockLabel, resolveSpan, } from "./phone-block-read.js";
/** The real script, beside orion-wake (ORION_SCRIPTS_DIR for a replay). Wired in by index.ts only. */
export const livePhoneTimeRun = (args) => new Promise((resolve) => execFile(join(process.env.ORION_SCRIPTS_DIR || dirname(ORION_WAKE), "orion-phone-time"), args, { timeout: 15000, maxBuffer: 1 << 20 }, (e, stdout, stderr) => resolve({ stdout: `${String(stdout ?? "")}${e ? String(stderr ?? "") : ""}`, code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
/** His next wake alarm from wake-plan.json (the plan's own file, in the state dir); undefined when there is none. */
export function wakeAtFromPlan(stateDir, now) {
    if (!stateDir)
        return undefined;
    try {
        const plan = JSON.parse(readFileSync(join(stateDir, "wake-plan.json"), "utf8"));
        const times = (plan.alarms ?? []).map((a) => (typeof a.iso === "string" ? Date.parse(a.iso) : NaN)).filter((t) => Number.isFinite(t) && t - now.getTime() >= 60_000);
        return times.length ? new Date(Math.min(...times)) : undefined;
    }
    catch {
        return undefined;
    }
}
const say = (text) => ({ outcome: "say", kind: "plain", text });
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const GROUP_OF = { social: "social", feeds: "social", browsers: "browsers", video: "video", games: "games", messaging: "messaging" };
const sayLabels = (names) => list(names.map((n) => GROUP_LABEL[GROUP_OF[n.trim()] ?? "social"] ?? n));
const cmd = (args) => `exec orion-phone-time ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** What the block covers: the apps he named, if they sit in the group's list, else whatever he picked there. */
function covers(groups, apps) {
    const lists = list(groups.map((g) => `your ${LIST_NAME[g]} list`));
    return apps.length ? `that covers ${list(apps)} if ${apps.length > 1 ? "they're" : "it's"} in ${lists}` : `that covers whatever apps are in ${lists}`;
}
const NOT_PICKED = /no apps|haven'?t picked|has not picked|not picked|nothing is shielded/i;
/** The script's own caveat is a standing sentence about groups he never set up; only a statement about THIS group counts. */
const saysNoneSet = (stdout) => NOT_PICKED.test(stdout.replace(/If he never picked apps for a group[^.]*\./i, ""));
/** Blocks `groups` for a span. A length over the limit, or a run that fails, blocks nothing and says so. */
export async function blockGroups(opts) {
    const { groups, apps, run } = opts;
    const resolved = resolveSpan(opts.span, opts.now, opts.wake);
    if ("tooLong" in resolved)
        return { flow: say(`I can only block for up to ${MAX_MINUTES / 60} hours at a time, so nothing is blocked yet. Want ${MAX_MINUTES / 60} hours, or a shorter stretch?`), tools: [], wrote: false };
    const args = ["block", groups.map((g) => (g === "social" ? "social" : g)).join(","), "--minutes", String(resolved.minutes), "--why", "asked in chat"];
    const out = await run(args).catch(() => ({ stdout: "", code: 1 }));
    const tools = [{ canonical: cmd(args), stdout: out.stdout, exit: out.code }];
    if (out.code !== 0 || !/^\s*Sent to his phone/i.test(out.stdout)) {
        return { flow: say(`I couldn't block ${sayLabels(groups)} just now, so nothing is blocked. Say go and I'll retry it.`), tools, wrote: false };
    }
    const label = opts.all ? "everything (social media, browsers, video, games and messaging)" : sayLabels(groups);
    const until = clockLabel(resolved.until);
    const assumed = resolved.note === "default" ? " (I went with an hour since you didn't say how long)" : resolved.note === "capped" ? ` (that's the ${MAX_MINUTES / 60}-hour limit, shorter than until your alarm)` : "";
    const none = saysNoneSet(out.stdout) ? ` Heads up: pick the apps for ${groups.length > 1 ? "those groups" : "that group"} in ORION on your phone, or nothing gets shielded.` : "";
    const kinds = opts.distractions ? ` (I took "distracting" to mean ${label}; browsers and messaging are still open, tell me if you want those shut too)` : "";
    const reply = `Blocked ${label} on your phone until ${until}${assumed}${kinds}, ${opts.all ? "everything on your lists" : covers(groups, apps)}.${none}`;
    return { flow: { outcome: "done", calls: [cmd(args)], outputs: [out.stdout], reply }, tools, wrote: true };
}
/** Opens groups again (or everything ORION shut). The reply says what the script said happened. */
export async function unblockGroups(opts) {
    const target = opts.groups === "all" ? "all" : opts.groups.join(",");
    const args = ["unblock", target];
    const out = await opts.run(args).catch(() => ({ stdout: "", code: 1 }));
    const tools = [{ canonical: cmd(args), stdout: out.stdout, exit: out.code }];
    const text = out.stdout.trim();
    if (out.code !== 0 || !text)
        return { flow: say("I couldn't reach your phone link just now, so nothing changed. Say go and I'll retry it."), tools, wrote: false };
    const still = text.match(/Still shut:\s*([^.]+)\./)?.[1];
    const stillSaid = still ? ` Still shut: ${sayLabels(still.split(","))}.` : "";
    const named = opts.groups === "all" ? "everything" : sayLabels(opts.groups);
    if (/^Sent to his phone/i.test(text)) {
        const opened = text.match(/^Sent to his phone:\s*([^.]+?) open again/i)?.[1];
        const what = opts.groups === "all" ? (opened ? sayLabels(opened.split(",")) : "everything ORION had shut") : named;
        const via = opts.apps.length && opts.groups !== "all" ? ` That's the group ${list(opts.apps)} sits in, so the rest of it is open too.` : "";
        return { flow: { outcome: "done", calls: [cmd(args)], outputs: [out.stdout], reply: `Opened ${what} on your phone again.${via}${stillSaid}` }, tools, wrote: true };
    }
    const nothing = opts.groups === "all" ? "I don't have anything blocked for you" : `I didn't have ${named} blocked`;
    return { flow: say(`${cap(nothing)}, so nothing changed. A bedtime or work-block lock ends on its own, or I can give you extra time if you need into your apps.${stillSaid}`), tools, wrote: false };
}
/** The whole route for a read request: block, unblock, or the one short question. */
export async function runPhoneBlock(read, deps) {
    if (read.kind === "ask")
        return { flow: { outcome: "say", kind: "ask", text: read.text }, tools: [], wrote: false };
    const now = deps.now ?? pluginNow();
    if (read.kind === "unblock")
        return unblockGroups({ groups: read.groups, apps: read.apps, run: deps.run });
    return blockGroups({ groups: read.groups.length ? read.groups : [...GROUPS], apps: read.apps, ...(read.span ? { span: read.span } : {}), ...(read.all ? { all: true } : {}), ...(read.distractions ? { distractions: true } : {}), run: deps.run, now, wake: () => wakeAtFromPlan(deps.stateDir, now) });
}
