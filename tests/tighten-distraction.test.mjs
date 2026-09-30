import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../scripts/lib/life/distraction.mjs";

const base = { now: { minute: 900 }, usage: { social: 0, video: 0, games: 0, other: 0 }, windowMinutes: 60, current: null, bedtime: null, recentNudges: 0, lockAllowed: true };
const study = { kind: "study", title: "Macro study", end: 930 };

test("breaks are protected", () => {
  assert.deepEqual(decide({ ...base, current: { kind: "rest", title: "Break", end: 930 }, usage: { ...base.usage, social: 60 } }), { action: "none", reason: "break", minutes: 0 });
});

test("scrolling in a study block nudges first", () => {
  assert.deepEqual(decide({ ...base, current: study, usage: { ...base.usage, social: 20 } }), { action: "nudge", reason: "during Macro study", minutes: 0 });
});

test("third strike locks until the block ends", () => {
  assert.deepEqual(decide({ ...base, current: study, usage: { ...base.usage, social: 20 }, recentNudges: 2 }), { action: "lock", reason: "during Macro study", minutes: 30 });
});

test("lock never shorter than 15", () => {
  assert.equal(decide({ ...base, current: { ...study, end: 905 }, usage: { ...base.usage, social: 20 }, recentNudges: 2 }).minutes, 15);
});

test("past bedtime after midnight", () => {
  assert.deepEqual(decide({ ...base, now: { minute: 30 }, bedtime: 1410, usage: { ...base.usage, video: 15 }, recentNudges: 2 }), { action: "lock", reason: "past bedtime", minutes: 30 });
});

test("no lock without permission", () => {
  assert.equal(decide({ ...base, now: { minute: 30 }, bedtime: 1410, usage: { ...base.usage, video: 15 }, recentNudges: 2, lockAllowed: false }).action, "nudge");
});

test("long free-time scroll nudges but never locks", () => {
  assert.deepEqual(decide({ ...base, usage: { ...base.usage, social: 50 }, recentNudges: 5 }), { action: "nudge", reason: "long scroll", minutes: 0 });
});

test("light use is fine", () => {
  assert.deepEqual(decide({ ...base, current: study, usage: { ...base.usage, social: 5 } }), { action: "none", reason: "ok", minutes: 0 });
});

test("bad input throws", () => {
  assert.throws(() => decide({ ...base, windowMinutes: 10 }), TypeError);
});
