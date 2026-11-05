/*
 A bedtime change, carried out (w20 routegate, 2026-11-04). bedtime-read.ts says what he meant; scripts/orion-sleepplan is the ONE writer:
 it writes life-config.json (the standing bedtime, plan.bedFixed) or the plan's bedOverrides (one night), rewrites wake-plan.json, and answers
 with a `readback` re-read from that file. The nudge engine, the wind-down, the plan and the phone all read those same files, so the reply
 states only what was read back, never what was asked for:

   "Bedtime 11:45 tonight. Wind-down at 11:15, alarm still 6:30, that's 6h45 of sleep."

 day-edit-run.ts (a bedtime inside a multi-part day edit) and sleep-plan-flow.ts (a bedtime on its own) both come through here.
*/
import type { FlowResult } from "./schedule-flow.js";
import type { BedChange } from "./bedtime-read.js";
import { meridiem } from "./sleep-fmt.js";

export type BedRun = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type Readback = { evening: string; sleepBy: string; nudgeAt: string; wake: string; wakeDate: string; alarmAsked: boolean; hours: number; lockdownBelowHours: number; tonightOnly: boolean; standing: string; fixed?: boolean };
export type BedResult = { ok: true; readback: Readback; was?: string; stdout: string } | { ok: false; error: string; stdout: string };

export const bedArgs = (c: BedChange): string[] => [
  "bedtime", ...("reset" in c ? ["reset"] : "time" in c ? [c.time] : ["shift", String(c.shift)]), ...(c.scope === "tonight" ? ["--tonight"] : []), "--json",
];

/** orion-sleepplan --json prints pretty (multi-line) JSON: parse the whole output, else the last single-line object. Never a lone "{". */
export function parseScriptJson(stdout: string): { ok?: boolean; error?: string; readback?: Readback | null; was?: string } | undefined {
  const text = stdout.trim();
  for (const candidate of [text, text.slice(text.indexOf("{")), text.split("\n").at(-1) ?? ""]) {
    try { const o = JSON.parse(candidate); if (o && typeof o === "object") return o; } catch { /* next */ }
  }
  return undefined;
}

/** Runs the one writer and parses its read-back; any failure is an error with the script's own reason. */
export async function applyBedChange(c: BedChange, run: BedRun): Promise<BedResult & { args: string[] }> {
  const args = bedArgs(c);
  const r = await run(args).catch(() => ({ stdout: "", code: 1 }));
  let out: { ok?: boolean; error?: string; readback?: Readback | null; was?: string } | undefined;
  out = parseScriptJson(r.stdout);
  if (r.code === 0 && out?.ok && out.readback) return { ok: true, readback: out.readback, ...(out.was ? { was: out.was } : {}), stdout: r.stdout, args };
  const raw = out?.error ?? (out ? "" : r.stdout.replace(/^NOTHING WAS SAVED:\s*/, "").trim().split("\n")[0] ?? "");
  return { ok: false, error: raw.slice(0, 160) || "the sleep plan did not answer", stdout: r.stdout, args };
}

const hm = (hours: number): string => { const t = Math.round(hours * 60); const h = Math.floor(t / 60); const m = t % 60; return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`; };

/** What moved with the bedtime, in his words, from the read-back alone. */
export function bedtimeSentence(b: Readback, reset = false): string {
  if (reset) return `Back to normal. Bedtime's ${meridiem(b.sleepBy)} tonight, worked out from your ${meridiem(b.wake)} alarm and how much sleep you need, not a fixed time. Wind-down at ${meridiem(b.nudgeAt)}.`;
  const when = b.tonightOnly ? "tonight" : "every night from now on";
  const alarm = `alarm ${b.alarmAsked ? "still" : "(the automatic one)"} ${meridiem(b.wake)}`;
  const parts = [`Bedtime ${meridiem(b.sleepBy)} ${when}.`, `Wind-down at ${meridiem(b.nudgeAt)}, ${alarm}, that's ${hm(b.hours)} of sleep.`];
  if (b.hours < b.lockdownBelowHours) parts.push(`That's under your ${b.lockdownBelowHours}h line, so the lockdown still applies unless you give me a reason.`);
  if (b.tonightOnly) parts.push("Say \"every night\" if you want it to stay.");
  return parts.join(" ");
}

export async function runBedChange(c: BedChange, run: BedRun): Promise<{ flow: FlowResult; tools: Array<{ canonical: string; stdout: string; exit: number }> }> {
  const r = await applyBedChange(c, run);
  const tools = [{ canonical: `exec orion-sleepplan ${r.args.join(" ")}`, stdout: r.stdout, exit: r.ok ? 0 : 1 }];
  if (!r.ok) return { flow: { outcome: "say", kind: "plain", text: `I couldn't change your bedtime (${r.error}), so it's as it was.` }, tools };
  return { flow: { outcome: "done", calls: tools.map((t) => t.canonical), outputs: tools.map((t) => t.stdout), reply: bedtimeSentence(r.readback, "reset" in c) }, tools };
}
