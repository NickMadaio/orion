// The bedtime ladder stops on evidence that he is in bed (2026-10-23 audit: "he'll text me proactively saying go to bed
// WHILE IM TRYING TO SLEEP"). Before this, a bedtime line went out whenever the sleep window had not opened yet (bed-wind,
// a phone push with the Mac idle 11 min), or one Mac keystroke in the last 5 min made him "late-awake" (bed-now, bed-late),
// and his reply to a nag ("im doing work shush up") did not stop the next rung 40 min later.
// Pure: evidence in, a verdict out. readBedtimeEvidence() reads the files.
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { readJson, writeJsonAtomic } from "../awareness/io.mjs";

const MIN = 60_000;
/** Keys of the bedtime lines (lib/reach/proactive.mjs) and the "why" orion-reach sees for them. */
export const BED_KEYS = Object.freeze(["bed-wind", "bed-now", "bed-late"]);
export const isBedtimeWhy = (why) => /^proactive: (?:bed-(?:wind|now|late)\b|session-done-)/.test(String(why ?? ""));
/** A delivered row that IS a bedtime line, by its key: a bed-* rung, or the late session-done reminder. Never by its words. */
export const isBedtimeRow = (row) => /^proactive: bed-(?:wind|now|late)\b/.test(String(row?.why ?? ""))
  || (/^proactive: session-done-/.test(String(row?.why ?? "")) && row?.kind === "reminder");
/** At most this many bedtime lines reach him a night, whatever the ladder wants. */
export const NIGHTLY_CAP = 2;
/** No Mac or phone interaction for this long after bedtime: he is in bed, not up. */
export const INACTIVE_MINUTES = 15;
/** A phone sample this old still says where the phone is (it reports on change, not on a clock). */
const PHONE_FRESH_MS = 45 * MIN;
/** The phone counts as in his hand when its screen was unlocked this recently. */
const PHONE_IN_USE_MS = 5 * MIN;
const MOVING = ["walking", "running", "cycling", "vehicle", "automotive"];
export const ACK_FILE = "bedtime-ack.json";

/** The night a moment belongs to: the evening's date until 06:00. */
export const nightOf = (now) => new Date(now.getTime() - 6 * 3600_000).toLocaleDateString("en-CA");
const minuteOf = (d) => d.getHours() * 60 + d.getMinutes();
const atNight = (minute) => minute >= 21 * 60 || minute < 6 * 60;
/** Minutes since bedtime (negative before it), on a clock where a 00:30 bed is 1470 on the evening. */
export function minutesPastBed(minute, bed) {
  const bedEve = bed < 12 * 60 ? bed + 1440 : bed;
  const nowEve = minute < 12 * 60 ? minute + 1440 : minute;
  return nowEve - bedEve;
}

/**
 * Whether a bedtime line may go now.
 * @param e { now: Date, bed: minute of bedtime, declaredAt?: ISO, ack?: { night, at }, mac: { locked, displayAsleep, idleSeconds },
 *            phone: { charging, motion, at } | null, screen: { locked, at } | null, sentTonight: number }
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function bedtimeVerdict(e) {
  const now = e.now; const t = now.getTime(); const minute = minuteOf(now);
  const night = nightOf(now);
  if (e.declaredAt && t - Date.parse(e.declaredAt) >= -MIN && t - Date.parse(e.declaredAt) < 10 * 3600_000) return { ok: false, reason: "he said goodnight" };
  if (e.ack?.night === night) return { ok: false, reason: "he already answered a bedtime message tonight" };
  if ((e.sentTonight ?? 0) >= NIGHTLY_CAP) return { ok: false, reason: `already ${NIGHTLY_CAP} bedtime messages tonight` };
  const screenAt = Date.parse(e.screen?.at);
  const phoneInUse = e.screen?.locked === false && Number.isFinite(screenAt) && t - screenAt <= PHONE_IN_USE_MS;
  const phoneAt = Date.parse(e.phone?.at);
  const phoneFresh = Number.isFinite(phoneAt) && t - phoneAt >= 0 && t - phoneAt <= PHONE_FRESH_MS;
  // On the charger and not moving, at night, and not in his hand: he has settled (10-19 23:44, right after a "Still up" nag).
  if (atNight(minute) && phoneFresh && e.phone.charging === true && !MOVING.includes(e.phone.motion) && !phoneInUse) return { ok: false, reason: "his phone is on the charger and still - he has settled" };
  const past = minutesPastBed(minute, e.bed);
  const idle = Number(e.mac?.idleSeconds);
  const macAway = e.mac?.locked === true || e.mac?.displayAsleep === true;
  if (past >= -30 && macAway && !phoneInUse) return { ok: false, reason: "the Mac is locked or asleep at bedtime" };
  // No interaction at all for a while: inactive in his sleep window is asleep or trying to be, never a push. From the wind-down
  // on (30 min before bed), so "Bed at 12:00 — start wrapping up" is not pushed to a phone he has put down either (2026-10-23).
  const macIdle = !Number.isFinite(idle) || idle >= INACTIVE_MINUTES * 60;
  if (past >= -30 && macIdle && !phoneInUse) return { ok: false, reason: past >= 0 ? `no Mac or phone use for ${INACTIVE_MINUTES}+ min after bedtime` : `no Mac or phone use for ${INACTIVE_MINUTES}+ min at wind-down` };
  return { ok: true };
}

const readLines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

/** How many bedtime lines reached him this night (held, dropped and failed rows do not count). */
export function bedtimeSentTonight(rows, now) {
  const night = nightOf(now);
  const seen = new Set();
  return rows.filter((r) => isBedtimeWhy(r.why) && r.channel !== "hold" && !r.status && !seen.has(r.id) && seen.add(r.id)
    && Number.isFinite(Date.parse(r.at)) && nightOf(new Date(r.at)) === night).length;
}

/** The evidence, read from the controlled dir. `mac`: the live Mac facts the caller already has. */
export function readBedtimeEvidence({ dir, now, bed, mac }) {
  const log = readJson(join(dir, "health-log.json")) ?? {};
  const screen = log.phoneScreen && !Array.isArray(log.phoneScreen) ? log.phoneScreen : (log.phoneScreen ?? []).at?.(-1) ?? null;
  return {
    now, bed, mac: mac ?? {},
    declaredAt: readJson(join(dir, "sleep-declared.json"))?.at ?? null,
    ack: readJson(join(dir, ACK_FILE)),
    phone: (log.phoneSignals ?? []).at(-1) ?? null,
    screen,
    sentTonight: bedtimeSentTonight(readLines(join(dir, "outreach.jsonl")), now),
  };
}

/** He answered a bedtime line (any words: "ok", "not yet", "shush"): no more bedtime lines this night. */
export function ackBedtime(dir, now) {
  writeJsonAtomic(dir, ACK_FILE, { night: nightOf(now), at: now.toISOString() });
}
