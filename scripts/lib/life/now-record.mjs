// The now record (2026-10-30): ORION's one answer to its standing question -- given Nick's goals, commitments, current
// state and what has actually happened today, what should he do now, and next? Every surface reads this record
// (now.json, `orion-now --json`) instead of deciding for itself. Pure: everything comes in as arguments.
//
// Contract, schemaVersion 1 (docs/design/2026-10-30-now-record.md). Adding a field is a minor change readers ignore;
// renaming, removing or changing the meaning of one is a new schemaVersion.
import { nextAction } from "./next-action.mjs";
import { commuteWalls } from "./commute.mjs";
import { dailyNeeds } from "./daily-needs.mjs";
import { evidenceOfStart } from "../curiosity/loop.mjs";
import { cancels, factsFor } from "../awareness/declared-facts.mjs";

export const NOW_SCHEMA_VERSION = 1;
export const RECORD_KEYS = Object.freeze(["schemaVersion", "computedAt", "shouldBe", "is", "mismatch", "next", "slipsToday", "declared", "strictness", "sensors", "sleepPlan"]);
export const MISMATCH_KINDS = Object.freeze(["not-started", "off-plan", "awake-late", "missed", "overrun"]);
export const SENSOR_LIMITS_MS = Object.freeze({ phone: 2 * 3600_000, mac: 10 * 60_000, whoop: 24 * 3600_000 });

const NOT_STARTED_AFTER = 5;     // minutes into a block before "not started" (lib/curiosity/loop.mjs uses the same)
const OFF_PLAN_DWELL = 15;
const PREPARE_MINUTES = 15;      // next-action.mjs's "prepare" window, applied to leaving for class
const OVERRUN_LOOKBACK = 120;
const FIRM_AFTER = 30;           // a mismatch this old is no longer a wobble
const HOME_KINDS = ["study", "side_project", "other", "deadline"];
const MOVING = ["walking", "running", "cycling", "vehicle", "automotive"];

const localDate = (d) => d.toLocaleDateString("en-CA");
const minuteOf = (d) => d.getHours() * 60 + d.getMinutes();
const hhmm = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMinute = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const words4 = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 3);
const sharesWord = (a, b) => { const set = new Set(words4(b)); return words4(a).some((w) => set.has(w)); };

/** An ISO instant for minute `m` of local day `day` (a Date at that day's midnight); minutes past 1440 roll over. */
const isoAt = (day, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m).toISOString();
const minutesBetween = (fromIso, now) => Math.max(0, Math.round((now.getTime() - Date.parse(fromIso)) / 60000));

/** The sleep window on this evening's clock: bed 00:00 is 1440, a 07:45 wake is the next morning. */
function sleepWindow(sleepPlan) {
  const b = toMinute(sleepPlan?.bedtime) ?? 1440;
  const bed = b < 12 * 60 ? b + 1440 : b;
  const w = toMinute(sleepPlan?.wake) ?? 540;
  return { bed, wake: w + 1440 };
}

/** The local day the plan belongs to: until 06:00 it is still the evening before. */
const planDay = (now) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return minuteOf(now) < 360 ? new Date(d.getTime() - 86400000) : d; };

function sensorsOf(sensors, now) {
  const one = (name) => {
    const at = sensors?.[name] ?? null;
    const t = Date.parse(at);
    return { lastSampleAt: at && !Number.isNaN(t) ? at : null, stale: Number.isNaN(t) || now.getTime() - t > SENSOR_LIMITS_MS[name] };
  };
  return { phone: one("phone"), mac: one("mac"), whoop: one("whoop") };
}

function isNow(aw) {
  const s = aw?.session ?? {}, loc = aw?.location ?? {}, mac = aw?.mac ?? {}, phone = aw?.phone ?? {};
  const evidence = [];
  if (["focus", "rest", "paused"].includes(s.state)) evidence.push(`session:${s.state}${s.task ? ` on ${s.task}` : ""}`);
  if (aw?.sleep?.state && aw.sleep.state !== "unknown") evidence.push(`sleep:${aw.sleep.state}${aw.sleep.source ? ` (${aw.sleep.source})` : ""}`);
  if (loc.state && loc.state !== "unknown") evidence.push(`location:${loc.placeId ?? loc.state}`);
  if (mac.state && mac.state !== "unknown") evidence.push(`mac:${mac.state}${mac.frontApp ? ` ${mac.frontApp}` : ""}`);
  if (phone.state && phone.state !== "unknown") evidence.push(`phone:${phone.state}`);
  const activity = aw?.sleep?.state === "asleep" ? "sleeping" : s.state === "focus" ? "focus" : s.state === "rest" ? "break" : s.state === "paused" ? "paused"
    : loc.placeId === "gym" ? "gym" : MOVING.includes(phone.motion) || loc.state === "moving" ? "moving" : mac.state === "active" ? "at-mac"
    : loc.state === "elsewhere" || loc.state === "known" ? "away" : "unknown";
  const confidence = ["focus", "break", "paused"].includes(activity) || (activity === "sleeping" && aw?.sleep?.source !== "window") ? "high"
    : ["at-mac", "gym", "away", "sleeping"].includes(activity) ? "medium" : activity === "moving" ? "low" : "none";
  const focusSession = ["focus", "rest", "paused"].includes(s.state) ? { state: s.state, task: s.task ?? null, endsAt: s.phaseEndsAt ?? null, sessionId: s.sessionId ?? null } : null;
  return { activity, place: loc.state === "unknown" || !loc.state ? null : loc.placeId ?? loc.state, focusSession, evidence, confidence };
}

/** Blocks that are off today: done, slipped away, or cancelled by something he declared. */
function openBlocks(day, { declared, checkins, slipsToday }) {
  const doneIds = new Set((checkins ?? []).filter((c) => c?.block && c.loop?.phase === "done").map((c) => c.block));
  const slipped = (b) => slipsToday.some((s) => s.title === b.title && s.startMinute === b.start);
  return (day ?? []).filter((b) => !b.logged && !doneIds.has(b.id) && !slipped(b) && !cancels(declared, b) && !["commute"].includes(b.kind));
}

/** The first commute-to-class wall matching `when`, with the class it leads to, or null. */
function classWall(blocks, config, when) {
  const wall = commuteWalls(blocks, config ?? {}).filter((w) => /to class/.test(w.title) && when(w)).sort((a, b) => a.start - b.start)[0];
  const target = wall && blocks.find((b) => b.kind === "class" && b.start === wall.end);
  return target ? { wall, target } : null;
}
/** The commute wall he should be in now. */
const travelNow = (blocks, config, minute) => classWall(blocks, config, (w) => w.start <= minute && minute < w.end);
/** A commute that starts within PREPARE_MINUTES. */
const leaveSoon = (blocks, config, minute) => classWall(blocks, config, (w) => w.start > minute && w.start - minute <= PREPARE_MINUTES);

function shouldBeFrom({ now, day0, minute, blocks, config, aw, sleepPlan, dayOk }) {
  const sleep = sleepWindow(sleepPlan);
  const eveningMinute = minuteOf(now) < 360 ? minuteOf(now) + 1440 : minuteOf(now);
  const pastBed = eveningMinute >= sleep.bed && eveningMinute < sleep.wake;
  if (aw?.sleep?.state === "asleep" || aw?.sleep?.state === "late-awake" || (pastBed && aw?.sleep?.state !== "awake")) {
    return { kind: "sleep", title: "Sleep", blockId: null, start: isoAt(day0, sleep.bed), end: isoAt(day0, sleep.wake),
      why: aw?.sleep?.state === "asleep" ? "Inside his sleep window." : `Bedtime was ${sleepPlan?.bedtime ?? "00:00"}.` };
  }
  if (!dayOk) return { kind: "unknown", title: "Calendar unreadable", blockId: null, start: now.toISOString(), end: now.toISOString(), why: "The calendar could not be read, so the plan is unknown." };
  const trip = travelNow(blocks, config, minute);
  if (trip) return { kind: "travel", title: `Head to ${trip.target.title}`, blockId: trip.target.id, start: isoAt(day0, trip.wall.start), end: isoAt(day0, trip.wall.end),
    why: `${trip.target.title} is at ${hhmm(trip.target.start)} and the commute takes ${trip.wall.end - trip.wall.start} min.` };
  const leave = leaveSoon(blocks, config, minute);
  if (leave) return { kind: "prepare", title: `Get ready to leave for ${leave.target.title}`, blockId: leave.target.id, start: now.toISOString(), end: isoAt(day0, leave.wall.start),
    why: `Leave at ${hhmm(leave.wall.start)} for ${leave.target.title} at ${hhmm(leave.target.start)}.` };
  const act = nextAction({ blocks, now: minute });
  const b = blocks.find((x) => x.id === act.blockId);
  if (act.action === "do" && b) return { kind: b.kind, title: b.title, blockId: b.id, start: isoAt(day0, b.start), end: isoAt(day0, b.end), why: act.reason };
  if (act.action === "prepare" && b) return { kind: "prepare", title: `Get ready for ${b.title}`, blockId: b.id, start: now.toISOString(), end: isoAt(day0, b.start), why: act.reason };
  const short = dailyNeeds(blocks, {}).missing.find((m) => m.need === "side_project")?.minutes ?? 0;
  const why = `${act.reason}${short > 0 ? ` No side-project time on the calendar yet (${short} min short of the daily hour).` : ""}`;
  return { kind: "free", title: "Free time", blockId: null, start: now.toISOString(), end: b ? isoAt(day0, b.start) : isoAt(day0, sleep.bed), why };
}

function mismatchFrom({ shouldBe, aw, now, day0, minute, blocks, day }) {
  if (shouldBe.kind === "sleep") {
    return aw?.sleep?.state === "asleep" ? null : { kind: "awake-late", since: shouldBe.start, minutes: minutesBetween(shouldBe.start, now) };
  }
  const s = aw?.session ?? {};
  if (s.state === "focus" && s.task) {
    const over = (day ?? []).filter((b) => b.end <= minute && b.end > minute - OVERRUN_LOOKBACK && b.id !== shouldBe.blockId && sharesWord(s.task, b.title)).sort((a, b) => b.end - a.end)[0];
    if (over) return { kind: "overrun", since: isoAt(day0, over.end), minutes: minute - over.end };
  }
  const b = blocks.find((x) => x.id === shouldBe.blockId);
  if (!b) return null;
  if (shouldBe.kind === "travel") {
    return aw?.derived?.atHome === true && minutesBetween(shouldBe.start, now) >= NOT_STARTED_AFTER
      ? { kind: "not-started", since: shouldBe.start, minutes: minutesBetween(shouldBe.start, now) } : null;
  }
  if (shouldBe.kind === "prepare") return null;
  // a session on the block's task is evidence even when the shared word is short ("Gym"; the loop's match needs 4 letters)
  if ((s.state === "focus" && (!s.task || sharesWord(s.task, b.title))) || evidenceOfStart(aw ?? {}, b, { day, checkin: null, minute })) return null;
  if (b.end <= minute) return { kind: "missed", since: isoAt(day0, b.end), minutes: minute - b.end };
  const loc = aw?.location ?? {};
  const away = loc.state === "elsewhere" || (loc.state === "known" && !/^(home|campus)/.test(String(loc.placeId)));
  const hasPlace = b.kind === "gym" || b.where || b.place;
  if (!hasPlace && HOME_KINDS.includes(b.kind) && away && Date.parse(loc.since) && minutesBetween(loc.since, now) >= OFF_PLAN_DWELL) {
    return { kind: "off-plan", since: new Date(loc.since).toISOString(), minutes: minutesBetween(loc.since, now) };
  }
  if (b.fixed && b.kind === "class") return aw?.derived?.atHome === true && minute - b.start >= NOT_STARTED_AFTER ? { kind: "not-started", since: isoAt(day0, b.start), minutes: minute - b.start } : null;
  return minute - b.start >= NOT_STARTED_AFTER ? { kind: "not-started", since: isoAt(day0, b.start), minutes: minute - b.start } : null;
}

function nextFrom({ shouldBe, blocks, config, day0, minute, sleepPlan }) {
  // heading to (or getting ready for) a block: that block is next; otherwise the earliest block still to start
  const target = shouldBe.kind === "travel" || shouldBe.kind === "prepare" ? blocks.find((b) => b.id === shouldBe.blockId) : null;
  const b = target ?? blocks.filter((x) => x.id !== shouldBe.blockId && x.start > minute).sort((x, y) => x.start - y.start)[0];
  if (!b) {
    if (shouldBe.kind === "sleep") return { kind: "wake", title: "Wake up", blockId: null, start: shouldBe.end };
    return { kind: "sleep", title: "Bed", blockId: null, start: isoAt(day0, sleepWindow(sleepPlan).bed) };
  }
  const wall = b.kind === "class" ? commuteWalls(blocks, config ?? {}).find((w) => /to class/.test(w.title) && w.end === b.start) : null;
  return { kind: b.kind, title: b.title, blockId: b.id, start: isoAt(day0, b.start), ...(wall ? { leaveBy: isoAt(day0, wall.start) } : {}) };
}

function strictnessOf({ mismatch, shouldBe, slipsToday, patterns }) {
  if (!mismatch) return "flexible";
  if (mismatch.minutes >= FIRM_AFTER) return "firm";
  const kind = shouldBe.kind;
  if (slipsToday.some((s) => s.kind === kind || s.title === shouldBe.title)) return "firm";
  const learned = patterns?.byKind?.[kind];
  return learned && learned.planned >= 3 && Number(learned.rate) < 0.5 ? "firm" : "flexible";
}

const slipRow = (s, day0) => ({ title: s.planned?.title ?? null, kind: s.planned?.kind ?? null, rank: s.planned?.rank ?? null,
  start: Number.isFinite(s.planned?.start) ? isoAt(day0, s.planned.start) : null, end: Number.isFinite(s.planned?.end) ? isoAt(day0, s.planned.end) : null,
  reason: s.reason ?? null, missedMinutes: s.missedMinutes ?? null, replacedBy: s.replacedBy ?? null, at: s.at ?? null });

const factRow = (f) => ({ id: f.id ?? null, kind: f.kind, text: f.text, at: f.at ?? null, source: f.source ?? null,
  ...(f.title ? { title: f.title } : {}), ...(f.blockId ? { blockId: f.blockId } : {}), ...(f.place ? { place: f.place } : {}) });

/**
 * @param now        Date (the clock: ORION_NOW in tests)
 * @param aw         awareness snapshot (lib/awareness/state.mjs readAwareness)
 * @param day        today's blocks (lib/life/live-day.mjs), with `date`
 * @param dayOk      false when the calendar could not be read
 * @param config     life-config (commuteMinutes, homeGapMinutes)
 * @param sleepPlan  { bedtime: "HH:MM", wake: "HH:MM" } (lib/life/now-state.mjs sleepPlanFor)
 * @param slips      slips.jsonl rows; declared: declared-facts rows; checkins: checkins.json rows; patterns: patterns.json
 * @param sensors    { phone, mac, whoop }: ISO time of each source's last sample, or null
 */
export function nowRecord({ now, aw = null, day = [], dayOk = true, config = {}, sleepPlan = {}, slips = [], declared = [], checkins = [], patterns = null, sensors = {} }) {
  const day0 = planDay(now);
  const date = localDate(day0);
  const minute = minuteOf(now) + (localDate(now) === date ? 0 : 1440);
  const slipsToday = (slips ?? []).filter((s) => s?.date === date).map((s) => ({ ...slipRow(s, day0), startMinute: s.planned?.start }));
  const facts = factsFor(declared, date);
  const blocks = openBlocks((day ?? []).map((b) => ({ ...b, date: b.date ?? date })), { declared: facts, checkins, slipsToday });
  const shouldBe = shouldBeFrom({ now, day0, minute, blocks, config, aw, sleepPlan, dayOk });
  const mismatch = dayOk || shouldBe.kind === "sleep" ? mismatchFrom({ shouldBe, aw, now, day0, minute, blocks, day }) : null;
  const slipsOut = slipsToday.map(({ startMinute: _drop, ...row }) => row);
  return {
    schemaVersion: NOW_SCHEMA_VERSION,
    computedAt: now.toISOString(),
    shouldBe,
    is: isNow(aw),
    mismatch,
    next: nextFrom({ shouldBe, blocks, config, day0, minute, sleepPlan }),
    slipsToday: slipsOut,
    declared: facts.map(factRow),
    strictness: strictnessOf({ mismatch, shouldBe, slipsToday: slipsOut, patterns }),
    sensors: sensorsOf(sensors, now),
    sleepPlan: { bedtime: sleepPlan?.bedtime ?? null, wake: sleepPlan?.wake ?? null },
  };
}
