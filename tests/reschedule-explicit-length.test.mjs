// W8-A (gate run-1101080052, rea-exhausted-c): "add a 30 min nap at 11am" was booked 11:00-12:15 because his saved nap minimum (75) raised the
// length he stated. An `add` carries the length asked for; saved minimums only raise lengths ORION defaulted. Fixtures only.
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
const CONFIG = { readyMinutes: 105, bufferMinutes: 5, commuteMinutes: 45, minimums: { nap: 75, "side project": 60 }, homeGapMinutes: 150, ranks: { gym: "must" },
  anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] };

function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-explen-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled");
  mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify(CONFIG));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const now = new Date(2030, 9, 3, 8, 0).toISOString();
  const env = { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: now, ORION_REACH_NOW: now };
  const run = (...args) => { const r = spawnSync(process.execPath, [RESCHEDULE, ...args, "--date", DATE], { encoding: "utf8", env }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  const day = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title} ${clock(e.start)}-${clock(e.end)}`);
  return { run, day };
}
const BUSY = [{ title: "CS2100 — Lecture", start: at(9), end: at(10, 30) }, { title: "ECON1115 — Lecture", start: at(13, 30), end: at(15) }];
const SPARSE = [];

for (const [name, events] of [["a busy weekday", BUSY], ["a sparse day", SPARSE]]) {
  test(`${name}: a stated 30 min nap stays 30 min over the saved 75 minimum`, (t) => {
    const w = world(t, events);
    const r = w.run("add", "Nap", "30", "--at", "11:00");
    assert.equal(r.code, 0, r.out);
    assert.ok(w.day().includes("Nap 11:00-11:30"), w.day().join("\n"));
    assert.doesNotMatch(r.out, /his minimum/);
  });
  test(`${name}: held out lengths (20 and 45 min naps) are kept`, (t) => {
    for (const [mins, end] of [["20", "16:20"], ["45", "16:45"]]) {
      const w = world(t, events);
      assert.equal(w.run("add", "nap", mins, "--at", "16:00").code, 0);
      assert.ok(w.day().some((l) => l.toLowerCase() === `nap 16:00-${end}`), w.day().join("\n"));
    }
  });
}
