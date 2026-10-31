// Gate run-1031224700, wave 5 "writes": the scheduler half. Each case runs orion-reschedule against an evaluation sandbox in a
// temp state dir (eval marker + eval-calendar.json), the same pair the gate and the real planner use (bridge-path.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(import.meta.dirname, "../scripts/orion-reschedule");
const at = (hhmm, day = "2026-11-02") => `${day}T${hhmm}:00Z`;   // Europe/London is GMT in November
const ev = (identifier, title, start, end, orion) => ({ identifier, title, start: at(start), end: at(end), ...(orion ? { orion } : {}) });
const MONDAY = [
  ev("seed-0", "MKTG2201", "13:30", "15:30"),
  ev("seed-1", "Gym", "17:00", "18:30", "gym"),
  ev("seed-2", "Side project", "19:30", "20:30", "side_project"),
];

function sandboxRun(args, { now, events = MONDAY, read = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "w5-write-"));
  writeFileSync(join(dir, "eval-mode"), "test\n");
  writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now, events, reminders: [] }));
  const env = { PATH: process.env.PATH, HOME: dir, TZ: "Europe/London", ORION_CONTROLLED_DIR: dir };
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env, timeout: 60000 });
  const after = JSON.parse(readFileSync(join(dir, "eval-calendar.json"), "utf8"));
  const undo = () => spawnSync(process.execPath, [SCRIPT, "undo"], { encoding: "utf8", env, timeout: 60000 });
  return { out: `${r.stdout}${r.stderr}`, code: r.status, events: after.events, dir, undo, read: () => JSON.parse(readFileSync(join(dir, "eval-calendar.json"), "utf8")).events };
}
const find = (events, title) => events.filter((e) => e.title === title).sort((a, b) => a.start.localeCompare(b.start));

test("rea-class-late-c: an overrun that leaves everything fitting says nothing needed to move, never NOTHING WAS BOOKED", () => {
  const r = sandboxRun(["overrun", "30", "--what", "MKTG2201"], { now: at("15:20") });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /NOTHING WAS BOOKED/);
  assert.match(r.out, /Nothing needed to move/);
  assert.match(r.out, /Gym 17:00 still fits/);
});

test("rea-class-late-c: overrun --shift pushes every one of his movable blocks after the class by exactly N; the class stays", () => {
  const r = sandboxRun(["overrun", "30", "--what", "MKTG2201", "--shift"], { now: at("15:20") });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(find(r.events, "Gym").map((e) => [e.start, e.end]), [[at("17:30"), at("19:00")]]);
  assert.deepEqual(find(r.events, "Side project").map((e) => [e.start, e.end]), [[at("20:00"), at("21:00")]]);
  assert.deepEqual(find(r.events, "MKTG2201").map((e) => [e.start, e.end]), [[at("13:30"), at("15:30")]]);
  assert.match(r.out, /moved Gym: 17:00 → 17:30/);
  const u = r.undo();
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.deepEqual(find(r.read(), "Gym").map((e) => e.start), [at("17:00")]);
});

test("rea-class-late-c: --shift keeps a fixed plan as a wall (what would land on it slides past it)", () => {
  const events = [...MONDAY, ev("seed-3", "Dinner with Sam", "19:00", "20:00")];
  const r = sandboxRun(["overrun", "60", "--what", "MKTG2201", "--shift"], { now: at("15:20"), events });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(find(r.events, "Dinner with Sam").map((e) => e.start), [at("19:00")]);
  const gym = find(r.events, "Gym")[0];
  assert.ok(gym.end <= at("19:00") || gym.start >= at("20:00"), JSON.stringify(gym));
});

test("sch-move-fixed-named: move on a class he names moves that day's occurrence; ORION's blocks reflow; undo restores", () => {
  const r = sandboxRun(["move", "MKTG2201", "--to", "14:00"], { now: at("10:00") });
  assert.equal(r.code, 0, r.out);
  const mk = find(r.events, "MKTG2201");
  assert.deepEqual(mk.map((e) => [e.start, e.end]), [[at("14:00"), at("16:00")]], "one occurrence, same length, at 14:00");
  assert.equal(mk[0].orion, undefined, "still his own event (fixed), never marked as ORION's");
  assert.match(r.out, /MKTG2201 moved: 13:30 → 14:00–16:00/);
  const u = r.undo();
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.deepEqual(find(r.read(), "MKTG2201").map((e) => [e.start, e.end]), [[at("13:30"), at("15:30")]]);
});

test("sch-move-fixed-named: a moved class pushes an ORION block it would now overlap", () => {
  const events = [ev("seed-0", "MKTG2201", "13:30", "15:30"), ev("seed-1", "Study econ", "16:00", "17:00", "study"), ev("seed-2", "Gym", "17:00", "18:30", "gym")];
  const r = sandboxRun(["move", "MKTG2201", "--to", "14:30"], { now: at("10:00"), events });
  assert.equal(r.code, 0, r.out);
  const study = find(r.events, "Study econ")[0];
  assert.ok(study.start >= at("16:30"), JSON.stringify(study));
});

test("sch-move-fixed-named: a class already over is not moved", () => {
  const r = sandboxRun(["move", "MKTG2201", "--to", "16:00"], { now: at("16:10") });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /NOTHING WAS CHANGED/);
  assert.deepEqual(find(r.events, "MKTG2201").map((e) => e.start), [at("13:30")]);
});

test("sandbox bridge: delete with an occurrence start refuses a start that is not that event's (as EventKit does)", () => {
  const dir = mkdtempSync(join(tmpdir(), "w5-sb-"));
  const file = join(dir, "eval-calendar.json");
  writeFileSync(file, JSON.stringify({ now: at("10:00"), events: MONDAY }));
  const bridge = join(import.meta.dirname, "../scripts/lib/eval/sandbox-bridge.mjs");
  const ask = (payload) => JSON.parse(spawnSync(process.execPath, [bridge], { input: JSON.stringify({ id: "t", action: "delete_calendar_event", payload }), encoding: "utf8", env: { ...process.env, ORION_SANDBOX_CALENDAR: file } }).stdout);
  assert.equal(ask({ identifier: "seed-0", start: at("09:00") }).ok, false);
  assert.equal(ask({ identifier: "seed-0", start: at("13:30") }).ok, true);
});
