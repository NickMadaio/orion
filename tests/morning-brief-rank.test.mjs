// 2026-11-04: the spoken brief said "finish resume has been first on my list 4 days running": due-soonest alone put the 11-day-stale item first.
import test from "node:test";
import assert from "node:assert/strict";
import { briefingTop, buildView } from "../scripts/lib/reach/morning.mjs";

const TODAY = "2030-11-04";
const day = (n) => new Date(Date.UTC(2030, 10, 4 + n, 12)).toISOString().slice(0, 10);
const TODOS = [
  { title: "finish resume", priority: "medium", dueDate: day(-11) },
  { title: "Student oyster card", priority: "medium", dueDate: null },
  { title: "DS Lab 05", priority: "medium", dueDate: day(-5), notes: "Tags: school" },
  { title: "GET A GP", priority: "high", dueDate: day(-2) },
  { title: "CS Lab", priority: "high", dueDate: null, notes: "Tags: school" },
];

test("the brief's head is the most urgent to-do, not the stalest", () => {
  const top = briefingTop({ todos: TODOS, headHistory: [], today: TODAY });
  assert.equal(top.head.title, "GET A GP");
  assert.equal(top.text, "First on my list: GET A GP.");
});

test("a streak is still said when the same urgent item keeps leading", () => {
  const history = [{ date: day(-1), head: "get a gp" }, { date: day(-2), head: "get a gp" }];
  assert.match(briefingTop({ todos: TODOS, headHistory: history, today: TODAY }).text, /GET A GP has been first on my list 3 days running/);
});

test("the morning screen lists the three most urgent, in order", () => {
  const view = buildView({ now: new Date(2030, 10, 4, 8, 0), day: [], travel: [], todos: TODOS, today: TODAY });
  assert.deepEqual(view.top, ["GET A GP", "DS Lab 05", "CS Lab"]);
});
