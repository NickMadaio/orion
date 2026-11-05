// w20 r5 (live gate 3 #99): the now record's "wake" was the COMPUTED wake (first fixed thing minus 75 min = 07:45), not his alarm (06:30 in
// wake-plan.json), and the models said "sleep well until 7:45". Any stated alarm comes from wake-plan.json.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNow } from "../scripts/lib/life/now-state.mjs";

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), "nowwake-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const base = { usualWake: "09:00", bedtime: "23:45", sleepHours: 8, readyMinutes: 75, commuteMinutes: 30 };
const lecture = [{ title: "CS1800 Discrete Structures", start: 540, end: 630, fixed: true }];
const at = new Date(2026, 10, 5, 0, 30);
const build = (dir) => buildNow({ dir, now: at, aw: {}, day: [], dayOk: true, tomorrowDay: lecture, config: base });
const plan = (alarms) => ({ source: "nick", alarms });

test("the stated wake is the real next alarm, not the computed one", async (t) => {
  const dir = tmp(t);
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify(plan([{ date: "2026-11-05", at: "06:30", iso: new Date(2026, 10, 5, 6, 30).toISOString() }])));
  assert.equal((await build(dir)).sleepPlan.wake, "06:30");
});

test("a past alarm and an alarm that is off are not it", async (t) => {
  const dir = tmp(t);
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify(plan([
    { date: "2026-11-04", at: "06:30", iso: new Date(2026, 10, 4, 6, 30).toISOString() },
    { date: "2026-11-05", at: "05:00", iso: new Date(2026, 10, 5, 5, 0).toISOString(), off: true },
    { date: "2026-11-06", at: "09:00", iso: new Date(2026, 10, 6, 9, 0).toISOString() }])));
  assert.equal((await build(dir)).sleepPlan.wake, "09:00");
});

test("no alarm on file: the computed wake still stands (it is a plan, and no longer called an alarm)", async (t) => {
  const dir = tmp(t);
  assert.equal((await build(dir)).sleepPlan.wake, "07:45");
});
