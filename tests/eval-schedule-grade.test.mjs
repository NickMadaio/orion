// The schedule grader: today's real failure must fail it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeSchedule } from "../scripts/lib/eval/schedule-grade.mjs";

const before = [
  { title: "DS lab", start: 738, end: 828 }, { title: "Nap", start: 908, end: 953 }, { title: "Study", start: 963, end: 1023 },
  { title: "finish resume", start: 1243, end: 1333 },
];

test("1 October's second DS lab, dropped work and overlap all fail", () => {
  const after = [
    { title: "DS lab", start: 738, end: 828 }, { title: "nap", start: 900, end: 975 }, { title: "study", start: 975, end: 1035 },
    { title: "DS lab", start: 1045, end: 1165 }, { title: "study", start: 1000, end: 1030 },
  ];
  const g = gradeSchedule({ after, before, now: 862, expect: { count: { "DS lab": 1 } }, reply: "Done. (Noted: naps locked.)" });
  assert.equal(g.ok, false);
  assert.ok(g.failures.some((f) => f.startsWith("duplicate")));
  assert.ok(g.failures.some((f) => f.startsWith("count")));
  assert.ok(g.failures.some((f) => f.startsWith("overlap")));
  assert.ok(g.failures.some((f) => f === "lost: finish resume"));
  assert.ok(g.failures.some((f) => f.includes("noted")));
});

test("the right outcome passes", () => {
  const after = [
    { title: "DS lab", start: 738, end: 900 }, { title: "Nap", start: 910, end: 985 }, { title: "Study", start: 995, end: 1055 },
    { title: "finish resume", start: 1243, end: 1333 },
  ];
  const g = gradeSchedule({ after, before, now: 862, expect: { has: [{ title: "DS lab", end: "15:00" }], count: { "DS lab": 1 }, order: [["DS lab", "Nap"]], minutes: { Nap: 75 } }, reply: "Done — and saved: naps are always at least 1h15." });
  assert.deepEqual(g.failures, []);
});

test("a dropped block must be named and followed by a choice", () => {
  const after = before.filter(b => b.title !== "finish resume");
  assert.equal(gradeSchedule({ before, after, reply: "Finish resume no longer fits. Move it to tomorrow?" }).ok, true);
  for (const reply of ["Everything is done", "Finish resume no longer fits", "Something won't fit. Drop it?"]) {
    assert.equal(gradeSchedule({ before, after, reply }).ok, false);
  }
  assert.equal(gradeSchedule({ before, after, expect: { minutes: { "finish resume": 90 } }, reply: "Finish resume won't fit. Tomorrow?" }).ok, false);
});
test("quality criteria reject stacked breaks, waking breaks and afternoon dinner", () => {
  const after = [{ title: "Break", start: 440, end: 450 }, { title: "Second break", start: 460, end: 470 }, { title: "Dinner", start: 930, end: 975 }];
  const g = gradeSchedule({ before: [], after, expect: { breaks: { wake: "07:15" }, natural: [{ title: "Dinner", earliest: "18:30" }] } });
  assert.ok(g.failures.some(f => f.includes("stacked"))); assert.ok(g.failures.some(f => f.includes("waking"))); assert.ok(g.failures.some(f => f.includes("unnatural")));
});
