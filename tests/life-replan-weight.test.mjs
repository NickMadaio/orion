// WP6: replan orders by weight; a displaced item may bump only strictly lower ranks, never a must or a fixed block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replan } from "../scripts/lib/life/replan.mjs";

const b = (id, title, kind, start, end, extra = {}) => ({ id, title, kind, date: "d", start, end, fixed: false, source: "orion", ...extra });
// 15:00 now. A wall 15:00-16:00 and one 17:00-18:00 leave exactly one slot: 16:00-17:00.
const walls = [b("w1", "Seminar", "class", 900, 960, { fixed: true, source: "calendar" }), b("w2", "Lecture", "class", 1020, 1080, { fixed: true, source: "calendar" })];
const run = (slotBlock, displacedBlock, extra = {}) => replan([...walls, slotBlock], { now: 900, window: { start: 480, end: 1080 }, rebuild: true,
  displaced: [{ block: displacedBlock, minutes: 50 }], config: {}, ...extra });
const titles = (r) => r.blocks.map((x) => x.title);

test("a displaced high item bumps a later medium one", () => {
  const r = run(b("m", "email prof", "other", 960, 1020), b("p", "Study for quiz", "study", 840, 900));
  assert.deepEqual(r.unplaced.map((u) => u.title), ["email prof"]);
  assert.ok(titles(r).includes("Study for quiz"));
  assert.equal(r.created[0].start, 960);
  assert.equal(r.moves.length, 0, "a displaced item is a new block, not a move");
});

test("an equal rank does not bump: the displaced item is the one left off", () => {
  const r = run(b("m", "email prof", "other", 960, 1020), b("p", "finish resume", "other", 840, 900));
  assert.deepEqual(r.unplaced.map((u) => [u.title, u.displaced === true]), [["finish resume", true]]);
  assert.ok(titles(r).includes("email prof"));
});

test("a must is never bumped, even by a displaced high item; a displaced must does bump a high one", () => {
  const mustSlot = b("m", "Gym", "gym", 960, 1020, { rank: "must" });
  assert.deepEqual(run(mustSlot, b("p", "Study", "study", 840, 900)).unplaced.map((u) => u.title), ["Study"]);
  const r = run(b("h", "Study", "study", 960, 1020), b("p", "Gym", "gym", 840, 900, { rank: "must" }));
  assert.deepEqual(r.unplaced.map((u) => u.title), ["Study"]);
  assert.equal(r.unplaced[0].rank, "high");
});

test("a fixed block never moves or goes", () => {
  const r = run(b("m", "email prof", "other", 960, 1020), b("p", "Study", "study", 840, 900));
  for (const w of walls) assert.ok(r.blocks.some((x) => x.id === w.id && x.start === w.start && x.end === w.end));
  assert.ok(!r.unplaced.some((u) => walls.some((w) => w.title === u.title)));
});

test("his saved ranks now count: youtube: high beats a medium existing block", () => {
  const r = run(b("m", "email prof", "other", 960, 1020), b("p", "YouTube", "side_project", 840, 900), { config: { ranks: { youtube: "high" } } });
  assert.deepEqual(r.unplaced.map((u) => u.title), ["email prof"]);
});

test("a high-rank new item beats a medium existing one (weight before existing-first)", () => {
  const r = replan([...walls, b("m", "email prof", "other", 960, 1020)], { now: 900, window: { start: 480, end: 1080 }, rebuild: true,
    add: [{ title: "Gym", kind: "gym", minutes: 50, rank: "must", tags: ["anchor"] }], config: {} });
  assert.deepEqual(r.unplaced.map((u) => u.title), ["email prof"]);
  assert.deepEqual(r.created[0].tags, ["anchor"]);
});
