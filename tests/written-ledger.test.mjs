// Live run 5 (2026-10-21): "finish resume" on the School calendar (an older ORION block whose [orion:kind] marker was lost) was treated as a
// fixed plan, so "reschedule tomorrow …, gym first then resume" was refused. ORION's own blocks are movable whatever calendar they are in:
// by their marker, by orion-written.json (every block ORION creates from now on), or, for the old ones, by a to-do title he does alone.
// Fixtures only: a temp ledger, the fake bridge, no live state.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (h, m = 0) => new Date(2030, 9, 22, h, m).toISOString();

test("toBlocks: ORION's blocks move whatever calendar they are in; only events ORION did not write are fixed", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orion-written-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  process.env.ORION_WRITTEN_FILE = join(dir, "orion-written.json");
  const { toBlocks } = await import(join(ROOT, "scripts/lib/life/live-day.mjs"));
  const ev = (identifier, title, extra = {}) => ({ identifier, title, start: at(14), end: at(15), allDay: "false", ...extra });
  const rows = [
    [ev("a", "finish resume"), false, "an old ORION to-do block with no marker (School)"],
    [ev("b", "apply to internships"), false, "another to-do title"],
    [ev("c", "Project sync"), true, "his own event"],
    [ev("d", "Project sync"), false, "the same title, but ORION wrote it (ledger)"],
    [ev("e", "CS1800 Discrete Structures — Lecture"), true, "a class"],
    [ev("f", "finish essay with Sam"), true, "a plan with people"],
    [ev("g", "Review session — Lecture"), true, "a class, whatever the verb"],
    [ev("h", "Gym", { orion: "gym" }), false, "marked"],
    [ev("i", "Quiz 3 due"), true, "a deadline"],
  ];
  const blocks = toBlocks(rows.map((r) => r[0]), "2030-10-22", new Set(["d"]));
  for (const [e, fixed, why] of rows) assert.equal(blocks.find((b) => b.calendarId === e.identifier).fixed, fixed, `${e.title}: ${why}`);
  assert.equal(blocks.find((b) => b.calendarId === "d").source, "orion");
  delete process.env.ORION_WRITTEN_FILE;
});

test("the scheduler records the blocks it creates in the ledger beside its journal (never the live one in a test), and only its own", (t) => {
  const home = mkdtempSync(join(tmpdir(), "orion-written-w-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  const calendar = join(home, "calendar.json"); writeFileSync(calendar, "[]");
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, commuteMinutes: 45 }));
  const now = new Date(2030, 9, 22, 9, 0).toISOString();
  const env = { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: join(ROOT, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: calendar,
    ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: now, ORION_REACH_NOW: now };
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/orion-reschedule"), "add", "walk", "45", "--at", "17:00", "--date", "2030-10-22"], { encoding: "utf8", env });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const ids = JSON.parse(readFileSync(calendar, "utf8")).filter((e) => e.title === "walk").map((e) => e.identifier);
  assert.equal(ids.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "orion-written.json"), "utf8")), ids);
  assert.equal(existsSync(join(controlled, "orion-written.json")), false, "the ledger follows ORION_RESCHEDULE_UNDO in a test");
});
