// Property tests: thousands of random days through the planner; no plan may
// break the day rules. (2026-10-01: overlaps kept coming back case by case.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { replan } from "../scripts/lib/life/replan.mjs";
import { checkDay } from "../scripts/lib/life/day-check.mjs";

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const KINDS = ["study", "gym", "side_project", "meal", "rest", "other"];

function randomDay(r) {
  const blocks = []; let id = 0;
  // A few fixed things (classes, plans with people), possibly overlapping each other.
  for (let i = 0; i < Math.floor(r() * 4); i++) {
    const start = 480 + Math.floor(r() * 50) * 15; const len = 30 + Math.floor(r() * 8) * 15;
    blocks.push({ id: `f${id++}`, title: `Fixed ${i}`, kind: "class", start, end: Math.min(1440, start + len), fixed: true, source: "calendar" });
  }
  // ORION's movable blocks, deliberately colliding with things.
  for (let i = 0; i < Math.floor(r() * 7); i++) {
    const start = 480 + Math.floor(r() * 56) * 15; const len = 15 + Math.floor(r() * 7) * 15;
    blocks.push({ id: `m${id++}`, title: `Task ${i}`, kind: KINDS[i % KINDS.length], start, end: Math.min(1440, start + len), fixed: false, source: "orion" });
  }
  const add = [];
  for (let i = 0; i < Math.floor(r() * 5); i++) {
    const minutes = 15 + Math.floor(r() * 8) * 15;
    const timed = r() < 0.4; const fixed = timed && r() < 0.3;
    add.push({ title: `New ${i}`, kind: KINDS[(i + 2) % KINDS.length], minutes, ...(timed ? { at: 480 + Math.floor(r() * 56) * 15 } : {}), fixed,
      ...(r() < 0.3 ? { importance: Math.floor(r() * 3) } : {}) });
  }
  const blocked = r() < 0.3 ? [{ start: 600 + Math.floor(r() * 20) * 15, end: 0 }].map((b) => ({ ...b, end: b.start + 30 + Math.floor(r() * 6) * 15 })) : [];
  return { blocks, add, blocked, now: 420 + Math.floor(r() * 30) * 15, rebuild: r() < 0.5 };
}

test("no random day comes out with ORION's blocks overlapping anything", () => {
  const failures = [];
  for (let seed = 1; seed <= 3000; seed++) {
    const r = rng(seed); const d = randomDay(r);
    const result = replan(d.blocks, { now: d.now, window: { start: 420, end: 1440 }, blocked: d.blocked, add: d.add,
      rebuild: d.rebuild, buffer: 10, keepFree: 60 });
    const check = checkDay(result.blocks, { from: d.now });
    // What it was told was busy is a wall too: nothing of ORION's inside it.
    const inBusy = result.blocks.filter((b) => !b.fixed && b.start >= d.now && d.blocked.some((w) => b.start < w.end && w.start < b.end));
    if (!check.ok || inBusy.length) failures.push(`seed ${seed}: ${[...check.problems, ...inBusy.map((b) => `${b.title} inside busy time`)].join("; ")}`);
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("blocks ORION lays out keep the gap between them", () => {
  const failures = [];
  for (let seed = 1; seed <= 1000; seed++) {
    const r = rng(seed * 7); const d = randomDay(r);
    const result = replan(d.blocks.filter((b) => b.fixed), { now: d.now, window: { start: 420, end: 1440 },
      add: d.add.map(({ at, fixed, ...rest }) => rest), rebuild: true, buffer: 10 });
    const placed = result.blocks.sort((a, b) => a.start - b.start);
    for (let i = 1; i < placed.length; i++) {
      const [a, b] = [placed[i - 1], placed[i]];
      if ((!a.fixed || !b.fixed) && b.start < a.end + 10 && b.start >= a.start) failures.push(`seed ${seed}: ${a.title} → ${b.title} gap ${b.start - a.end}`);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("checkDay names the overlap and lets his own clashes through as a note", () => {
  const r = checkDay([{ title: "Lunch", start: 690, end: 715, source: "orion", fixed: false }, { title: "Break", start: 710, end: 725, source: "orion", fixed: false },
    { title: "Lecture", start: 540, end: 630, fixed: true, source: "calendar" }, { title: "Club", start: 600, end: 660, fixed: true, source: "calendar" }]);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /Lunch \(11:30–11:55\) overlaps Break/);
  assert.equal(r.notes.length, 1);
});
