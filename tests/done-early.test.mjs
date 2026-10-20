// "Done early" (2026-10-20): one button tells ORION he finished what is under way. Each kind of current block, end to end
// against the fake bridge (calendar with [orion:kind][tag] markers, Reminders), plus undo as one group.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const CHECKIN = join(ROOT, "scripts/orion-checkin");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-05";
const at = (h, m = 0) => new Date(2030, 9, 5, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const minute = (s) => { const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };
const hm = (h, m = 0) => h * 60 + m;

// A stand-in for orion-session: `status --json` answers with $FAKE_SESSION_TASK, `finish` is logged to $FAKE_SESSION_LOG.
const SESSION_STUB = `import { appendFileSync } from "node:fs";
const [cmd] = process.argv.slice(2);
if (cmd === "status") console.log(JSON.stringify(process.env.FAKE_SESSION_TASK ? { ok: true, status: "running", task: process.env.FAKE_SESSION_TASK } : { ok: true, status: "none" }));
else { appendFileSync(process.env.FAKE_SESSION_LOG, process.argv.slice(2).join(" ") + "\\n"); console.log("Session finished"); }
`;

function world(t, { events, reminders = [], sessionTask = "", config = {} }) {
  const home = mkdtempSync(join(tmpdir(), "orion-done-early-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled");
  mkdirSync(controlled, { recursive: true });
  writeFileSync(join(controlled, "life-config.json"), JSON.stringify({ commuteMinutes: 45, bufferMinutes: 5, usualWake: "08:00", minimums: {}, freeMinutesKept: 60, ...config }));
  const calendar = join(home, "calendar.json");
  const remindersFile = join(home, "reminders.json");
  const sessionBin = join(home, "session-stub.mjs");
  const sessionLog = join(home, "session.log");
  const checkinFile = join(home, "checkins.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  writeFileSync(remindersFile, JSON.stringify(reminders));
  writeFileSync(sessionBin, SESSION_STUB);
  const env = { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, FAKE_REMINDERS: remindersFile,
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_LIFE_CONFIG: join(controlled, "life-config.json"),
    ORION_SESSION_BIN: sessionBin, FAKE_SESSION_LOG: sessionLog, FAKE_SESSION_TASK: sessionTask, ORION_CHECKIN_FILE: checkinFile };
  const exec = (script, ...args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  const read = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
  const lines = (file) => { try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return {
    run: (...args) => exec(SCRIPT, ...args, "--date", DATE),
    review: () => exec(join(ROOT, "scripts/orion-day-review"), "--json", "--date", DATE),
    checkin: (...args) => exec(CHECKIN, ...args),
    events: () => read(calendar, []),
    day: () => read(calendar, []).map((e) => ({ title: e.title, start: minute(e.start), end: minute(e.end) })).sort((a, b) => a.start - b.start),
    reminders: () => read(remindersFile, []),
    logged: () => lines(join(controlled, "logged.jsonl")),
    slips: () => lines(join(controlled, "slips.jsonl")),
    focusFinished: () => (existsSync(sessionLog) ? readFileSync(sessionLog, "utf8").split("\n").filter(Boolean) : []),
  };
}

const noOverlaps = (d) => d.every((x, i) => d.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end)));
const firstLine = (out) => out.split("\n")[0];

const classDay = [
  { title: "CS1802 Lecture", start: at(9), end: at(10, 30) },
  { title: "Study session", start: at(14), end: at(15, 30), orion: "study" },
  { title: "Side project", start: at(15, 40), end: at(17, 10), orion: "side_project" },
  { title: "Dinner", start: at(19), end: at(19, 45), orion: "meal" },
];
const resumeDay = [
  { title: "Finish resume", start: at(14), end: at(16), orion: "study", orionTags: "study,todo-rem0" },
  { title: "CS Lab prep", start: at(16, 10), end: at(17), orion: "study" },
  { title: "Dinner", start: at(19), end: at(19, 45), orion: "meal" },
];
const resumeTodo = { identifier: "rem-0", title: "Finish resume (for the Acme internship)", list: "Orion" };

test("class: clipped to now, the trip home reserved, one line says so", (t) => {
  const w = world(t, { events: classDay });
  const r = w.run("early", "--now", "10:00");
  assert.equal(r.code, 0, r.out);
  const d = w.day();
  assert.equal(d.find((e) => e.title === "CS1802 Lecture").end, hm(10));
  assert.ok(d.find((e) => e.title === "Study session").start >= hm(10, 45), JSON.stringify(d));
  assert.match(firstLine(r.out), /^Out of CS1802 Lecture at 10:00 AM — 45 min reserved to get home\./);
  assert.ok(noOverlaps(d));
  assert.deepEqual(w.logged(), [], "a class is attendance, not a logged block");
});

test("class: staying on campus when another class is ahead; future classes are never shortened", (t) => {
  const w = world(t, { events: [{ title: "CS1802 Lecture", start: at(9), end: at(10, 30) }, { title: "DS1500 Lecture", start: at(12), end: at(13, 30) }, ...classDay.slice(1)] });
  const r = w.run("early", "--now", "10:00");
  assert.equal(r.code, 0, r.out);
  const d = w.day();
  assert.deepEqual(d.find((e) => e.title === "DS1500 Lecture"), { title: "DS1500 Lecture", start: hm(12), end: hm(13, 30) });
  assert.match(firstLine(r.out), /staying on campus/);
});

test("class: a next class 2.5 h or more away still gets the trip home reserved", (t) => {
  const w = world(t, { events: [{ title: "CS1802 Lecture", start: at(9), end: at(10, 30) }, { title: "DS1500 Lecture", start: at(15), end: at(16, 30) }, { title: "Study session", start: at(11), end: at(12), orion: "study" }] });
  const r = w.run("early", "--now", "10:00");
  assert.equal(r.code, 0, r.out);
  assert.match(firstLine(r.out), /45 min reserved to get home/);
  assert.ok(w.day().find((e) => e.title === "Study session").start >= hm(10, 45) );
});

test("to-do-linked task: ends now, ticks the to-do off by its link, closes the check-in, ends the focus session, is logged as done", (t) => {
  const w = world(t, { events: resumeDay, reminders: [resumeTodo], sessionTask: "finish resume" });
  assert.equal(w.checkin("add", "10", "Finish resume").code, 0);
  const r = w.run("early", "--now", "14:40");
  assert.equal(r.code, 0, r.out);
  const d = w.day();
  assert.equal(d.find((e) => e.title === "Finish resume").end, hm(14, 40));
  assert.ok(noOverlaps(d));
  // The to-do carries a different title than the block: only the block's link ties them.
  assert.equal(w.reminders()[0].completed, true, r.out);
  assert.match(firstLine(r.out), /^Nice — Finish resume is done and checked off\./);
  assert.match(firstLine(r.out), /Focus session wrapped up\./);
  assert.match(firstLine(r.out), /Next: CS Lab prep at \d+:\d\d (AM|PM)\.$/);
  assert.deepEqual(w.focusFinished(), ["finish"]);
  assert.match(w.checkin("list").out, /No open check-ins/);
  // Done, not a slip: the ledger the nightly review reads has it, the slips file does not.
  const [row] = w.logged();
  assert.deepEqual([row.title, row.start, row.end, row.early], ["Finish resume", hm(14), hm(14, 40), true]);
  assert.deepEqual(w.slips(), []);
});

test("to-do matched by an unambiguous title when the block has no link", (t) => {
  const w = world(t, { events: [{ title: "Email Prof Lee", start: at(14), end: at(15), orion: "other" }, resumeDay[2]],
    reminders: [{ identifier: "rem-0", title: "Email Prof Lee", list: "Orion" }, { identifier: "rem-1", title: "Email the landlord", list: "Orion" }] });
  const r = w.run("early", "--now", "14:20");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(w.reminders().map((x) => !!x.completed), [true, false]);
  assert.match(firstLine(r.out), /Email Prof Lee is done and checked off/);
});

test("an ambiguous title ticks nothing off, ends the block and says which to-dos it could be", (t) => {
  const w = world(t, { events: [{ title: "Study macro", start: at(14), end: at(15), orion: "study" }],
    reminders: [{ identifier: "rem-0", title: "Study macro chapter 4", list: "Orion" }, { identifier: "rem-1", title: "Study macro chapter 5", list: "Orion" }] });
  const r = w.run("early", "--now", "14:20");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(w.reminders().map((x) => !!x.completed), [false, false]);
  assert.equal(w.day()[0].end, hm(14, 20));
  assert.match(firstLine(r.out), /didn't check anything off.*Study macro chapter 4.*Study macro chapter 5/);
});

test("unlinked task with no to-do: ends now and is recorded as done; the focus session on another task is left alone", (t) => {
  const w = world(t, { events: [{ title: "Tidy desk", start: at(14), end: at(15), orion: "other" }], reminders: [resumeTodo], sessionTask: "write the essay" });
  const r = w.run("early", "--now", "14:20");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.day()[0].end, hm(14, 20));
  assert.equal(w.reminders()[0].completed, undefined);
  assert.deepEqual(w.focusFinished(), []);
  assert.equal(firstLine(r.out).startsWith("Nice — Tidy desk is done."), true, r.out);
  assert.equal(w.logged().length, 1);
  assert.deepEqual(w.slips(), []);
});

test("gym: ends now and is marked done; no to-do is touched", (t) => {
  const w = world(t, { events: [{ title: "Gym", start: at(18), end: at(19), orion: "gym" }, resumeDay[2]], reminders: [{ identifier: "rem-0", title: "Gym", list: "Orion" }] });
  const r = w.run("early", "--now", "18:30");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.day().find((e) => e.title === "Gym").end, hm(18, 30));
  assert.equal(w.reminders()[0].completed, undefined);
  assert.match(firstLine(r.out), /^Nice — Gym is done\. /);
  assert.equal(w.logged()[0].early, true);
});

test("nothing current: says so, offers the next item, exits 0, writes nothing", (t) => {
  const w = world(t, { events: resumeDay, reminders: [resumeTodo] });
  const before = w.day();
  const r = w.run("early", "--now", "12:00");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Nothing is on right now\. Next up: Finish resume at 2:00 PM/);
  assert.deepEqual(w.day(), before);
  assert.deepEqual(w.logged(), []);
  const late = w.run("early", "--now", "23:00");
  assert.equal(late.code, 0, late.out);
  assert.match(late.out, /nothing else is planned today/);
});

test("--check reports the kind of what is current", (t) => {
  const w = world(t, { events: resumeDay });
  assert.deepEqual(JSON.parse(w.run("early", "--check", "--now", "14:40").out), { kind: "block", id: JSON.parse(w.run("early", "--check", "--now", "14:40").out).id, title: "Finish resume", blockKind: "task" });
  assert.deepEqual(JSON.parse(w.run("early", "--check", "--now", "12:00").out), { kind: "none" });
});

test("--dry-run changes nothing: not the calendar, the to-do, the ledger or the session", (t) => {
  const w = world(t, { events: resumeDay, reminders: [resumeTodo], sessionTask: "finish resume" });
  const before = w.day();
  const r = w.run("early", "--now", "14:40", "--dry-run");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Would change/);
  assert.deepEqual(w.day(), before);
  assert.equal(w.reminders()[0].completed, undefined);
  assert.deepEqual(w.logged(), []);
  assert.deepEqual(w.focusFinished(), []);
});

test("one undo reverses the calendar change, reopens the to-do and takes the done-record back", (t) => {
  const w = world(t, { events: resumeDay, reminders: [resumeTodo] });
  const before = w.day();
  assert.equal(w.run("early", "--now", "14:40").code, 0);
  assert.notDeepEqual(w.day(), before);
  assert.equal(w.reminders()[0].completed, true);
  const u = w.run("undo");
  assert.equal(u.code, 0, u.out);
  assert.match(u.out, /reopened the to-do/);
  assert.deepEqual(w.day(), before);
  assert.equal(w.reminders()[0].completed, false);
  assert.deepEqual(w.logged(), []);
  assert.match(w.run("undo").out, /Nothing to undo/, "the whole press was one undo group");
});

test("the nightly review counts it as finished early: done, not slipped", (t) => {
  const w = world(t, { events: resumeDay, reminders: [resumeTodo] });
  assert.equal(w.run("early", "--now", "14:40").code, 0);
  const review = JSON.parse(w.review().out);
  assert.deepEqual(review.done.map((d) => [d.title, d.how, d.early]), [["Finish resume", "logged", true]]);
  assert.ok(!review.slipped.some((s) => /finish resume/i.test(s.title)), JSON.stringify(review.slipped));
  assert.match(review.text, /finish resume 2-2:40 \(done early\)/);
});

test("day --todos links each block to its to-do (a todo-<key> tag), and that link is what Done early follows", (t) => {
  const w = world(t, { events: [], reminders: [{ identifier: "rem-0", title: "Finish resume", list: "Orion" }] });
  const planned = w.run("day", "--todos", "--fill");
  assert.equal(planned.code, 0, planned.out);
  const event = w.events().find((e) => e.title === "Finish resume");
  assert.ok(event, planned.out);
  assert.match(event.orionTags, /(^|,)todo-rem0(,|$)/);
  const start = minute(event.start);
  const r = w.run("early", "--now", `${String(Math.floor((start + 10) / 60)).padStart(2, "0")}:${String((start + 10) % 60).padStart(2, "0")}`);
  assert.equal(r.code, 0, r.out);
  assert.equal(w.reminders()[0].completed, true, r.out);
});
