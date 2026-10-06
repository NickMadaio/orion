// Spreading to-dos before they are due (2026-10-06).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpread, planSessions, minutesIn, taskImportance } from "../scripts/lib/life/task-spread.mjs";

const TUESDAY = "2026-10-06";

test("lengths in the ways he says them", () => {
  assert.equal(minutesIn("2 hours"), 120); assert.equal(minutesIn("2-hour"), 120);
  assert.equal(minutesIn("90 min"), 90); assert.equal(minutesIn("an hour and a half"), 90); assert.equal(minutesIn("1.5h"), 90);
});

test("2 hours a day until it's due: every day up to the day before", () => {
  const s = parseSpread("2 hours a day until it's due");
  assert.deepEqual(s, { kind: "daily", minutes: 120 });
  const plan = planSessions(s, { today: TUESDAY, due: "2026-10-09" });
  assert.deepEqual(plan.map((p) => p.date), ["2026-10-06", "2026-10-07", "2026-10-08"]);
  assert.ok(plan.every((p) => p.minutes === 120));
});

test("two 2-hour blocks, tuesday and thursday", () => {
  const s = parseSpread("two 2-hour blocks sometime in my week, tuesday and thursday");
  assert.equal(s.kind, "sessions");
  assert.deepEqual(planSessions(s, { today: TUESDAY, due: "2026-10-12" }), [{ date: "2026-10-06", minutes: 120 }, { date: "2026-10-08", minutes: 120 }]);
});

test("2 hours on tuesday, 2 hours on thursday", () => {
  const s = parseSpread("2 hours on tuesday, 2 hours on thursday");
  assert.deepEqual(s.sessions, [{ minutes: 120, weekday: 2 }, { minutes: 120, weekday: 4 }]);
});

test("four 1-hour blocks this week are spread across the rest of the week", () => {
  const plan = planSessions(parseSpread("four 1-hour blocks this week"), { today: TUESDAY, due: "2026-10-20" });
  assert.equal(plan.length, 4);
  assert.ok(plan.every((p) => p.minutes === 60 && p.date >= TUESDAY && p.date <= "2026-10-11"), JSON.stringify(plan));
});

test("a total is split into sessions of at most two hours", () => {
  const plan = planSessions(parseSpread("about 5 hours total"), { today: TUESDAY, due: "2026-10-10" });
  assert.equal(plan.reduce((s, p) => s + p.minutes, 0) >= 300, true);
  assert.ok(plan.every((p) => p.minutes <= 120));
});

test("a weekday after the due date is not booked", () => {
  const plan = planSessions(parseSpread("2 hours on friday"), { today: TUESDAY, due: "2026-10-08" });
  assert.deepEqual(plan, []);
});

test("a description without a plan gives no spread", () => {
  assert.equal(parseSpread("talk to Sam about the group part"), null);
  assert.equal(parseSpread(""), null);
});

test("priority and closeness decide how much it matters", () => {
  assert.equal(taskImportance({ priority: "high", due: "2026-10-20" }, TUESDAY), 0);
  assert.equal(taskImportance({ priority: "low", due: "2026-10-07" }, TUESDAY), 0);
  assert.equal(taskImportance({ priority: "low", due: "2026-10-20" }, TUESDAY), 2);
  assert.equal(taskImportance({ due: "2026-10-20" }, TUESDAY), 1);
});

test("his real notes: a to-do waits for another until that one is done", async () => {
  const { waitsFor } = await import("../scripts/lib/life/task-spread.mjs");
  const open = ["finish resume", "send internship applications", "do cert courses", "study for macro"];
  assert.equal(waitsFor('only schedule this once i have fully completed the "do cert courses" task.', open), "do cert courses");
  assert.equal(waitsFor('Dont schedule unless "finish resume" is completed', open), "finish resume");
  assert.equal(waitsFor('Dont schedule unless "finish resume" is completed', ["send internship applications"]), null, "done once it is no longer open");
  assert.equal(waitsFor("2.5 hours a day", open), null);
  assert.equal(waitsFor("finish it within the week, when i have extra time", open), null);
});
