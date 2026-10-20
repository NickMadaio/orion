// 2026-10-20 review: a write that is stopped partway must never leave his day with holes and no way back (calendar-write.mjs applyPlan).
//   SIGTERM (the 60 s execFile timeout, a host abort): held until the write is complete and recorded; the day is fully applied and "undo" reverses it exactly.
//   SIGKILL at any moment: creates come first, a move or delete is journaled BEFORE it is sent, so none of his blocks is ever lost and "undo" can bring back whatever a request in flight took.
//   (A create already sent when the process dies still lands, unrecorded: one extra block at worst, never a hole.)
// Fixtures only: a fake bridge that takes 150 ms per write, a temp home.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESCHEDULE = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const EVENTS = [
  { title: "MKTG2201 Introduction to Marketing — Lecture", start: at(15, 30), end: at(17) },
  { title: "finish resume", start: at(17, 50), end: at(18, 50), orion: "study", orionTags: "study" },
  { title: "Gym", start: at(20, 15), end: at(21, 45), orion: "gym", orionTags: "gym" },
];
const CONFIG = { bufferMinutes: 5, commuteMinutes: 45, anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] };
const PLAN = ["day", "--plan", "Gym, 90, 17:50", "--plan", "finish resume, 60, 19:25", "--date", "2030-10-03"];

function world(t) {
  const home = mkdtempSync(join(tmpdir(), "orion-interrupt-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify(CONFIG));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(EVENTS.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const now = new Date(2030, 9, 3, 16, 16).toISOString();
  const env = { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, FAKE_DELAY_MS: "150", ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: now, ORION_REACH_NOW: now };
  const titles = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title} ${e.start}-${e.end}`).sort();
  const undo = () => spawnSync(process.execPath, [RESCHEDULE, "undo"], { encoding: "utf8", env: { ...env, FAKE_DELAY_MS: "0" } });
  const start = () => spawn(process.execPath, [RESCHEDULE, ...PLAN], { env, stdio: "ignore" });
  const journal = () => (existsSync(join(home, "undo.json")) ? JSON.parse(readFileSync(join(home, "undo.json"), "utf8")) : []);
  return { titles, undo, start, journal };
}
const exited = (child) => new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("SIGTERM partway: the write finishes and is recorded, then the process stops; undo restores the day exactly", async (t) => {
  const w = world(t); const original = w.titles();
  const child = w.start(); const done = exited(child);
  for (let i = 0; i < 200 && !w.journal().length; i += 1) await sleep(25);   // the write has begun: its first step is journaled
  child.kill("SIGTERM");
  const { signal } = await done;
  assert.equal(signal, "SIGTERM", "it stops, after the write");
  const after = w.titles();
  assert.ok(after.some((l) => l.startsWith("Gym") && l.includes(at(17, 50))), after.join("\n"));
  assert.ok(after.some((l) => l.startsWith("finish resume") && l.includes(at(19, 25))), after.join("\n"));
  assert.equal(after.filter((l) => l.startsWith("Gym")).length, 1, "the old Gym is gone, not duplicated");
  assert.ok(w.journal().at(-1)?.steps.length >= 4, "the whole write is in the undo journal");
  assert.match(w.undo().stdout, /Undone/);
  assert.deepEqual(w.titles(), original);
});

for (const ms of [120, 300, 450, 600, 750, 900]) {
  test(`SIGKILL at ${ms} ms: none of his blocks is lost, and undo is there for whatever was written`, async (t) => {
    const w = world(t); const original = w.titles();
    const child = w.start(); const done = exited(child);
    await sleep(ms);
    child.kill("SIGKILL"); await done;
    await sleep(500);                    // a bridge call already sent finishes on its own
    const after = w.titles();
    const lost = original.filter((l) => !after.includes(l));
    // Only a completed write may have taken an old block away, and then the journal holds it.
    if (lost.length) assert.ok(w.journal().at(-1)?.steps.some((s) => s.op === "delete" || s.op === "move"), `lost ${lost.join(", ")} with no journal`);
    w.undo();
    const restored = w.titles();
    for (const l of original) assert.ok(restored.includes(l), `${l} is back after undo\n${restored.join("\n")}`);
  });
}
