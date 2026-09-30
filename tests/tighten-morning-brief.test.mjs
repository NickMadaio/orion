import { test } from "node:test";
import assert from "node:assert/strict";
import { clock12, morningBrief } from "../scripts/lib/life/morning-brief.mjs";

const now = { date: "2026-09-30", minute: 450 };
const classes = [
  { title: "CS1802 Seminar", kind: "class", start: 540, end: 630, fixed: true },
  { title: "CS2100 Lab", kind: "class", start: 660, end: 750, fixed: true },
];

test("a normal class day", () => {
  const { text } = morningBrief({ now, blocks: classes, deadlines: [], sleep: { hours: 7.5, recovery: 70 } });
  assert.ok(text.startsWith("CS1802 Seminar at 9:00 AM."), text);
  assert.ok(text.includes("2 things fixed, last ends 12:30 PM."), text);
});

test("a short night leads", () => {
  assert.equal(morningBrief({ now, blocks: classes, sleep: { hours: 4.5, recovery: null } }).parts[0], "Short night — 4.5h.");
});

test("low recovery when sleep was fine", () => {
  assert.equal(morningBrief({ now, blocks: classes, sleep: { hours: 7.2, recovery: 20 } }).parts[0], "Recovery's low (20%) — go easy.");
});

test("nearest deadline wording", () => {
  const { text } = morningBrief({ now, blocks: classes, deadlines: [{ title: "DUE 13:00 — Marketing: Panopto presentation", date: "2026-10-02" }] });
  assert.ok(text.includes("Marketing: Panopto presentation in 2 days."), text);
});

test("side project nudge uses the label", () => {
  assert.ok(morningBrief({ now, blocks: classes, sideProjectLabel: "London vlog" }).text.includes("London vlog hour isn't booked"));
});

test("no fixed events", () => {
  const { text } = morningBrief({ now, blocks: [] });
  assert.ok(text.includes("Nothing fixed today."));
  assert.ok(text.includes("after 1:00 PM"));
});

test("rain is mentioned only when likely", () => {
  assert.ok(morningBrief({ now, blocks: classes, weather: { summary: "rain", rainChance: 70 } }).text.includes("Rain likely — take a jacket."));
  assert.ok(!morningBrief({ now, blocks: classes, weather: { summary: "clear", rainChance: 20 } }).text.includes("Rain"));
});

test("long briefs drop the least important parts", () => {
  const long = "x".repeat(250);
  const { text } = morningBrief({ now, blocks: classes, deadlines: [{ title: long, date: "2026-10-01" }], weather: { summary: "rain", rainChance: 90 } });
  assert.ok(text.length <= 300);
  assert.ok(!text.includes("Rain likely"));
});

test("clock12 edges", () => {
  assert.equal(clock12(0), "12:00 AM");
  assert.equal(clock12(720), "12:00 PM");
  assert.equal(clock12(1439), "11:59 PM");
});

test("missing facts throw", () => {
  assert.throws(() => morningBrief({}), TypeError);
});
