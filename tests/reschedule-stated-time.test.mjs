// Gate rea-work-on-it-tomorrow-c: "move finish resume to tomorrow at 10am, 45 min" ran add --at 10:00 --date tomorrow, yet the block was
// placed 1:20 PM with no word why. A time he states for add is his: it lands there, or the output says what blocked it.
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

function world(t, { now = [8, 0], events }) {
  const home = mkdtempSync(join(tmpdir(), "orion-stated-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const cfg = join(home, ".openclaw/orion-controlled/life-config.json");
  writeFileSync(cfg, JSON.stringify({ commuteMinutes: 45 }));
  const calendar = join(home, "calendar.json");
  const isoAt = (h, m, plus = 0) => spawnSync(process.execPath, ["-e", `process.stdout.write(new Date(2030, 9, ${6 + plus}, ${h}, ${m}).toISOString())`], { encoding: "utf8", env: { ...process.env, TZ } }).stdout;
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, title: e.title, start: isoAt(...e.start, e.d ?? 0), end: isoAt(...e.end, e.d ?? 0), ...(e.orion ? { orion: e.orion } : {}) }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8",
      env: { ...process.env, TZ, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_LIFE_CONFIG: cfg, ORION_RESCHEDULE_NOW: isoAt(...now) } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const cal = () => {
    const js = `const e=${JSON.stringify(JSON.parse(readFileSync(calendar, "utf8")))};const m=(s)=>{const x=new Date(s);return {d:x.getDate(),m:x.getHours()*60+x.getMinutes()}};
      process.stdout.write(JSON.stringify(e.map((v)=>({title:v.title,day:m(v.start).d,start:m(v.start).m,end:m(v.end).m}))))`;
    return JSON.parse(spawnSync(process.execPath, ["-e", js], { encoding: "utf8", env: { ...process.env, TZ } }).stdout);
  };
  return { run, cal };
}
const hm = (h, m = 0) => h * 60 + m;
const busyTomorrow = (extra = []) => [
  { title: "Gym", start: [7, 0], end: [8, 30], d: 1, orion: "gym" },
  { title: "ECON1115 Lecture", start: [13, 0], end: [14, 30], d: 1 },
  { title: "CS2100 Lab", start: [15, 0], end: [17, 0], d: 1 },
  ...extra,
];
const resume = (w) => w.cal().find((b) => b.title === "Finish resume" && b.day === 7);

for (const [label, now, events] of [
  ["sparse Sunday", [8, 0], []],
  ["busy weekday, class later", [8, 0], busyTomorrow()],
  ["evening before", [21, 30], busyTomorrow()],
]) {
  for (const len of [45, 60, 30]) {
    test(`(a) free at 10:00 tomorrow: stated time wins (${label}, ${len} min)`, (t) => {
      const w = world(t, { now, events });
      const r = w.run("add", "Finish resume", String(len), "--at", "10:00", "--date", "tomorrow", "--length-explicit");
      assert.equal(r.code, 0, r.out);
      const b = resume(w);
      assert.ok(b, r.out);
      assert.equal(b.start, hm(10), r.out);
      assert.equal(b.end, hm(10) + len, r.out);
    });
  }
}

test("(a) same-day add --at stays at the stated time when free", (t) => {
  const w = world(t, { now: [8, 0], events: busyTomorrow().map((e) => ({ ...e, d: 0 })) });
  const r = w.run("add", "Finish resume", "45", "--at", "11:00", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.cal().find((b) => b.title === "Finish resume")?.start, hm(11), r.out);
});

test("(b) a class at 10:00 tomorrow: placed elsewhere and the output says why", (t) => {
  const w = world(t, { events: busyTomorrow([{ title: "ECON1115 Lecture", start: [9, 30], end: [11, 0], d: 1 }]) });
  const r = w.run("add", "Finish resume", "45", "--at", "10:00", "--date", "tomorrow", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  const b = resume(w);
  assert.ok(b && b.start !== hm(10), r.out);
  assert.match(r.out, /could not go at 10:00 \(ECON1115 Lecture is there\)/i, r.out);
});

test("(b) a plan with people at 10:00 same day: output names it", (t) => {
  const w = world(t, { events: [{ title: "Coffee with Sam", start: [9, 45], end: [10, 45] }] });
  const r = w.run("add", "Finish resume", "45", "--at", "10:00", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  const b = w.cal().find((x) => x.title === "Finish resume");
  assert.ok(b && b.start !== hm(10), r.out);
  assert.match(r.out, /could not go at 10:00 \(Coffee with Sam is there\)/i, r.out);
});

test("(c) only an ORION movable block at 10:00 tomorrow: stated time wins, the owned one slides", (t) => {
  const w = world(t, { events: busyTomorrow([{ title: "Study for CS Midterm", start: [9, 30], end: [11, 0], d: 1, orion: "study" }]) });
  const r = w.run("add", "Finish resume", "45", "--at", "10:00", "--date", "tomorrow", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  assert.equal(resume(w)?.start, hm(10), r.out);
});

test("(c) same day: ORION's own block at the stated time slides", (t) => {
  const w = world(t, { events: [{ title: "Study for CS Midterm", start: [10, 0], end: [11, 30], orion: "study" }] });
  const r = w.run("add", "Finish resume", "45", "--at", "10:00", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.cal().find((b) => b.title === "Finish resume")?.start, hm(10), r.out);
});

test("(a) a class soon after the stated slot (travel time): the stated time still holds, or the output says why", (t) => {
  const w = world(t, { events: busyTomorrow([{ title: "CS1000 Lecture", start: [11, 0], end: [12, 0], d: 1 }]) });
  const r = w.run("add", "Finish resume", "45", "--at", "10:00", "--date", "tomorrow", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  const b = resume(w);
  assert.ok(b, r.out);
  assert.ok(b.start === hm(10) || /could not go at 10:00 \(.+ is there\)/.test(r.out), r.out);
});

test("(a) right after tomorrow's gym: stated time holds, or the output says why", (t) => {
  const w = world(t, { events: [{ title: "Gym", start: [8, 30], end: [10, 0], d: 1, orion: "gym" }, { title: "ECON1115 Lecture", start: [13, 0], end: [14, 30], d: 1 }] });
  const r = w.run("add", "Finish resume", "45", "--at", "10:00", "--date", "tomorrow", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  const b = resume(w);
  assert.ok(b, r.out);
  assert.ok(b.start === hm(10) || /could not go at 10:00/.test(r.out), r.out);
});
