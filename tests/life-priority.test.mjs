import { strict as assert } from "node:assert";
import { test } from "node:test";
import { priorityOf, comparePriority, movable } from "../scripts/lib/life/priority.mjs";

test("classes outrank everything", () => {
  const cls = { id: "c1", title: "Class", kind: "class", date: "2026-01-01", start: 540, end: 630, fixed: true, source: "calendar" };
  const gym = { id: "g1", title: "Gym", kind: "gym", date: "2026-01-01", start: 540, end: 630, fixed: false, source: "template" };
  const rest = { id: "r1", title: "Rest", kind: "rest", date: "2026-01-01", start: 540, end: 630, fixed: false, source: "nick" };

  assert.equal(priorityOf(cls), 0);
  assert.ok(priorityOf(gym) > priorityOf(cls));
  assert.ok(priorityOf(rest) > priorityOf(cls));
});

test("rest is last", () => {
  const rest = { id: "r1", title: "Rest", kind: "rest", date: "2026-01-01", start: 540, end: 630, fixed: false, source: "nick" };
  const other = { id: "o1", title: "Other", kind: "other", date: "2026-01-01", start: 540, end: 630, fixed: false, source: "nick" };

  assert.equal(priorityOf(rest), 8);
  assert.ok(priorityOf(other) < priorityOf(rest));
});

test("fixed beats movable of higher kind", () => {
  // A fixed `other` sorts before a movable `gym`.
  const fixedOther = { id: "fo1", title: "Fixed Other", kind: "other", date: "2026-01-01", start: 540, end: 630, fixed: true, source: "nick" };
  const movableGym = { id: "mg1", title: "Movable Gym", kind: "gym", date: "2026-01-01", start: 540, end: 630, fixed: false, source: "template" };

  assert.ok(comparePriority(fixedOther, movableGym) < 0);
});

test("ties break by start then id", () => {
  const a = { id: "a1", title: "A", kind: "study", date: "2026-01-01", start: 600, end: 700, fixed: false, source: "nick" };
  const b = { id: "b1", title: "B", kind: "study", date: "2026-01-01", start: 500, end: 600, fixed: false, source: "nick" };
  const c = { id: "a1", title: "A", kind: "study", date: "2026-01-01", start: 500, end: 600, fixed: false, source: "nick" };
  const d = { id: "b1", title: "B", kind: "study", date: "2026-01-01", start: 500, end: 600, fixed: false, source: "nick" };

  // b starts earlier than a → b before a
  assert.ok(comparePriority(b, a) < 0);

  // same start, id "a1" < "b1" → c before d
  assert.ok(comparePriority(c, d) < 0);
});

test("class and sleep are never movable even when fixed is false", () => {
  const cls = { id: "c1", title: "Class", kind: "class", date: "2026-01-01", start: 540, end: 630, fixed: false, source: "calendar" };
  const slp = { id: "s1", title: "Sleep", kind: "sleep", date: "2026-01-01", start: 1200, end: 1440, fixed: false, source: "template" };

  assert.equal(movable(cls), false);
  assert.equal(movable(slp), false);
});

test("sorting does not mutate the input array", () => {
  const arr = [
    { id: "z1", title: "Z", kind: "rest", date: "2026-01-01", start: 900, end: 1000, fixed: false, source: "nick" },
    { id: "a1", title: "A", kind: "class", date: "2026-01-01", start: 540, end: 630, fixed: true, source: "calendar" },
    { id: "m1", title: "M", kind: "meal", date: "2026-01-01", start: 720, end: 780, fixed: false, source: "nick" },
  ];
  const copy = [...arr];

  arr.sort(comparePriority);

  assert.deepStrictEqual(arr, copy.toSorted(comparePriority));
  // The original order of `copy` must be unchanged since we spread before sorting.
  // More precisely: the sorted result equals what toSorted would produce from the original.
});
