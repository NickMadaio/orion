import { test } from "node:test";
import assert from "node:assert/strict";
import { fillDay } from "../scripts/lib/life/fill-day.mjs";
import { DEFAULTS } from "../scripts/lib/life/config.mjs";

const b = (id, kind, start, end, fixed = true, title = id) => ({ id, title, kind, date: "2026-09-29", start, end, fixed, source: "calendar" });
const config = { ...DEFAULTS };
test("an empty afternoon gets the side-project hour, dinner and a break", () => {
  const asks = fillDay([b("macro", "class", 810, 900), b("mktg", "class", 930, 1020)], { now: 1020, window: { start: 540, end: 1320 }, weekday: 2, config });
  assert.deepEqual(asks.map((a) => a.kind), ["side_project", "meal", "rest", "rest"]);
  assert.equal(asks[0].title, "Side project (YouTube)");
});
test("the gym comes first, then study before a quiz", () => {
  const asks = fillDay([], { now: 600, window: { start: 540, end: 1380 }, weekday: 1, config, deadlines: [{ title: "Macro Quiz 1", daysAway: 5 }] });
  assert.deepEqual(asks.slice(0, 2).map((a) => a.kind), ["gym", "study"]);
});
test("what is already planned is not asked for again", () => {
  const asks = fillDay([b("sp", "side_project", 1100, 1160, false), b("tea", "meal", 1140, 1190, false, "Dinner")], { now: 900, window: { start: 540, end: 1320 }, weekday: 2, config });
  assert.ok(!asks.some((a) => a.kind === "side_project" || a.kind === "meal"));
});
test("a club night leaves no evening to fill, and the day keeps free time", () => {
  const blocks = [b("macro", "class", 810, 900), b("mktg", "class", 930, 1020), b("home", "other", 1030, 1080, true, "clean"), b("prep", "meal", 1080, 1200, true, "meal prep with Sam")];
  const asks = fillDay(blocks, { now: 1020, window: { start: 540, end: 1320 }, weekday: 2, config: { ...config, windDownMinutes: 0 } });
  const total = asks.reduce((a, x) => a + x.minutes, 0);
  assert.ok(1320 - 1200 - total >= 60 || asks.length === 0, "at least an hour stays free");
});
test("a night out through bedtime means no wind-down block", () => {
  const asks = fillDay([b("club", "other", 1320, 1440, true, "Ministry of Sound")], { now: 900, window: { start: 540, end: 1440 }, weekday: 2, config });
  assert.ok(!asks.some((a) => a.title === "Wind down"));
});

test("the side-project hour can be made specific", () => {
  const asks = fillDay([], { now: 600, window: { start: 540, end: 1320 }, weekday: 2, config: { ...config, sideProjectLabel: "Edit the London vlog" } });
  assert.equal(asks.find((a) => a.kind === "side_project").title, "Edit the London vlog");
});

test("the gym is asked for first and flagged early", () => {
  const asks = fillDay([], { now: 600, window: { start: 540, end: 1380 }, weekday: 3, config, deadlines: [{ title: "Macro Quiz 1", daysAway: 2 }] });
  assert.equal(asks[0].kind, "gym"); assert.equal(asks[0].early, true); assert.equal(asks[0].minutes, config.gymMinutes);
});
test("low recovery: study shrinks and the gym is a shorter easy session", () => {
  const recovery = { level: "low", studyScale: 0.6, gymMinutes: 45 };
  const asks = fillDay([], { now: 600, window: { start: 540, end: 1380 }, weekday: 3, config, studyPlan: [{ title: "CS midterm", minutes: 120 }], recovery });
  const gym = asks.find((a) => a.kind === "gym"), study = asks.find((a) => a.kind === "study");
  assert.equal(gym.minutes, 45); assert.equal(gym.easy, true); assert.equal(gym.title, "Gym");
  assert.equal(study.minutes, 70);
});
test("normal or unknown recovery changes nothing", () => {
  const base = fillDay([], { now: 600, window: { start: 540, end: 1380 }, weekday: 3, config, studyPlan: [{ title: "CS midterm", minutes: 120 }] });
  for (const level of ["normal", "unknown"]) {
    assert.deepEqual(fillDay([], { now: 600, window: { start: 540, end: 1380 }, weekday: 3, config, studyPlan: [{ title: "CS midterm", minutes: 120 }], recovery: { level } }), base);
  }
});
