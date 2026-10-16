// WP6: one weight, computed in code (spec 3.8 point 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { weightOf, rankOf, importanceOf } from "../scripts/lib/life/priority.mjs";
import { toBlocks } from "../scripts/lib/life/live-day.mjs";

const b = (title, kind, extra = {}) => ({ title, kind, fixed: false, source: "orion", ...extra });

test("fixed first: a real class and any other fixed block", () => {
  assert.deepEqual(weightOf(b("CS2101 Lab", "class", { fixed: true, source: "calendar" })), { rank: "fixed", score: 0, source: "fixed" });
  assert.equal(weightOf(b("Dinner with Sam", "meal", { fixed: true, source: "calendar", rank: "low" })).rank, "fixed");
});

test("evidence order: stored tag, anchor, saved words, title words, kind", () => {
  const config = { ranks: { gym: "high", resume: "medium" }, anchors: [{ title: "Gym", kind: "gym", rank: "must" }] };
  assert.equal(weightOf(b("Gym", "gym", { rank: "low" }), config).rank, "low");       // tag beats anchor
  assert.equal(weightOf(b("Gym", "gym"), config).rank, "must");                       // anchor beats ranks.gym
  assert.equal(weightOf(b("Evening gym", "gym"), { ranks: { gym: "medium" } }).rank, "medium"); // saved words beat the kind
  assert.equal(weightOf(b("finish resume, must", "other"), config).rank, "medium");   // saved words beat title words
  assert.equal(weightOf(b("must email prof", "other")).rank, "must");
  assert.equal(weightOf(b("study (if there's time)", "study")).rank, "low");
  assert.equal(weightOf(b("x", "other", { importance: 0 })).rank, "must");
  assert.equal(weightOf(b("Nap", "rest")).rank, "high");
});

test("ranks.gym finally counts: gym: medium lowers the kind default", () => {
  assert.equal(weightOf(b("Gym", "gym")).rank, "high");
  assert.equal(weightOf(b("Gym", "gym"), { ranks: { gym: "low" } }).score, 4);
});

test("kind defaults follow SCHEDULING.md", () => {
  for (const [kind, rank] of [["gym", "high"], ["study", "high"], ["deadline", "high"], ["other", "medium"], ["side_project", "medium"], ["meal", "medium"], ["rest", "low"]])
    assert.equal(weightOf(b("thing", kind)).rank, rank, kind);
  assert.equal(rankOf(b("Gym", "gym")), "high");
});

test("importanceOf is fed by weightOf but a kind default is not evidence", () => {
  assert.equal(importanceOf(b("Break", "rest")), 1);
  assert.equal(importanceOf(b("Gym", "gym"), { anchors: [{ title: "Gym" }] }), 0);
  assert.equal(importanceOf(b("YouTube", "side_project", { rank: "low" })), 2);
});

test("a rank tag survives the calendar round-trip", () => {
  const at = (h) => new Date(2030, 9, 3, h).toISOString();
  const [blk] = toBlocks([{ identifier: "e1", title: "Gym", start: at(17), end: at(18), orion: "gym", orionTags: ["gym", "anchor", "rank-must"] }], "2030-10-03");
  assert.deepEqual(blk.tags, ["anchor", "rank-must"]);
  assert.equal(blk.rank, "must");
  assert.equal(blk.logged, false);
  assert.equal(weightOf(blk).rank, "must");
  const [logged] = toBlocks([{ identifier: "e2", title: "gym", start: at(14), end: at(16), orion: "gym", orionTags: "gym,logged" }], "2030-10-03");
  assert.equal(logged.logged, true);
  const [old] = toBlocks([{ identifier: "e3", title: "Study", start: at(14), end: at(16), orion: "study" }], "2030-10-03");
  assert.deepEqual(old.tags, []);
});
