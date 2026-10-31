// Wave 4 calendar writes, script side (gate run-1031202318, clusters 3 and 9). Fixtures only: a fake bridge and a temp home.
//   "add cs lab 7:15pm to 10:30pm tonight" was refused: "DS Lab 05 is already on today's calendar". Words under three letters were
//   dropped, so "cs lab" and "DS Lab 05" were both just "lab". A different short qualifier (cs / ds) is a different thing.
//   "i slept from 2 to 3:30pm, redo the rest of the day" at 20:37 "moved practice leetcode: 2:52 PM → 3:30 PM": a piece of a
//   block left over after the nap but already over is never kept in elapsed time.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planLog } from "../scripts/lib/life/reality.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-w4-calwrite-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, ranks: { gym: "must" }, anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] }));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (now, ...args) => {
    const iso = new Date(2030, 9, 3, ...now).toISOString();
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/orion-reschedule"), ...args, "--date", "2030-10-03"], { encoding: "utf8", env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled,
      ORION_BRIDGE_BIN: join(ROOT, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"),
      ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: iso, ORION_REACH_NOW: iso } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title} ${clock(e.start)}-${clock(e.end)}`);
  return { run, day };
}

const EARLIER_LAB = { title: "DS Lab 05", start: at(14, 2), end: at(14, 47), orion: "study", orionTags: "study" };

test("a CS lab is not the DS Lab 05 that already happened: 'add cs lab 19:15-22:30' is booked", (t) => {
  const w = world(t, [EARLIER_LAB]);
  const r = w.run([19, 10], "add", "cs lab", "195", "--at", "19:15");
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /already on today's calendar/);
  assert.ok(w.day().some((l) => /^cs lab 19:15-22:30$/i.test(l)), w.day().join("\n"));
});

test("the same lab said again (same short qualifier) is still caught as already done today", (t) => {
  const w = world(t, [EARLIER_LAB]);
  const r = w.run([19, 10], "add", "ds lab", "60", "--at", "19:15");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /already on today's calendar/);
});

test("a title with no short qualifier still matches the lab ('lab' said alone)", (t) => {
  const w = world(t, [EARLIER_LAB]);
  const r = w.run([19, 10], "add", "lab", "60", "--at", "19:15");
  assert.equal(r.code, 1, r.out);
});

test("planLog: a leftover of a block that is already over by now is not kept in elapsed time", () => {
  const leet = { id: "l", title: "practice leetcode", kind: "study", start: 14 * 60 + 52, end: 15 * 60 + 37, fixed: false, source: "orion" };
  const gym = { id: "g", title: "Gym", kind: "gym", start: 21 * 60, end: 22 * 60 + 30, fixed: false, source: "orion" };
  const now = 20 * 60 + 37;
  const plan = planLog([leet, gym], { from: 14 * 60, to: 15 * 60 + 30 }, { title: "Nap", kind: "rest", date: "2030-10-03", now, window: { start: 480, end: 1410 }, config: {}, buffer: 5, txn: "t", at: "2030-10-03T20:37:00Z" });
  assert.ok(!plan.refused, plan.refused);
  for (const m of plan.moves) assert.ok(m.to >= now || m.to === m.from, `moved ${m.title} into elapsed time: ${m.from} -> ${m.to}`);
  for (const c of plan.created.filter((x) => !x.tags?.includes("logged"))) assert.ok(c.start >= now, `created ${c.title} at ${c.start}, before now ${now}`);
});

test("planLog: a leftover still under way at now starts at now", () => {
  const leet = { id: "l", title: "practice leetcode", kind: "study", start: 15 * 60, end: 16 * 60 + 30, fixed: false, source: "orion" };
  const now = 15 * 60 + 45;
  const plan = planLog([leet], { from: 14 * 60, to: 15 * 60 + 30 }, { title: "Nap", kind: "rest", date: "2030-10-03", now, window: { start: 480, end: 1410 }, config: {}, buffer: 5, txn: "t", at: "2030-10-03T15:45:00Z" });
  const m = plan.moves.find((x) => x.id === "l");
  assert.ok(m, JSON.stringify(plan.moves));
  assert.ok(m.to >= now, `starts at ${m.to}, before now ${now}`);
});
