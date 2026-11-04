// W18 wake: one-off alarm overrides (wake-on), shifting the next alarm, and reading the alarms back with the phone's receipt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validSleepPlan } from "../scripts/lib/life/config.mjs";
import { wakeWhy } from "../scripts/lib/life/night.mjs";
import { wakePlanDoc } from "../scripts/lib/life/sleep-plan.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-sleepplan");
const base = { usualWake: "09:00", bedtime: "00:00", sleepHours: 8, readyMinutes: 105, commuteMinutes: 30 };
const early = { title: "CS Lecture", start: 480, end: 540, fixed: true, source: "calendar", kind: "class" };

test("store: overrides are a date to HH:MM or off, and nothing else", () => {
  assert.ok(validSleepPlan({ overrides: { "2026-11-03": "06:45", "2026-11-07": "off" } }));
  assert.ok(!validSleepPlan({ overrides: { tomorrow: "06:45" } }));
  assert.ok(!validSleepPlan({ overrides: { "2026-11-03": "6:45am" } }));
  assert.ok(!validSleepPlan({ overrides: [] }));
});

test("rule: an override is honoured even when a class would pull the wake earlier; off drops the plan and lead", () => {
  const cfg = { ...base, sleepPlan: { byDay: { tue: { wake: "06:00" } }, firstClassLeadMin: 180, overrides: { "2026-11-03": "07:30", "2026-11-10": "off" } } };
  assert.deepEqual(wakeWhy("2026-11-03", { blocksOf: () => [early], config: cfg }), { minute: 450, reason: "plan" });
  const off = wakeWhy("2026-11-10", { blocksOf: () => [], config: cfg });
  assert.equal(off.reason, "usual", "tue 06:00 is skipped on the overridden date");
  assert.equal(off.minute, 540);
});

test("doc: an override alone makes the plan his, with a byNick alarm; an off alone does not", () => {
  const days = [{ date: "2026-11-03", weekday: "tue", wake: "06:45", wakeIso: "2026-11-03T06:45:00.000Z", reason: "plan", evening: "2026-11-02", sleepBy: "22:45", nudgeAt: "22:15", sleepByIso: "x", nudgeAtIso: "y", lockdownAt: "00:00", lockdownIso: "z", exception: null }];
  assert.equal(wakePlanDoc({ now: new Date(), days, config: { ...base, sleepPlan: { overrides: { "2026-11-03": "06:45" } } } }).source, "nick");
  assert.equal(wakePlanDoc({ now: new Date(), days, config: { ...base, sleepPlan: { overrides: { "2026-11-03": "off" } } } }).source, "default");
});

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "sleepplan-alarms-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "eval-mode"), "");
  const at = (d, h, m) => new Date(2026, 10, d, h, m);
  writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: at(2, 20, 0).toISOString(), events: [] }));
  const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
  for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"]) delete env[k];
  const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const plan = () => JSON.parse(readFileSync(join(dir, "eval-wake-plan.json"), "utf8"));
  return { dir, run, plan };
}

test("CLI wake-on: tomorrow 06:45 writes the alarm, the bedtime 8 h before it, and clears a stale wake request", (t) => {
  const { dir, run, plan } = sandbox(t);
  writeFileSync(join(dir, "wake-request.json"), JSON.stringify({ at: new Date(2026, 10, 3, 9, 0).toISOString() }));
  const r = run("wake-on", "--date", "tomorrow", "--time", "06:45", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.ok, true);
  assert.equal(out.days[0].date, "2026-11-03");
  assert.equal(out.days[0].wake, "06:45");
  assert.equal(out.days[0].sleepBy, "22:45");
  const doc = plan();
  assert.equal(doc.source, "nick");
  assert.deepEqual(doc.alarms.map((a) => `${a.date} ${a.at}`), ["2026-11-03 06:45"]);
  assert.deepEqual(doc.bedtimes.find((b) => b.date === "2026-11-02").sleepBy, "22:45");
  assert.ok(!existsSync(join(dir, "wake-request.json")), "the plan now holds that alarm");
});

test("CLI wake-on: a weekday name means the next one, and off removes a standing alarm for that date only", (t) => {
  const { run, plan } = sandbox(t);
  assert.equal(run("set", "--days", "weekends", "--wake", "09:00").code, 0);
  assert.deepEqual(plan().alarms.map((a) => a.date), ["2026-11-07", "2026-11-08"]);
  const r = run("wake-on", "--date", "sat", "--time", "off", "--json");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(plan().alarms.map((a) => a.date), ["2026-11-08"], "Saturday has none, Sunday keeps its alarm");
  assert.equal(JSON.parse(r.out).dateOff, "2026-11-07");
});

test("CLI shift: later and earlier move the next alarm and nothing else", (t) => {
  const { run, plan } = sandbox(t);
  run("wake-on", "--date", "tomorrow", "--time", "06:45");
  const later = JSON.parse(run("shift", "--minutes", "20", "--json").out);
  assert.equal(later.days[0].wake, "07:05");
  assert.equal(later.days[0].sleepBy, "23:05");
  assert.equal(JSON.parse(run("shift", "--minutes", "-35", "--json").out).days[0].wake, "06:30");
  assert.deepEqual(plan().alarms.map((a) => a.at), ["06:30"]);
});

test("CLI shift: with no alarm ahead it refuses and saves nothing", (t) => {
  const { dir, run } = sandbox(t);
  const r = run("shift", "--minutes", "20", "--json");
  assert.equal(r.code, 3);
  assert.equal(JSON.parse(r.out).ok, false);
  assert.ok(!existsSync(join(dir, "eval-wake-plan.json")));
});

test("CLI alarms: the alarms ahead, and the phone's receipt only once it matches", (t) => {
  const { dir, run } = sandbox(t);
  run("wake-on", "--date", "tomorrow", "--time", "06:45");
  const pending = JSON.parse(run("alarms", "--json").out);
  assert.deepEqual(pending.alarms.map((a) => `${a.date} ${a.at}`), ["2026-11-03 06:45"]);
  assert.equal(pending.phone.state, "unknown", "no receipt yet");
  const iso = pending.alarms[0].iso;
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneAlarms: { at: "2026-11-02T20:01:00Z", fires: [iso], state: "Set for 06:45" } }));
  assert.equal(JSON.parse(run("alarms", "--json").out).phone.state, "confirmed");
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneAlarms: { at: "2026-11-02T19:00:00Z", fires: ["2026-11-03T09:00:00.000Z"], state: "Set for 09:00" } }));
  assert.equal(JSON.parse(run("alarms", "--json").out).phone.state, "pending", "the phone holds something else");
});

test("CLI wake-on: bad input saves nothing", (t) => {
  const { dir, run } = sandbox(t);
  assert.equal(run("wake-on", "--date", "tomorrow", "--time", "6ish").code, 2);
  assert.equal(run("wake-on", "--date", "someday", "--time", "07:00").code, 2);
  assert.ok(!existsSync(join(dir, "eval-life-config.json")));
});
