import { test } from "node:test";
import assert from "node:assert/strict";
import { planSweep, sweep } from "../scripts/lib/life/todo-lists.mjs";

const r = (identifier, title, list) => ({ identifier, title, list });
const lists = [
  r("a", "finish resume", "Orion"), r("b", "DS lab", "Orion"),
  r("c", "Finish resume", "Reminders"), r("d", "thinking fast and slow book", "Reminders"),
  r("e", "Cheese", "Groceries"), r("f", "insect repellent", "Family"),
];

test("the phone's list is swept onto the to-do list; groceries and family are left alone", () => {
  const steps = planSweep(lists, { todoList: "Orion", sweepLists: ["Reminders"] });
  assert.deepEqual(steps.map((s) => [s.op, s.identifier]), [["complete-duplicate", "c"], ["move", "d"]]);
});

test("two strays with the same title: the first moves, the second is a duplicate", () => {
  const steps = planSweep([r("x", "gym", "Reminders"), r("y", "Gym", "Reminders")], { todoList: "Orion", sweepLists: ["Reminders"] });
  assert.deepEqual(steps.map((s) => s.op), ["move", "complete-duplicate"]);
});

test("sweep carries the plan out through the bridge", async () => {
  const calls = [];
  const bridge = async (action, payload) => {
    calls.push([action, payload]);
    return action === "list_incomplete_reminders" ? { reminders_json: JSON.stringify(lists) } : {};
  };
  const lines = await sweep(bridge, { todoList: "Orion", sweepLists: ["Reminders"] });
  assert.deepEqual(calls.slice(1), [["complete_reminder", { identifier: "c" }], ["move_reminder", { identifier: "d", list: "Orion" }]]);
  assert.equal(lines.length, 2);
});
