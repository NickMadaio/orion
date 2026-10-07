import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../scripts/lib/reach/proactive.mjs";

const m = (h, mm = 0) => h * 60 + mm;
const base = { bed: "23:45", wake: "07:45", day: [{ title: "CS1802 Seminar", start: m(9), end: m(10, 30), fixed: true }], sent: {}, idleSeconds: 10 };

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
  const out = decide({ ...base, minute: m(0, 5), session: { status: "finished", endedMinute: m(0, 1), sessionId: "s1" }, focusToday: "3h 10m across 3 sessions" });
  assert.equal(out[0].key, "session-done-s1");
  assert.match(out[0].text, /Session done\. 3h 10m across 3 sessions today\. It's 12:05 AM — past bedtime; sleep now and you get 7h 40m/);
  assert.equal(out[0].urgent, true);
});

test("a daytime session end names what's next", () => {
  const out = decide({ ...base, minute: m(15, 2), day: [...base.day, { title: "Gym", start: m(17), end: m(18) }], session: { status: "finished", endedMinute: m(15), sessionId: "s2" } });
  assert.match(out[0].text, /Session done\. Next: Gym at 5:00 PM\./);
});
