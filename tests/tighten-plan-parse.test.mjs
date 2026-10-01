import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parsePlans, DEFAULT_MINUTES } from "../scripts/lib/life/plan-parse.mjs";

const NOW = { date: "2026-09-29", minute: 900, weekday: 2 }; // Tuesday 3 PM

test("dinner with friends tomorrow at 7", () => {
  const items = parsePlans("dinner with friends tomorrow at 7", NOW);
  assert.strictEqual(items.length, 1);
  const item = items[0];
  assert.strictEqual(item.title, "Dinner with friends");
  assert.strictEqual(item.kind, "social");
  assert.strictEqual(item.date, "2026-09-30");
  assert.strictEqual(item.start, 1140); // 7 PM = 19*60
  assert.strictEqual(item.minutes, 120);
  assert.strictEqual(item.fixed, true);
  assert.deepStrictEqual(item.assumed, ["120 min"]);
});

test("club from 10 till 2 tonight", () => {
  const items = parsePlans("tonight I'm going to Ministry of Sound from 10 till 2", NOW);
  assert.strictEqual(items.length, 1);
  const item = items[0];
  assert.strictEqual(item.title, "Ministry of Sound");
  assert.strictEqual(item.kind, "social");
  assert.strictEqual(item.date, "2026-09-29");
  assert.strictEqual(item.start, 1320); // 10 PM = 22*60
  assert.strictEqual(item.minutes, 240); // 10 PM to 2 AM = 4 hours
  assert.strictEqual(item.fixed, true);
});

test("three plans in one sentence", () => {
  const items = parsePlans(
    "going home after class to clean, then meal prep with a friend at 6, then the club at 10",
    NOW
  );
  assert.strictEqual(items.length, 3);

  // Item 1: Clean
  assert.strictEqual(items[0].title, "Clean");
  assert.strictEqual(items[0].kind, "errand");
  assert.strictEqual(items[0].start, null);
  assert.ok(items[0].assumed.includes("afternoon"), `expected "afternoon" in assumed, got ${JSON.stringify(items[0].assumed)}`);

  // Item 2: Meal prep with a friend
  assert.strictEqual(items[1].title, "Meal prep with a friend");
  assert.strictEqual(items[1].kind, "social");
  assert.strictEqual(items[1].start, 1080); // 6 PM = 18*60

  // Item 3: Club
  assert.strictEqual(items[2].title, "Club");
  assert.strictEqual(items[2].kind, "social");
  assert.strictEqual(items[2].start, 1320); // 10 PM = 22*60
});

test("durations in words", () => {
  const items = parsePlans("gym for an hour and a half at 7am tomorrow", NOW);
  assert.strictEqual(items.length, 1);
  const item = items[0];
  assert.strictEqual(item.minutes, 90);
  assert.strictEqual(item.start, 420); // 7 AM = 7*60
  assert.strictEqual(item.kind, "gym");
  assert.strictEqual(item.fixed, false);
});

test("weekday names", () => {
  const items = parsePlans("study macro thursday at 2", NOW);
  assert.strictEqual(items.length, 1);
  const item = items[0];
  assert.strictEqual(item.date, "2026-10-01"); // Thursday Oct 1
  assert.strictEqual(item.start, 840); // 2 PM = 14*60
  assert.strictEqual(item.kind, "study");
});

test("a passed bare hour today means pm", () => {
  const items = parsePlans("groceries at 5", NOW);
  assert.strictEqual(items.length, 1);
  const item = items[0];
  assert.strictEqual(item.start, 1020); // 5 PM = 17*60
});

test("no activity gives nothing", () => {
  const items = parsePlans("tomorrow at 7", NOW);
  assert.strictEqual(items.length, 0);
});

test("invalid now throws", () => {
  assert.throws(() => parsePlans("x", null), TypeError);
});

test("joining words are not part of the title (2026-09-30)", () => {
  const now = { date: "2026-09-30", minute: 480, weekday: 3 };
  const items = parsePlans("tonight Ministry of Sound from 10 till 2, and before that meal prep with a friend at 6", now);
  assert.deepEqual(items.map((i) => i.title), ["Ministry of Sound", "Meal prep with a friend"]);
});

test("bare hours in a full replacement day parse without crashing (2026-09-30 regression)", () => {
  const now = { date: "2026-09-30", minute: 720, weekday: 3 };
  const items = parsePlans("nap 90 min at 1, then application progress 90 min at 2:30, then snack 30 min at 4, then soccer practice 5-7, then dinner 30 min at 7:30, then workout at 8", now);
  assert.deepEqual(items.map((item) => [item.title, item.start, item.minutes]), [
    ["Nap", 780, 90],
    ["Application progress", 870, 90],
    ["Snack", 960, 30],
    ["Soccer practice", 1020, 120],
    ["Dinner", 1170, 30],
    ["Workout", 1200, 60],
  ]);
});

test("must-have and optional language becomes scheduling importance, not title text", () => {
  const items = parsePlans("I have to do application progress for 90 min, then maybe study for 60 min", NOW);
  assert.deepEqual(items.map((item) => [item.title, item.importance]), [
    ["Application progress", 0],
    ["Study", 2],
  ]);
});

test("numbers that label things are not times (2026-10-01)", () => {
  const now = { date: "2026-10-01", minute: 420, weekday: 4 };
  const lect = parsePlans("review CS lect 2 at 3", now)[0];
  assert.equal(lect.title, "Review CS lect 2");
  assert.equal(lect.start, 900);
  const quiz = parsePlans("study for quiz 2 at 4", now)[0];
  assert.equal(quiz.title, "Study for quiz 2");
  assert.equal(quiz.start, 960);
  assert.equal(parsePlans("finish lab 3 tomorrow", now)[0].start, null);
});
