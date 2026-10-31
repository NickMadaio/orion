import { test } from "node:test";
import assert from "node:assert/strict";
import { morningBrief, topOfList, itemKey } from "../scripts/lib/life/morning-brief.mjs";

const now = { date: "2026-09-30", minute: 450 };
const classes = [
  { title: "CS1802 Seminar", kind: "class", start: 540, end: 630, fixed: true },
  { title: "CS2100 Lab", kind: "class", start: 660, end: 750, fixed: true },
];
const cands = [{ title: "finish resume" }, { title: "Student oyster card" }];

test("the head is recomputed: a real deadline outranks an old to-do", () => {
  const t = topOfList({ now, candidates: [...cands, { title: "DUE 13:00 — Panopto presentation", due: "2026-10-01" }], history: [] });
  assert.equal(t.head.title, "Panopto presentation"); assert.equal(t.text, "First on my list: Panopto presentation.");
});
test("the same item heading a third day running says it keeps slipping and offers a choice", () => {
  const history = [{ date: "d1", head: itemKey("finish resume") }, { date: "d2", head: itemKey("finish resume") }];
  const t = topOfList({ now, candidates: cands, history });
  assert.equal(t.streak, 2);
  assert.match(t.text, /first on my list 3 days running/); assert.match(t.text, /this keeps slipping/); assert.match(t.text, /Give it a time today, or drop it\?/);
});
test("two days running is not yet a slip, and a different head resets the count", () => {
  assert.doesNotMatch(topOfList({ now, candidates: cands, history: [{ head: itemKey("finish resume") }] }).text, /slipping/);
  assert.equal(topOfList({ now, candidates: cands, history: [{ head: "x" }, { head: itemKey("finish resume") }] }).streak, 0);
});
test("waiting items and duplicates never head the list", () => {
  const t = topOfList({ now, candidates: [{ title: "a", waiting: true }, { title: "Resume" }, { title: "resume!" }], history: [] });
  assert.equal(t.head.title, "Resume");
});
test("duplicate deadlines are said once", () => {
  const d = { title: "DUE 13:00 — Marketing: Panopto presentation", date: "2026-09-30" };
  const { text } = morningBrief({ now, blocks: classes, deadlines: [d, { ...d, title: "Marketing: Panopto presentation" }] });
  assert.equal(text.match(/Panopto/g).length, 1, text);
  assert.ok(text.includes("Marketing: Panopto presentation is today."), text);
});
test("two different deadlines the same day are one sentence", () => {
  const { text } = morningBrief({ now, blocks: classes, deadlines: [{ title: "DUE 13:00 — Essay", date: "2026-09-30" }, { title: "DUE 17:00 — Quiz 2", date: "2026-09-30" }] });
  assert.ok(text.includes("Essay and Quiz 2 are due today."), text);
});
test("a deadline already said is not repeated as the head", () => {
  const { text, head } = morningBrief({ now, blocks: classes, deadlines: [{ title: "Essay", date: "2026-09-30" }], candidates: [{ title: "Essay", due: "2026-09-30" }] });
  assert.equal(text.match(/Essay/g).length, 1, text); assert.equal(head.key, "essay");
});
test("the brief carries the proposal, the gym and what sensors are missing, under the cap", () => {
  const r = morningBrief({ now, blocks: classes, sleep: { hours: 3.7, recovery: 1 }, proposal: "Proposal: nap after class. Say \"keep it\" to leave the day as it was.",
    gym: { start: 840, minutes: 45, easy: true }, sensorNotices: ["your phone hasn't reported since Monday - open ORION on it"], weather: { rainChance: 80 }, candidates: cands });
  assert.ok(r.text.startsWith("Short night — 3.7h. Proposal"), r.text);
  assert.ok(r.text.includes("Gym at 2:00 PM, 45 min, easy."), r.text);
  assert.ok(r.text.includes("Your phone hasn't reported since Monday"), r.text);
  assert.ok(r.text.length <= 420, r.text);
});
