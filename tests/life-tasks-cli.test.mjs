// orion-tasks end to end on a fake calendar and fake Reminders (2026-10-06):
// due dates, spreads and priorities planned into sessions, and re-planned when
// he (or ORION) changes them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TASKS = join(ROOT, "scripts/orion-tasks");
const RESCHEDULE = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const TODAY = "2030-10-08";   // a Tuesday
const local = (s) => { const d = new Date(s); return { date: d.toLocaleDateString("en-CA"), minutes: (new Date(d) - new Date(d).setHours(0, 0, 0, 0)) / 60000, weekday: d.getDay() }; };

function world(t, { reminders = [], events = [], at = [9, 0] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-tasks-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "life.json"), "{}");
  writeFileSync(join(home, "calendar.json"), JSON.stringify(events));
  writeFileSync(join(home, "reminders.json"), JSON.stringify(reminders));
  const env = { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "calendar.json"),
    FAKE_REMINDERS: join(home, "reminders.json"), ORION_TASK_LEDGER: join(home, "task-sessions.json"), ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"),
    ORION_RESCHEDULE_NOW: new Date(2030, 9, 8, ...at).toISOString() };
  const run = (script, ...a) => { const r = spawnSync(process.execPath, [script, ...a], { encoding: "utf8", env }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  const sessions = (title) => JSON.parse(readFileSync(join(home, "calendar.json"), "utf8"))
    .filter((e) => e.title === title).map((e) => ({ ...local(e.start), length: (new Date(e.end) - new Date(e.start)) / 60000 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const reminder = (title) => JSON.parse(readFileSync(join(home, "reminders.json"), "utf8")).find((r) => r.title === title);
  const complete = (title) => writeFileSync(join(home, "reminders.json"), JSON.stringify(JSON.parse(readFileSync(join(home, "reminders.json"), "utf8"))
    .map((r) => (r.title === title ? { ...r, completed: true } : r))));
  return { tasks: (...a) => run(TASKS, ...a), reschedule: (...a) => run(RESCHEDULE, ...a), sessions, reminder, complete };
}

test("a to-do due Friday at 2 hours a day gets a 2-hour session every day before Friday", (t) => {
  const w = world(t);
  const r = w.tasks("add", "Marketing project", "--due", "2030-10-11", "--spread", "2 hours a day until it's due", "--priority", "high");
  assert.equal(r.code, 0, r.out);
  const s = w.sessions("Marketing project");
  assert.deepEqual(s.map((x) => x.date), ["2030-10-08", "2030-10-09", "2030-10-10"], r.out);
  assert.ok(s.every((x) => x.length === 120));
  const rem = w.reminder("Marketing project");
  assert.equal(rem.notes, "2 hours a day until it's due"); assert.equal(rem.priority, "high"); assert.ok(rem.due);
});

test("two 2-hour blocks on Tuesday and Thursday land on those days", (t) => {
  const w = world(t);
  assert.equal(w.tasks("add", "Macro problem set", "--due", "2030-10-14", "--spread", "two 2-hour blocks, tuesday and thursday").code, 0);
  const s = w.sessions("Macro problem set");
  assert.deepEqual(s.map((x) => [x.weekday, x.length]), [[2, 120], [4, 120]]);
});

test("changing the spread re-plans: two 2-hour blocks become four 1-hour blocks", (t) => {
  const w = world(t);
  w.tasks("add", "Macro problem set", "--due", "2030-10-14", "--spread", "two 2-hour blocks, tuesday and thursday");
  const r = w.tasks("set", "macro problem set", "--spread", "four 1-hour blocks this week");
  assert.equal(r.code, 0, r.out);
  const s = w.sessions("Macro problem set");
  assert.equal(s.length, 4, JSON.stringify(s));
  assert.ok(s.every((x) => x.length === 60 && x.date <= "2030-10-13"), JSON.stringify(s));
  assert.equal(w.reminder("Macro problem set").notes, "four 1-hour blocks this week");
});

test("moving the due date earlier removes the sessions after it", (t) => {
  const w = world(t);
  w.tasks("add", "Essay", "--due", "2030-10-12", "--spread", "1 hour a day");
  assert.equal(w.sessions("Essay").length, 4);
  const r = w.tasks("set", "Essay", "--due", "2030-10-10");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(w.sessions("Essay").map((x) => x.date), ["2030-10-08", "2030-10-09"]);
});

test("today's session that already happened is not booked again", (t) => {
  const iso = (h) => new Date(2030, 9, 8, h).toISOString();
  const w = world(t, { at: [15, 0],
    reminders: [{ identifier: "r1", title: "Essay", list: "Orion", due: new Date(2030, 9, 11, 23, 59).toISOString(), notes: "1 hour a day" }],
    events: [{ identifier: "e1", title: "Essay", start: iso(10), end: iso(11), orion: "other" }] });
  const r = w.tasks("plan");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.sessions("Essay").filter((x) => x.date === TODAY).length, 1, r.out);
});

test("planning the day from the to-do list leaves spread to-dos to orion-tasks", (t) => {
  const w = world(t, { reminders: [{ identifier: "r1", title: "Essay", list: "Orion", notes: "1 hour a day" }, { identifier: "r2", title: "call the bank", list: "Orion" }] });
  const r = w.reschedule("day", "--todos", "--date", "2030-10-09");
  assert.match(r.out, /Essay \(spread across days by orion-tasks\)/);
  assert.equal(w.sessions("Essay").length, 0);
});

test("an unknown to-do is refused with the list", (t) => {
  const w = world(t, { reminders: [{ identifier: "r1", title: "Essay", list: "Orion" }] });
  const r = w.tasks("set", "Nope", "--priority", "low");
  assert.equal(r.code, 1); assert.match(r.out, /To-dos: Essay/);
});

test("cert courses: the parent is scheduled 2.5 hours a day, the courses are subtasks with progress", (t) => {
  const w = world(t);
  assert.equal(w.tasks("add", "Complete cert courses", "--due", "2030-10-15", "--spread", "2.5 hours a day until it's due", "--priority", "high").code, 0);
  for (const c of ["Google Data Analytics", "AWS Cloud Practitioner", "CompTIA ITF+"]) assert.equal(w.tasks("sub", "Complete cert courses", "add", c).code, 0);
  const r = w.tasks("sub", "Complete cert courses", "set", "aws cloud", "40");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AWS Cloud Practitioner 40%/);
  const notes = w.reminder("Complete cert courses").notes;
  assert.match(notes, /^2\.5 hours a day until it's due\n- \[ \] Google Data Analytics · 0%\n- \[ \] AWS Cloud Practitioner · 40%/);
  const s = w.sessions("Complete cert courses");
  assert.ok(s.length >= 6 && s.every((x) => x.length === 150), JSON.stringify(s));
  assert.equal(w.sessions("AWS Cloud Practitioner").length, 0, "subtasks are never scheduled");
  // changing the spread keeps the subtasks
  w.tasks("set", "Complete cert courses", "--spread", "3 hours a day");
  assert.match(w.reminder("Complete cert courses").notes, /^3 hours a day\n- \[ \] Google Data Analytics/);
});

test("a to-do that waits for another is not scheduled, and planning the day leaves it out", (t) => {
  const w = world(t, { reminders: [
    { identifier: "c", title: "do cert courses", list: "Orion", due: new Date(2030, 9, 20, 23, 59).toISOString(), notes: "2.5 hours a day" },
    { identifier: "r", title: "finish resume", list: "Orion", notes: 'only schedule this once i have fully completed the "do cert courses" task.' },
    { identifier: "i", title: "send internship applications", list: "Orion", notes: 'Dont schedule unless "finish resume" is completed' },
  ] });
  const r = w.tasks("plan");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /finish resume: waiting until "do cert courses" is done/);
  assert.ok(w.sessions("do cert courses").length > 0);
  assert.equal(w.sessions("finish resume").length, 0);
  const d = w.reschedule("day", "--todos", "--date", "2030-10-09");
  assert.match(d.out, /send internship applications \(waits until "finish resume" is done\)/);
  assert.equal(w.sessions("send internship applications").length, 0);
});

test("delete everything after the resume, or just the two named ones", (t) => {
  const iso = (h, m = 0) => new Date(2030, 9, 8, h, m).toISOString();
  const evening = [["finish resume", 17, 18], ["send internship applications", 18, 19], ["research backpacking stuff", 19, 20], ["Dinner", 20, 21]]
    .map(([title, a, b], i) => ({ identifier: `e${i}`, title, start: iso(a), end: iso(b), orion: "other" }));
  const w = world(t, { events: evening, at: [16, 0] });
  const r = w.reschedule("drop", "--after", "finish resume");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.sessions("finish resume").length, 1);
  for (const gone of ["send internship applications", "research backpacking stuff", "Dinner"]) assert.equal(w.sessions(gone).length, 0, gone);
  w.reschedule("undo");
  const two = w.reschedule("drop", "finish resume", "send internship applications");
  assert.equal(two.code, 0, two.out);
  assert.equal(w.sessions("finish resume").length, 0);
  assert.equal(w.sessions("research backpacking stuff").length, 1);
});

// 2026-10-13: "remind me at 11" became `orion-tasks add … --at 11:00`; --at was ignored silently, the to-do
// was booked into his evening and ORION said "reminder at 11". Unknown options now fail loudly.
test("unknown options are refused, with nothing changed", (t) => {
  const w = world(t, { reminders: [] });
  const r = w.tasks("add", "Text the group chat", "--due", "tomorrow", "--at", "11:00");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--at/);
  assert.match(r.out, /NOTHING WAS CHANGED|not an option/i);
});

// 2026-10-13: he finished his cert courses and they stayed booked every evening. A to-do that is
// ticked off loses the sessions ORION booked for it (from now on; what already happened stays).
test("a finished to-do's booked sessions come off its days", (t) => {
  const w = world(t, { at: [15, 0] });
  assert.equal(w.tasks("add", "Complete cert courses", "--due", "2030-10-12", "--spread", "2 hours a day").code, 0);
  assert.ok(w.sessions("Complete cert courses").length >= 3);
  w.complete("Complete cert courses");
  const r = w.tasks("sweep");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Complete cert courses is done/);
  assert.equal(w.sessions("Complete cert courses").length, 0, r.out);
  // Nothing left to sweep: quiet, and no calendar read.
  assert.equal(w.tasks("sweep").out.trim(), "");
});

test("an open to-do's sessions are left alone by the sweep", (t) => {
  const w = world(t, { at: [15, 0] });
  w.tasks("add", "Essay", "--due", "2030-10-12", "--spread", "1 hour a day");
  const before = w.sessions("Essay").length;
  w.tasks("sweep");
  assert.equal(w.sessions("Essay").length, before);
});

// Live sweep 2026-10-15 (q042, q045): the prompts advertised `orion-tasks done`, which did not exist.
// "mark the oats one done" ran nothing and the reply said it was done; "check off the zebra painting
// thing" ran `set "Zebra painting" --no-due` instead. `done` ticks off ONE to-do or changes nothing.
test("done ticks off the one to-do it names, and only that one", (t) => {
  const w = world(t, { reminders: [{ identifier: "r1", title: "buy more oats", list: "Orion" }, { identifier: "r2", title: "Review spending", list: "Orion" }] });
  const r = w.tasks("done", "the oats one");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Changed "buy more oats": done/m);
  assert.equal(w.reminder("buy more oats").completed, true);
  assert.notEqual(w.reminder("Review spending").completed, true);
});

test("done with no matching to-do changes nothing and says which to-dos there are", (t) => {
  const w = world(t, { reminders: [{ identifier: "r1", title: "practice leetcode", list: "Orion" }] });
  const r = w.tasks("done", "zebra painting thing");
  assert.equal(r.code, 1);
  assert.match(r.out, /NOTHING WAS CHANGED/);
  assert.match(r.out, /To-dos: practice leetcode/);
  assert.notEqual(w.reminder("practice leetcode").completed, true);
});

test("done that matches two to-dos asks which, and ticks neither", (t) => {
  const w = world(t, { reminders: [{ identifier: "r1", title: "CS Lab", list: "Orion" }, { identifier: "r2", title: "CS Lab report", list: "Orion" }, { identifier: "r3", title: "DS Lab", list: "Orion" }] });
  const r = w.tasks("done", "lab");
  assert.equal(r.code, 1);
  assert.match(r.out, /NOTHING WAS CHANGED.*more than one/);
  assert.ok(["CS Lab", "CS Lab report", "DS Lab"].every((x) => w.reminder(x).completed !== true));
  // An exact title is never ambiguous.
  const exact = w.tasks("done", "cs lab");
  assert.equal(exact.code, 0, exact.out);
  assert.equal(w.reminder("CS Lab").completed, true);
  assert.notEqual(w.reminder("CS Lab report").completed, true);
});

// Review, 2026-10-16 (MEDIUM 12): `done` dropped words under 3 letters, so "ds lab" ticked off "CS lab report".
test("done keeps two-letter words: 'ds lab' never ticks off the CS lab to-do", (t) => {
  const w = world(t, { reminders: [{ identifier: "r1", title: "CS lab report", list: "Orion" }] });
  const r = w.tasks("done", "ds lab");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING WAS CHANGED/);
  assert.notEqual(w.reminder("CS lab report").completed, true);
});

test("done 'the lab one' with a CS and a DS lab to-do asks which and ticks neither", (t) => {
  const w = world(t, { reminders: [{ identifier: "r1", title: "CS lab report", list: "Orion" }, { identifier: "r2", title: "DS lab report", list: "Orion" }] });
  const r = w.tasks("done", "the lab one");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /more than one/);
  assert.ok(["CS lab report", "DS lab report"].every((x) => w.reminder(x).completed !== true));
  const ds = w.tasks("done", "ds lab");
  assert.equal(ds.code, 0, ds.out);
  assert.equal(w.reminder("DS lab report").completed, true);
  assert.notEqual(w.reminder("CS lab report").completed, true);
});
