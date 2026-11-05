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
import { pluginNow } from "./plugin-clock.js";
import { cap, clock, meridiem } from "./sleep-fmt.js";
import { runAlarmTurn } from "./alarm-flow.js";
import { runBedChange } from "./bedtime-change.js";
import type { Draft, SleepPending, SleepStep, SleepTurn } from "./sleep-plan-read.js";

export type SleepRun = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type SleepTool = { canonical: string; stdout: string; exit: number };
export type SleepOutcome = { flow: FlowResult; pending?: SleepPending; tools: SleepTool[] };

type PlanDay = { date: string; weekday: string; wake: string; reason: string; firstClass: { title: string; at: string } | null;
  evening: string; sleepBy: string; nudgeAt?: string; lockdownAt: string; wakeIso?: string; nudgeAtIso?: string; exception: { reason: string; until: string | null } | null };
type PlanOut = { ok: boolean; error?: string; calendar?: string; plan?: { nudgeBeforeMin?: number; byDay?: Record<string, unknown>; firstClassLeadMin?: number | null }; days?: PlanDay[] };

/** One interview per chat, for a few minutes; taken (and so cleared) by the next turn whatever it is. */
export class SleepPlanPending {
  static readonly TTL_MS = 15 * 60_000;
  private readonly held = new Map<string, { pending: SleepPending; at: number }>();
  take(key: string, nowMs: number): SleepPending | undefined {
    const h = this.held.get(key);
    this.held.delete(key);
    return h && nowMs - h.at < SleepPlanPending.TTL_MS ? h.pending : undefined;
  }
  /** W18: an alarm was just talked about, so his next bare "push it back 20 min" is about it. */
  static readonly ALARM_TTL_MS = 30 * 60_000;
  private readonly alarmAt = new Map<string, number>();
  noteAlarm(key: string, nowMs: number): void { this.alarmAt.set(key, nowMs); }
  recentAlarm(key: string, nowMs: number): boolean { const at = this.alarmAt.get(key); return at !== undefined && nowMs - at < SleepPlanPending.ALARM_TTL_MS; }
  set(key: string, pending: SleepPending | undefined, nowMs: number): void {
    if (pending) this.held.set(key, { pending, at: nowMs }); else this.held.delete(key);
  }
}

const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const QUESTIONS: Record<Exclude<SleepStep, "confirm" | "grace">, string> = {
  wake: "Love that. Roughly what time do you want to get up?",
  days: "Every day, or just some days?",
  lead: "And how long before a class do you want to be up?",
};
const REASKS: Record<Exclude<SleepStep, "confirm" | "grace">, string> = {
  wake: "Just a rough time is fine, like 6 or 7:30?",
  days: "Which days, like weekdays or mon wed thu?",
  lead: "How long before class, like 2 or 3 hours? Or say no rule.",
};

const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
const weekdayOf = (date: string): string => ORDER[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]!;
/** ["mon", "wed", "thu"] → "Mon, Wed and Thu". */
const listDays = (days: string[]): string => { const c = days.map(cap); return c.length > 1 ? `${c.slice(0, -1).join(", ")} and ${c.at(-1)}` : c[0] ?? ""; };

/** orion-sleepplan arguments for a draft. An alarm asked for outright keeps his other days (no --only); the interview replaces them. */
export function draftArgs(d: Draft): string[] {
  return [...(d.days && d.wake ? ["--days", d.days.join(","), "--wake", d.wake, ...(d.direct ? [] : ["--only"])] : []),
    ...(d.also ?? []).flatMap((a) => ["--also", `${a.days.join(",")}=${a.wake}`]), ...(d.rest ? ["--rest", d.rest] : []),
    ...(d.lead !== undefined ? ["--lead", d.lead === null ? "off" : String(d.lead)] : []), ...(d.sleep !== undefined ? ["--sleep", String(d.sleep)] : []),
    ...(d.forGym && d.days && d.wake && !d.days.includes("gym") ? ["--gym"] : [])];
}

const nextStep = (d: Draft): "wake" | "days" | undefined => (!d.wake ? "wake" : !d.days ? "days" : undefined);

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
  return { code: r.code, stdout: r.stdout, out: parse(r.stdout) };
}

/** The CLI could not tell which days are gym days (no Gym block this week, no gym days set): ask. */
const gymUnknown = (out: PlanOut | undefined): boolean => out?.ok === false && /gym days/i.test(out.error ?? "");
const GYM_ASK = "Which days are gym days?";

/** A day he gave no time for whose first class the 3-hour rule would pull earlier: only then is the lead worth asking. */
const leadMatters = (days: PlanDay[]): boolean => days.some((d) => d.reason !== "plan" && d.firstClass && toMin(d.firstClass.at) - 180 < toMin(d.wake));

/** The next alarm that will really ring (his per-day wake or the class rule), with the bedtime the night before it. */
function nextAlarm(days: PlanDay[]): string {
  const a = days.find((d) => d.reason === "plan" || d.reason === "class");
  return a ? `Next alarm ${clock(a.wake)} ${cap(a.weekday)}, so bed by ${meridiem(a.sleepBy)} ${cap(weekdayOf(a.evening))}.` : "";
}

async function interview(draft: Draft, reask: SleepStep | undefined, run: SleepRun): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const step = draft.lead === undefined && reask === "lead" ? "lead" : nextStep(draft);
  if (step) {
    const text = reask === step ? REASKS[step] : step === "days" && draft.wake ? `Got it, ${clock(draft.wake)}. ${QUESTIONS.days}` : QUESTIONS[step];
    return { flow: say(text, "ask"), pending: { step, draft, ...(reask === step ? { reasked: true } : {}) }, tools };
  }
  if (draft.direct) return save(draft, run, true);
  const preview = await call(run, ["plan", "--json", ...draftArgs(draft)], tools);
  if (gymUnknown(preview.out)) { const { days: _d, ...rest } = draft; return { flow: say(GYM_ASK, "ask"), pending: { step: "days", draft: rest }, tools }; }
  if (!preview.out?.ok || !preview.out.days?.length) return { flow: say("I couldn't work out your week just now, so nothing's changed. Try me again in a bit?"), tools };
  if (draft.lead === undefined && !draft.rest && !draft.days?.includes("all") && leadMatters(preview.out.days)) return { flow: say(QUESTIONS.lead, "ask"), pending: { step: "lead", draft }, tools };
  const blind = preview.out.calendar && preview.out.calendar !== "ok" ? " I couldn't see your calendar, so classes aren't counted yet." : "";
  return { flow: say(`${weekLine(preview.out.days)}${blind} Sound right?`, "ask"), pending: { step: "confirm", draft }, tools };
}

async function save(draft: Draft, run: SleepRun, direct = false): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const r = await call(run, ["set", ...draftArgs(draft), "--json"], tools);
  if (gymUnknown(r.out)) { const { days: _d, ...rest } = draft; return { flow: say(GYM_ASK, "ask"), pending: { step: "days", draft: rest }, tools }; }
  if (r.code !== 0 || !r.out?.ok || !r.out.days?.length) return { flow: say("I couldn't save that just now, so your sleep plan hasn't changed."), tools };
  const nudge = r.out.plan?.nudgeBeforeMin ?? 30;
  const set = Object.entries((r.out.plan?.byDay ?? {}) as Record<string, { wake?: string }>).filter(([, v]) => v.wake === draft.wake).map(([d]) => d);
  const head = direct && draft.wake ? `Done, ${clock(draft.wake)} alarm on ${listDays(ORDER.filter((d) => set.includes(d)))} from now on.` : "Done, that's your plan now.";
  const reply = [head, nextAlarm(r.out.days), `I'll nudge you ${nudge} min before bed.`].filter(Boolean).join(" ");
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

/** orion-checkin with fixed arguments: the one quiet check-back a grace promises. */
export type SleepCheckin = (args: string[]) => Promise<{ stdout: string; code: number }>;
export const GRACE_MIN = 10;
const notFor = (activity: string): string => (activity === "Staying up" ? "Not tonight" : `Not for ${activity.toLowerCase()}`);

/*
 No exception (gaming, scrolling, "another hour"). Built from his plan (orion-sleepplan plan --json), never from a nudge's text: the
 bedtime is his (22:00 before a 6:00 day), the stakes are the hours to his alarm. A plea gets one short grace, and "I'll check in" is
 said only when orion-checkin really booked it. A second plea inside the grace gets none. Before his nudge time it is not late yet.
*/
async function noExcept(turn: Extract<SleepTurn, { kind: "noexcept" }>, run: SleepRun, now: Date, checkin?: SleepCheckin): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const r = await call(run, ["plan", "--json"], tools);
  const d = r.out?.days?.[0];
  if (!turn.grace) {
    const when = d?.lockdownAt ? `still kicks in at ${meridiem(d.lockdownAt)}` : "still stands";
    return { flow: say(`${turn.activity} doesn't get you a pass, so the lockdown ${when}. Friends or schoolwork, I'd let it slide.`), tools };
  }
  if (!d?.wakeIso) return { flow: say(`${notFor(turn.activity)}. Wrap it up and get to bed.`), tools };
  if (d.nudgeAtIso && now.getTime() < Date.parse(d.nudgeAtIso)) {
    return { flow: say(`You're fine till ${meridiem(d.sleepBy)}, then bed. You're up at ${clock(d.wake)}.`), tools };
  }
  const hours = Math.ceil((Date.parse(d.wakeIso) - now.getTime()) / 3_600_000);
  const stakes = `you're up at ${clock(d.wake)}${hours > 0 ? `, that's under ${hours}h away` : ""}`;
  if (turn.again) return { flow: say(`That was the one. Bed now, ${stakes}.`), tools };
  let back = "";
  if (checkin) {
    const args = ["add", String(GRACE_MIN), `Bed — up at ${clock(d.wake)}`, "--because", "one more before bed"];
    const c = await checkin(args).catch(() => ({ stdout: "", code: 1 }));
    tools.push({ canonical: `exec orion-checkin ${args.join(" ")}`, stdout: c.stdout, exit: c.code });
    if (c.code === 0) back = ` and I'll check in ${GRACE_MIN}`;
  }
  return { flow: say(`${notFor(turn.activity)}, ${stakes}. Finish this one${back}${back ? "" : ", then bed"}.`), pending: { step: "grace", draft: {} }, tools };
}

/*
 W10-B review 3 (gate hea-bedtime-set-v): "i wanna sleep earlier this week" started the wake interview. Sleep only is a bedtime change:
 saved in one reply through orion-sleepplan bedtime (the eval config in a sandbox), with the assumption said when he named no time,
 the nudge it moves, and what it means against tomorrow's alarm. All of it from the CLI's answer.
*/
type BedOut = PlanOut & { bedtime?: string; was?: string };
async function bedtime(time: string | undefined, run: SleepRun): Promise<SleepOutcome> {
  const tools: SleepTool[] = [];
  const r = await call(run, ["bedtime", time ?? "earlier", "--json"], tools);
  const out = r.out as BedOut | undefined;
  const d = out?.days?.[0];
  if (r.code !== 0 || !out?.ok || !out.bedtime || !d) return { flow: say("I couldn't change your bedtime just now, so it's as it was."), tools };
  if (out.was === out.bedtime) return { flow: say(`Your bedtime's already ${meridiem(out.bedtime)}. Tell me a time if you want it earlier.`), tools };
  const assumed = time ? "" : " I went 30 minutes earlier since you didn't name a time; say one if you want another.";
  const hours = (toMin(d.wake) + 1440 - toMin(d.sleepBy)) % 1440 / 60;
  const sleep = Number.isInteger(hours) ? `${hours}h` : hours % 1 === 0.5 ? `${Math.floor(hours)}½h` : `about ${Math.round(hours)}h`;
  const reply = `Bedtime's now ${meridiem(out.bedtime)}${out.was ? ` (was ${meridiem(out.was)})` : ""} and stays that way till you change it; I'll nudge you at ${meridiem(d.nudgeAt ?? d.sleepBy)}. Your ${clock(d.wake)} wake-up ${cap(d.weekday)} doesn't move, so that's ${sleep} of sleep.${assumed}`;
  return { flow: { outcome: "done", calls: tools.map((t) => t.canonical), outputs: tools.map((t) => t.stdout), reply }, tools };
}

/** One turn of the sleep plan, end to end. `now` is the plugin clock (pluginNow); checkin books the grace's check-back. */
export async function runSleepTurn(turn: SleepTurn, { run, now = pluginNow(), checkin }: { run: SleepRun; now?: Date; checkin?: SleepCheckin }): Promise<SleepOutcome> {
  if (turn.kind === "decline") return { flow: say("Okay, I left your sleep plan as it was."), tools: [] };
  if (turn.kind === "interview") return interview(turn.draft, turn.reask, run);
  if (turn.kind === "confirm") return save(turn.draft, run);
  if (turn.kind === "except") return except(turn.reason, turn.until, run);
  if (turn.kind === "bedtime") return bedtime(turn.time, run);
  if (turn.kind === "bedset") return runBedChange(turn.change, run);
  if (turn.kind === "alarm") return runAlarmTurn(turn.req, { run, now });
  return noExcept(turn, run, now, checkin);
}


/** The real script (no shell, fixed arguments), beside orion-wake (ORION_SCRIPTS_DIR for a replay). Wired in by index.ts only. */
export const liveSleepPlanRun: SleepRun = (args) => new Promise((resolve) =>
  execFile(join(process.env.ORION_SCRIPTS_DIR || dirname(ORION_WAKE), "orion-sleepplan"), args, { timeout: 30000, maxBuffer: 1 << 20 }, (e, stdout, stderr) =>
    resolve({ stdout: e ? `${String(stdout ?? "")}${String(stderr ?? "")}` : String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
