// Sleep wins: past tonight's bedtime-nudge time no plan/gym check-in goes out. Pure; no real paths.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nudgeInstant, pastNudgeTime, nightHushed } from "../scripts/lib/reach/night-hush.mjs";
import { tickPlanLoop } from "../scripts/lib/reach/plan-loop.mjs";

const at = (h, m = 0, day = 2) => new Date(2026, 10, day, h, m);

test("fallback is bedtime minus wind-down; the night lasts until 04:00", () => {
  const config = { bedtime: "23:30", windDownMinutes: 45 };
  assert.equal(pastNudgeTime({ now: at(22, 44), config }), false);
  assert.equal(pastNudgeTime({ now: at(22, 45), config }), true);
  assert.equal(pastNudgeTime({ now: at(1, 0, 3), config }), true);
  assert.equal(pastNudgeTime({ now: at(10, 0, 3), config }), false);
});

test("a midnight bedtime reaches past midnight", () => {
  assert.equal(pastNudgeTime({ now: at(23, 29), config: { bedtime: "00:00", windDownMinutes: 30 } }), false);
  assert.equal(pastNudgeTime({ now: at(23, 30), config: { bedtime: "00:00", windDownMinutes: 30 } }), true);
});

test("Nick's own wake plan wins; another source does not", () => {
  const plan = { source: "nick", bedtimes: [{ date: "2026-11-02", nudgeAtIso: at(21, 0).toISOString() }] };
  assert.equal(nudgeInstant({ now: at(21, 5), plan, config: { bedtime: "02:00" } }).getTime(), at(21, 0).getTime());
  assert.equal(pastNudgeTime({ now: at(21, 5), plan: { ...plan, source: "default" }, config: { bedtime: "02:00" } }), false);
});

test("nightHushed reads wake-plan.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "nh-"));
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify({ source: "nick", bedtimes: [{ date: "2026-11-02", nudgeAtIso: at(22, 0).toISOString() }] }));
  assert.equal(nightHushed({ dir, now: at(22, 1) }), true);
  assert.equal(nightHushed({ dir, now: at(21, 59) }), false);
});

test("a held gym plan loop sends nothing", () => {
  const GYM = { date: "2026-11-02", start: 1260, end: 1350 };
  const c = { id: "ci-gym", what: "Gym", by: "orion", block: "cal-gym", tier: "protected", blockWindow: GYM, alerts: 0, createdAt: at(21, 5).toISOString(),
    loop: { phase: "waiting", level: 0, nextCheckAt: Math.floor(at(21, 5).getTime() / 60000), history: [] } };
  const sent = [];
  const fx = { send: (_c, m) => { sent.push(m); return { reached: true, dropped: false, channels: ["auto"] }; }, displace: () => ({ status: 1, stdout: "" }), outcome: () => {}, queue: () => {} };
  const ctx = { nowMs: at(21, 30).getTime(), record: null, declared: [], patterns: null, slipsToday: [], workouts: [], sentToday: [] };
  tickPlanLoop(c, { ...ctx, held: true }, fx);
  assert.equal(sent.length, 0);
});
