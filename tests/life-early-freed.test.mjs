// "I'm done with ORION stuff early" (2026-10-06): a break if he has worked an
// hour, then the freed time goes to what is short, then the day moves up.
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

function world(t, events, now, config = { minimums: { "side project": 60 } }) {
  const home = mkdtempSync(join(tmpdir(), "orion-early-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "cal.json"), JSON.stringify(events));
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, ...config }));
  const env = { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "cal.json"), ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 8, ...now).toISOString() };
  const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { encoding: "utf8", env }); return { code: r.status, out: r.stdout + r.stderr }; };
  const cal = () => JSON.parse(readFileSync(join(home, "cal.json"), "utf8")).map((e) => ({ title: e.title, start: minuteOf(e.start), end: minuteOf(e.end) })).sort((a, b) => a.start - b.start);
  return { run, cal };
}
const evening = [
  { identifier: "o", title: "work on orion", start: at(16), end: at(18), orion: "side_project" },
  { identifier: "y", title: "YouTube side project", start: at(18, 10), end: at(18, 40), orion: "side_project" },
  { identifier: "s", title: "Study", start: at(18, 45), end: at(19, 45), orion: "study" },
  { identifier: "d", title: "Dinner", start: at(19, 50), end: at(20, 35), orion: "meal" },
];
const noOverlaps = (d) => d.every((x, i) => d.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end)));

test("finishing an 80-minute stint 40 minutes early: a break, the short side project grows, nothing overlaps", (t) => {
  const w = world(t, evening, [17, 20]);
  const r = w.run("early");
  assert.equal(r.code, 0, r.out);
  const d = w.cal();
  assert.ok(noOverlaps(d), JSON.stringify(d));
  const orion = d.find((b) => b.title === "work on orion");
  assert.equal(orion.end, 17 * 60 + 20);
  const brk = d.find((b) => b.title === "Break");
  assert.deepEqual([brk.start, brk.end], [17 * 60 + 20, 17 * 60 + 35], r.out);
  const yt = d.find((b) => /YouTube/.test(b.title));
  assert.ok(yt.end - yt.start > 30, r.out);
  assert.match(r.out, /added a break/); assert.match(r.out, /gave YouTube side project/);
  assert.equal(d.find((b) => b.title === "Study").end - d.find((b) => b.title === "Study").start, 60);
});

test("a short stint finished early gets no break; the day just moves up", (t) => {
  const w = world(t, [{ identifier: "o", title: "email", start: at(17), end: at(17, 30), orion: "other" },
    { identifier: "s", title: "Study", start: at(17, 35), end: at(18, 35), orion: "study" }], [17, 10], {});
  const r = w.run("early");
  assert.equal(r.code, 0, r.out);
  assert.ok(!w.cal().some((b) => b.title === "Break"));
  assert.ok(w.cal().find((b) => b.title === "Study").start < 17 * 60 + 35, r.out);
});

test("undo puts the evening back exactly", (t) => {
  const w = world(t, evening, [17, 20]);
  const before = w.cal();
  w.run("early");
  assert.equal(w.run("undo").code, 0);
  assert.deepEqual(w.cal(), before);
});
