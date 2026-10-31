// Gate cluster 1 (run-1031133008, sch-gym-moved-later-c): "move gym to 8:30pm today" was refused with "Not done: moving it would
// break the day rules — Study for CS Midterm is shorter than 5 minutes". The day rules judged a 3-minute leftover of ORION's own
// that the request never touched. The check now judges only the blocks a change creates or moves; a stale sliver neither vetoes
// the move nor is blamed on him. (The "only N minutes between" refusal is the plugin's schedule-flow.ts, not this script.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDay } from "../scripts/lib/life/day-check.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const TZ = "Europe/London";

function world(t, { y = 2030, mo = 9, d = 3, now = [13, 5], events, config = {} }) {
  const home = mkdtempSync(join(tmpdir(), "orion-only-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const cfg = join(home, ".openclaw/orion-controlled/life-config.json");
  writeFileSync(cfg, JSON.stringify({ commuteMinutes: 45, ...config }));
  const calendar = join(home, "calendar.json");
  // ISO strings are computed in the child (TZ fixed) so a DST day is laid out in London time whatever this machine's zone is.
  const isoAt = (h, m, plus = 0) => spawnSync(process.execPath, ["-e", `process.stdout.write(new Date(${y}, ${mo}, ${d + plus}, ${h}, ${m}).toISOString())`], { encoding: "utf8", env: { ...process.env, TZ } }).stdout;
  // dayOffset: an event on another day (the class tomorrow that sets tonight's bedtime).
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, title: e.title, start: isoAt(...e.start, e.dayOffset ?? 0), end: isoAt(...e.end, e.dayOffset ?? 0), ...(e.orion ? { orion: e.orion } : {}) }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8",
      env: { ...process.env, TZ, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar,
             ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_LIFE_CONFIG: cfg,
             ORION_RESCHEDULE_NOW: isoAt(...now) } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  // Minutes of day in London; an end at the next midnight reads as 1440.
  const day = () => {
    const raw = JSON.parse(readFileSync(calendar, "utf8")).filter((v) => !String(v.identifier).startsWith("seed-") || !events[Number(String(v.identifier).slice(5))]?.dayOffset);
    const js = `const e=${JSON.stringify(raw)};const m=(s)=>{const x=new Date(s);return x.getHours()*60+x.getMinutes()};const day=(s)=>new Date(s).getDate();
      process.stdout.write(JSON.stringify(e.map((v)=>({title:v.title,start:m(v.start),end:day(v.end)!==day(v.start)&&m(v.end)===0?1440:m(v.end)})).sort((a,b)=>a.start-b.start)))`;
    return JSON.parse(spawnSync(process.execPath, ["-e", js], { encoding: "utf8", env: { ...process.env, TZ } }).stdout);
  };
  return { run, day, home };
}

const hm = (h, m = 0) => h * 60 + m;
// The day state from the effect diff: classes, ORION gym 17:00-18:30, side project 19:30-20:30, and a 3-minute leftover study block.
const events = [
  { title: "Study for CS Midterm", start: [12, 0], end: [12, 3], orion: "study" },
  { title: "MKTG2201 Lecture", start: [13, 30], end: [15, 30] },
  { title: "Gym", start: [17, 0], end: [18, 30], orion: "gym" },
  { title: "Side project", start: [19, 30], end: [20, 30], orion: "side_project" },
];
const at = (r, title) => r.day().find((b) => b.title === title);

for (const [say, args, expect] of [
  ["move gym to 8:30pm today", ["move", "Gym", "--to", "20:45"], hm(20, 45)],
  ["push gym to 9pm", ["move", "Gym", "--to", "21:00"], hm(21)],
  ["gym later tonight like 9:15", ["move", "Gym", "--to", "21:15"], hm(21, 15)],
]) {
  test(`a stale 3-minute ORION block does not veto: "${say}"`, (t) => {
    const w = world(t, { now: [10, 0], events });
    const r = w.run(...args);
    assert.doesNotMatch(r.out, /shorter than 5 minutes|NOTHING WAS CHANGED/);
    assert.equal(at(w, "Gym").start, expect, r.out);
  });
}

test("a move that really overlaps is still refused", (t) => {
  const w = world(t, { now: [10, 0], events });
  const r = w.run("move", "Gym", "--to", "14:15");
  assert.match(r.out, /NOTHING WAS CHANGED/);
  assert.match(r.out, /overlaps/);
});

test("checkDay with onlyTouched ignores untouched degenerate ORION blocks and never blames them", () => {
  const day = [
    { id: "a", title: "Study for CS Midterm", start: 720, end: 723, fixed: false, source: "orion" },
    { id: "b", title: "Gym", start: 1245, end: 1335, fixed: false, source: "orion", touched: true },
  ];
  assert.equal(checkDay(day, { from: 600, onlyTouched: true }).ok, true);
  assert.equal(checkDay(day, { from: 600 }).ok, false); // the whole-day view still sees it
  const shrunk = [{ ...day[0], touched: true }, day[1]];
  assert.match(checkDay(shrunk, { from: 600, onlyTouched: true }).problems[0], /shorter than 5 minutes/);
});

test("an overlap between two untouched blocks is not charged to this change", () => {
  const day = [
    { id: "a", title: "A", start: 700, end: 760, fixed: false, source: "orion" },
    { id: "b", title: "B", start: 730, end: 790, fixed: false, source: "orion" },
    { id: "c", title: "C", start: 900, end: 960, fixed: false, source: "orion", touched: true },
  ];
  assert.equal(checkDay(day, { from: 600, onlyTouched: true }).ok, true);
});
