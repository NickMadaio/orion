// 2026-10-31 review, finding 1: a replan never deletes the Gym, and a block given up on at its end does not come back as 5 min.
// Through the real orion-reschedule displace, with a fake bridge and a temp home.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planDisplace } from "../scripts/lib/life/reality.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function world(t, events, config = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-rv-displace-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, ranks: { gym: "must" }, anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }], ...config }));
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

test("a Gym given up on with no room to come back stays on the calendar, and the output says so", (t) => {
  const w = world(t, [{ title: "Gym", start: at(20, 15), end: at(21, 45), orion: "gym", orionTags: "gym" }], { bedtime: "22:00" });
  const r = w.run([21, 10], "displace", "Gym", "--why", "gave-up");
  assert.equal(r.code, 0, r.out);
  assert.ok(w.day().includes("Gym 20:15-21:45"), `the replan deleted the Gym: ${w.day().join(", ")}`);
  assert.match(r.out, /Gym has no room today/);
});

test("planDisplace: a must with no room is kept (nothing removed); a lower block given up on at its end comes back whole or not at all", () => {
  const gym = { id: "g", title: "Gym", kind: "gym", start: 1215, end: 1305, fixed: false, source: "orion", rank: "must" };
  const opts = { date: "2030-10-03", now: 1300, window: { start: 480, end: 1320 }, config: { ranks: { gym: "must" } }, buffer: 0, why: "gave-up", txn: "t", at: "2030-10-03T21:00:00Z" };
  const kept = planDisplace([gym], gym, opts);
  assert.deepEqual(kept.removed, []);
  assert.equal(kept.offToday.length, 1);
  const study = { id: "s", title: "Study for CS Midterm", kind: "study", start: 1215, end: 1275, fixed: false, source: "orion" };
  const back = planDisplace([study], study, { ...opts, now: 1275, window: { start: 480, end: 1400 } });
  for (const c of back.created) assert.ok(c.end - c.start >= 30, `re-entered as ${c.end - c.start} min`);
});
