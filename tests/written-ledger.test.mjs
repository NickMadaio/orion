// Review of 7d5f393 (live run 5 follow-up): an EXISTING event is ORION's, and so may move, only on hard evidence — the [orion:kind] marker
// ORION writes into its notes, or its id in orion-written.json. No title rule: real events with to-do-sounding titles stay his and fixed.
// `orion-reschedule ledger backfill` marks older ORION events once, from the undo journal, the app's created-events record, ORION's pins
// and its markers. Fixtures only: temp homes, the fake bridge, no live state.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toBlocks } from "../scripts/lib/life/live-day.mjs";
import { backfillEvidence } from "../scripts/lib/life/written.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (h, m = 0) => new Date(2030, 9, 22, h, m).toISOString();
const ev = (identifier, title, extra = {}) => ({ identifier, title, start: at(14), end: at(15), allDay: "false", ...extra });

// The reviewer's eight real events, plus the old School "finish resume" with no evidence.
const REAL = ["Fix car — Kwik Fit 10am", "Submit visa application at VFS", "Review w/ advisor", "Do taxes w accountant", "Practice match", "Prep cook",
  "Research group sync", "Prep for Annika visit", "finish resume"];

test("toBlocks: his events never move by their title; ORION's move by marker or ledger, whatever calendar", () => {
  const events = [...REAL.map((t, i) => ev(`r${i}`, t)), ev("led", "finish resume (old School block)"), ev("tag", "Gym", { orion: "gym" }), ev("cls", "CS1800 Discrete Structures — Lecture")];
  const blocks = toBlocks(events, "2030-10-22", new Set(["led"]));
  for (let i = 0; i < REAL.length; i += 1) assert.equal(blocks.find((b) => b.calendarId === `r${i}`).fixed, true, `${REAL[i]} must stay fixed`);
  assert.equal(blocks.find((b) => b.calendarId === "led").fixed, false, "in the ledger: ORION's");
  assert.equal(blocks.find((b) => b.calendarId === "led").source, "orion");
  assert.equal(blocks.find((b) => b.calendarId === "tag").fixed, false, "marked: ORION's");
  assert.equal(blocks.find((b) => b.calendarId === "cls").fixed, true);
});

test("backfillEvidence: only the journal's creates, the app's created record, pins and markers count; never a title", () => {
  const events = [ev("A", "finish resume"), ev("B", "Gym"), ev("C", "walk", { orion: "study" }), ev("D", "Fix car — Kwik Fit 10am"), ev("E", "reading"), ev("F", "Prep cook")];
  const got = backfillEvidence({ events, journal: [{ steps: [{ op: "create", identifier: "A" }, { op: "move", identifier: "D" }, { op: "delete", identifier: "F" }] }],
    created: ["CAL1:E"], pins: { "2030-10-22": ["B"] } });
  assert.deepEqual(Object.fromEntries(got), { A: ["journal"], E: ["created"], B: ["pin"], C: ["tag"] });
  assert.equal(got.has("D"), false, "a move of his event is not evidence");
  assert.equal(got.has("F"), false, "deleting an event is not evidence it was ORION's");
});

function world(t, events, { journal = [], pins = {}, created } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-ledger-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  const calendar = join(home, "calendar.json"); writeFileSync(calendar, JSON.stringify(events));
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, commuteMinutes: 45 }));
  writeFileSync(join(home, "undo.json"), JSON.stringify(journal)); writeFileSync(join(home, "pins.json"), JSON.stringify(pins));
  if (created) writeFileSync(join(controlled, "orion-created-events.json"), JSON.stringify(created));
  const now = new Date(2030, 9, 22, 9, 0).toISOString();
  const env = { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: join(ROOT, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: calendar,
    ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: now, ORION_REACH_NOW: now };
  delete env.ORION_WRITTEN_FILE;
  const run = (...args) => { const r = spawnSync(process.execPath, [join(ROOT, "scripts/orion-reschedule"), ...args], { encoding: "utf8", env }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  const ledger = () => { try { return JSON.parse(readFileSync(join(home, "orion-written.json"), "utf8")); } catch { return null; } };
  return { run, ledger, home, controlled, calendar };
}

test("ledger backfill: marks on evidence, prints what it marked, is idempotent, and --dry-run writes nothing", (t) => {
  const events = [ev("A", "finish resume"), ev("B", "Gym"), ev("D", "Fix car — Kwik Fit 10am"), ev("E", "reading"), ev("P", "Prep cook")];
  const w = world(t, events, { journal: [{ steps: [{ op: "create", identifier: "A" }, { op: "create", identifier: "GONE" }] }], pins: { "2030-10-22": ["B"] }, created: ["CAL1:E"] });
  const dry = w.run("ledger", "backfill", "--dry-run");
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /^Would mark 4 event ids as ORION's own \(3 on the calendar now\):/);
  assert.equal(w.ledger(), null, "dry run wrote nothing");
  const first = w.run("ledger", "backfill");
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /Marked 4 event ids as ORION's own \(3 on the calendar now\):/);
  assert.match(first.out, /marked finish resume 2030-10-22 14:00 \(journal\)/);
  assert.match(first.out, /marked Gym 2030-10-22 14:00 \(pin\)/);
  assert.match(first.out, /marked reading 2030-10-22 14:00 \(created\)/);
  assert.match(first.out, /1 more from the journal or pins are not on the calendar now/);
  assert.doesNotMatch(first.out, /Fix car|Prep cook/);
  assert.deepEqual(new Set(w.ledger()), new Set(["A", "GONE", "B", "E"]));
  const again = w.run("ledger", "backfill");
  assert.match(again.out, /^Nothing new to mark: 4 ORION event ids already in the ledger\./);
  assert.deepEqual(new Set(w.ledger()), new Set(["A", "GONE", "B", "E"]));
  // after the backfill the old block moves, his events do not
  const show = JSON.parse(w.run("show", "--json", "--date", "2030-10-22").out);
  assert.deepEqual(Object.fromEntries(show.blocks.map((b) => [b.title, b.fixed])), { "finish resume": false, Gym: false, "Fix car — Kwik Fit 10am": true, reading: false, "Prep cook": true });
  assert.equal(existsSync(join(w.controlled, "orion-written.json")), false, "a test never writes the controlled-dir ledger");
});

test("the scheduler records the blocks it creates (never his own fixed plans)", (t) => {
  const w = world(t, []);
  const r = w.run("add", "walk", "45", "--at", "17:00", "--date", "2030-10-22");
  assert.equal(r.code, 0, r.out);
  const ids = JSON.parse(readFileSync(w.calendar, "utf8")).filter((e) => e.title === "walk").map((e) => e.identifier);
  assert.equal(ids.length, 1);
  assert.deepEqual(w.ledger(), ids);
  assert.equal(w.run("ledger", "nope").code, 2);
});
