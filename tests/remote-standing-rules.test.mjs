// Standing rules from Nick's own words, saved without the model (2026-10-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readStandingRules, parseDuration } from "../scripts/lib/remote/standing-rules.mjs";

test("his real nap message becomes a 75-minute minimum", () => {
  const r = readStandingRules("First, naps should be at least an hour and 15 minutes long ALWAYS. And with that being said that makes things even tighter. Make the nap longer, push study back, and now get rid of send internship applications");
  assert.equal(r.standing, true);
  assert.deepEqual(r.minimums, [{ key: "nap", minutes: 75 }]);
});

test("his real 'going forward' message is kept as a standing statement", () => {
  const r = readStandingRules("Just make it fit, shrink it. It’s not a priority item. Going forward remember that you can change how much time is allotted to non priority items");
  assert.equal(r.standing, true);
  assert.match(r.statement, /Going forward remember/);
  assert.deepEqual(r.minimums, []);
});

test("an ordinary request is not a standing rule", () => {
  const r = readStandingRules("The DS lab is taking longer than expected. Extend it all the way to 3. I'll take my nap after.");
  assert.equal(r.standing, false);
});

test("durations in the ways he says them", () => {
  assert.equal(parseDuration("an hour and 15 minutes"), 75);
  assert.equal(parseDuration("1h15"), 75);
  assert.equal(parseDuration("an hour and a half"), 90);
  assert.equal(parseDuration("2 hours"), 120);
  assert.equal(parseDuration("45 min"), 45);
  assert.equal(parseDuration("soon"), null);
});

test("'at least X for Y' also works", () => {
  assert.deepEqual(readStandingRules("Always give me at least 30 minutes for dinner").minimums, [{ key: "dinner", minutes: 30 }]);
});

test("always between should and be preserves the minimum", () => {
 assert.deepEqual(readStandingRules("naps should always be at least an hour and 15 minutes").minimums, [{ key: "nap", minutes: 75 }]);
});
