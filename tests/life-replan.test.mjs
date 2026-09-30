import { test } from "node:test";
import assert from "node:assert/strict";
import { replan } from "../scripts/lib/life/replan.mjs";
import { isSocial, movable as movableTitle, toBlocks } from "../scripts/lib/life/live-day.mjs";

const b = (id, kind, start, end, fixed = false, title = id) => ({ id, title, kind, date: "2026-09-29", start, end, fixed, source: "calendar" });
const win = { start: 480, end: 1380 };

test("classes and plans with friends never move", () => {
  const day = [b("macro", "class", 810, 900, true), b("club", "other", 1320, 1380, true, "Ministry of Sound with Sam"), b("study", "study", 960, 1020)];
  const r = replan(day, { now: 700, window: win, blocked: [{ start: 940, end: 1100, title: "ran late" }] });
  assert.equal(r.blocks.find((x) => x.id === "macro").start, 810);
  assert.equal(r.blocks.find((x) => x.id === "club").start, 1320);
  assert.equal(r.moves[0].id, "study");
  assert.ok(r.moves[0].to >= 1100);
});

test("untouched blocks stay exactly where they are", () => {
  const day = [b("gym", "gym", 1080, 1140), b("games", "rest", 1200, 1260)];
  const r = replan(day, { now: 600, window: win, blocked: [{ start: 700, end: 760 }] });
  assert.deepEqual(r.moves, []);
});

test("running late pushes what clashes, most important first", () => {
  const day = [b("study", "study", 900, 960), b("games", "rest", 960, 1020), b("dinner", "meal", 1140, 1200, true)];
  const r = replan(day, { now: 900, window: win, blocked: [{ start: 900, end: 1000, title: "running late" }] });
  const study = r.blocks.find((x) => x.id === "study");
  const games = r.blocks.find((x) => x.id === "games");
  assert.ok(study.start >= 1000 && study.start < games.start, "study goes first, games after");
});

test("adding something finds room and moves only what it must", () => {
  const day = [b("macro", "class", 810, 900, true), b("clean", "other", 960, 1020)];
  const r = replan(day, { now: 700, window: win, add: [{ title: "groceries", kind: "other", minutes: 45, at: 960 }] });
  assert.equal(r.created.length, 1);
  assert.equal(r.created[0].title, "groceries");
  assert.ok(!r.blocks.some((x, i) => r.blocks.slice(i + 1).some((y) => x.start < y.end && y.start < x.end)), "no overlaps");
});

test("a new fixed plan takes its time and pushes movable blocks off it", () => {
  const day = [b("study", "study", 1080, 1200)];
  const r = replan(day, { now: 700, window: win, add: [{ title: "meal prep with Sam", kind: "meal", minutes: 120, at: 1080, fixed: true }] });
  assert.equal(r.created[0].start, 1080);
  assert.ok(r.blocks.find((x) => x.id === "study").start >= 1200);
});

test("his own plans go back in before ORION's suggestions", () => {
  const day = [b("class", "class", 930, 1020, true), b("clean", "other", 960, 1020, false, "clean at home"), b("prep", "meal", 1080, 1170, true, "meal prep with Sam")];
  const r = replan(day, { now: 900, window: win, add: [{ title: "Side project", kind: "side_project", minutes: 60 }] });
  assert.equal(r.blocks.find((x) => x.id === "clean").start, 1020, "cleaning right after class, as he said");
  assert.ok(r.created[0].start >= 1170, "the side-project hour fits around it");
});

test("what cannot fit is reported, not dropped silently", () => {
  const day = [b("wall", "class", 900, 1380, true), b("study", "study", 850, 890)];
  const r = replan(day, { now: 850, window: win, blocked: [{ start: 850, end: 900 }] });
  assert.equal(r.unplaced[0].title, "study");
});

test("a rebuild lays must-haves first and leaves optional work out when needed", () => {
  const day = [b("optional", "rest", 900, 1020, false, "Games if there's time")];
  const r = replan(day, { now: 900, window: { start: 900, end: 1080 }, rebuild: true, add: [
    { title: "Application progress", kind: "other", minutes: 120, importance: 0 },
  ] });
  assert.equal(r.created[0].title, "Application progress");
  assert.equal(r.created[0].start, 900);
  assert.equal(r.unplaced[0].id, "optional");
  assert.equal(r.unplaced[0].importance, 2);
});

test("a rebuild never moves work that is already in progress", () => {
  const day = [b("nap", "rest", 780, 870, false, "Nap"), b("study", "study", 900, 960)];
  const r = replan(day, { now: 810, window: win, rebuild: true });
  assert.equal(r.blocks.find((item) => item.id === "nap").start, 780);
  assert.ok(!r.moves.some((move) => move.id === "nap"));
});

test("titles decide what may move", () => {
  assert.equal(isSocial("Ministry of Sound"), true);
  assert.equal(isSocial("meal prep with Sam"), true);
  assert.equal(movableTitle("groceries"), true);
  assert.equal(movableTitle("Dinner with Sam"), false);
  assert.equal(movableTitle("Dentist"), false);
  assert.equal(movableTitle("Anything", "study"), true, "ORION's own blocks always may move");
  const blocks = toBlocks([{ title: "CS1800 Lecture", start: "2026-09-29T09:00:00", end: "2026-09-29T10:30:00" },
                           { title: "Study", start: "2026-09-29T15:00:00", end: "2026-09-29T16:00:00", orion: "study" }], "2026-09-29");
  assert.deepEqual(blocks.map((x) => x.fixed), [true, false]);
});
