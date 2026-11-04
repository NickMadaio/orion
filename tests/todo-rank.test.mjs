// 2026-11-04: "finish resume" led every day over high-priority and coursework items. Fixture: his real list, as it stood that morning.
import test from "node:test";
import assert from "node:assert/strict";
import { rankTodos, firstBecause, behindBecause } from "../scripts/lib/life/todo-rank.mjs";

const TODAY = "2030-11-04";
const day = (n) => { const d = new Date(Date.UTC(2030, 10, 4 + n, 12)); return d.toISOString().slice(0, 10); };
const LIST = [
  { title: "finish resume", priority: "medium", dueDate: day(-11), notes: "Tags: internship" },
  { title: "Student oyster card", priority: "medium", notes: "Tags: misc" },
  { title: "DS Lab 05", priority: "medium", dueDate: day(-5), notes: "Tags: school" },
  { title: "CS Lab", priority: "high", notes: "Tags: school" },
  { title: "GET A GP", priority: "high", dueDate: day(-2), notes: "Tags: misc" },
  { title: "New CS Lab", priority: "medium", dueDate: day(5), notes: "Tags: school" },
  { title: "practice leetcode", priority: "low", notes: "Tags: internship" },
];
const titles = (l) => l.map((t) => t.title);

test("a medium, no-coursework, 11-days-stale resume is never first, and never ahead of due coursework or high priority", () => {
  const ranked = rankTodos(LIST, { today: TODAY });
  assert.notEqual(ranked[0].title, "finish resume");
  const at = (t) => titles(ranked).indexOf(t);
  for (const ahead of ["GET A GP", "DS Lab 05", "CS Lab"]) assert.ok(at(ahead) < at("finish resume"), `${ahead} before resume`);
  assert.ok(at("finish resume") < at("practice leetcode"));
});

test("staleness is not urgency: days overdue do not change the score", () => {
  const a = rankTodos([{ title: "x thing", priority: "medium", dueDate: day(-1) }], { today: TODAY })[0];
  const b = rankTodos([{ title: "x thing", priority: "medium", dueDate: day(-30) }], { today: TODAY })[0];
  assert.equal(a.score, b.score);
});

test("due tonight beats a high-priority item with no date; due-today reason says tonight", () => {
  const ranked = rankTodos([{ title: "tidy desk", priority: "high" }, { title: "AE1 slides", priority: "medium", dueDate: day(0), dueMinute: 23 * 60 + 59 }], { today: TODAY });
  assert.equal(ranked[0].title, "AE1 slides");
  assert.match(firstBecause(ranked), /^AE1 slides is first because it's due tonight/);
});

test("a calendar deadline that names the to-do counts as its due date", () => {
  const ranked = rankTodos([{ title: "read chapter", priority: "medium" }, { title: "marketing report", priority: "medium" }], { today: TODAY, deadlines: [{ title: "marketing report", date: day(1) }] });
  assert.equal(ranked[0].title, "marketing report");
  assert.match(ranked[0].reason, /due tomorrow/);
});

test("explanations: first, and why one sits behind another", () => {
  const ranked = rankTodos(LIST, { today: TODAY });
  assert.match(firstBecause(ranked), /GET A GP is first because it's overdue since .* and high priority\./);
  const resume = ranked.find((r) => r.title === "finish resume");
  assert.match(behindBecause(ranked, resume), /finish resume is behind .* because it's only overdue since/);
});

test("rankTodos does not mutate its input", () => {
  const copy = JSON.stringify(LIST);
  rankTodos(LIST, { today: TODAY });
  assert.equal(JSON.stringify(LIST), copy);
});
