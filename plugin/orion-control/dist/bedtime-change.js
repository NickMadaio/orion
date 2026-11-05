import { meridiem } from "./sleep-fmt.js";
export const bedArgs = (c) => [
    "bedtime", ...("reset" in c ? ["reset"] : "time" in c ? [c.time] : ["shift", String(c.shift)]), ...(c.scope === "tonight" ? ["--tonight"] : []), "--json",
];
/** orion-sleepplan --json prints pretty (multi-line) JSON: parse the whole output, else the last single-line object. Never a lone "{". */
export function parseScriptJson(stdout) {
    const text = stdout.trim();
    for (const candidate of [text, text.slice(text.indexOf("{")), text.split("\n").at(-1) ?? ""]) {
        try {
            const o = JSON.parse(candidate);
            if (o && typeof o === "object")
                return o;
        }
        catch { /* next */ }
    }
    return undefined;
}
/** Runs the one writer and parses its read-back; any failure is an error with the script's own reason. */
export async function applyBedChange(c, run) {
    const args = bedArgs(c);
    const r = await run(args).catch(() => ({ stdout: "", code: 1 }));
    let out;
    out = parseScriptJson(r.stdout);
    if (r.code === 0 && out?.ok && out.readback)
        return { ok: true, readback: out.readback, ...(out.was ? { was: out.was } : {}), stdout: r.stdout, args };
    const raw = out?.error ?? (out ? "" : r.stdout.replace(/^NOTHING WAS SAVED:\s*/, "").trim().split("\n")[0] ?? "");
    return { ok: false, error: raw.slice(0, 160) || "the sleep plan did not answer", stdout: r.stdout, args };
}
const hm = (hours) => { const t = Math.round(hours * 60); const h = Math.floor(t / 60); const m = t % 60; return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`; };
/** What moved with the bedtime, in his words, from the read-back alone. */
export function bedtimeSentence(b, reset = false) {
    if (reset)
        return `Back to normal. Bedtime's ${meridiem(b.sleepBy)} tonight, worked out from your ${meridiem(b.wake)} alarm and how much sleep you need, not a fixed time. Wind-down at ${meridiem(b.nudgeAt)}.`;
    const when = b.tonightOnly ? "tonight" : "every night from now on";
    const alarm = `alarm ${b.alarmAsked ? "still" : "(the automatic one)"} ${meridiem(b.wake)}`;
    const parts = [`Bedtime ${meridiem(b.sleepBy)} ${when}.`, `Wind-down at ${meridiem(b.nudgeAt)}, ${alarm}, that's ${hm(b.hours)} of sleep.`];
    if (b.hours < b.lockdownBelowHours)
        parts.push(`That's under your ${b.lockdownBelowHours}h line, so the lockdown still applies unless you give me a reason.`);
    if (b.tonightOnly)
        parts.push("Say \"every night\" if you want it to stay.");
    return parts.join(" ");
}
export async function runBedChange(c, run) {
    const r = await applyBedChange(c, run);
    const tools = [{ canonical: `exec orion-sleepplan ${r.args.join(" ")}`, stdout: r.stdout, exit: r.ok ? 0 : 1 }];
    if (!r.ok)
        return { flow: { outcome: "say", kind: "plain", text: `I couldn't change your bedtime (${r.error}), so it's as it was.` }, tools };
    return { flow: { outcome: "done", calls: tools.map((t) => t.canonical), outputs: tools.map((t) => t.stdout), reply: bedtimeSentence(r.readback, "reset" in c) }, tools };
}
