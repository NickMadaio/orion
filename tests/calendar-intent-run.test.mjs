// The calendar intent layer end to end, script side (2026-10-20 re-run, docs/audits/2026-10-20-live-as-nick.md): his sentence goes through the
// plugin's runScheduleFlow (built dist), which runs the REAL scripts/orion-reschedule on a fake bridge and a temp home, today and tomorrow.
// No model (the form throws if it is asked), no real calendar, no live state.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScheduleFlow } from "../plugin/orion-control/dist/schedule-flow.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESCHEDULE = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const at = (d, h, m = 0) => new Date(2030, 9, d, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// His config: commute 45, buffer 5, the Gym an every-day must of 90 minutes.
const CONFIG = { readyMinutes: 105, bufferMinutes: 5, commuteMinutes: 45, minimums: { nap: 75 }, homeGapMinutes: 150, ranks: { gym: "must" },
  anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] };
// Thursday 10-03 (today): his day is over; Friday 10-04 (tomorrow): CS1802 9:00-10:30 and CS2100 11:00-12:30, nothing else (the re-run's 10-21).
const EVENTS = [
  { title: "CS Lab", start: at(3, 9), end: at(3, 11, 15), orion: "study", orionTags: "study" },
  { title: "ECON1115 Principles of Macroeconomics — Lecture", start: at(3, 13, 30), end: at(3, 15) },
  { title: "Gym", start: at(3, 21, 5), end: at(3, 22, 35), orion: "gym", orionTags: "gym" },
  { title: "CS1802 Seminar — Lecture", start: at(4, 9), end: at(4, 10, 30) },
  { title: "CS2100 Program Design — Lecture", start: at(4, 11), end: at(4, 12, 30) },
];

function world(t, [h, m], events = EVENTS) {
  const home = mkdtempSync(join(tmpdir(), "orion-intent-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled");
  mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify(CONFIG));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const now = new Date(2030, 9, 3, h, m);
  const env = { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: now.toISOString(), ORION_REACH_NOW: now.toISOString() };
  const writes = [];
  const exec = async (args) => {
    if (args[0] !== "show") writes.push(args);
    const r = spawnSync(process.execPath, [RESCHEDULE, ...args], { encoding: "utf8", env });
    return { stdout: `${r.stdout}${r.stderr}`, code: r.status ?? 1 };
  };
  const say = (message, extra = {}) => runScheduleFlow({ message, clock: `Thu ${h}:${m}`, now, exec, ask: async () => { throw new Error("the form must not be asked"); }, ...extra });
  const day = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title.replace(/\s+—.*$/, "")} ${new Date(e.start).getDate()} ${hm(e.start)}-${hm(e.end)}`).sort();
  return { say, writes, day, exec };
}

test("re-run #10: 'can u put a 45 min walk tomorrow at 5' books 5:00-5:45 PM tomorrow, not 1:20 PM", async (t) => {
  const w = world(t, [22, 46]);
  const before = w.day();
  const r = await w.say("can u put a 45 min walk tomorrow at 5");
  assert.equal(r.outcome, "done", JSON.stringify(r));
  assert.deepEqual(w.writes, [["add", "walk", "45", "--at", "17:00", "--date", "tomorrow"]]);
  assert.match(r.reply, /^Done for tomorrow: walk 5:00 PM–5:45 PM/);
  assert.deepEqual(w.day().filter((l) => !before.includes(l)), ["walk 4 17:00-17:45"]);
});

test("re-run #9a: 'reschedule tomorrow after my first class, gym first' puts the Gym after the second class and the trip home, 90 minutes", async (t) => {
  const w = world(t, [22, 45]);
  const r = await w.say("reschedule tomorrow after my first class, gym first");
  assert.equal(r.outcome, "done", JSON.stringify(r));
  assert.deepEqual(w.writes, [["day", "--plan", "Gym, 90, 13:20", "--date", "tomorrow"]]);
  assert.ok(w.day().includes("Gym 4 13:20-14:50"), w.day().join("\n"));
  assert.ok(w.day().includes("CS1802 Seminar 4 09:00-10:30") && w.day().includes("CS2100 Program Design 4 11:00-12:30"), "classes untouched");
  assert.ok(w.day().includes("Gym 3 21:05-22:35"), "today's Gym untouched");
  assert.match(r.reply, /^Done for tomorrow, but not as asked, after your first class: Gym 1:20–2:50 PM/);
  assert.deepEqual(r.replan, { order: ["gym"], anchor: "first class", home: false, explicit: true, day: "tomorrow", date: "2030-10-04" });
});

test("re-run #2a and #9b: resume and dinner are not on tomorrow: said by name, nothing written", async (t) => {
  const w = world(t, [22, 40]);
  const before = w.day();
  const a = await w.say("can u redo tomorrow after my first class, gym first then resume");
  assert.equal(a.outcome, "say");
  assert.match(a.text, /^Resume isn't on your day tomorrow, so I haven't changed anything/);
  const b = await w.say("actually do resume before gym", { replanContext: a.replan });
  assert.match(b.text, /^Resume isn't on your day tomorrow/);
  const c = await w.say("dinner then gym", { replanContext: { order: ["gym"], anchor: "first class", home: false, explicit: true, day: "tomorrow", date: "2030-10-04" } });
  assert.match(c.text, /^Dinner wasn't in the plan I just made and isn't on your day tomorrow, so I haven't changed anything/);
  assert.deepEqual(w.writes, []);
  assert.deepEqual(w.day(), before);
});

test("re-run #7: piano practice is not on tomorrow", async (t) => {
  const w = world(t, [22, 43]);
  const r = await w.say("reschedule tomorrow, put piano practice first");
  assert.match(r.text, /^Piano practice isn't on your day tomorrow/);
  assert.deepEqual(w.writes, []);
});

test("re-run #5 at 22:42: 'put cs lab from now until ten thirty' says 10:30 PM has passed; nothing booked, the Gym untouched", async (t) => {
  const w = world(t, [22, 42]);
  const before = w.day();
  const r = await w.say("put cs lab from now until ten thirty");
  assert.deepEqual(r, { outcome: "say", kind: "cannot", text: "10:30 PM has already passed (it's 10:42 PM), so I haven't booked CS Lab. Tell me a later end time." });
  assert.deepEqual(w.day(), before);
});

test("at 21:55 the same words try CS Lab from now until 22:30 as a second session; the Gym under way is a must, so nothing is cut and it is said", async (t) => {
  const w = world(t, [21, 55]);
  const before = w.day();
  const r = await w.say("put cs lab from now until ten thirty");
  assert.deepEqual(w.writes, [["add", "CS Lab", "35", "--at", "21:55", "--again"]]);
  // The scheduler refuses (the Gym, 90 minutes, would not fit after it) and lists the plan it tried: that list is never said as done.
  assert.deepEqual(r.outcome, "say", JSON.stringify(r));
  assert.equal(r.text, "Not done: Gym didn't fit. I won't cut it short to fit, so nothing was changed. Tell me if CS Lab should end earlier, or whether it should wait.");
  assert.deepEqual(w.day(), before);
});

test("today's clock: 'put a walk at 5' at 22:42 has passed; 'put a walk at 9 tomorrow' is asked about; nothing written", async (t) => {
  const w = world(t, [22, 42]);
  const a = await w.say("put a walk at 5");
  assert.equal(a.text, "5:00 PM has already passed (it's 10:42 PM), so I haven't booked walk. Tell me a later time, or say tomorrow.");
  const b = await w.say("put a walk at 9 tomorrow");
  assert.equal(b.text, "Do you mean 9:00 AM or 9:00 PM tomorrow? I haven't booked walk yet.");
  const c = await w.say("can u put a 45 min walk tomorrow at 11am");
  assert.match(c.text, /^CS2100 Program Design is 11:00 AM–12:30 PM tomorrow, so walk can't go at 11:00 AM/);
  assert.deepEqual(w.writes, []);
});

test("re-run #8: a request taken back at the end is said back and never reaches the form", async (t) => {
  const w = world(t, [22, 44]);
  const r = await w.say("resched my day, gim frist, nvrmind");
  assert.deepEqual(r, { outcome: "say", kind: "plain", text: "Okay, you took that back, so I've left your day as it is." });
  assert.deepEqual(w.writes, []);
});

test("today, earlier in the day: move and extend are one call each, and one undo puts the day back", async (t) => {
  const events = [...EVENTS.filter((e) => e.title !== "Gym"), { title: "Gym", start: at(3, 18), end: at(3, 19, 30), orion: "gym", orionTags: "gym" }];
  const w = world(t, [15, 10], events);
  const before = w.day();
  const r = await w.say("move gym to 7");
  assert.equal(r.outcome, "done", JSON.stringify(r));
  assert.deepEqual(w.writes, [["move", "Gym", "--to", "19:00"]]);
  assert.ok(w.day().includes("Gym 3 19:00-20:30"), w.day().join("\n"));
  await w.exec(["undo"]);
  assert.deepEqual(w.day(), before);
  const e = await w.say("extend gym until 8");
  assert.deepEqual(w.writes.at(-1), ["extend", "Gym", "--until", "20:00"]);
  assert.equal(e.outcome, "done", JSON.stringify(e));
  assert.ok(w.day().includes("Gym 3 18:00-20:00"), w.day().join("\n"));
});

test("follow-up 3: the scheduler writes, then its output is lost (a crash): the reply reads the day back and says what is now there, with undo", async (t) => {
  const w = world(t, [22, 46]);
  const lost = async (args) => { const r = await w.exec(args); return args[0] === "show" ? r : { stdout: "", code: 1 }; };
  const r = await runScheduleFlow({ message: "can u put a 45 min walk tomorrow at 5", clock: "Thu 22:46", now: new Date(2030, 9, 3, 22, 46), exec: lost,
    ask: async () => { throw new Error("the form must not be asked"); } });
  assert.equal(r.outcome, "done");
  assert.equal(r.uncertain, true);
  assert.equal(r.reply, "The scheduler stopped before it reported back. Your calendar for tomorrow now differs from before: walk added at 5:00 PM–5:45 PM. Say \"undo\" to put it back.");
});

test("follow-up 1 and 2, script side: until 2am at 23:00 is after midnight (nothing booked); a walk at 5 at 2 AM is 5 AM", async (t) => {
  const late = world(t, [23, 0]);
  const before = late.day();
  const a = await late.say("put cs lab from now until 2am");
  assert.match(a.text, /^2:00 AM is after midnight, and a block can't run into tomorrow/);
  assert.deepEqual(late.day(), before);
  const early = world(t, [2, 0]);
  const b = await early.say("put a walk at 5");
  assert.deepEqual(early.writes, [["add", "walk", "30", "--at", "05:00"]]);
  assert.equal(b.outcome, "done", JSON.stringify(b));
});

test("live run 3 #8: 'can u block 2 hrs for econ homework tonight at 7' books 7:00-9:00 PM, not 1:20 PM", async (t) => {
  const w = world(t, [15, 10]);
  const before = w.day();
  const r = await w.say("can u block 2 hrs for econ homework tonight at 7");
  assert.equal(r.outcome, "done", JSON.stringify(r));
  assert.deepEqual(w.writes, [["add", "econ homework", "120", "--at", "19:00"]]);
  assert.deepEqual(w.day().filter((l) => !before.includes(l)), ["econ homework 3 19:00-21:00"]);
});

test("live run 3 #2c: 'ok and push everything 30 min' slides every block of his still ahead by 30 minutes; classes stay", async (t) => {
  const events = [...EVENTS.filter((e) => e.title !== "Gym"), { title: "Gym", start: at(3, 18), end: at(3, 19, 30), orion: "gym", orionTags: "gym" }];
  const w = world(t, [15, 10], events);
  const r = await w.say("ok and push everything 30 min");
  assert.deepEqual(w.writes, [["day", "--plan", "Gym, 90, 18:30"]]);
  assert.equal(r.outcome, "done", JSON.stringify(r));
  assert.ok(w.day().includes("Gym 3 18:30-20:00"), w.day().join("\n"));
  assert.ok(w.day().includes("ECON1115 Principles of Macroeconomics 3 13:30-15:00"));
});

test("live run 4 #7/#9: '45 min walk today at 5pm' and 'need to do laundry, 1 hr, today at 6pm' are booked at those times (no false block)", async (t) => {
  const w = world(t, [3, 50]);
  const before = w.day();
  const a = await w.say("45 min walk today at 5pm");
  assert.equal(a.outcome, "done", JSON.stringify(a));
  const b = await w.say("need to do laundry, 1 hr, today at 6pm");
  assert.equal(b.outcome, "done", JSON.stringify(b));
  assert.deepEqual(w.writes, [["add", "walk", "45", "--at", "17:00"], ["add", "laundry", "60", "--at", "18:00"]]);
  assert.deepEqual(w.day().filter((l) => !before.includes(l)).sort(), ["laundry 3 18:00-19:00", "walk 3 17:00-17:45"]);
});

test("live run 4 #2b: at 03:47 'move gym from 7 to 8' moves the 19:00 Gym to 20:00", async (t) => {
  const events = [...EVENTS.filter((e) => e.title !== "Gym"), { title: "Gym", start: at(3, 19), end: at(3, 20, 30), orion: "gym", orionTags: "gym" }];
  const w = world(t, [3, 47], events);
  const r = await w.say("move gym from 7 to 8");
  assert.equal(r.outcome, "done", JSON.stringify(r));
  assert.deepEqual(w.writes, [["move", "Gym", "--to", "20:00"]]);
  assert.ok(w.day().includes("Gym 3 20:00-21:30"), w.day().join("\n"));
});

test("edit follow-up: 'lunch 45 min today at 6pm' then 'make it an hour' resizes that lunch on the real scheduler (no session)", async (t) => {
  const { blockTarget, parseEdit } = await import("../plugin/orion-control/dist/edit-followup.js");
  const w = world(t, [15, 10]);
  const a = await w.say("lunch 45 min today at 6pm");
  assert.equal(a.outcome, "done", JSON.stringify(a));
  const target = blockTarget(a.calls, a.outputs, Date.now());
  assert.deepEqual({ title: target.title, minutes: target.minutes }, { title: "lunch", minutes: 45 });
  const b = await w.say("make it an hour", { edit: { target, req: parseEdit("make it an hour") } });
  assert.equal(b.outcome, "done", JSON.stringify(b));
  assert.deepEqual(w.writes.at(-1), ["resize", "lunch", "60"]);
  assert.ok(w.day().includes("lunch 3 18:00-19:00"), w.day().join("\n"));
});

test("live run 5 #3b/#8b on the real scheduler: the block just made tomorrow is the one 'move gym from 7 to 8' and 'push it 15 min' change", async (t) => {
  const { blockTarget } = await import("../plugin/orion-control/dist/edit-followup.js");
  const w = world(t, [22, 45]);
  const target = (r) => { const b = blockTarget(r.calls, r.outputs, Date.now()); return { title: b.title, start: b.start, dateArgs: b.dateArgs }; };
  const a = await w.say("add gym tomorrow at 7pm");
  assert.equal(a.outcome, "done", JSON.stringify(a));
  const b = await w.say("move gym from 7 to 8", { lastTarget: target(a) });
  assert.equal(b.outcome, "done", JSON.stringify(b));
  assert.deepEqual(w.writes.at(-1), ["move", "Gym", "--to", "20:00", "--date", "tomorrow"]);
  assert.ok(w.day().includes("Gym 4 20:00-21:30"), w.day().join("\n"));
  const c = await w.say("add reading tomorrow at 8pm");
  const t2 = target(c);   // where the scheduler really put it (the Gym now sits at 20:00)
  const d = await w.say("push it 15 min", { lastTarget: t2 });
  assert.equal(d.outcome, "done", JSON.stringify(d));
  const [h, m] = t2.start.split(":").map(Number); const to = h * 60 + m + 15;
  assert.deepEqual(w.writes.at(-1), ["move", "reading", "--to", `${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}`, "--date", "tomorrow"]);
});
