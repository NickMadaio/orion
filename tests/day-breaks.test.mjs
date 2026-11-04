// 2026-11-04: "He also doesn't give me a single break." Six blocks back to back from 13:20 to 20:15, no lunch.
import test from "node:test";
import assert from "node:assert/strict";
import { planRests, breakSettings, BREAK_DEFAULTS, longestWorkRun } from "../scripts/lib/life/day-breaks.mjs";

const m = (h, mm = 0) => h * 60 + mm;
const blk = (id, title, start, end, extra = {}) => ({ id, title, kind: "study", start, end, fixed: false, source: "orion", ...extra });
const cls = (id, title, start, end) => ({ id, title, kind: "class", start, end, fixed: true });
const WINDOW = { start: m(6), end: m(23, 30) };
const S = breakSettings({});

const packed = [
  cls("c1", "CS1802", m(9), m(10, 30)), cls("c2", "CS2100", m(11), m(12, 30)),
  blk("a", "GET A GP", m(12, 35), m(13, 20)), blk("b", "DS Lab 05", m(13, 25), m(14, 10)),
  blk("c", "CS Lab", m(14, 15), m(15, 15)), blk("d", "finish resume", m(15, 20), m(16, 20)),
  blk("e", "Orion learning plan", m(16, 25), m(17, 25)),
];

test("defaults are sensible and configurable", () => {
  assert.equal(BREAK_DEFAULTS.breakMinutes, 15);
  assert.equal(BREAK_DEFAULTS.maxWorkMinutes, 120);
  const custom = breakSettings({ planBreaks: { breakMinutes: 10, lunch: { minutes: 30 } } });
  assert.equal(custom.breakMinutes, 10);
  assert.equal(custom.lunch.minutes, 30);
  assert.equal(custom.lunch.from, "12:00", "unset fields keep their default");
  assert.equal(breakSettings({ planBreaks: { enabled: false } }).enabled, false);
});

test("a packed afternoon gets a lunch and breaks, and no stretch of work passes two hours", () => {
  const r = planRests(packed, { window: WINDOW, now: m(8), settings: S, buffer: 5 });
  const titles = r.blocks.map((b) => b.title);
  assert.ok(titles.includes("Lunch"), "lunch");
  assert.ok(r.added.filter((b) => b.title === "Break").length >= 2, "breaks");
  assert.ok(longestWorkRun(r.blocks) <= 120, `longest run ${longestWorkRun(r.blocks)}`);
  assert.ok(longestWorkRun(packed) > 120, "the input really was too long");
  const sorted = [...r.blocks].sort((a, b) => a.start - b.start);
  sorted.slice(1).forEach((b, i) => assert.ok(b.start >= sorted[i].end, `${sorted[i].title} overlaps ${b.title}`));
  for (const c of r.blocks.filter((b) => b.kind === "class")) assert.equal(c.start, packed.find((p) => p.id === c.id).start, "classes never move");
});

test("breaks are 10 to 15 minutes, visible blocks marked as ORION's own", () => {
  const r = planRests(packed, { window: WINDOW, now: m(8), settings: S, buffer: 5 });
  for (const b of r.added.filter((x) => x.title === "Break")) {
    assert.ok(b.end - b.start >= 10 && b.end - b.start <= 15, `${b.end - b.start}`);
    assert.equal(b.kind, "rest");
    assert.equal(b.source, "orion");
    assert.ok(b.tags.includes("autobreak"));
  }
});

test("lunch lands in the lunch window; dinner in the dinner window when the evening is free", () => {
  const r = planRests([...packed, blk("f", "Study", m(17, 30), m(18, 15))], { window: WINDOW, now: m(8), settings: S, buffer: 5 });
  const lunch = r.blocks.find((b) => b.title === "Lunch");
  assert.ok(lunch.start >= m(12) && lunch.end <= m(14, 30));
  assert.equal(lunch.end - lunch.start, 45);
  const dinner = r.blocks.find((b) => b.title === "Dinner");
  assert.ok(dinner.start >= m(18) && dinner.end <= m(20, 30));
});

test("an existing meal is not doubled", () => {
  const r = planRests([...packed.filter((b) => b.id !== "a"), blk("l", "Lunch", m(12, 35), m(13, 20), { kind: "meal" })], { window: WINDOW, now: m(8), settings: S, buffer: 5 });
  assert.equal(r.blocks.filter((b) => b.kind === "meal" && /lunch/i.test(b.title)).length, 1);
  assert.equal(r.added.some((b) => b.title === "Lunch"), false);
});

test("a window that has already passed gets no meal; nothing before now moves", () => {
  const r = planRests(packed, { window: WINDOW, now: m(15), settings: S, buffer: 5 });
  assert.equal(r.blocks.some((b) => b.title === "Lunch"), false);
  for (const b of packed.filter((p) => p.start < m(15))) assert.equal(r.blocks.find((x) => x.id === b.id).start, b.start);
});

test("a fixed wall stops a shift: the break is skipped and said, never an overlap", () => {
  const tight = [blk("a", "one", m(9), m(10, 30)), blk("b", "two", m(10, 35), m(11, 30)), cls("w", "CS2100", m(11, 32), m(13)), blk("c", "three", m(13, 5), m(14))];
  const r = planRests(tight, { window: WINDOW, now: m(8), settings: { ...S, lunch: { ...S.lunch, from: "23:00", to: "23:30" } }, buffer: 5 });
  const sorted = [...r.blocks].sort((a, b) => a.start - b.start);
  sorted.slice(1).forEach((b, i) => assert.ok(b.start >= sorted[i].end));
  assert.ok(r.unsatisfied.length >= 1);
});

test("a visible transition before a class when ORION work runs up to it", () => {
  const r = planRests([blk("a", "Study", m(9), m(9, 45)), cls("c", "CS2100", m(10), m(11, 30))], { window: WINDOW, now: m(8), settings: { ...S, lunch: { ...S.lunch, from: "23:00", to: "23:30" } }, buffer: 5 });
  const t = r.added.find((b) => /transition/i.test(b.title));
  assert.ok(t, "transition block");
  assert.equal(t.end, m(10));
});

test("disabled settings change nothing", () => {
  const r = planRests(packed, { window: WINDOW, now: m(8), settings: { ...S, enabled: false }, buffer: 5 });
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.shifts, []);
});

test("input blocks are not mutated", () => {
  const copy = JSON.stringify(packed);
  planRests(packed, { window: WINDOW, now: m(8), settings: S, buffer: 5 });
  assert.equal(JSON.stringify(packed), copy);
});
