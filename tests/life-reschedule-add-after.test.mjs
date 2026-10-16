// r8 review 3 M3 (2026-10-16): `add "resume work" 45 --after Lunch` set the start to Lunch's end with no buffer
// and moved Lunch itself ("moved Lunch: 12:15 → 13:40"). --after is a floor (anchor end + buffer), like "X after Y".
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-02";
const iso = (h, m = 0) => new Date(2030, 9, 2, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");

function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-addafter-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "life.json"), "{}");
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  return (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--date", DATE], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json") } });
    return `${r.stdout}${r.stderr}`;
  };
}

const day = [
  { title: "Lunch", start: iso(12, 15), end: iso(12, 45) },
  { title: "Study", start: iso(10), end: iso(11) },
  { title: "Side project", start: iso(14), end: iso(15) },
  { title: "Gym", start: iso(16), end: iso(17) },
  { title: "Dinner", start: iso(18, 30), end: iso(19, 15) },
];

test("add --after Lunch starts after Lunch with its buffer and moves nothing", (t) => {
  const run = world(t, day);
  const out = run("add", "resume work", "45", "--after", "Lunch", "--dry-run");
  assert.match(out, /planned resume work: 12:(?:50|55)–/, out);
  assert.doesNotMatch(out, /moved Lunch/, out);
  assert.doesNotMatch(out, /^\s*moved /m, out);
});
