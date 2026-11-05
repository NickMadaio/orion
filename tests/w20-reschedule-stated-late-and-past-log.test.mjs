// w20 sched: a time he states past the computed bedtime is booked (not "did not fit"), and `log` can write yesterday.
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
const isoAt = (h, m, plus = 0) => spawnSync(process.execPath, ["-e", `process.stdout.write(new Date(2030, 9, ${6 + plus}, ${h}, ${m}).toISOString())`], { encoding: "utf8", env: { ...process.env, TZ } }).stdout;

function world(t) {
  const home = mkdtempSync(join(tmpdir(), "orion-w20-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const cfg = join(home, ".openclaw/orion-controlled/life-config.json");
  writeFileSync(cfg, JSON.stringify({ commuteMinutes: 45, bedtime: "21:50" }));
  const calendar = join(home, "calendar.json");
  const ev = [["CS seminar", [9, 0], [10, 30], 0], ["Nap", [15, 0], [18, 30], 0, "rest"], ["Study", [17, 0], [18, 0], -1, "study"]];
  writeFileSync(calendar, JSON.stringify(ev.map(([title, a, b, d, orion], i) => ({ identifier: `s${i}`, title, start: isoAt(...a, d), end: isoAt(...b, d), ...(orion ? { orion } : {}) }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, TZ, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_LIFE_CONFIG: cfg, ORION_RESCHEDULE_NOW: isoAt(20, 2) } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { run, cal: () => JSON.parse(readFileSync(calendar, "utf8")) };
}

test("add at a stated 22:00 books it past a 21:50 bedtime", (t) => {
  const w = world(t);
  const r = w.run("add", "Gym", "60", "--at", "22:00", "--length-explicit");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Gym: 22:00–23:00/);
});

test("day --plan with a stated late time books it too", (t) => {
  const w = world(t);
  const r = w.run("day", "--plan", "Gym, 60, 22:00");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Gym: 22:00–23:00/);
  assert.doesNotMatch(r.out, /NOT BOOKED/);
});

test("log can write yesterday, replacing the planned block, without re-weighing today", (t) => {
  const w = world(t);
  const r = w.run("log", "Pub", "--from", "17:00", "--to", "18:00", "--date", "yesterday", "--instead", "Study");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /logged Pub 17:00–18:00 \(replaced Study\)/);
  assert.ok(w.cal().some((e) => e.title === "Pub"));
});

test("add still refuses another earlier day", (t) => {
  const w = world(t);
  const r = w.run("add", "Gym", "60", "--at", "10:00", "--date", "2030-10-05");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /in the past/);
});
