// 2026-10-16 proactive-messaging audit, MEDIUM findings 7-12, one test per real incident.
import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../scripts/lib/reach/proactive.mjs";

const m = (h, mm = 0) => h * 60 + mm;
const cs1800 = { id: "a", title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
const econ = { id: "b", title: "ECON1115 Macroeconomics", kind: "class", start: m(13, 30), end: m(15), fixed: true, source: "calendar" };
const base = { bed: "00:00", wake: "07:45", day: [], sent: {}, idleSeconds: 5 };

// ---- 7: bedtime names the wrong tomorrow, and offers to move a class ----------
test("incident 10-12 23:34: Monday night names TUESDAY's first thing, not Monday's CS2100", () => {
  const cs2100 = { title: "CS2100 Program Design", kind: "class", start: m(9), end: m(10, 30), fixed: true };
  const out = decide({ ...base, minute: m(23, 34), day: [cs2100], tomorrowDay: [econ] });
  assert.match(out[0].text, /ECON1115 Macroeconomics at 1:30 PM tomorrow/);
  assert.doesNotMatch(out[0].text, /CS2100/);
});

test("tomorrow unknown: no claim about tomorrow at all", () => {
  const out = decide({ ...base, minute: m(23, 34), day: [cs1800] });
  assert.equal(out[0].key, "bed-wind");
  assert.doesNotMatch(out[0].text, /tomorrow/);
});

test("after midnight 'tomorrow' is today, and only what is still ahead", () => {
  const out = decide({ ...base, minute: m(1, 25), day: [cs1800], tomorrowDay: [cs1800], tomorrowIsToday: true, idleSeconds: 5 });
  assert.equal(out[0].key, "bed-late");
  assert.match(out[0].text, /Your first class is CS1800 Discrete Structures at 9:00 AM/);
  assert.doesNotMatch(out[0].text, /move/i, "a fixed class is never offered a move");
});

test("bed-late offers to move only a MOVABLE first block", () => {
  const study = { title: "finish resume", kind: "study", start: m(10), end: m(11), fixed: false };
  const out = decide({ ...base, minute: m(1, 25), tomorrowDay: [study], tomorrowIsToday: true });
  assert.match(out[0].text, /Want me to move finish resume later\?/);
});

// ---- 8: one bedtime message per window ----------------------------------------
test("incident 10-15 01:25: session-done and bed-late 1 s apart become ONE message", () => {
  const ctx = { ...base, minute: m(1, 25), tomorrowDay: [cs1800], tomorrowIsToday: true,
    session: { status: "finished", endedMinute: m(1, 24), sessionId: "s-x", reason: "early", servedFocusSeconds: 37 * 60 } };
  const out = decide(ctx);
  assert.equal(out.length, 1, JSON.stringify(out.map((o) => o.key)));
  assert.match(out[0].text, /^Session done\./);
  assert.match(out[0].text, /past bedtime/);
  assert.deepEqual(out[0].also, ["bed-wind", "bed-now", "bed-late"], "the bed keys are said with it");
});

test("no bedtime nag is ever urgent", () => {
  for (const minute of [m(23, 25), m(0, 5), m(1, 25)]) for (const o of decide({ ...base, minute })) assert.notEqual(o.urgent, true, o.key);
});

// ---- 9: "free until" -------------------------------------------------------------------
// The gap question moved to lib/curiosity (decide.mjs): it ends the gap at the next commute, never claims a hard-coded
// 9 PM, and offers the best-ranked to-do. Those incidents are tested in tests/curiosity-decide.test.mjs; decide() itself
// no longer asks about gaps at all.
test("decide() leaves gaps to the curiosity loop", () => {
  assert.deepEqual(decide({ ...base, bed: "23:45", minute: m(15), todos: [{ title: "finish resume" }] }), []);
});

// ---- 10: session done ---------------------------------------------------------------
test("incident 10-16 03:09: a 2-second abandoned session never says 'Session done'", () => {
  const s = { status: "finished", endedMinute: m(3, 8), sessionId: "s-b126e9b7", reason: "abandoned", servedFocusSeconds: 2.2 };
  assert.deepEqual(decide({ ...base, minute: m(3, 9), session: s, day: [{ title: "MKTG2201", start: m(13, 30), end: m(15), fixed: true }] }), []);
});

test("a short or unmeasured session is not announced; a real one is", () => {
  const mk = (extra) => ({ status: "finished", endedMinute: m(15), sessionId: "s1", ...extra });
  assert.deepEqual(decide({ ...base, minute: m(15, 2), session: mk({ reason: "completed", servedFocusSeconds: 120 }) }), []);
  assert.deepEqual(decide({ ...base, minute: m(15, 2), session: mk({}) }), [], "no served time: unknown, not real");
  assert.equal(decide({ ...base, minute: m(15, 2), session: mk({ reason: "early", servedFocusSeconds: 37 * 60 }) })[0].key, "session-done-s1");
});
