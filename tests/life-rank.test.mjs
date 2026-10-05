// Priority ranks ORION can see and say (2026-10-05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankOf } from "../scripts/lib/life/priority.mjs";

const b = (title, kind, extra = {}) => ({ title, kind, fixed: false, source: "orion", ...extra });

test("a real class is fixed; an ORION block called a lab is not", () => {
  assert.equal(rankOf(b("CS2101 Lab", "class", { fixed: true, source: "calendar" })), "fixed");
  assert.notEqual(rankOf(b("DS lab", "class")), "fixed");
});

test("defaults follow his priorities", () => {
  assert.equal(rankOf(b("Nap", "rest")), "high");
  assert.equal(rankOf(b("Gym", "gym")), "high");
  assert.equal(rankOf(b("Study for macro quiz", "study")), "high");
  assert.equal(rankOf(b("finish resume", "other")), "medium");
  assert.equal(rankOf(b("Break", "rest")), "low");
  assert.equal(rankOf(b("study (if there's time)", "study")), "low");
});

test("his own words win", () => {
  assert.equal(rankOf(b("YouTube side project", "side_project"), { ranks: { youtube: "low" } }), "low");
  assert.equal(rankOf(b("finish resume", "other"), { ranks: { resume: "high" } }), "high");
});
