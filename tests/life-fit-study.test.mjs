import { test } from "node:test";
import assert from "node:assert/strict";
import { fitStudy } from "../scripts/lib/life/fit-study.mjs";

const b = (id, kind, start, end, fixed = false) => ({ id, title: id, kind, date: "2026-09-30", start, end, fixed, source: "calendar" });
const window = { start: 480, end: 1380 };

test("fits into an empty afternoon", () => {
  const r = fitStudy([b("class", "class", 540, 630, true)], [90], window, 700);
  assert.equal(r.placed.length, 1);
  assert.equal(r.placed[0].start, 700);
  assert.equal(r.placed[0].end, 790);
  assert.deepEqual(r.unplaced, []);
});

test("never moves a class", () => {
  const blocks = [b("c1", "class", 480, 900, true), b("c2", "class", 910, 1380, true)];
  const r = fitStudy(blocks, [60], window, 480);
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.unplaced, [60]);
  assert.deepEqual(r.blocks.map((x) => [x.id, x.start]), [["c1", 480], ["c2", 910]]);
});

test("moves rest before side project", () => {
  // Only 70 free minutes at the end of the day, so the 80-minute session needs
  // room: rest (lowest priority) moves to the end; the side project stays.
  const blocks = [b("c", "class", 480, 600, true), b("rest", "rest", 610, 670), b("sp", "side_project", 710, 800),
                  b("c2", "class", 810, 1300, true)];
  const r = fitStudy(blocks, [80], window, 480);
  assert.equal(r.moved.length, 1);
  assert.equal(r.moved[0].id, "rest");
  assert.equal(r.placed.length, 1);
  assert.equal(r.blocks.find((x) => x.id === "sp").start, 710);
});

test("side project keeps its hour", () => {
  const blocks = [b("c", "class", 480, 600, true), b("sp", "side_project", 610, 670), b("c2", "class", 680, 1200, true)];
  const r = fitStudy(blocks, [50], window, 480);
  const sp = r.blocks.filter((x) => x.kind === "side_project").reduce((a, x) => a + x.end - x.start, 0);
  assert.equal(sp, 60);
});

test("nothing goes before now", () => {
  const r = fitStudy([], [60], window, 900, "2026-09-30");
  assert.ok(r.placed[0].start >= 900);
});

test("reports what could not fit", () => {
  const r = fitStudy([b("c", "class", 480, 1380, true)], [90, 60], window, 480);
  assert.deepEqual(r.unplaced.sort(), [60, 90]);
});

test("inputs are not mutated", () => {
  const blocks = [b("c", "class", 480, 600, true), b("rest", "rest", 610, 700), b("c2", "class", 710, 1380, true)];
  const copy = JSON.parse(JSON.stringify(blocks));
  const sessions = [80];
  fitStudy(blocks, sessions, window, 480);
  assert.deepEqual(blocks, copy);
  assert.deepEqual(sessions, [80]);
});
