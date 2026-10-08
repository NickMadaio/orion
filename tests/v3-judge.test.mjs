// The V3 judge: one dimension per call, "unknown" allowed, agreement counted ±1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeOne, agreement, DIMENSIONS } from "../scripts/lib/eval/v3/judge.mjs";

const reply = (content) => async (req) => { reply.seen = req; return { message: { content }, timings: {}, aborted: null, error: null }; };

test("a judge call asks about one dimension at temperature 0 and parses the score", async () => {
  const chatImpl = reply('{"score":"4","why":"short and correct"}');
  const r = await judgeOne({ model: "gpt-oss:20b", dimension: "spoken", item: { say: "time?", reply: "It's 3:53 PM." }, chatImpl });
  assert.equal(r.score, 4);
  assert.match(reply.seen.messages[0].content, /spoken:/);
  assert.equal(reply.seen.options.temperature, 0);
});

test("unknown is kept as no score; garbage is an error, not a score", async () => {
  assert.equal((await judgeOne({ model: "m", dimension: "tone", item: { say: "x", reply: "y" }, chatImpl: reply('{"score":"unknown","why":"?"}') })).score, null);
  assert.equal((await judgeOne({ model: "m", dimension: "tone", item: { say: "x", reply: "y" }, chatImpl: reply("five") })).error, "unparsable judge output");
});

test("agreement: within one point, unknown counts against", () => {
  const a = agreement([{ hand: 5, judge: 4 }, { hand: 3, judge: 1 }, { hand: 2, judge: null }, { hand: 4, judge: 4 }]);
  assert.equal(a.n, 4); assert.equal(a.withinOne, 0.5); assert.equal(a.exact, 0.25);
  assert.equal(Object.keys(DIMENSIONS).length, 5);
});
