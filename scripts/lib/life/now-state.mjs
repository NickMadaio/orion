// The now record's inputs and its file (2026-10-30). lib/life/now-record.mjs decides; this reads the state directory,
// the calendar and the clock, and keeps now.json. Producers: orion-proactive (every tick) and orion-now --json.
// Readers: readNowRecord, which refuses a record of another schemaVersion rather than guessing at it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../awareness/io.mjs";
import { readAwareness } from "../awareness/state.mjs";
import { readDeclaredFacts } from "../awareness/declared-facts.mjs";
import { controlledDir, clockNow } from "../clock.mjs";
import { nowRecord, NOW_SCHEMA_VERSION } from "./now-record.mjs";
import { liveDayWithLogged, liveDay, localDate } from "./live-day.mjs";
import { loadConfig } from "./config.mjs";
import { planBedtime } from "./effective-bed.mjs";

export const NOW_FILE = "now.json";
const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const latest = (...xs) => xs.filter((x) => x && !Number.isNaN(Date.parse(x))).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
/** A JSON-lines file as rows; a missing file or a torn line is skipped, never thrown. */
const lines = (path) => { try { return readFileSync(path, "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }); } catch { return []; } };

/**
 * Tonight's plan, as orion-now has always worked it out: wake 75 min before tomorrow's first fixed thing (from 05:00),
 * never after 09:00; bed 8 h before that, never after midnight. Before 06:00 "tomorrow" is today.
 */
export function sleepPlanFor({ minute, tomorrow = [] }) {
  const nightOf = minute < 360;
  const first = (tomorrow ?? []).find((b) => b.fixed && b.start >= 300 && (nightOf ? b.start > minute : true));
  const wake = Math.min(540, first ? first.start - 75 : 540);
  const bed = Math.min(1440, wake + 1440 - 480) % 1440;
  return { bedtime: hhmm(bed), wake: hhmm(wake) };
}

/** When each sensor last reported: the phone (awareness, else the health log), the Mac (awareness), WHOOP (nights, today's record). */
export function sensorsFrom({ aw, healthLog = {}, nights = [] }) {
  const days = healthLog?.days ?? {};
  const lastDay = Object.keys(days).sort().at(-1);
  return {
    phone: latest(aw?.phone?.lastSampleAt, (healthLog?.phoneSignals ?? []).at(-1)?.at),
    mac: latest(aw?.mac?.at),
    whoop: latest((nights ?? []).at(-1)?.wokeAt, lastDay ? days[lastDay]?.updatedAt : null),
  };
}

/** Everything nowRecord needs that lives in the state directory. */
export function stateInputs(dir) {
  const healthLog = readJson(join(dir, "health-log.json")) ?? {};
  const nights = readJson(join(dir, "sleep-actual.json"))?.nights ?? [];
  return {
    healthLog, nights,
    slips: lines(join(dir, "slips.jsonl")),
    declared: readDeclaredFacts(dir),
    checkins: readJson(process.env.ORION_CHECKIN_FILE || join(dir, "checkins.json"))?.checkins ?? [],
    patterns: readJson(process.env.ORION_PATTERNS_FILE || join(dir, "patterns.json")),
  };
}

/**
 * The record at `now`. Callers that already hold awareness or today's calendar pass them (orion-proactive does, with its
 * own fallbacks), so the calendar is read once per tick; otherwise they are read here.
 */
export async function buildNow({ dir = controlledDir(), now = clockNow(), aw = null, day = null, dayOk = null, tomorrowDay = null, config = null } = {}) {
  const awareness = aw ?? readAwareness({ dir, now });
  const minute = now.getHours() * 60 + now.getMinutes();
  // before 06:00 the plan is still the evening's: its blocks are yesterday's date, its "tomorrow" is today
  const planDate = localDate(minute < 360 ? new Date(now.getTime() - 86400000) : now);
  let blocks = day, ok = dayOk;
  if (!Array.isArray(blocks)) { try { blocks = await liveDayWithLogged(planDate); ok = true; } catch { blocks = []; ok = false; } }
  let tomorrow = tomorrowDay;
  if (!Array.isArray(tomorrow)) { try { tomorrow = await liveDay(minute < 360 ? localDate(now) : localDate(new Date(now.getTime() + 86400000))); } catch { tomorrow = []; } }
  const s = stateInputs(dir);
  const cfg = config ?? loadConfig();
  // The bedtime shown goes through effective-bed: a night he named, or a standing bedtime he fixed, beats the computed one.
  const computed = sleepPlanFor({ minute, tomorrow });
  const sleepPlan = { ...computed, bedtime: planBedtime(cfg, planDate, computed.bedtime) };
  return nowRecord({ now, aw: awareness, day: blocks, dayOk: ok !== false, config: cfg, sleepPlan,
    slips: s.slips, declared: s.declared, checkins: s.checkins, patterns: s.patterns, sensors: sensorsFrom({ aw: awareness, healthLog: s.healthLog, nights: s.nights }) });
}

/** now.json, atomically (temp file + rename, under the awareness lock). */
export const writeNowRecord = (dir, record) => writeJsonAtomic(dir, NOW_FILE, record);

/** The last record written, or null when there is none or it is not schemaVersion 1. */
export function readNowRecord(dir = controlledDir()) {
  const r = readJson(join(dir, NOW_FILE));
  return r && r.schemaVersion === NOW_SCHEMA_VERSION ? r : null;
}
