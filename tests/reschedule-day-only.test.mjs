// 2026-10-25 (the day the UK clocks went back, 13:05 GMT): "only doing two things today. Study for CS Midterm from now until 6pm.
// then i go back home. once im home i work on marketing presentation until 12 am." The worker wrote `resize Study 300` (14:00–19:00)
// and `move "AE1 Marketing Presentation" --to 24:00` (refused), and the other blocks cascaded into the evening.
// Here: an END of 24:00 is the end of today (move/extend --until 24:00), and `day --plan … --only` puts in exactly what he named and
// takes every other ORION-planned block off the rest of today, never his own events, classes or plans with people.
// Every world is a temp HOME with a fake calendar bridge: nothing here touches his real calendar or ~/.openclaw.
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
const TZ = "Europe/London";

function world(t, { y = 2030, mo = 9, d = 3, now = [13, 5], events, config = {} }) {
  const home = mkdtempSync(join(tmpdir(), "orion-only-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const cfg = join(home, ".openclaw/orion-controlled/life-config.json");
  writeFileSync(cfg, JSON.stringify({ commuteMinutes: 45, ...config }));
  const calendar = join(home, "calendar.json");
  // ISO strings are computed in the child (TZ fixed) so a DST day is laid out in London time whatever this machine's zone is.
  const isoAt = (h, m) => spawnSync(process.execPath, ["-e", `process.stdout.write(new Date(${y}, ${mo}, ${d}, ${h}, ${m}).toISOString())`], { encoding: "utf8", env: { ...process.env, TZ } }).stdout;
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, title: e.title, start: isoAt(...e.start), end: isoAt(...e.end), ...(e.orion ? { orion: e.orion } : {}) }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8",
      env: { ...process.env, TZ, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar,
             ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_LIFE_CONFIG: cfg,
             ORION_RESCHEDULE_NOW: isoAt(...now) } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  // Minutes of day in London; an end at the next midnight reads as 1440.
  const day = () => {
    const raw = JSON.parse(readFileSync(calendar, "utf8"));
    const js = `const e=${JSON.stringify(raw)};const m=(s)=>{const x=new Date(s);return x.getHours()*60+x.getMinutes()};const day=(s)=>new Date(s).getDate();
      process.stdout.write(JSON.stringify(e.map((v)=>({title:v.title,start:m(v.start),end:day(v.end)!==day(v.start)&&m(v.end)===0?1440:m(v.end)})).sort((a,b)=>a.start-b.start)))`;
    return JSON.parse(spawnSync(process.execPath, ["-e", js], { encoding: "utf8", env: { ...process.env, TZ } }).stdout);
  };
  return { run, day };
}

// His day before the change (undo journal, 2026-10-25): times in GMT.
const sunday = [
  { title: "practice leetcode", start: [10, 30], end: [11, 30], orion: "study" },
  { title: "finish resume", start: [11, 35], end: [13, 5], orion: "other" },
  { title: "AE1 Marketing Presentation", start: [13, 10], end: [13, 55], orion: "study" },
  { title: "Study for CS Midterm", start: [14, 0], end: [15, 0], orion: "study" },
  { title: "Go over Orion learning plan", start: [15, 5], end: [16, 5], orion: "side_project" },
  { title: "DS Lab 05", start: [16, 10], end: [16, 55], orion: "study" },
  { title: "Gym", start: [17, 0], end: [18, 30], orion: "gym" },
];
const hm = (h, m = 0) => h * 60 + m;
const PLAN = ["day", "--plan", "Study for CS Midterm, 295, 13:05", "--plan", "AE1 Marketing Presentation, 315, 18:45", "--only"];

for (const [label, date] of [["DST day 2026-10-25", { y: 2026, mo: 9, d: 25 }], ["an ordinary Sunday 2026-10-18", { y: 2026, mo: 9, d: 18 }]]) {
  test(`${label}: day --plan … --only books exactly what he said and clears ORION's other blocks for the rest of today`, (t) => {
    const { run, day } = world(t, { ...date, events: sunday, config: { ranks: { gym: "must" }, anchors: [{ title: "Gym", minutes: 90 }] } });
    const r = run(...PLAN);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /DROPPED \(he said only what he named today\): .*Go over Orion learning plan/);
    const d = day();
    const study = d.find((b) => b.title === "Study for CS Midterm");
    const mkt = d.find((b) => b.title === "AE1 Marketing Presentation");
    assert.deepEqual([study.start, study.end], [hm(13, 5), hm(18)], JSON.stringify(d));
    assert.deepEqual([mkt.start, mkt.end], [hm(18, 45), 1440], JSON.stringify(d));
    for (const gone of ["Go over Orion learning plan", "DS Lab 05", "Gym"]) assert.ok(!d.some((b) => b.title === gone), `${gone} still on: ${JSON.stringify(d)}`);
    // What already happened stays.
    assert.ok(d.some((b) => b.title === "practice leetcode") && d.some((b) => b.title === "finish resume"), JSON.stringify(d));
    assert.equal(d.filter((b) => b.title === "Study for CS Midterm").length, 1);
  });
}

test("--only never touches a class, his own event or a plan with people", (t) => {
  const events = [
    { title: "CS2100 Lecture", start: [15, 0], end: [16, 0] },
    { title: "Dinner with Sam", start: [19, 0], end: [20, 0] },
    { title: "Dentist", start: [21, 0], end: [21, 30] },
    { title: "Reading", start: [16, 30], end: [17, 0], orion: "study" },
    { title: "Study", start: [14, 0], end: [14, 45], orion: "study" },
    { title: "Lunch with Maya", start: [22, 0], end: [22, 30], orion: "meal" },   // a plan with people ORION booked: never cleared
  ];
  const { run, day } = world(t, { events });
  const r = run("day", "--plan", "Study, 100, 13:10", "--only");
  assert.equal(r.code, 0, r.out);
  const d = day();
  for (const kept of ["CS2100 Lecture", "Dinner with Sam", "Dentist", "Lunch with Maya"]) assert.ok(d.some((b) => b.title === kept), `${kept} was removed: ${r.out}`);
  assert.ok(!d.some((b) => b.title === "Reading"), r.out);
});

test("--only needs at least one --plan", (t) => {
  const { run } = world(t, { events: sunday });
  const r = run("day", "--only");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /usage/);
});

test("move --until 24:00 ends the block at midnight today (it was refused as not HH:MM)", (t) => {
  const { run, day } = world(t, { events: sunday });
  const r = run("move", "AE1 Marketing Presentation", "--to", "18:45", "--until", "24:00");
  assert.equal(r.code, 0, r.out);
  const mkt = day().find((b) => b.title === "AE1 Marketing Presentation");
  assert.deepEqual([mkt.start, mkt.end], [hm(18, 45), 1440]);
});

test("extend --until 24:00 is the end of today; 24:30 and a 24:00 start are still refused", (t) => {
  const { run, day } = world(t, { events: [{ title: "Reading", start: [22, 0], end: [23, 0], orion: "study" }], now: [21, 0] });
  const ok = run("extend", "Reading", "--until", "24:00");
  assert.equal(ok.code, 0, ok.out);
  assert.equal(day().find((b) => b.title === "Reading").end, 1440);
  assert.notEqual(run("extend", "Reading", "--until", "24:30").code, 0);
  assert.notEqual(run("move", "Reading", "--to", "24:00").code, 0);
});
