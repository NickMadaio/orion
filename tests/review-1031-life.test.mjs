// 2026-10-31 review of the proactive loop: finding 4 (the bedtime line claimed a change nobody made), 5 (false stale-sensor
// notices), 9 (block ids by position), 10 (gym stays 90 min on low recovery), 11 (undo history of 10), 13 (state-copy paths and
// his own reminders). Pure where it can be; subprocesses only for module-level paths.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { goToBedMessage, tomorrowProposal } from "../scripts/lib/life/after-late-night.mjs";
import { sensorHealth, macExpected } from "../scripts/lib/awareness/facets.mjs";
import { sensorNotices } from "../scripts/lib/life/stale-sensors.mjs";
import { toBlocks } from "../scripts/lib/life/live-day.mjs";
import { rewritesBedtime } from "../scripts/lib/reach/bedtime-guard.mjs";

test("finding 4: the bedtime line never says tomorrow was lightened unless something was written", () => {
  const plain = goToBedMessage({ minute: 190, wake: 465 });
  assert.doesNotMatch(plain, /already lightened/);
  assert.match(goToBedMessage({ minute: 190, wake: 465, proposed: true }), /I'll have a lighter plan for tomorrow in the morning\./);
  assert.match(goToBedMessage({ minute: 190, wake: 465, lightened: true }), /I've already lightened tomorrow around it\./);
});

test("finding 4: orion-watch does not let the default claim a write", () => {
  const src = readFileSync(join(import.meta.dirname, "../scripts/orion-watch"), "utf8");
  const call = src.match(/goToBedMessage\(\{[^\n]*\}\)/)?.[0] ?? "";
  assert.match(call, /lightened: false/);
  assert.match(call, /proposed:/);
});

const now = new Date(2026, 9, 30, 15, 0);   // Friday 15:00
const ago = (h) => new Date(now.getTime() - h * 3600_000).toISOString();

test("finding 5: a locked or sleeping Mac is off, not stale", () => {
  assert.equal(macExpected({ awake: true, activity: { at: ago(3), locked: true } }), false);
  assert.equal(macExpected({ awake: true, activity: { at: ago(3), displayAsleep: true } }), false);
  assert.equal(macExpected({ awake: false, activity: { at: ago(3) } }), false);
  assert.equal(macExpected({ awake: true, activity: { at: ago(3), locked: false } }), true);
  const h = sensorHealth({ now, at: { phone: ago(1), mac: ago(3), whoop: ago(1) }, expected: { phone: true, mac: macExpected({ awake: true, activity: { at: ago(3), locked: true } }), whoop: true } });
  assert.equal(h.mac.state, "off");
});

test("finding 5: the phone is flagged only after 12 h without a sample, or none all day", () => {
  const dayStart = new Date(2026, 9, 30, 4, 0);
  assert.equal(sensorHealth({ now, at: { phone: ago(5) }, dayStart }).phone.state, "live", "5 h quiet is a phone in a pocket");
  assert.equal(sensorHealth({ now, at: { phone: ago(13) }, dayStart }).phone.state, "stale");
  const morning = new Date(2026, 9, 30, 9, 0);
  assert.equal(sensorHealth({ now: morning, at: { phone: new Date(2026, 9, 29, 23, 0).toISOString() }, dayStart }).phone.state, "live", "nothing since last night, at 9 AM: not yet");
  assert.equal(sensorHealth({ now, at: { phone: new Date(2026, 9, 30, 3, 0).toISOString() }, dayStart }).phone.state, "stale", "none all day, at 3 PM");
  assert.equal(sensorHealth({ now, at: { phone: ago(13) }, expected: { phone: false, mac: true, whoop: true } }).phone.state, "off", "asleep: off");
});

test("finding 5: one notice per real outage", () => {
  const h = sensorHealth({ now, at: { phone: ago(13), mac: ago(0), whoop: ago(1) } });
  const first = sensorNotices({ health: h, now });
  assert.equal(first.notices.length, 1);
  const later = sensorHealth({ now: new Date(now.getTime() + 3600_000), at: { phone: ago(13), mac: ago(0), whoop: ago(1) } });
  assert.equal(sensorNotices({ health: later, told: first.told, now }).notices.length, 0);
});

test("finding 9: a block keeps its id when another event appears before it", () => {
  const ev = (identifier, title, h) => ({ identifier, title, start: new Date(2026, 9, 30, h).toISOString(), end: new Date(2026, 9, 30, h + 1).toISOString() });
  const a = toBlocks([ev("GYM-1", "Gym", 17), ev("RES-1", "finish resume", 19)], "2026-10-30", new Set());
  const b = toBlocks([ev("NEW-1", "Coffee", 9), ev("GYM-1", "Gym", 17), ev("RES-1", "finish resume", 19)], "2026-10-30", new Set());
  assert.equal(b.find((x) => x.title === "Gym").id, a.find((x) => x.title === "Gym").id);
  const c = toBlocks([ev(undefined, "Gym", 17)], "2026-10-30", new Set());
  const d = toBlocks([ev(undefined, "Coffee", 9), ev(undefined, "Gym", 17)], "2026-10-30", new Set());
  assert.equal(d.find((x) => x.title === "Gym").id, c[0].id, "no identifier: title and start");
  const dup = toBlocks([ev("SAME", "A", 9), ev("SAME", "B", 10)], "2026-10-30", new Set());
  assert.notEqual(dup[0].id, dup[1].id, "ids stay unique");
});

test("finding 10: low recovery keeps the gym at 90 min (an easier session) and shrinks study instead", () => {
  const b = (id, kind, start, end, fixed = false) => ({ id, title: id, kind, date: "2026-10-31", start, end, fixed, source: "calendar" });
  const day = [b("cs2100", "class", 540, 630, true), b("study", "study", 900, 1020), b("gym", "gym", 1260, 1350)];
  const r = tomorrowProposal(day, { sleptMinutes: 270, wake: 465, window: { start: 465, end: 1380 }, recovery: { level: "low" } });
  const gym = r.blocks.find((x) => x.id === "gym"); assert.equal(gym.end - gym.start, 90);
  assert.match(r.text, /easier session/i);
  const study = r.blocks.find((x) => x.id === "study"); assert.ok(study.end - study.start < 120, "study shrinks instead");
});

test("finding 11: the undo history keeps the whole day (up to 50), not the last 10", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-undo-"));
  const undo = join(dir, "undo.json");
  const code = `const { recordUndo } = await import(${JSON.stringify(join(import.meta.dirname, "../scripts/lib/life/calendar-write.mjs"))});
for (let i = 0; i < 60; i++) recordUndo([{ op: "create", identifier: "x" + i, title: "t" }]);`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, ORION_CONTROLLED_DIR: dir, ORION_RESCHEDULE_UNDO: undo, ORION_RESCHEDULE_PINS: join(dir, "pins.json") } });
  assert.equal(r.status, 0, r.stderr);
  const list = JSON.parse(readFileSync(undo, "utf8"));
  assert.equal(list.length, 50);
  assert.equal(list.at(-1).steps[0].identifier, "x59");
});

test("finding 13: the eval marker and the sandbox calendar follow ORION_CONTROLLED_DIR", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-ctl-"));
  const code = `const e = await import(${JSON.stringify(join(import.meta.dirname, "../scripts/lib/eval-mode.mjs"))});
const b = await import(${JSON.stringify(join(import.meta.dirname, "../scripts/lib/life/bridge-path.mjs"))});
console.log(JSON.stringify({ marker: e.EVAL_MARKER, cal: b.SANDBOX_CALENDAR }));`;
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir }; delete env.ORION_EVAL_MARKER; delete env.ORION_SANDBOX_CALENDAR;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.marker, join(dir, "eval-mode"));
  assert.equal(out.cal, join(dir, "eval-calendar.json"));
});

test("finding 13: only ORION's own bed-* lines are rewritten with the awake-late words, never a reminder", () => {
  assert.equal(rewritesBedtime({ why: "proactive: bed-now", kind: "reminder" }), true);
  assert.equal(rewritesBedtime({ why: "proactive: session-done-abc", kind: "reminder" }), false);
  assert.equal(rewritesBedtime({ why: "reminder: take meds", kind: "reminder" }), false);
});
