// 2026-10-20 reschedule incident, script side (docs/audits/2026-10-20-reschedule-incident.md). Fixtures only: a fake bridge and a temp home.
// "reschedule my day after my marketing class, but put gym as the first event after i get back home" reaches `orion-reschedule day` as
//   --plan "Gym, 90, 17:50" --plan "finish resume, 60, 19:25": gym first at class end + the 45 min trip home + the 5 min gap, its anchor's 90 minutes,
// then his other plan in his order, the rest of the day laid out again by rank. `show --json` hands code the facts it needs (the trip, the gap, the anchors).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESCHEDULE = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-03";
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function world(t, events, config) {
  const home = mkdtempSync(join(tmpdir(), "orion-dayorder-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled");
  mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify(config));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const now = (h, m) => new Date(2030, 9, 3, h, m).toISOString();
  const env = (h, m) => ({ ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: now(h, m), ORION_REACH_NOW: now(h, m) });
  const run = (clockAt, ...args) => {
    const r = spawnSync(process.execPath, [RESCHEDULE, ...args, "--date", DATE], { encoding: "utf8", env: env(...clockAt) });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title} ${clock(e.start)}-${clock(e.end)}`).sort((a, b) => a.split(" ").at(-1).localeCompare(b.split(" ").at(-1)));
  return { run, day };
}

// His config (life-config.json, read only on the live machine): commute 45, buffer 5, the Gym an every-day must of 90 minutes.
const CONFIG = { readyMinutes: 105, bufferMinutes: 5, commuteMinutes: 45, minimums: { nap: 75, "side project": 60 }, homeGapMinutes: 150, ranks: { gym: "must" },
  anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] };
// The day at 16:16: marketing 15:30-17:00 is on now, "finish resume" 17:50 and the Gym 20:15 (90) are ORION's.
const EVENTS = [
  { title: "CS Lab", start: at(9), end: at(11, 15) },
  { title: "ECON1115 Principles of Macroeconomics — Lecture", start: at(13, 30), end: at(15) },
  { title: "MKTG2201 Introduction to Marketing — Lecture", start: at(15, 30), end: at(17) },
  { title: "finish resume", start: at(17, 50), end: at(18, 50), orion: "study", orionTags: "study" },
  { title: "Gym", start: at(20, 15), end: at(21, 45), orion: "gym", orionTags: "gym" },
];
const NOW = [16, 16];

test("show --json carries the trip home, the gap between blocks and the daily anchors' own lengths", (t) => {
  const w = world(t, EVENTS, CONFIG);
  const r = w.run(NOW, "show", "--json");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(r.out).plan, { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] });
});

test("gym first after the trip home, 90 minutes, then resume in his order: nothing before gym, no overlap", (t) => {
  const w = world(t, EVENTS, CONFIG);
  const r = w.run(NOW, "day", "--plan", "Gym, 90, 17:50", "--plan", "finish resume, 60, 19:25");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /planned Gym: 17:50–19:20/);
  assert.match(r.out, /planned finish resume: 19:25–20:25/);
  assert.deepEqual(w.day().filter((l) => !/^(CS Lab|ECON|MKTG)/.test(l)), ["Gym 17:50-19:20", "finish resume 19:25-20:25"]);
});

test("the rest of his day is laid out around the two, and one undo puts it all back", (t) => {
  const w = world(t, [...EVENTS, { title: "Dinner", start: at(19), end: at(19, 45), orion: "meal", orionTags: "meal" }], CONFIG);
  const before = w.day();
  assert.equal(w.run(NOW, "day", "--plan", "Gym, 90, 17:50", "--plan", "finish resume, 60, 19:25").code, 0);
  const movable = w.day().filter((l) => !/^(CS Lab|ECON|MKTG)/.test(l));
  assert.equal(movable[0], "Gym 17:50-19:20", movable.join("\n"));
  assert.equal(movable[1], "finish resume 19:25-20:25", movable.join("\n"));
  assert.ok(movable.some((l) => l.startsWith("Dinner")), "dinner is not lost");
  assert.ok(movable.findIndex((l) => l.startsWith("Dinner")) > 1, "dinner comes after the two he ordered, not between them");
  const starts = movable.map((l) => l.split(" ").at(-1).split("-")); // non-overlapping, in order
  starts.slice(1).forEach(([s], i) => assert.ok(s >= starts[i][1], `${movable[i + 1]} starts before ${movable[i]} ends`));
  assert.match(w.run([16, 20], "undo").out, /Undone/);
  assert.deepEqual(w.day(), before);
});

test("the old plan the worker wrote (resume first, gym 60) is exactly what this replaces", (t) => {
  const w = world(t, EVENTS, CONFIG);
  const r = w.run(NOW, "day", "--plan", "finish resume, 60, 17:30", "--plan", "Gym, 60, 18:00");
  // Run by the script it books resume 17:30 (inside the trip home) and a 60-minute gym: the very plan Nick did not ask for.
  assert.notEqual(w.day().filter((l) => /^Gym/.test(l))[0], "Gym 17:50-19:20", r.out);
});
