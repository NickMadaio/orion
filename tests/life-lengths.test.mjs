// lengths.mjs: his minimums and shrink-to-fit (2026-10-01, "naps at least an
// hour and 15 ALWAYS"; "remember you can change how much time is allotted to
// non priority items").
import { test } from "node:test";
import assert from "node:assert/strict";
import { minimumFor, withMinimums, shrinkFloor, shrinkPlan, applyShrink } from "../scripts/lib/life/lengths.mjs";

const b = (id, title, kind, start, end, extra = {}) => ({ id, title, kind, start, end, fixed: false, source: "orion", ...extra });

test("a minimum applies to any title containing its name", () => {
  assert.equal(minimumFor("Nap", { nap: 75 }), 75);
  assert.equal(minimumFor("afternoon nap", { nap: 75 }), 75);
  assert.equal(minimumFor("Study", { nap: 75 }), 0);
});

test("planned items are raised to his minimum and say so", () => {
  const [nap, study] = withMinimums([{ title: "nap", minutes: 45 }, { title: "study", minutes: 60 }], { nap: 75 });
  assert.equal(nap.minutes, 75); assert.equal(nap.raisedFrom, 45);
  assert.equal(study.minutes, 60); assert.equal(study.raisedFrom, undefined);
});

test("nothing shrinks below half, 20 minutes, or his minimum", () => {
  assert.equal(shrinkFloor(b("y", "YouTube side project", "side_project", 0, 60)), 30);
  assert.equal(shrinkFloor(b("r", "break", "rest", 0, 30)), 20);
  assert.equal(shrinkFloor(b("y", "YouTube side project", "side_project", 0, 60), { youtube: 50 }), 50);
});

test("low-priority blocks give up time; nap, study, meals, his to-dos and fixed plans never do", () => {
  const day = [
    b("nap", "Nap", "rest", 900, 975), b("study", "Study", "study", 990, 1050),
    b("dinner", "Dinner", "meal", 1190, 1235), b("yt", "YouTube side project", "side_project", 1340, 1400),
    b("apply", "apply to SOMEWHERE", "other", 1030, 1075), b("soccer", "soccer", "other", 1100, 1220, { fixed: true }),
  ];
  const plan = shrinkPlan(day, 40, { now: 800 });
  assert.deepEqual(plan.map((x) => x.id), ["yt"]);
  assert.equal(plan[0].to, 30, "never below half");
  const after = applyShrink(day, plan);
  assert.equal(day.find((x) => x.id === "yt").end, 1400, "input not mutated");
  assert.ok(after.every((x) => x.end > x.start));
});

test("blocks already under way are not shrunk", () => {
  assert.deepEqual(shrinkPlan([b("yt", "YouTube", "side_project", 700, 760)], 20, { now: 710 }), []);
});

test("anything he marked optional gives up time first", () => {
  const plan = shrinkPlan([b("yt", "YouTube", "side_project", 900, 960), b("s", "study (if there's time)", "study", 1000, 1060)], 20, { now: 0 });
  assert.equal(plan[0].id, "s");
});

test("time a block gives up slides the later blocks up, but never past a fixed plan or before now", () => {
  const day = [
    b("yt", "YouTube", "side_project", 600, 660), b("a", "resume", "other", 670, 760),
    b("soccer", "soccer", "other", 800, 900, { fixed: true }), b("c", "dinner", "meal", 910, 950),
  ];
  const after = applyShrink(day, [{ id: "yt", title: "YouTube", from: 60, to: 30 }], { now: 500 });
  const byId = Object.fromEntries(after.map((x) => [x.id, x]));
  assert.deepEqual([byId.yt.start, byId.yt.end], [600, 630]);
  assert.deepEqual([byId.a.start, byId.a.end], [640, 730]);
  assert.deepEqual([byId.c.start, byId.c.end], [910, 950], "nothing slides past the fixed plan");
});
