// 2026-10-20 live test as Nick, script side (docs/audits/2026-10-20-live-as-nick.md). Fixtures only: a fake bridge and a temp home.
//   "put cs lab from now until ten thirty" at 20:55 cut the Gym that was under way to 5 minutes; a Gym given up on at 20:55 came back as 20:55-21:45 (50 min).
//   A must (the Gym, 90) is never cut: moved later whole, or the change is refused with the reason.
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
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const EVENTS = [
  { title: "CS Lab", start: at(9), end: at(11, 15), orion: "study", orionTags: "study" },
  { title: "MKTG2201 Introduction to Marketing — Lecture", start: at(15, 30), end: at(17) },
  { title: "finish resume", start: at(17, 50), end: at(19, 20), orion: "study", orionTags: "study" },
  { title: "Gym", start: at(20, 15), end: at(21, 45), orion: "gym", orionTags: "gym" },
];

function world(t, config = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-live-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, commuteMinutes: 45, ranks: { gym: "must" }, anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }], ...config }));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(EVENTS.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (now, ...args) => {
    const iso = new Date(2030, 9, 3, ...now).toISOString();
    const r = spawnSync(process.execPath, [RESCHEDULE, ...args, "--date", "2030-10-03"], { encoding: "utf8", env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar,
      ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: iso, ORION_REACH_NOW: iso } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title} ${clock(e.start)}-${clock(e.end)}`);
  return { run, day };
}

test("'put cs lab from now until ten thirty' at 20:55 never cuts the Gym that is under way: refused with the reason when the Gym cannot fit after it", (t) => {
  const w = world(t);
  const before = w.day();
  const r = w.run([20, 55], "add", "CS Lab", "95", "--at", "20:55", "--again");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING WAS CHANGED: must-haves could not fit: Gym/);
  assert.deepEqual(w.day(), before, "the Gym is still 20:15-21:45 (90), the CS Lab was not added");
});

test("...and when the Gym fits later it is moved whole, 90 minutes, never cut", (t) => {
  const w = world(t);
  const r = w.run([20, 55], "add", "CS Lab", "40", "--at", "20:55", "--again");
  assert.equal(r.code, 0, r.out);
  const day = w.day();
  assert.ok(day.includes("CS Lab 20:55-21:35"), day.join("\n"));
  const gym = day.find((l) => l.startsWith("Gym"));
  const [s, e] = gym.split(" ").at(-1).split("-").map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)));
  assert.equal(e - s, 90, gym);
  assert.ok(s >= 21 * 60 + 40, `after the CS Lab: ${gym}`);
  assert.match(r.out, /moved Gym/);
});

test("a Gym given up on at 20:55 comes back whole (90), not as the 50 minutes that were left", (t) => {
  const w = world(t);
  const r = w.run([20, 55], "displace", "Gym", "--why", "gave-up");
  assert.equal(r.code, 0, r.out);
  assert.ok(w.day().includes("Gym 20:55-22:25"), w.day().join("\n"));
  assert.match(r.out, /Gym moved to 8:55-10:25/);
});

test("a Gym given up on that cannot be put back whole is dropped with a message, never trimmed", (t) => {
  const w = world(t, { bedtime: "22:00" });
  const r = w.run([20, 55], "displace", "Gym", "--why", "gave-up");
  assert.ok(!w.day().some((l) => /^Gym/.test(l) && !/^Gym 2[0-9]:[0-9]{2}-2[0-9]:[0-9]{2}$/.test(l)));
  assert.doesNotMatch(w.day().join("\n"), /Gym 20:55-21:45/);
  assert.match(r.out, /no room today|Gym moved/);
});
