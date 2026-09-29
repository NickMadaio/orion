import { test } from "node:test";
import assert from "node:assert/strict";
import { startLoop, step } from "../scripts/lib/life/follow-through.mjs";

const block = { id: "slides", start: 1000 };
test("reminds at the block's start", () => {
  const loop = step(startLoop(block, 900), { type: "tick" }, 1000);
  assert.equal(loop.phase, "reminded"); assert.equal(loop.level, 1); assert.equal(loop.nextCheckAt, 1010);
});
test("ignoring escalates to level 4 and stops there", () => {
  let loop = step(startLoop(block, 900), { type: "tick" }, 1000);
  for (let t = 1010; t < 1100; t += 10) loop = step(loop, { type: "ignored" }, t);
  assert.equal(loop.level, 4); assert.equal(loop.phase, "intervening");
});
test("starting resets the level", () => {
  let loop = step(step(startLoop(block, 900), { type: "tick" }, 1000), { type: "ignored" }, 1010);
  loop = step(loop, { type: "started" }, 1015);
  assert.equal(loop.phase, "active"); assert.equal(loop.level, 0); assert.equal(loop.nextCheckAt, 1040);
});
test("eating first defers and comes back", () => {
  let loop = step(step(startLoop(block, 900), { type: "tick" }, 1000), { type: "defer", minutes: 25, legitimate: true }, 1002);
  assert.equal(loop.phase, "deferred"); assert.equal(loop.nextCheckAt, 1027);
  loop = step(loop, { type: "tick" }, 1027);
  assert.equal(loop.phase, "reminded");
});
test("the third deferral is not legitimate", () => {
  let loop = step(startLoop(block, 900), { type: "tick" }, 1000);
  loop = step(loop, { type: "defer", minutes: 10, legitimate: true }, 1001);
  loop = step(loop, { type: "tick" }, 1011);
  loop = step(loop, { type: "defer", minutes: 10, legitimate: true }, 1012);
  loop = step(loop, { type: "tick" }, 1022);
  const before = loop.level;
  loop = step(loop, { type: "defer", minutes: 10, legitimate: true }, 1023);
  assert.notEqual(loop.phase, "deferred"); assert.equal(loop.level, before + 1);
});
test("cancel ends without escalation", () => {
  const loop = step(step(startLoop(block, 900), { type: "tick" }, 1000), { type: "cancelled", reason: "friend invited me" }, 1001);
  assert.equal(loop.phase, "cancelled"); assert.equal(loop.nextCheckAt, null); assert.equal(loop.level, 1);
});
test("done ends the loop", () => {
  const loop = step(step(startLoop(block, 900), { type: "started" }, 1000), { type: "done" }, 1060);
  assert.equal(loop.phase, "done"); assert.equal(step(loop, { type: "tick" }, 2000), loop);
});
test("never mutates the loop", () => {
  const loop = startLoop(block, 900); const copy = JSON.parse(JSON.stringify(loop));
  step(loop, { type: "tick" }, 1000); assert.deepEqual(loop, copy);
});
