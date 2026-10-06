// "Schedule things for me until around 8 PM" (2026-10-06): ORION invented
// --until, the tool ignored it, and the evening ran to 21:29.
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
const at = (h, m = 0) => new Date(2030, 9, 8, h, m).toISOString();
const minuteOf = (s) => { const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };

function world(t) {
  const home = mkdtempSync(join(tmpdir(), "orion-until-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "cal.json"), JSON.stringify([{ identifier: "w", title: "work on orion", start: at(16, 59), end: at(17, 29), orion: "side_project" }]));
  writeFileSync(join(home, "rem.json"), JSON.stringify(["finish resume", "research backpacking stuff", "send internship applications", "do 20 minutes of marketing work."]
    .map((title, i) => ({ identifier: `r${i}`, title, list: "Orion" }))));
  writeFileSync(join(home, "life.json"), JSON.stringify({ freeMinutesKept: 0 }));
  const env = { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "cal.json"), FAKE_REMINDERS: join(home, "rem.json"),
    ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 8, 16, 59).toISOString() };
  const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { encoding: "utf8", env }); return { code: r.status, out: r.stdout + r.stderr }; };
  const cal = () => JSON.parse(readFileSync(join(home, "cal.json"), "utf8")).map((e) => ({ title: e.title, start: minuteOf(e.start), end: minuteOf(e.end) }));
  return { run, cal };
}

test("planning from the to-do list until 8 PM books nothing after 8 PM and names what did not fit", (t) => {
  const w = world(t);
  const r = w.run("day", "--todos", "--until", "20:00");
  assert.equal(r.code, 0, r.out);
  const day = w.cal();
  assert.ok(day.every((b) => b.end <= 20 * 60), JSON.stringify(day));
  assert.ok(day.length > 1, r.out);
});

test("a length in the to-do's title is used, and the block under way never shrinks", (t) => {
  const w = world(t);
  w.run("day", "--todos", "--until", "23:00");
  const orion = w.cal().find((b) => b.title === "work on orion");
  assert.equal(orion.end - orion.start, 30);
  const marketing = w.cal().find((b) => /marketing/.test(b.title));
  assert.ok(marketing, JSON.stringify(w.cal()));
  assert.equal(marketing.end - marketing.start, 20);
});

test("an option the tool does not have is refused and nothing changes", (t) => {
  const w = world(t);
  const before = w.cal();
  const r = w.run("day", "--todos", "--before-dinner");
  assert.equal(r.code, 2);
  assert.match(r.out, /has no --before-dinner option/);
  assert.deepEqual(w.cal(), before);
});

test("now with --plan is refused instead of silently dropping the plans", (t) => {
  const w = world(t);
  const r = w.run("now", "work on orion, 30", "--plan", "finish resume, 90");
  assert.equal(r.code, 2);
  assert.match(r.out, /not --plan/);
});
