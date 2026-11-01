/*
 His answer to ORION's bedtime line (pending-reply.ts → pending-reply-act.ts), moved here from pending-reply-act.ts on 2026-10-31 (W5).

 "cant sleep", "i have a lot to do tho", "im up working on econ", "5 more min" were handled before; W5 (gate run-1031224700) adds:
   - "fine going to bed now" (reply kind "bed"): goodnight, the wake alarm confirmed against the first fixed thing tomorrow (moved earlier
     only when it would make him late), and one quiet check-back in case he is still up. Before, nothing read it ("Got it. Sleep well.").
   - the nap is booked only for a short night (under seven hours from the cap to his wake time), not for "5 more min" at 12:43 AM;
   - the nap line says the length the calendar shows (his learned minimum made a 30 min nap 75, and the reply said 30).
 Every write goes through the scheduler, orion-checkin or orion-wake, and every line is built from what they returned.
*/
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ORION_WAKE } from "./wake-flow.js";
import type { Memo, PendingOutcome } from "./pending-reply.js";
import type { Reply } from "./pending-reply-read.js";
import type { Ctx } from "./pending-reply-act.js";
import { dayEndFor } from "./life-window.js";
import { addCommand, dayWord, firstFixed, flowText, flowWrote, freeSlot, h12, nowMinOf, placedSpan, toMin, unseen, wakeDayIsToday } from "./pending-reply-day.js";
import type { Day, DayBlock } from "./schedule-flow.js";

type BedMemo = Extract<Memo, { kind: "bedtime" }>;

/** Under this much sleep (minutes, from the cap to his wake time) the night is short and tomorrow gets a nap. */
export const SHORT_NIGHT_MIN = 7 * 60;
/** With no alarm of his own, he wakes this long before the first fixed thing (the phone's automatic alarm is first class minus get-ready time). */
const READY_MIN = 60;
/** A manual alarm later than this before the first fixed thing would make him late: it moves to READY_MIN before. */
const LATEST_ALARM_LEAD = 30;
/** The quiet check after "going to bed": once, this long after. */
const BED_CHECK_MIN = 20;
/** "one more thing" past bedtime: the limit ORION gives it, said as his limit in the reply (Wave 6). */
export const ONE_MORE_MIN = 15;

/**
 Wave 6 (gate run-1101003318, loop-reply-bed-v): "ok one more thing" read as nothing, and the model asked "What is the one more thing?".
 "one more <unit>", "one last <unit>", "finish this one bit": a stall of unstated length. Not a request ("add one more gym") or a question.
*/
const ONE_MORE = /\b(?:one|1|another)\s+(?:more|last)\s+(?:thing|ep|episode|game|round|match|level|video|vid|chapter|page|email|bit|song|question|problem|section|part|task)s?\b|\bfinish(?:ing)?\s+(?:this|the|my)\s+(?:one\s+|last\s+)?(?:thing|bit|part)\b/i;
const STALL_NOT = /\?\s*$|\b(?:add|book|schedule|move|put|remind|can you|could you|for me)\b/i;
/**
 REV6 MUST 1: "one more thing, gym at 7 tmrw" and "one more question about the essay" were swallowed as a stall (the gym change was
 dropped). It is a stall only when nothing he wants follows the "one more …": filler words and punctuation may, anything else is routed.
*/
const TRAIL_FILLER = new Set(["lol", "lmao", "haha", "pls", "plz", "please", "ok", "okay", "k", "then", "first", "tho", "though", "bed", "sleep", "i", "promise", "swear", "fr", "real", "quick", "quickly", "and", "after", "that", "im", "going", "to"]);
const onlyFiller = (rest: string): boolean => (rest.toLowerCase().match(/[a-z0-9']+/g) ?? []).every((w) => TRAIL_FILLER.has(w.replace(/'/g, "")));
export function readBedStall(message: string): Extract<Reply, { kind: "defer" }> | undefined {
  const m = message.trim();
  const hit = ONE_MORE.exec(m);
  if (m.split(/\s+/).length > 10 || STALL_NOT.test(m) || !hit) return undefined;
  if (!onlyFiller(m.slice(hit.index + hit[0].length))) return undefined;
  return { kind: "defer", stall: true };
}
const oneMore = (said: string | undefined): boolean => !!said && ONE_MORE.test(said);

/** The manual wake alarm still ahead (wake-request.json, written by orion-wake), in minutes on the day he wakes into; undefined for none. */
export function manualAlarm(stateDir: string | undefined, now: Date): number | undefined {
  if (!stateDir) return undefined;
  try {
    const at = Date.parse((JSON.parse(readFileSync(join(stateDir, "wake-request.json"), "utf8")) as { at?: string }).at ?? "");
    if (!Number.isFinite(at) || at <= now.getTime() || at - now.getTime() > 24 * 3600_000) return undefined;
    return nowMinOf(new Date(at));
  } catch { return undefined; }
}

/** Minutes from `from` (today's clock, minutes) to `wake` on the day he wakes into. */
const sleepBetween = (from: number, wake: number, now: Date): number => (wakeDayIsToday(now) ? wake - from : wake + 1440 - from);

export async function bedtime(c: Ctx, r: Reply, memo?: BedMemo): Promise<PendingOutcome | undefined> {
  const wake = await c.day("tomorrow");
  const anchor = firstFixed(wake);
  const anchorLine = anchor ? ` ${anchor.title} at ${h12(toMin(anchor.start))} stays.` : "";
  const when = dayWord("tomorrow", c.now) || "";
  const alarm = manualAlarm(c.deps.stateDir, c.now);
  const wakeAt = alarm ?? (anchor ? toMin(anchor.start) - READY_MIN : undefined);
  let napped = memo?.napped ?? false;
  const nap = async (bedAt: number): Promise<string> => {
    if (napped || wakeAt === undefined || sleepBetween(bedAt, wakeAt, c.now) >= SHORT_NIGHT_MIN) return "";
    const from = anchor ? toMin(anchor.end) + 5 : 12 * 60;
    const start = freeSlot(wake, 30, Math.max(from, 12 * 60), 18 * 60);
    if (start === undefined) return "";
    const flow = await c.schedule(addCommand("nap", 30, "tomorrow", start, c.now));
    if (!flowWrote(flow)) return "";
    napped = true;
    const seen = placedSpan(await c.day("tomorrow"), "nap", start);
    return seen === undefined ? ` ${unseen("the nap")}` : ` I put a ${seen.minutes} min nap at ${h12(seen.start)}${when} so the short night doesn't wreck the day.`;
  };
  const memoOut = (extra: Partial<BedMemo> = {}): Memo => ({ kind: "bedtime", at: c.now.getTime(), ...(memo?.checkinId ? { checkinId: memo.checkinId } : {}), ...(memo?.checkinAt !== undefined ? { checkinAt: memo.checkinAt } : {}), napped, ...extra });
  if (r.kind === "bed") return goingToBed(c, wake, anchor, alarm, memo);
  if (r.kind === "workload" || (r.kind === "awake" && r.workload && !r.activity && r.minutes === undefined)) {
    const from = anchor ? toMin(anchor.end) + 5 : 10 * 60;
    const start = freeSlot(wake, 60, from, dayEndFor(c.deps.stateDir));
    if (start === undefined) return c.done(`It'll keep till tomorrow — sleep matters more tonight.${anchorLine} Tell me what's due and I'll find it a slot.`, memoOut());
    const flow = await c.schedule(addCommand("catch-up work", 60, "tomorrow", start, c.now));
    if (!flowWrote(flow)) return c.done(`${flowText(flow) ?? "I couldn't book the catch-up just now."} Either way, it keeps till tomorrow — sleep now.`, memoOut());
    const seen = placedSpan(await c.day("tomorrow"), "catch-up work", start);
    if (seen === undefined) return c.done(`${unseen("the catch-up work")} Either way, it keeps till tomorrow — sleep now.`, memoOut());
    const right = anchor && seen.start === toMin(anchor.end) + 5 ? `, right after ${anchor.title}` : "";
    return c.done(`It'll keep — I put ${seen.minutes} min of catch-up work at ${h12(seen.start)}${when}${right}. Sleep now.${anchorLine}`, memoOut());
  }
  if (r.kind === "awake" && r.sleepless && !r.activity && r.minutes === undefined) {
    const napLine = await nap(c.nowMin);
    return c.done(`Then don't fight it — lights off, phone away, just lie down; rest still counts.${napLine}${anchorLine}`, memoOut());
  }
  if (r.kind === "awake" || r.kind === "defer") {
    const one = r.kind === "defer" && r.minutes === undefined && !r.activity && oneMore(c.turn.said);
    const minutes = r.minutes ?? (one ? ONE_MORE_MIN : 30);
    const assumed = r.minutes === undefined;
    const target = c.nowMin + minutes;
    const what = r.activity ? ` on ${r.activity}` : "";
    if (memo?.checkinAt !== undefined && Math.abs(memo.checkinAt - target) <= 10) {
      return c.done(`Deal — ${h12(memo.checkinAt)}, then bed. I'll check then.${anchorLine}`, memoOut());
    }
    const because = one ? c.turn.said!.slice(0, 120) : r.activity ?? "staying up";
    const out = memo?.checkinId ? await c.checkin(["defer", String(minutes), memo.checkinId, "--because", because]) : await c.checkin(["add", String(minutes), "bed", "--because", because]);
    const id = memo?.checkinId ?? out?.stdout.match(/\b(ci-[0-9a-f]+)\b/)?.[1];
    const napLine = await nap(target);
    const check = out && out.code === 0 ? ` I'll check at ${h12(target)}.` : " I couldn't set the check-back, so set yourself a timer.";
    const lead = one ? `Okay — one more thing, ${minutes} min max (my limit, since it's past your bedtime)` : `Okay — ${minutes} min${what}${assumed ? " (that's the cap)" : ""}`;
    return c.done(`${lead}, then bed.${check}${napLine}${anchorLine}`, memoOut({ ...(id ? { checkinId: id } : {}), ...(out?.code === 0 ? { checkinAt: target } : {}) }));
  }
  return undefined;
}

/** "fine going to bed now": goodnight, the alarm checked against tomorrow's first fixed thing, one quiet check-back. */
async function goingToBed(c: Ctx, wake: Day | undefined, first: DayBlock | undefined, alarm: number | undefined, memo?: BedMemo): Promise<PendingOutcome> {
  // REV5 SHOULD 6: the alarm answers to the first fixed thing he will actually be at, not one he is skipping or that is online.
  const anchor = first ? attendedFirst(wake, readSkips(c.deps.stateDir, wake?.date)) : undefined;
  const alarmLine = await protectAlarm(c, anchor, alarm);
  const tomorrow = anchor ? ` ${anchor.title} at ${h12(toMin(anchor.start))} stays${earlyClear(wake, anchor) ? ", nothing before it" : ""}.` : "";
  const checkAt = c.nowMin + BED_CHECK_MIN;
  const already = memo?.checkinAt !== undefined;
  const out = already ? undefined : await c.checkin(["add", String(BED_CHECK_MIN), "bed", "--because", (c.turn.said ?? "going to bed").slice(0, 120)]);
  const check = already ? "" : out && out.code === 0 ? ` If you're still up at ${h12(checkAt)}, I'll check in.` : "";
  return c.done(`Good — goodnight.${alarmLine}${tomorrow}${check}`, null);
}

/** A class he can join from bed: nothing to get up early for. */
const REMOTE = /\b(?:online|zoom|remote|virtual|async(?:hronous)?|teams call|recorded)\b/i;
type Skips = { titles: string[]; noClasses: boolean };
const normTitle = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** What he declared off on the day he wakes into (declared-facts.json: kind skip names the block, kind no-classes takes every class). */
export function readSkips(stateDir: string | undefined, date: string | undefined): Skips {
  if (!stateDir || !date) return { titles: [], noClasses: false };
  try {
    const file = JSON.parse(readFileSync(join(stateDir, "declared-facts.json"), "utf8")) as { schemaVersion?: number; facts?: Array<{ kind?: string; date?: string; title?: string }> };
    const facts = file.schemaVersion === 1 && Array.isArray(file.facts) ? file.facts.filter((f) => f && f.date === date) : [];
    return { titles: facts.filter((f) => f.kind === "skip" && typeof f.title === "string" && normTitle(f.title)).map((f) => normTitle(f.title!)), noClasses: facts.some((f) => f.kind === "no-classes") };
  } catch { return { titles: [], noClasses: false }; }
}
const isClass = (b: DayBlock): boolean => b.kind === "class" || /^[A-Za-z]{2,5}\s?\d{3,5}\b/.test(b.title.trim());
/** The first fixed block he will be at in person: skipped (the same rule as declared-facts cancels()) and online ones left out. */
export function attendedFirst(day: Day | undefined, skips: Skips): DayBlock | undefined {
  const off = (b: DayBlock) => REMOTE.test(b.title) || (skips.noClasses && isClass(b)) || skips.titles.some((t) => normTitle(b.title).includes(t));
  return firstFixed(day ? { ...day, blocks: day.blocks.filter((b) => !off(b)) } : undefined);
}

/** Nothing ORION could move sits before the anchor on the day he wakes into. */
const earlyClear = (day: Day | undefined, anchor: DayBlock): boolean =>
  !(day?.blocks ?? []).some((b) => b !== anchor && toMin(b.start) < toMin(anchor.start) && b.kind !== "sleep" && !/^sleep\b/i.test(b.title));

/** The wake alarm said as it is, or moved earlier (orion-wake) when it would make him late for the anchor. */
async function protectAlarm(c: Ctx, anchor: DayBlock | undefined, alarm: number | undefined): Promise<string> {
  if (!anchor) return alarm !== undefined ? ` Your alarm's set for ${h12(alarm)}.` : "";
  const latest = toMin(anchor.start) - LATEST_ALARM_LEAD;
  if (alarm !== undefined && alarm <= latest) return ` Your alarm's set for ${h12(alarm)}.`;
  if (alarm === undefined) return ` Your alarm's on automatic, so it goes off before ${anchor.title}.`;
  if (!c.deps.wake) return ` Your alarm's set for ${h12(alarm)}, after you'd need to be up for ${anchor.title} — move it earlier.`;
  const to = Math.max(0, toMin(anchor.start) - READY_MIN);   // REV5: a class just after midnight is 00:00, never "-1:-30"
  const hhmm = `${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}`;
  const out = await c.deps.wake([hhmm]).catch(() => ({ stdout: "", code: 1 }));
  c.acc.tools.push({ canonical: `exec orion-wake ${hhmm}`, stdout: out.stdout, exit: out.code });
  if (out.code === 0 && /^Sent to/.test(out.stdout.trim())) { c.acc.wrote = true; return ` I moved your alarm to ${h12(to)} — ${h12(alarm)} was too late for ${anchor.title}.`; }
  if (out.code === 0 && /^Saved an alarm/.test(out.stdout.trim())) { c.acc.wrote = true; return ` I saved your alarm for ${h12(to)}, but the phone link isn't running, so your iPhone doesn't have it yet.`; }
  return ` Your alarm's set for ${h12(alarm)}, after you'd need to be up for ${anchor.title}, and I couldn't move it — set it earlier yourself.`;
}

/** orion-wake with fixed arguments (no shell). Wired in by index.ts only. */
export const liveWakeExec = (args: string[]): Promise<{ stdout: string; code: number }> => new Promise((resolve) =>
  execFile(join(process.env.ORION_SCRIPTS_DIR || dirname(ORION_WAKE), "orion-wake"), args, { timeout: 15000 }, (e, stdout, stderr) =>
    resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? 1 : 0 })));
