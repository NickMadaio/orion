// When he woke today, and whether he is still inside the grace period after it (2026-10-19: "You've been avoiding X" landed
// two minutes after he woke). Sources, earliest wins: WHOOP / the phone's wake (night.actualWake), a wake signal in the
// sleep log (unplugged, used, up) and the morning brief going out. Unknown stays unknown: no wake time, no grace.
import { join } from "node:path";
import { readJson } from "./io.mjs";
import { actualWake } from "../life/night.mjs";

const localDate = (d) => d.toLocaleDateString("en-CA");
const minuteOf = (d) => d.getHours() * 60 + d.getMinutes();

/** Minutes after midnight he woke today, or null. */
export function wokeMinuteToday({ dir, now = new Date() }) {
  const today = localDate(now);
  const health = readJson(join(dir, "health-log.json")) ?? {};
  const candidates = [];
  const known = actualWake(today, { nights: readJson(join(dir, "sleep-actual.json"))?.nights ?? [], sleepLog: health.sleepLog ?? [], phoneSignals: health.phoneSignals ?? [], now });
  if (known) candidates.push(known.minute);
  for (const e of health.sleepLog ?? []) {
    const t = new Date(e?.at);
    if (["up", "unplugged", "used"].includes(e?.event) && !Number.isNaN(t.getTime()) && localDate(t) === today && t <= now && minuteOf(t) >= 180 && minuteOf(t) < 14 * 60) candidates.push(minuteOf(t));
  }
  const briefAt = new Date((readJson(join(dir, "morning-sent.json")) ?? {})[today]?.at);
  if (!Number.isNaN(briefAt.getTime()) && briefAt <= now) candidates.push(minuteOf(briefAt));
  return candidates.length ? Math.min(...candidates) : null;
}

/** True within `minutes` after he woke today: no scolding nudges (leave and class reminders still go). */
export function inWakeGrace({ dir, now = new Date(), minutes = 30 }) {
  const woke = wokeMinuteToday({ dir, now });
  const since = woke === null ? null : minuteOf(now) - woke;
  return since !== null && since >= 0 && since < minutes;
}
