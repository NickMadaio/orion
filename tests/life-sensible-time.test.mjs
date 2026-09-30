import { test } from "node:test";
import assert from "node:assert/strict";
import { homeFrom, preferredStart } from "../scripts/lib/life/sensible-time.mjs";
import { replan } from "../scripts/lib/life/replan.mjs";

const b = (id, kind, start, end, fixed = true, title = id) => ({ id, title, kind, date: "2026-10-01", start, end, fixed, source: "calendar" });
const at = (h, m = 0) => h * 60 + m;

test("home is after the last class and the trip back", () => {
  assert.equal(homeFrom([b("l", "class", at(9), at(10, 30)), b("w", "class", at(12), at(14))], { commuteMinutes: 30 }), at(14, 30));
  assert.equal(homeFrom([], { wake: at(9) }), at(9));
});

test("kinds prefer their natural time of day", () => {
  const home = at(11);
  assert.equal(preferredStart({ title: "reading", kind: "study" }, home), at(20));
  assert.equal(preferredStart({ title: "Gym", kind: "gym" }, home), at(17));
  assert.equal(preferredStart({ title: "Dinner", kind: "meal" }, home), at(18, 30));
  assert.equal(preferredStart({ title: "Side project (YouTube)", kind: "side_project" }, home), home);
  assert.equal(preferredStart({ title: "Nap", kind: "rest" }, home), home);
});

test("the test day that went wrong: no reading at 8 AM, no side project the minute class ends", () => {
  const day = [b("lec", "class", at(9), at(10, 30)), b("soccer", "other", at(16, 30), at(19, 30), true, "soccer practice")];
  const home = homeFrom(day, { commuteMinutes: 30 });
  const ask = (title, kind, minutes) => ({ title, kind, minutes, after: home, prefer: preferredStart({ title, kind }, home) });
  const r = replan(day, { now: at(7), window: { start: at(8), end: at(24) }, add: [
    ask("reading", "study", 30), ask("Side project (YouTube)", "side_project", 60), ask("resume work", "other", 60)] });
  const get = (t) => r.created.find((x) => x.title === t);
  assert.ok(get("reading").start >= at(20), `reading at ${get("reading").start}`);
  assert.ok(get("Side project (YouTube)").start >= at(11), "side project after he is home");
  assert.ok(get("resume work").start >= at(11));
  assert.ok(r.created.every((x) => x.start >= at(10, 30)), "nothing before class");
});

test("a preferred time gives way when only earlier time is free, but never before home", () => {
  const day = [b("lec", "class", at(9), at(10, 30)), b("late", "other", at(19), at(24), true, "night out with Sam")];
  const home = homeFrom(day, { commuteMinutes: 30 });
  const r = replan(day, { now: at(7), window: { start: at(8), end: at(24) }, add: [
    { title: "reading", kind: "study", minutes: 30, after: home, prefer: preferredStart({ title: "reading", kind: "study" }, home) }] });
  assert.ok(r.created[0].start >= home && r.created[0].start < at(19));
});
