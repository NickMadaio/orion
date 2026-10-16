import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../scripts/lib/reach/proactive.mjs";

const m = (h, mm = 0) => h * 60 + mm;
const seminar = { title: "CS1802 Seminar", start: m(9), end: m(10, 30), fixed: true, kind: "class" };
// 2026-10-16: tomorrow's first thing comes from TOMORROW's calendar (tomorrowDay), never from today's.
const base = { bed: "23:45", wake: "07:45", day: [seminar], tomorrowDay: [seminar], sent: {}, idleSeconds: 10 };

test("no bedtime messages during a focus session or while he's out (2026-10-07)", () => {
  assert.deepEqual(decide({ ...base, minute: m(23, 50), session: { status: "running" } }), []);
  assert.deepEqual(decide({ ...base, minute: m(23, 50), out: true, where: "at the club" }), []);
});

test("at home and free: wind down, then bedtime, once each", () => {
  const wind = decide({ ...base, minute: m(23, 25) });
  assert.equal(wind[0].key, "bed-wind");
  assert.match(wind[0].text, /Bed at 11:45 PM — CS1802 Seminar at 9:00 AM tomorrow/);
  const now = decide({ ...base, minute: m(23, 50) });
  assert.equal(now[0].key, "bed-now");
  assert.match(now[0].text, /7h 55m before your alarm/);
  assert.deepEqual(decide({ ...base, minute: m(23, 50), sent: { "bed-now": true } }), []);
});

test("still up long after bedtime only nags when he's clearly at the Mac", () => {
  assert.equal(decide({ ...base, minute: m(0, 40) })[0].key, "bed-late");
  assert.deepEqual(decide({ ...base, minute: m(0, 40), idleSeconds: 3600 }), []);
});

test("a session that just ended past bedtime says so, with the sleep left", () => {
  const out = decide({ ...base, minute: m(0, 5), session: { status: "finished", endedMinute: m(0, 1), sessionId: "s1", reason: "completed", servedFocusSeconds: 1800 }, focusToday: "3h 10m across 3 sessions" });
  assert.equal(out[0].key, "session-done-s1");
  assert.match(out[0].text, /Session done\. 3h 10m across 3 sessions today\. It's 12:05 AM — past bedtime; sleep now and you get 7h 40m/);
  assert.notEqual(out[0].urgent, true, "2026-10-16: bedtime lines are never urgent");
});

test("a daytime session end names what's next", () => {
  const out = decide({ ...base, minute: m(15, 2), day: [...base.day, { title: "Gym", start: m(17), end: m(18) }], session: { status: "finished", endedMinute: m(15), sessionId: "s2", reason: "completed", servedFocusSeconds: 1800 } });
  assert.match(out[0].text, /Session done\. Next: Gym at 5:00 PM\./);
});

test("leave soon names where and when", () => {
  const day = [{ title: "CS2100 Program Design — Lab", start: m(11), end: m(12, 30), fixed: true }];
  const out = decide({ ...base, minute: m(10, 5), day, travel: [{ title: "commute to class", start: m(10, 15), end: m(11) }] });
  assert.equal(out[0].text, "Leave in 10 min for CS2100 Program Design at 11:00 AM.");
});

test("free time with an open to-do becomes a question, once per stretch", () => {
  const day = [{ title: "Gym", start: m(16), end: m(17) }];
  const todos = [{ title: "do cert courses", dueDate: "2026-10-21" }, { title: "finish resume", waiting: true }];
  const out = decide({ ...base, minute: m(14), day, todos });
  assert.equal(out[0].text, "You're free until 4:00 PM. Want me to put do cert courses there?");
  assert.deepEqual(decide({ ...base, minute: m(14), day, todos, session: { status: "running" } }), []);
  assert.deepEqual(decide({ ...base, minute: m(14), day: [{ title: "Gym", start: m(14, 30), end: m(15) }], todos }), [], "under an hour free");
});

test("due tomorrow with nothing booked is asked about in the evening", () => {
  const todos = [{ title: "macro quiz prep", dueDate: "2026-10-08" }, { title: "booked one", dueDate: "2026-10-08", booked: true }];
  const out = decide({ ...base, minute: m(18), day: [{ title: "Dinner", start: m(18), end: m(19) }], todos, today: "2026-10-07", tomorrow: "2026-10-08" });
  assert.equal(out.length, 1);
  assert.match(out[0].text, /macro quiz prep is due tomorrow and nothing's booked/);
});
