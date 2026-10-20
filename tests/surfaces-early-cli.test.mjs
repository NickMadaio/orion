// orion-reschedule early — end to end against a fake calendar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-05";
const at = (h, m = 0) => new Date(2030, 9, 5, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const minute = (s) => { const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };
const hm = (h, m = 0) => h * 60 + m;

function world(t, events, overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-early-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, ".openclaw/orion-controlled/life-config.json"), JSON.stringify({
    commuteMinutes: 30,
    bufferMinutes: 10,
    usualWake: "08:00",
    minimums: {},
    freeMinutesKept: 60,
    ...overrides,
  }));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--date", DATE], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar,
             ORION_RESCHEDULE_UNDO: join(home, "undo.json"),
             ORION_LIFE_CONFIG: join(home, ".openclaw/orion-controlled/life-config.json") } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8"))
    .map((e) => ({ title: e.title, start: minute(e.start), end: minute(e.end) })).sort((a, b) => a.start - b.start);
  return { run, day };
}

const noOverlaps = (d) => d.every((x, i) => d.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end)));

// A typical afternoon: a class in the morning, then movable blocks.
const afternoonEvents = [
  { title: "CS1802 Lecture", start: at(9), end: at(10, 30) },
  { title: "Study session", start: at(14), end: at(15, 30), orion: "study" },
  { title: "Side project", start: at(15, 40), end: at(17, 10), orion: "side_project" },
  { title: "Gym", start: at(18), end: at(19), orion: "gym" },
  { title: "Dinner", start: at(19), end: at(19, 45), orion: "meal" },
];

test("early during a block shortens it and pulls the rest forward", (t) => {
  const { run, day } = world(t, afternoonEvents);
  // Now is 14:45 — inside Study session (14:00–15:30). Mode "block" is inferred.
  const r = run("early", "--now", "14:45");
  assert.equal(r.code, 0, r.out);
  const d = day();
  // Study session should be shortened to end at 14:45
  const study = d.find((e) => e.title === "Study session");
  assert.equal(study.end, hm(14, 45), `study ended at ${study.end}, expected ${hm(14, 45)}\n${r.out}`);
  // Side project should have moved earlier
  const side = d.find((e) => e.title === "Side project");
  assert.ok(side.start < hm(15, 40), `side project should move earlier: ${side.start}\n${r.out}`);
  assert.ok(noOverlaps(d), JSON.stringify(d));
});

test("single early tap persists class end, protects commute and undo restores it", (t) => {
  const {run,day} = world(t,afternoonEvents);
  const before=day();
  const r=run("early","--now","10:00");
  assert.equal(r.code,0,r.out);
  assert.equal(day().find(e=>e.title==="CS1802 Lecture").end,hm(10));
  assert.ok(day().find(e=>e.title==="Study session").start >= hm(10,30)); // fixture's saved commute30
  assert.equal(run("undo").code,0);
  assert.deepEqual(day(),before);
});
test("past classes cannot be ended again (nothing under way is answered, not an error); already-home route is removed", (t) => {
  const {run,day}=world(t,afternoonEvents); const before=day();
  const idle=run("early","--now","11:00");   // nothing is under way: an answer, never an error
  assert.equal(idle.code,0,idle.out); assert.match(idle.out,/Nothing is on right now/);
  assert.equal(run("early","home","--now","10:00").code,2);
  assert.deepEqual(day(),before);
});

test("early --check prints the context as JSON and writes nothing", (t) => {
  const { run, day } = world(t, afternoonEvents);
  const before = day();
  // Now is 14:45 — inside Study session.
  const r = run("early", "--now", "14:45", "--check");
  assert.equal(r.code, 0, r.out);
  const parsed = JSON.parse(r.out.trim());
  assert.equal(parsed.kind, "block", `expected kind "block", got ${JSON.stringify(parsed)}\n${r.out}`);
  // Calendar should not have changed
  assert.deepEqual(day(), before, "calendar should be unchanged");
});

test("early --dry-run writes nothing", (t) => {
  const { run, day } = world(t, afternoonEvents);
  const before = day();
  const r = run("early", "--now", "14:45", "--dry-run");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Would change/);
  // Calendar should not have changed
  assert.deepEqual(day(), before, "calendar should be unchanged with --dry-run");
});

test("early then undo restores every block exactly", (t) => {
  const { run, day } = world(t, afternoonEvents);
  const before = day();
  // Finish early during Study session
  const r1 = run("early", "--now", "14:45");
  assert.equal(r1.code, 0, r1.out);
  assert.notDeepEqual(day(), before, "day should have changed");
  // Undo
  const r2 = run("undo");
  assert.equal(r2.code, 0, r2.out);
  assert.deepEqual(day(), before, `undo should restore exactly:\nbefore: ${JSON.stringify(before)}\nafter:  ${JSON.stringify(day())}`);
});

test("leaving final class early retains 45-minute commute plus five-minute transition", t => {
  const {run,day}=world(t,afternoonEvents,{commuteMinutes:45,bufferMinutes:5});
  const r=run("early","--now","10:00");assert.equal(r.code,0,r.out);
  const d=day();assert.equal(d.find(e=>e.title==="CS1802 Lecture").end,hm(10));
  const study=d.find(e=>e.title==="Study session"),side=d.find(e=>e.title==="Side project");
  assert.equal(study.start,hm(10,50));
  assert.equal(side.start-study.end,5);
});
