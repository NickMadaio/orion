// w20 routegate: "he can change my bed time and wake time". An exact bedtime (tonight only, or every night), a shift, and the answer's
// read-back from the files just written (wake-plan.json): bedtime, wind-down, alarm and the sleep that leaves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-sleepplan");
function sandbox(t, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), "sleepplan-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "eval-mode"), "");
  const ev = (d, h, m, dur, title) => { const s = new Date(2026, 10, d, h, m); return { identifier: `${title}-${d}`, title, allDay: "false", start: s.toISOString(), end: new Date(s.getTime() + dur * 60000).toISOString() }; };
  writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: new Date(2026, 10, 2, 20, 0).toISOString(),
    events: [ev(3, 13, 30, 95, "MKTG2201 Lecture"), ev(4, 9, 0, 100, "CS1800 Lecture"), ev(5, 10, 0, 60, "CS2100 Lab"), ev(6, 13, 30, 95, "MKTG2201 Lecture"), ...extra.map((e) => ev(...e))] }));
  const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
  for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"]) delete env[k];
  const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  return { dir, run };
}


const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));

test("bedtime HH:MM --tonight is exact for tonight only and read back from wake-plan.json", (t) => {
  const { dir, run } = sandbox(t);
  const r = run("bedtime", "23:45", "--tonight", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.readback.sleepBy, "23:45");
  assert.equal(out.readback.nudgeAt, "23:15");
  assert.equal(out.readback.wake, "09:00");
  assert.equal(out.readback.hours, 9.25);
  assert.equal(out.readback.tonightOnly, true);
  assert.equal(read(dir, "eval-wake-plan.json").bedtimes[0].sleepBy, "23:45");
  assert.equal(read(dir, "eval-life-config.json").bedtime, undefined, "the standing bedtime is untouched");
  assert.deepEqual(read(dir, "eval-life-config.json").sleepPlan.bedOverrides, { "2026-11-02": "23:45" });
  assert.notEqual(read(dir, "eval-wake-plan.json").bedtimes[1].sleepBy, "23:45", "tomorrow night is not changed");
});

test("bedtime HH:MM (every night) is exact: not capped by the sleep need before an early alarm", (t) => {
  const { dir, run } = sandbox(t);
  assert.equal(run("wake-on", "--date", "tomorrow", "--time", "05:50", "--json").code, 0);
  const capped = JSON.parse(run("plan", "--json").out).days[0].sleepBy;
  assert.equal(capped, "21:50", "the old rule: 05:50 minus 8 h");
  const out = JSON.parse(run("bedtime", "23:45", "--json").out);
  assert.equal(out.readback.sleepBy, "23:45");
  assert.equal(out.readback.wake, "05:50");
  assert.equal(out.readback.alarmAsked, true);
  assert.equal(out.readback.hours, 6.08);
  assert.equal(out.readback.tonightOnly, false);
  assert.equal(read(dir, "eval-life-config.json").bedtime, "23:45");
  assert.equal(read(dir, "eval-life-config.json").sleepPlan.bedFixed, true);
  assert.equal(read(dir, "eval-wake-plan.json").bedtimes[0].sleepBy, "23:45", "the nudge engine reads the same file");
});

test("bedtime shift moves tonight by N minutes from what it is now", (t) => {
  const { run } = sandbox(t);
  assert.equal(JSON.parse(run("bedtime", "shift", "-30", "--tonight", "--json").out).readback.sleepBy, "23:30");
  assert.equal(JSON.parse(run("bedtime", "shift", "30", "--tonight", "--json").out).readback.sleepBy, "00:00");
  assert.equal(JSON.parse(run("bedtime", "later", "--tonight", "--json").out).readback.sleepBy, "00:30");
  assert.equal(run("bedtime", "shift", "0").code, 2);
  assert.equal(run("bedtime", "10:00", "--tonight").code, 3, "a bedtime has to be between 8 PM and 4 AM");
});
