import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlineKind, ramp } from "../scripts/lib/life/deadline-ramp.mjs";

const quiz = { id: "q1", title: "Macro (ECON1115) — Quiz 1", date: "2026-10-16" };
const total = (days) => days.reduce((a, d) => a + d.total, 0);

test("kinds from real titles", () => {
  assert.equal(deadlineKind("Macro (ECON1115) — Quiz 1"), "quiz");
  assert.equal(deadlineKind("DUE 13:00 — Marketing: Panopto presentation"), "presentation");
  assert.equal(deadlineKind("DUE 13:30 — Marketing (MKTG2201) submission"), "assignment");
  assert.equal(deadlineKind("Dentist"), "other");
});

test("a quiz ramps over the five days before it", () => {
  const days = ramp([quiz], { today: "2026-10-11" });
  assert.deepEqual(days.map((d) => d.date), ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  assert.deepEqual(days.map((d) => d.total), [30, 30, 45, 60, 75]);
  assert.equal(total(days), 240);
  assert.ok(!days.some((d) => d.date === "2026-10-16"));
});

test("studied time is subtracted", () => {
  assert.equal(total(ramp([quiz], { today: "2026-10-11", done: { q1: 180 } })), 60);
});

test("a finished deadline needs nothing", () => {
  assert.deepEqual(ramp([quiz], { today: "2026-10-11", done: { q1: 240 } }), []);
});

test("far deadlines wait for their window", () => {
  const days = ramp([quiz], { today: "2026-10-01", horizonDays: 14 });
  assert.equal(days[0].date, "2026-10-11");
  assert.equal(days.at(-1).date, "2026-10-14");
});

test("busy days are capped and spill earlier", () => {
  const exams = [{ id: "e1", title: "Macro final exam", date: "2026-10-20" }, { id: "e2", title: "Marketing exam", date: "2026-10-22" }];
  const days = ramp(exams, { today: "2026-10-08", maxPerDay: 180, horizonDays: 20 });
  assert.ok(days.every((d) => d.total <= 195), JSON.stringify(days.map((d) => d.total)));
  assert.equal(total(days), 1200);
});

test("past and out-of-horizon deadlines are ignored", () => {
  assert.deepEqual(ramp([{ id: "x", title: "Quiz", date: "2026-10-11" }], { today: "2026-10-11" }), []);
});

test("invalid input throws", () => {
  assert.throws(() => ramp([], {}), TypeError);
});
