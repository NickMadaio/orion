// The reminder clock (w19-reminders). One pass over reminders.json: fire what is due, once, through orion-reach;
// say what the Mac slept through; arm and fire "when I get home"; roll recurring ones forward; resurface an
// unanswered one a single time; tidy up. Idempotent: the app calls it the second a reminder is due, orion-proactive
// calls it every tick as the backstop, and both together never say anything twice (the fired mark is written back
// under the store lock, and a claim stops two passes delivering the same reminder at once).
import { findPlace, readKnownPlaces } from "../awareness/places.mjs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { updateReminders, readReminders, KEEP_FIRED_MS } from "./store.mjs";
import { nextOccurrence } from "./schedule.mjs";
import { deliveryPlan } from "./deliver.mjs";
import { deliveryOutcome } from "../reach/delivery.mjs";

/** Later than this and he did not hear it when it was due (the Mac slept, the app was off): it is said as missed. */
export const LATE_MS = 120_000;
/** Later than this and the moment is gone: a one-off is dropped, a recurring one skips to its next time. */
export const DROP_MS = 36 * 3600_000;
export const NUDGE_AFTER_MS = 30 * 60_000;
export const NUDGE_UNTIL_MS = 2 * 3600_000;
export const MAX_ATTEMPTS = 5;
const CLAIM_MS = 60_000;

const here = import.meta.dirname;

/** The real orion-reach (ORION_REACH_BIN is the tests' seam, the way orion-proactive has it). */
export function defaultReach(args, env = process.env) {
  const r = env.ORION_REACH_BIN
    ? spawnSync(env.ORION_REACH_BIN, args, { encoding: "utf8", timeout: 30_000, env })
    : spawnSync(process.execPath, [join(here, "../../orion-reach"), ...args], { encoding: "utf8", timeout: 30_000, env });
  return { status: r.status, stdout: r.stdout ?? "" };
}

/** What each reminder needs doing this pass: transitions to write now, and deliveries to make. */
function plan(list, now, aw, places = []) {
  const t = now.getTime();
  const atHome = aw?.derived?.atHome ?? null;
  const fires = [];
  const next = [];
  for (const r of list) {
    const claimed = Number.isFinite(r.inflight) && t - r.inflight < CLAIM_MS;
    // Tidy: a fired one-off that nobody answered is cleared after three hours.
    if (!r.repeat && Number.isFinite(r.firedAt) && t - r.firedAt > KEEP_FIRED_MS) continue;
    if (claimed) { next.push(r); continue; }
    const open = Number.isFinite(r.open) ? t - r.open : null;
    let cur = open !== null && open > NUDGE_UNTIL_MS ? { ...r, open: null } : r;

    if (cur.place && !Number.isFinite(cur.firedAt)) {
      if (t >= cur.dueAt) fires.push({ r: cur, reason: "due" });
      else if (cur.place !== "home") {
        // "When I get to spit": a place he named (or an alias of one). Armed once he is somewhere else, fired when awareness puts him at that place.
        const target = findPlace(places, cur.place);
        const here = aw?.location?.placeId ?? null;
        if (target && here === target.id && cur.armed) fires.push({ r: cur, reason: "arrived" });
        else if (target && here !== target.id && aw?.location?.state && aw.location.state !== "unknown" && !cur.armed) cur = { ...cur, armed: true };
      }
      else if (atHome === true && cur.armed) fires.push({ r: cur, reason: "arrived" });
      else if (atHome === false && !cur.armed) cur = { ...cur, armed: true };
      next.push(cur);
      continue;
    }

    const due = t >= cur.dueAt && (cur.repeat || !Number.isFinite(cur.firedAt));
    if (due) {
      const late = t - cur.dueAt;
      if (late > DROP_MS) {
        if (!cur.repeat) continue;
        const skipped = nextOccurrence(cur.repeat, now);
        next.push(skipped ? { ...cur, dueAt: skipped } : cur);
        continue;
      }
      const snoozed = !!cur.snoozedAt || !!cur.snoozedFrom;
      fires.push({ r: cur, reason: snoozed ? "snoozed" : late > LATE_MS ? "missed" : "due" });
      next.push(cur);
      continue;
    }
    if (Number.isFinite(cur.open) && !cur.nudged && open >= NUDGE_AFTER_MS && open <= NUDGE_UNTIL_MS) fires.push({ r: cur, reason: "nudge" });
    next.push(cur);
  }
  return { fires, next };
}

/** The reminder after a delivery attempt: fired and rolled on if it got through, a retry counted if it did not. */
function afterDelivery(r, reason, outcome, now, held) {
  const t = now.getTime();
  const { inflight: _gone, ...rest } = r;
  if (!(outcome.said)) {
    const attempts = (r.attempts ?? 0) + 1;
    if (attempts < MAX_ATTEMPTS) return { ...rest, attempts };
    return reason === "nudge" ? { ...rest, attempts: 0, nudged: true, open: null } : { ...rest, attempts: 0, firedAt: t, open: null, nudged: true, ...(r.repeat ? { dueAt: nextOccurrence(r.repeat, now) ?? r.dueAt } : {}) };
  }
  if (reason === "nudge") return { ...rest, attempts: 0, nudged: true };
  const rolled = r.repeat ? { dueAt: nextOccurrence(r.repeat, new Date(Math.max(t, r.dueAt))) ?? r.dueAt, armed: false } : {};
  return { ...rest, ...rolled, attempts: 0, firedAt: t, open: held ? null : t, nudged: !!held, snoozedAt: null };
}

/**
 * @param {{ dir: string, now?: Date, aw?: object, activity?: object|null, reach?: (args: string[]) => { status: number|null, stdout: string } }} input
 * @returns {Promise<{ fired: { id: string, reason: string, text: string, sent: boolean }[] }>}
 */
export async function runTick({ dir, now = new Date(), aw = {}, activity = null, reach = defaultReach } = {}) {
  if (!readReminders(dir).length) return { fired: [] };
  let fires = [];
  updateReminders(dir, (list) => {
    const p = plan(list, now, aw, readKnownPlaces(dir));
    fires = p.fires;
    const claimed = new Map(fires.map((f) => [f.r.id, f.r]));
    const next = p.next.map((r) => (claimed.has(r.id) ? { ...r, inflight: now.getTime() } : r));
    return JSON.stringify(next) === JSON.stringify(list) ? undefined : next;
  });
  const fired = [];
  for (const { r, reason } of fires) {
    const p = deliveryPlan({ reminder: r, now, reason, activity, aw });
    let res;
    try { res = reach(p.args); } catch (e) { res = { status: 4, stdout: `NOT SENT: delivery failed (${String(e?.message ?? e).slice(0, 80)}).` }; }
    const outcome = deliveryOutcome(res);
    const held = outcome.said && /^Held/.test(String(res.stdout).trimStart());
    updateReminders(dir, (list) => list.map((x) => (x.id === r.id ? afterDelivery(x, reason, outcome, now, held) : x)));
    fired.push({ id: r.id, reason, text: p.text, sent: outcome.said });
  }
  return { fired };
}
