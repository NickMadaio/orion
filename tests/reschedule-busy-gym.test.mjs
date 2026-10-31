// orion-reschedule end to end against a fake calendar, replaying Nick's messages
// from 2026-09-30 (soccer 5-7 onto a full day; "get rid of studying and Orion
// stuff"; "clear everything and redo it: nap 90 at 1, internship stuff 90…").
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
const DATE = "2030-10-02";                     // a future day, so "now" is midnight
const iso = (h, m = 0) => new Date(2030, 9, 2, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const minute = (s) => { const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };

function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-resched-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--date", DATE], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar,
             ORION_RESCHEDULE_UNDO: join(home, "undo.json") } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8"))
    .map((e) => ({ title: e.title, start: minute(e.start), end: minute(e.end) })).sort((a, b) => a.start - b.start);
  return { run, day };
}
const noOverlaps = (day) => day.every((x, i) => day.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end)));
const hm = (h, m = 0) => h * 60 + m;

const evening = [
  { title: "CS2100 Lab", start: iso(11), end: iso(12, 30) },
  { title: "Study", start: iso(14), end: iso(15, 30), orion: "study" },
  { title: "Gym", start: iso(17), end: iso(18, 30), orion: "gym" },
  { title: "Dinner", start: iso(19), end: iso(19, 45), orion: "meal" },
  { title: "Side project (YouTube)", start: iso(20), end: iso(21), orion: "side_project" },
];
const gymLength = (day) => day.filter((b) => /gym/i.test(b.title)).reduce((n, b) => n + b.end - b.start, 0);

for (const [name, win] of [["over gym", "17:15-19:15"], ["clipping the start of gym", "16:30-18:00"], ["covering gym whole", "16:00-20:00"]]) {
  test(`busy ${name} keeps gym at its full 90 minutes`, (t) => {
    const w = world(t, evening);
    const r = w.run("busy", win, "--why", "dinner with a friend");
    assert.equal(r.code, 0, r.out);
    const day = w.day();
    assert.equal(gymLength(day), hm(1, 30), JSON.stringify(day));
    assert.ok(noOverlaps(day), JSON.stringify(day));
  });
}
