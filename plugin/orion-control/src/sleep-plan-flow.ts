/*
 The sleep-plan interview and the night exceptions (W10-B, 2026-11-02). sleep-plan-read.ts reads what he said; this asks the next
 missing thing, previews the week from his real calendar, and saves only on his yes. Every write goes through
 scripts/orion-sleepplan (fixed arguments, no shell), and every line about his week is built from what it returned.

   "im going to start waking up earlier and going to bed earlier"
     → "Love that. Roughly what time do you want to get up?"   → "6am"
     → "Every day, or just some days?"                          → "only mon wed thu"
     → "And how long before a class do you want to be up?"      → "3 hours"
     → "Mon 6:00, Tue 9:00 (class 1:30), … — bed by 10pm the night before 6:00 days. Sound right?" → "yep" → saved.
   One message can carry all of it ("6am mon wed thu, otherwise 9, 3h before class"): answered questions are skipped.
   "out with friends tonight" / "coursework till 1" → no lockdown tonight; "gaming till 2" → the lockdown stands, said lightly.
 The pending interview lives SleepPlanPending.TTL_MS and is dropped by any turn that does not answer it.
*/
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import type { FlowResult } from "./schedule-flow.js";
import { ORION_WAKE } from "./wake-flow.js";
import type { Draft, SleepPending, SleepStep, SleepTurn } from "./sleep-plan-read.js";

export type SleepRun = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type SleepTool = { canonical: string; stdout: string; exit: number };
export type SleepOutcome = { flow: FlowResult; pending?: SleepPending; tools: SleepTool[] };

type PlanDay = { date: string; weekday: string; wake: string; reason: string; firstClass: { title: string; at: string } | null;
  evening: string; sleepBy: string; lockdownAt: string; exception: { reason: string; until: string | null } | null };
type PlanOut = { ok: boolean; calendar?: string; plan?: { nudgeBeforeMin?: number; byDay?: Record<string, unknown>; firstClassLeadMin?: number | null }; days?: PlanDay[] };

/** One interview per chat, for a few minutes; taken (and so cleared) by the next turn whatever it is. */
export class SleepPlanPending {
  static readonly TTL_MS = 15 * 60_000;
  private readonly held = new Map<string, { pending: SleepPending; at: number }>();
  take(key: string, nowMs: number): SleepPending | undefined {
    const h = this.held.get(key);
    this.held.delete(key);
    return h && nowMs - h.at < SleepPlanPending.TTL_MS ? h.pending : undefined;
  }
  set(key: string, pending: SleepPending | undefined, nowMs: number): void {
    if (pending) this.held.set(key, { pending, at: nowMs }); else this.held.delete(key);
  }
}

const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const QUESTIONS: Record<Exclude<SleepStep, "confirm">, string> = {
  wake: "Love that. Roughly what time do you want to get up?",
  days: "Every day, or just some days?",
  lead: "And how long before a class do you want to be up?",
};
const REASKS: Record<Exclude<SleepStep, "confirm">, string> = {
  wake: "Just a rough time is fine, like 6 or 7:30?",
  days: "Which days, like weekdays or mon wed thu?",
  lead: "How long before class, like 2 or 3 hours? Or say no rule.",
};

/** "06:00" → "6:00"; "13:30" → "1:30". */
const clock = (hhmm: string): string => { const [h, m] = hhmm.split(":").map(Number); return `${(h! % 12) || 12}:${String(m).padStart(2, "0")}`; };
/** "22:00" → "10pm"; "00:00" → "midnight"; "01:00" → "1am". */
const meridiem = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === 0 && m === 0) return "midnight";
  return `${(h! % 12) || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h! < 12 ? "am" : "pm"}`;
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** orion-sleepplan arguments for a draft (days, wake, rest, lead). */
export function draftArgs(d: Draft): string[] {
  return [...(d.days && d.wake ? ["--days", d.days.join(","), "--wake", d.wake, "--only"] : []), ...(d.rest ? ["--rest", d.rest] : []),
    ...(d.lead !== undefined ? ["--lead", d.lead === null ? "off" : String(d.lead)] : [])];
}

const nextStep = (d: Draft): Exclude<SleepStep, "confirm"> | undefined => (!d.wake ? "wake" : !d.days ? "days" : d.lead === undefined ? "lead" : undefined);

const parse = (stdout: string): PlanOut | undefined => { try { const o = JSON.parse(stdout) as PlanOut; return o && typeof o === "object" ? o : undefined; } catch { return undefined; } };

/** "Mon 6:00, Tue 9:00 (class 1:30), … — bed by 10pm the night before 6:00 days." Built from the CLI's days only. */
export function weekLine(days: PlanDay[]): string {
  const byDay = new Map(days.map((d) => [d.weekday, d]));
  const shown = ORDER.filter((w) => byDay.has(w));
  const weekend = ["sat", "sun"].map((w) => byDay.get(w));
  const sameWeekend = weekend.every(Boolean) && weekend[0]!.wake === weekend[1]!.wake && !weekend[0]!.firstClass && !weekend[1]!.firstClass;
  const parts = shown.filter((w) => !(sameWeekend && (w === "sat" || w === "sun"))).map((w) => {
    const d = byDay.get(w)!;
    return `${cap(w)} ${clock(d.wake)}${d.firstClass ? ` (class ${clock(d.firstClass.at)})` : ""}`;
  });
  if (sameWeekend) parts.push(`weekend ${clock(weekend[0]!.wake)}`);
  const earliest = [...days].sort((a, b) => a.wake.localeCompare(b.wake))[0];
  const bed = earliest ? ` — bed by ${meridiem(earliest.sleepBy)} the night before ${clock(earliest.wake)} days` : "";
  return `${parts.join(", ")}${bed}.`;
}

const say = (text: string, kind: "ask" | "plain" = "plain"): FlowResult => ({ outcome: "say", kind, text });

async function call(run: SleepRun, args: string[], tools: SleepTool[]): Promise<{ out?: PlanOut; code: number; stdout: string }> {
  const r = await run(args).catch(() => ({ stdout: "", code: 1 }));
  tools.push({ canonical: `exec orion-sleepplan ${args.join(" ")}`, stdout: r.stdout, exit: r.code });
  return { code: r.code, stdout: r.stdout, ...(r.code === 0 ? { out: parse(r.stdout) } : {}) };
}

async function interview(draft: Draft, reask: SleepStep | undefined, run: SleepRun): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const step = nextStep(draft);
  if (step) {
    const text = reask === step ? REASKS[step] : step === "days" && draft.wake ? `Got it, ${clock(draft.wake)}. ${QUESTIONS.days}` : QUESTIONS[step];
    return { flow: say(text, "ask"), pending: { step, draft, ...(reask === step ? { reasked: true } : {}) }, tools };
  }
  const preview = await call(run, ["plan", "--json", ...draftArgs(draft)], tools);
  if (!preview.out?.days?.length) return { flow: say("I couldn't work out your week just now, so nothing's changed. Try me again in a bit?"), tools };
  const blind = preview.out.calendar && preview.out.calendar !== "ok" ? " I couldn't see your calendar, so classes aren't counted yet." : "";
  return { flow: say(`${weekLine(preview.out.days)}${blind} Sound right?`, "ask"), pending: { step: "confirm", draft }, tools };
}

async function save(draft: Draft, run: SleepRun): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const r = await call(run, ["set", ...draftArgs(draft), "--json"], tools);
  const first = r.out?.days?.[0];
  if (!r.out?.ok || !first) return { flow: say("I couldn't save that just now, so your sleep plan hasn't changed."), tools };
  const nudge = r.out.plan?.nudgeBeforeMin ?? 30;
  const reply = `Done, that's your plan now. Next up: bed by ${meridiem(first.sleepBy)}, alarm ${clock(first.wake)} ${cap(first.weekday)}. I'll nudge you ${nudge} min before bed.`;
  return { flow: { outcome: "done", calls: tools.map((t) => t.canonical), outputs: tools.map((t) => t.stdout), reply }, tools };
}

async function except(reason: string, until: string | undefined, run: SleepRun): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const r = await call(run, ["except", "--date", "tonight", "--reason", reason, ...(until ? ["--until", until] : []), "--json"], tools);
  if (!r.out?.ok) return { flow: say("I couldn't note that just now, so tonight's bedtime lockdown still stands."), tools };
  const first = r.out.days?.[0];
  const send = reason === "schoolwork" ? "Good luck with it." : "Have fun.";
  const his = Object.keys(r.out.plan?.byDay ?? {}).length > 0 || typeof r.out.plan?.firstClassLeadMin === "number";
  const alarm = first && his ? ` Your alarm's still ${clock(first.wake)}, so pace yourself.` : "";
  return { flow: { outcome: "done", calls: tools.map((t) => t.canonical), outputs: tools.map((t) => t.stdout),
    reply: `Got it, no lockdown tonight${until ? ` till ${meridiem(until)}` : ""}. ${send}${alarm}` }, tools };
}

async function noExcept(activity: string, run: SleepRun): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const r = await call(run, ["plan", "--json"], tools);
  const at = r.out?.days?.[0]?.lockdownAt;
  const when = at ? `still kicks in at ${meridiem(at)}` : "still stands";
  return { flow: say(`${activity} doesn't get you a pass, so the lockdown ${when}. Friends or schoolwork, I'd let it slide.`), tools };
}

/** One turn of the sleep plan, end to end. */
export async function runSleepTurn(turn: SleepTurn, { run }: { run: SleepRun }): Promise<SleepOutcome> {
  if (turn.kind === "decline") return { flow: say("Okay, I left your sleep plan as it was."), tools: [] };
  if (turn.kind === "interview") return interview(turn.draft, turn.reask, run);
  if (turn.kind === "confirm") return save(turn.draft, run);
  if (turn.kind === "except") return except(turn.reason, turn.until, run);
  return noExcept(turn.activity, run);
}

/** The real script (no shell, fixed arguments), beside orion-wake (ORION_SCRIPTS_DIR for a replay). Wired in by index.ts only. */
export const liveSleepPlanRun: SleepRun = (args) => new Promise((resolve) =>
  execFile(join(process.env.ORION_SCRIPTS_DIR || dirname(ORION_WAKE), "orion-sleepplan"), args, { timeout: 30000, maxBuffer: 1 << 20 }, (e, stdout, stderr) =>
    resolve({ stdout: e ? `${String(stdout ?? "")}${String(stderr ?? "")}` : String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
