// Review of 6fc2b13: ownership splits explicit from automatic. A block he NAMES (move / extend / resize / swap / drop, or an item he names in a
// re-plan) may be any of his own events that is not a class or a plan with people — "move gym to 7" on his own Gym works, as on live. What
// ORION changes as a SIDE EFFECT (cascade, late, re-plan of the rest, fill) only touches ORION's own blocks (ledger or marker): the eight real
// events the reviewer listed never move unless he names them. Fixtures only: temp home, fake bridge.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (h, m = 0) => new Date(2030, 9, 22, h, m).toISOString();
const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const REAL = ["Fix car — Kwik Fit 10am", "Submit visa application at VFS", "Review w/ advisor", "Do taxes w accountant", "Practice match", "Prep cook", "Research group sync", "Prep for Annika visit"];

function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-expl-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  const calendar = join(home, "calendar.json"); writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, allDay: "false", ...e }))));
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, commuteMinutes: 45, readyMinutes: 30 }));
  const now = new Date(2030, 9, 22, 8, 0).toISOString();
  const env = { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: join(ROOT, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: calendar,
    ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: now, ORION_REACH_NOW: now };
  delete env.ORION_WRITTEN_FILE;
  const run = (...args) => { const r = spawnSync(process.execPath, [join(ROOT, "scripts/orion-reschedule"), ...args, "--date", "2030-10-22"], { encoding: "utf8", env }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  const day = () => Object.fromEntries(JSON.parse(readFileSync(calendar, "utf8")).map((e) => [e.title, `${hm(e.start)}-${hm(e.end)}`]));
  const pins = () => { try { return JSON.parse(readFileSync(join(home, "pins.json"), "utf8")); } catch { return {}; } };
  const ledger = () => { try { return JSON.parse(readFileSync(join(home, "orion-written.json"), "utf8")); } catch { return []; } };
  return { run, day, pins, ledger };
}

// His own unmarked events, each alone in its own hour, and the eight real ones in the afternoon.
const HIS = [
  { title: "Gym", start: at(18), end: at(19, 30) },
  { title: "Nap", start: at(13), end: at(13, 45) },
  { title: "study econ", start: at(21), end: at(22) },
  { title: "CS1800 Discrete Structures — Lecture", start: at(9), end: at(10, 30) },
  { title: "Dinner with Sam", start: at(19, 45), end: at(20, 45) },
];

test("explicit: he names his own unmarked Gym, Nap or 'study econ' and it changes; nothing is pinned or claimed as ORION's", (t) => {
  const w = world(t, HIS);
  assert.equal(w.run("move", "Gym", "--to", "17:00").code, 0);
  assert.equal(w.day().Gym, "17:00-18:30");
  assert.equal(w.run("extend", "Nap", "--until", "14:00").code, 0);
  assert.equal(w.day().Nap, "13:00-14:00");
  assert.equal(w.run("resize", "study econ", "45").code, 0);
  assert.equal(w.day()["study econ"], "21:00-21:45");
  assert.equal(w.run("drop", "study econ").code, 0);
  assert.equal(w.day()["study econ"], undefined);
  assert.deepEqual(Object.values(w.pins()).flat(), [], "his events are never pinned (a pin would later read as ORION's)");
  assert.deepEqual(w.ledger(), [], "nor recorded as ORION's");
});

test("explicit: a class or a plan with people is still refused by name", (t) => {
  const w = world(t, HIS);
  assert.match(w.run("move", "CS1800", "--to", "12:00").out, /NOTHING WAS CHANGED/);
  assert.match(w.run("move", "Dinner with Sam", "--to", "21:00").out, /NOTHING WAS CHANGED/);
  assert.equal(w.day()["CS1800 Discrete Structures — Lecture"], "09:00-10:30");
  assert.equal(w.day()["Dinner with Sam"], "19:45-20:45");
});

test("explicit: 'move Fix car to 11' moves it, because he asked", (t) => {
  const w = world(t, [{ title: "Fix car — Kwik Fit 10am", start: at(10), end: at(11) }]);
  const r = w.run("move", "Fix car", "--to", "11:00");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.day()["Fix car — Kwik Fit 10am"], "11:00-12:00");
});

test("automatic: the eight real events and his own unmarked blocks never move as a side effect of ORION's changes", (t) => {
  // Each real event sits right where ORION's own block would cascade; ORION's study block (marked) is the only thing that may slide.
  const events = [
    ...REAL.map((title, i) => ({ title, start: at(12 + i), end: at(12 + i, 45) })),
    { title: "Gym", start: at(20, 30), end: at(21, 30) },
    { title: "Study", start: at(8, 30), end: at(9, 30), orion: "study", orionTags: "study" },
  ];
  const w = world(t, events);
  const before = w.day();
  // late: an hour lost from now (8:00); ORION's Study slides, nothing of his does
  const late = w.run("late", "60");
  assert.equal(late.code, 0, late.out);
  // an ORION add right on top of "Fix car" at 12:00: it does not push his event away
  w.run("add", "reading", "30", "--at", "12:00");
  // a re-plan of the rest of the day
  w.run("day", "--plan", "walk, 30, 08:30", "--rebuild");
  const after = w.day();
  for (const title of [...REAL, "Gym"]) assert.equal(after[title], before[title], `${title} moved as a side effect`);
  assert.notEqual(after.Study, before.Study, "ORION's own block is the one that slid");
});

test("a re-plan item he names may be his own event: 'day --plan \"Gym, 90, 11:00\"' moves his Gym, not a second copy; the rest of his stay", (t) => {
  const w = world(t, [...HIS, { title: "Prep cook", start: at(15), end: at(16) }]);
  const r = w.run("day", "--plan", "Gym, 90, 11:00");
  assert.equal(r.code, 0, r.out);
  const after = w.day();
  assert.equal(after.Gym, "11:00-12:30");
  assert.equal(after.Nap, "13:00-13:45", "his Nap, not named, stays");
  assert.equal(after["Prep cook"], "15:00-16:00");
  assert.equal(after["Dinner with Sam"], "19:45-20:45");
});
