// The morning brief lists today's reminders (w19-reminders).
process.env.TZ = "Europe/London";
import test from "node:test";
import assert from "node:assert/strict";
import { composeBriefing, remindersLine } from "../scripts/lib/reach/morning.mjs";

const now = new Date(2026, 10, 4, 8, 0);
const at = (h, m = 0) => new Date(2026, 10, 4, h, m).getTime();
const base = { now, day: [], today: "2026-11-04", weather: undefined, calendar: "ok" };

test("a line for today's reminders, in time order, with am/pm", () => {
  assert.equal(remindersLine([{ label: "gym bag", dueAt: at(17, 30) }, { label: "call mom", dueAt: at(10) }]),
    "Reminders today: call mom at 10 AM and gym bag at 5:30 PM.");
});

test("a place reminder and a long list are said briefly", () => {
  assert.equal(remindersLine([{ label: "water plants", place: "home", dueAt: at(23) }]), "Reminders today: water plants when you get home.");
  const many = ["a", "b", "c", "d", "e", "f"].map((l, i) => ({ label: `task ${l}`, dueAt: at(9 + i) }));
  assert.match(remindersLine(many), /and 2 more\.$/);
});

test("no reminders, no line", () => {
  assert.equal(remindersLine([]), null);
  assert.equal(remindersLine(undefined), null);
});

test("the brief carries the line before it asks what to change", () => {
  const text = composeBriefing({ ...base, reminders: [{ label: "call mom", dueAt: at(17) }] });
  assert.match(text, /Reminders today: call mom at 5 PM\. .*Anything you want to change\?$/);
  assert.doesNotMatch(composeBriefing(base), /Reminders today/);
});
