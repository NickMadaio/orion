import { test } from "node:test";
import assert from "node:assert/strict";
import { breakFor, shortBlock, extendWithin } from "../scripts/lib/life/freed-time.mjs";

const b = (id, title, start, end, extra = {}) => ({ id, title, start, end, fixed: false, ...extra });

test("an hour of work finished early earns a break; a short stint does not", () => {
  const day = [b("s", "Study", 1100, 1160)];
  assert.deepEqual(breakFor({ day, finished: b("o", "work on orion", 960, 1080), now: 1040, freed: 40 }), { start: 1040, end: 1055 });
  assert.equal(breakFor({ day, finished: b("o", "work on orion", 1010, 1080), now: 1040, freed: 40 }), null);
  assert.equal(breakFor({ day: [b("d", "Dinner", 1050, 1095)], finished: b("o", "work", 960, 1080), now: 1040, freed: 40 }), null);
});

test("a block under his minimum, or the side project under its hour, is short", () => {
  const day = [b("n", "Nap", 1100, 1145), b("y", "YouTube side project", 1200, 1230)];
  assert.deepEqual(shortBlock(day, { now: 1000, minimums: { nap: 75 } }), { block: day[0], deficit: 30 });
  assert.equal(shortBlock(day, { now: 1000, minimums: { "side project": 60 } }).block.id, "y");
  assert.equal(shortBlock(day, { now: 1000, minimums: {} }), null);
});

test("extending pushes later movable blocks, never into a fixed one", () => {
  const day = [b("y", "YouTube side project", 1000, 1030), b("r", "Reading", 1035, 1065), b("c", "Class", 1080, 1170, { fixed: true })];
  const r = extendWithin(day, day[0], 30, { buffer: 5 });
  assert.equal(r.by, 10);
  assert.deepEqual(r.day.find((x) => x.id === "r"), b("r", "Reading", 1045, 1075));
});
