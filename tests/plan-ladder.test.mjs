// The escalation ladder for a planned block that has not started (2026-10-30, W4). Pure: lib/reach/plan-ladder.mjs.
// R2 evidence: gym "gave-up" on 10-16, 10-20, 10-21, 10-23; both 10-27 loops ended given_up at level 0; "I'm meal prepping" was a
// dead end; a 10-18 rung said "It's been 1039 min".
import test from "node:test";
import assert from "node:assert/strict";
import { GAPS, CAPS, rungName, nextGap, smallerVersion, strictnessFor, rungText, endText, comebackText, graceFor,
  capVerdict, restrictionFor, recordSays } from "../scripts/lib/reach/plan-ladder.mjs";

const GYM = { date: "2026-10-30", start: 1020, end: 1110 };   // 17:00-18:30

test("the ladder is L0, L1 +10, L2 +20, L3 +40, END +60 from the first nudge", () => {
  assert.deepEqual(GAPS, [10, 10, 20, 20]);
  assert.deepEqual([0, 1, 2, 3, 4].map(rungName), ["L0", "L1", "L2", "L3", "END"]);
  assert.equal(nextGap(0), 10); assert.equal(nextGap(3), 20);
});

test("the smaller version is 30 min at most, never more than what is left, never under 10", () => {
  assert.equal(smallerVersion(GYM, 1035), 30);
  assert.equal(smallerVersion({ date: "x", start: 600, end: 640 }, 605), 20);
  assert.equal(smallerVersion(GYM, 1100), 10);
});

test("strictness: the now record wins for its own block; otherwise patterns, slips and the age of the mismatch decide", () => {
  const record = { shouldBe: { blockId: "gym-1" }, strictness: "flexible" };
  assert.equal(strictnessFor({ record, blockId: "gym-1", kind: "gym", elapsed: 5 }), "flexible");
  assert.equal(strictnessFor({ record, blockId: "gym-1", kind: "gym", elapsed: 5, firm: true }), "firm", "a refused excuse makes it firm");
  const patterns = { byKind: { gym: { planned: 6, happened: 0, rate: 0 } } };
  assert.equal(strictnessFor({ record: null, blockId: "gym-1", kind: "gym", elapsed: 5, patterns }), "firm");
  assert.equal(strictnessFor({ record: null, blockId: "s", kind: "study", elapsed: 5, patterns }), "flexible");
  assert.equal(strictnessFor({ record: null, blockId: "s", kind: "study", elapsed: 31 }), "firm");
  assert.equal(strictnessFor({ record: null, blockId: "s", title: "Study", kind: "study", elapsed: 5, slips: [{ title: "Study" }] }), "firm");
});

test("rung texts climb, keep the shapes the reply reader parses, and offer the smaller version at L1", () => {
  const base = { title: "Gym", elapsed: 5, smaller: 30, strictness: "flexible" };
  assert.equal(rungText({ ...base, rung: 0 }), "Time to start: Gym.");
  assert.match(rungText({ ...base, rung: 0, strictness: "firm", avoidance: "Gym: 0 of the last 6 happened." }), /^Time to start: Gym\. Gym: 0 of the last 6 happened\. Not today\.$/);
  assert.match(rungText({ ...base, rung: 1, elapsed: 15 }), /^Gym — still not started\. Just 30 min then/);
  assert.match(rungText({ ...base, rung: 2, elapsed: 25 }), /^It's been 25 min\. Gym, now\./);
  const l3 = rungText({ ...base, rung: 3, elapsed: 45, strictness: "firm" });
  assert.match(l3, /^You've been avoiding Gym for 45 min\. No\. Get up\./);
  assert.match(rungText({ ...base, rung: 3, elapsed: 62, strictness: "firm" }), /^You've been avoiding Gym for 62 min\. No\. That's an hour\. Get up\.$/);
  assert.match(rungText({ ...base, rung: 3, elapsed: 45, strictness: "firm", restricted: "lock" }), /locked the Mac/);
});

test("never a stale count: minutes are capped at the block's own length", () => {
  assert.match(rungText({ title: "Gym", rung: 2, elapsed: 1039, smaller: 30, strictness: "firm", blockMinutes: 90 }), /It's been 90 min/);
});

test("END always says what happens now: moved and told, no room asks, a failed replan asks", () => {
  assert.equal(endText({ title: "Gym", start: 1020, replan: { kind: "moved", start: 1200, end: 1290 } }),
    "Gym didn't happen at 5:00 PM. I've moved it to 8:00 PM–9:30 PM; that's the plan now. If today's off, say skip.");
  assert.match(endText({ title: "Gym", start: 1020, smaller: 30, replan: { kind: "no-room" } }), /no room left today.*30 min tonight, or first thing tomorrow\?$/);
  assert.match(endText({ title: "Gym", start: 1020, replan: { kind: "failed" } }), /Should I move it to later today, or is today off\?$/);
});

test("a legitimate reason gets 20-30 min and a comeback; avoidance gets none", () => {
  assert.deepEqual(graceFor("I'm meal prepping. That's why. Sorry.", 25), { minutes: 25, returning: "meal prep's done" });
  assert.deepEqual(graceFor("eating", 10), { minutes: 20, returning: "you ate" });
  assert.deepEqual(graceFor("on a call", 60), { minutes: 30, returning: "the call's done" });
  assert.equal(graceFor("later", 25), null);
  assert.equal(graceFor("one more video", 25), null);
  assert.equal(comebackText({ title: "Gym", returning: "you ate" }), "Time to start: Gym. Okay, you ate. Now we're starting.");
});

test("caps are a safety net: 4 rungs per block per hour, 25 a day, the closing message is never capped", () => {
  const at = (m) => new Date(Date.UTC(2026, 9, 30, 17, m)).toISOString();
  const sent = (block, mins) => mins.map((m) => ({ blockId: block, at: at(m) }));
  const now = Date.parse(at(50));
  assert.equal(capVerdict({ sent: sent("g", [5, 15, 25]), blockId: "g", nowMs: now, rung: 3 }).ok, true);
  const four = capVerdict({ sent: sent("g", [5, 15, 25, 45]), blockId: "g", nowMs: now, rung: 3 });
  assert.equal(four.ok, false); assert.equal(four.reason, "block-hour");
  assert.equal(capVerdict({ sent: sent("g", [5, 15, 25, 45]), blockId: "g", nowMs: now, rung: 4 }).ok, true, "END is not capped");
  const many = Array.from({ length: CAPS.perDay }, (_, i) => ({ blockId: `b${i}`, at: at(i) }));
  assert.equal(capVerdict({ sent: many, blockId: "new", nowMs: now, rung: 0 }).reason, "day");
});

test("restriction only with the grant and the Mac app's own consent, and only on the firm L3", () => {
  const activity = { at: "2026-10-30T17:44:30Z", enforcementAllowed: true, workApp: "Zed" };
  const now = Date.parse("2026-10-30T17:45:00Z");
  assert.equal(restrictionFor({ grant: false, activity, kind: "gym", nowMs: now, strictness: "firm" }), null);
  assert.equal(restrictionFor({ grant: true, activity: { ...activity, enforcementAllowed: false }, kind: "gym", nowMs: now, strictness: "firm" }), null);
  assert.equal(restrictionFor({ grant: true, activity, kind: "gym", nowMs: now, strictness: "flexible" }), null);
  assert.deepEqual(restrictionFor({ grant: true, activity, kind: "gym", nowMs: now, strictness: "firm" }), { step: "lock" });
  assert.deepEqual(restrictionFor({ grant: true, activity, kind: "study", nowMs: now, strictness: "firm" }), { step: "front", app: "Zed" });
  assert.equal(restrictionFor({ grant: true, activity: { ...activity, at: "2026-10-30T16:00:00Z" }, kind: "gym", nowMs: now, strictness: "firm" }), null, "a stale sample is no consent");
});

test("the now record drives it: a fresh record about this block says go, wait or off; a stale or missing one defers to the window", () => {
  const now = Date.parse("2026-10-30T17:15:00Z");
  const rec = (over) => ({ computedAt: "2026-10-30T17:14:00Z", shouldBe: { blockId: "g", kind: "gym" }, mismatch: { kind: "not-started", minutes: 14 }, declared: [], ...over });
  assert.equal(recordSays(rec({}), { blockId: "g", nowMs: now }).verdict, "go");
  assert.equal(recordSays(rec({ mismatch: null }), { blockId: "g", nowMs: now }).verdict, "wait");
  assert.equal(recordSays(rec({ shouldBe: { blockId: "c", kind: "class" } }), { blockId: "g", nowMs: now }).verdict, "wait");
  assert.equal(recordSays(rec({ shouldBe: { blockId: null, kind: "sleep" }, mismatch: { kind: "awake-late" } }), { blockId: "g", nowMs: now }).verdict, "wait");
  assert.equal(recordSays(rec({ computedAt: "2026-10-30T16:40:00Z" }), { blockId: "g", nowMs: now }).verdict, "window");
  assert.equal(recordSays(null, { blockId: "g", nowMs: now }).verdict, "window");
});

test("gym evidence: a WHOOP or HealthKit workout today, the gym place, or his word; nothing else", async () => {
  const { gymEvidence } = await import("../scripts/lib/life/attendance.mjs");
  const now = new Date(2026, 9, 30, 19, 0);
  const at = new Date(2026, 9, 30, 18, 10).toISOString();
  assert.deepEqual(gymEvidence({ date: "2026-10-30", workouts: [{ day: "2026-10-30", startedAt: at, source: "whoop" }], now }), { source: "whoop", at, minute: 1090 });
  assert.equal(gymEvidence({ date: "2026-10-30", workouts: [{ day: "2026-10-30", startedAt: at }], now }).source, "workout-log");
  assert.equal(gymEvidence({ date: "2026-10-30", workouts: [{ day: "2026-10-29", startedAt: new Date(2026, 9, 29, 18).toISOString(), source: "healthkit" }], now }), null, "yesterday's workout is not today's");
  assert.equal(gymEvidence({ date: "2026-10-30", placeId: "gym", now }).source, "place");
  assert.equal(gymEvidence({ date: "2026-10-30", declared: [{ kind: "note", text: "went to the gym this morning", at, date: "2026-10-30" }], now }).source, "declared");
  assert.equal(gymEvidence({ date: "2026-10-30", declared: [{ kind: "note", text: "gym later", at, date: "2026-10-30" }], now }), null);
  assert.equal(gymEvidence({ date: "2026-10-30", now }), null);
});
