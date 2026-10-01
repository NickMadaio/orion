// Nick's real day, 2026-09-30. Soccer 5-7 was added to a day ORION had already
// filled; every attempt after that overlapped, refused ("did not fit") or laid
// the day out in the wrong order (gym at 1 PM before soccer, dinner at 3:18).
import { test } from "node:test";
import assert from "node:assert/strict";
import { replan } from "../scripts/lib/life/replan.mjs";

const b = (id, kind, start, end, fixed = false, title = id) => ({ id, title, kind, date: "2026-09-30", start, end, fixed, source: fixed ? "calendar" : "orion" });
const win = { start: 480, end: 1440 };
const at = (h, m = 0) => h * 60 + m;
const noOverlaps = (blocks) => blocks.every((x, i) => blocks.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end)));
const byTitle = (r, t) => r.blocks.find((x) => x.title.toLowerCase() === t.toLowerCase());

// The day ORION booked that morning.
const morning = () => [
  b("sem", "class", at(9), at(10, 30), true, "CS1802 Seminar"),
  b("lab", "class", at(11), at(12, 30), true, "CS2100 Lab"),
  b("nap", "rest", at(13), at(14), false, "Nap"),
  b("orion", "other", at(14), at(15), false, "fix Orion stuff"),
  b("resume", "other", at(15), at(16, 30), false, "finish resume"),
  b("apps", "other", at(16, 30), at(18), false, "send internship applications"),
  b("gym", "gym", at(18), at(19), false, "Gym"),
  b("dinner", "meal", at(19), at(19, 45), false, "Dinner"),
  b("side", "side_project", at(19, 45), at(20, 45), false, "Side project (YouTube)"),
  b("study", "study", at(21), at(22), false, "study (if there's time)"),
];

test("his stated times are kept exactly, in the order he said them", () => {
  // "I get back 1. Nap 90 so 2:30. Internship stuff 90 so 4. Snack 30. Leave for
  //  soccer 4:30. Back 7:30, small dinner. Around 8 I work out." — on a clear day.
  const day = morning().filter((x) => x.fixed);
  const r = replan(day, { now: at(11, 14), window: win, rebuild: true, add: [
    { title: "Nap", kind: "rest", minutes: 90, at: at(13) },
    { title: "Application progress", kind: "other", minutes: 90, at: at(14, 30) },
    { title: "Snack", kind: "meal", minutes: 30, at: at(16) },
    { title: "Soccer practice", kind: "other", minutes: 150, at: at(16, 30), fixed: true },
    { title: "Dinner", kind: "meal", minutes: 30, at: at(19, 30) },
    { title: "Gym", kind: "gym", minutes: 60, at: at(20) },
  ] });
  assert.deepEqual(r.unplaced, []);
  for (const [t, s] of [["Nap", at(13)], ["Application progress", at(14, 30)], ["Snack", at(16)], ["Soccer practice", at(16, 30)], ["Dinner", at(19, 30)], ["Gym", at(20)]])
    assert.equal(byTitle(r, t).start, s, `${t} where he said`);
  assert.ok(noOverlaps(r.blocks));
});

test("his times push ORION's own blocks out of the way instead of being refused", () => {
  // The same timeline, but over the morning's plan still on the calendar.
  const r = replan(morning(), { now: at(11, 14), window: win, add: [
    { title: "Nap", kind: "rest", minutes: 90, at: at(13) },
    { title: "Application progress", kind: "other", minutes: 90, at: at(14, 30) },
    { title: "Soccer practice", kind: "other", minutes: 120, at: at(17), fixed: true },
    { title: "Gym", kind: "gym", minutes: 60, at: at(20) },
  ] });
  for (const [t, s] of [["Application progress", at(14, 30)], ["Soccer practice", at(17)]])
    assert.equal(r.created.find((x) => x.title === t).start, s, `${t} where he said`);
  assert.equal(r.created.find((x) => x.title === "Nap").start, at(13));
  assert.equal(r.created.find((x) => x.title === "Gym").start, at(20));
  assert.ok(noOverlaps(r.blocks), "nothing overlaps");
});

test("a rebuild keeps the day in time order, never gym before soccer", () => {
  // 13:18: "Add my new nap, resume work (before soccer) and dinner and then gym
  // (after soccer)". Listed order is the order he wants; untimed items follow
  // the timed item listed before them.
  const day = [b("soccer", "other", at(17), at(19), true, "Soccer practice")];
  const r = replan(day, { now: at(13, 18), window: win, rebuild: true, add: [
    { title: "Nap", kind: "rest", minutes: 45, before: at(15, 30) },
    { title: "Resume work", kind: "other", minutes: 60, at: at(15, 30), before: at(17) },
    { title: "Dinner", kind: "meal", minutes: 30, after: at(19) },
    { title: "Gym", kind: "gym", minutes: 60, after: at(19) },
  ] });
  assert.deepEqual(r.unplaced, []);
  const order = r.blocks.map((x) => x.title);
  assert.deepEqual(order, ["Nap", "Resume work", "Soccer practice", "Dinner", "Gym"]);
  assert.ok(byTitle(r, "Dinner").start >= at(19) && byTitle(r, "Gym").start >= byTitle(r, "Dinner").end);
});

test("when not everything fits, the least important goes, and the rest keep their order", () => {
  const day = [b("soccer", "other", at(17), at(19), true, "Soccer practice")];
  const r = replan(day, { now: at(15), window: { start: at(15), end: at(21) }, rebuild: true, add: [
    { title: "Resume work", kind: "other", minutes: 90, importance: 0 },
    { title: "Side project", kind: "side_project", minutes: 60, importance: 2 },
    { title: "Dinner", kind: "meal", minutes: 30, after: at(19) },
    { title: "Gym", kind: "gym", minutes: 60, after: at(19) },
  ] });
  assert.deepEqual(r.unplaced.map((u) => u.title), ["Side project"]);
  assert.deepEqual(r.blocks.map((x) => x.title), ["Resume work", "Soccer practice", "Dinner", "Gym"]);
});

test("a stated time that collides with something fixed moves just past it and says so", () => {
  const day = [b("soccer", "other", at(17), at(19), true, "Soccer practice")];
  const r = replan(day, { now: at(12), window: win, add: [{ title: "Gym", kind: "gym", minutes: 60, at: at(18) }] });
  const gym = r.created.find((x) => x.title === "Gym");
  assert.equal(gym.start, at(19));
  assert.equal(r.shifted[0].title, "Gym");
  assert.equal(r.shifted[0].from, at(18));
  assert.equal(r.shifted[0].because, "Soccer practice");
});

test("a time that cannot be kept never bumps his other blocks", () => {
  // 2026-09-30 eval: "resume work before soccer" at 16:00 collided with soccer at
  // 16:30, was moved to 18:30, and pushed "internship stuff" to 21:15.
  const day = [b("soccer", "other", at(16, 30), at(18, 30), true, "Soccer practice"),
    b("intern", "other", at(18, 30), at(19, 30), false, "internship stuff"), b("dinner", "meal", at(19, 30), at(20, 15))];
  const r = replan(day, { now: at(12), window: win, add: [{ title: "Resume work", kind: "other", minutes: 60, at: at(16) }] });
  assert.equal(r.blocks.find((x) => x.id === "intern").start, at(18, 30), "internship stays");
  assert.deepEqual(r.moves, []);
  const resume = r.created.find((x) => x.title === "Resume work");
  assert.ok(resume.start >= at(20, 15), "resume goes into free time");
  assert.equal(r.shifted[0].to, resume.start);
});

test("before means before, or not at all", () => {
  const day = [b("nap", "rest", at(15), at(16), false, "Nap"), b("soccer", "other", at(16, 30), at(18, 30), true, "Soccer practice")];
  const r = replan(day, { now: at(12), window: { start: at(15), end: at(23) }, add: [
    { title: "Resume work", kind: "other", minutes: 60, before: at(16, 30) }] });
  assert.equal(r.unplaced[0].title, "Resume work");
  assert.equal(r.blocks.find((x) => x.id === "nap").start, at(15), "the nap is not moved to make room");
});

test("his stated time wins over ORION's commute guess; the guess still guards everything else", () => {
  // "I get back at 2 after the workshop … nap 60 so 3": the nap went to 8:15 PM
  // because ORION had reserved 2:00-2:30 for the trip home.
  const day = [b("ws", "class", at(12), at(14), true, "Workshop")];
  const commute = [{ start: at(14), end: at(14, 30), title: "commute home" }];
  const r = replan(day, { now: at(10), window: win, soft: commute, add: [
    { title: "Nap", kind: "rest", minutes: 60, at: at(14) },
    { title: "Reading", kind: "rest", minutes: 30, after: at(14) },
  ] });
  assert.equal(r.created.find((x) => x.title === "Nap").start, at(14));
  assert.ok(r.created.find((x) => x.title === "Reading").start >= at(15));
  const r2 = replan(day, { now: at(10), window: win, soft: commute, add: [{ title: "Reading", kind: "rest", minutes: 30, after: at(14) }] });
  assert.equal(r2.created[0].start, at(14, 30), "flexible work still waits for the trip home");
});

test("blocks get a gap between them, not back to back (2026-10-01: 'things are smooshed')", () => {
  const day = [b("lab", "class", at(9), at(10, 30), true, "CS1800 Lecture")];
  const r = replan(day, { now: at(8), window: { start: at(8), end: at(24) }, buffer: 10, add: [
    { title: "DS lab", kind: "study", minutes: 90, after: at(11) },
    { title: "Side project", kind: "side_project", minutes: 60, after: at(11) },
    { title: "Study", kind: "study", minutes: 60, after: at(11) },
  ] });
  const placed = r.blocks.filter((x) => !x.fixed).sort((a, b) => a.start - b.start);
  for (let i = 1; i < placed.length; i++) assert.ok(placed[i].start - placed[i - 1].end >= 10, `${placed[i - 1].title} → ${placed[i].title}`);
});

test("a full day keeps free time by dropping the optional thing first", () => {
  const day = [b("w", "class", at(9), at(17), true, "All day")];
  // Free: 8–9 and 17–20 (240 min). Resume + dinner leave 105; study would leave 45 < 60.
  const r = replan(day, { now: at(8), window: { start: at(8), end: at(20) }, keepFree: 60, rebuild: true, add: [
    { title: "finish resume", kind: "other", minutes: 90, importance: 1 },
    { title: "study (if there's time)", kind: "study", minutes: 60, importance: 2 },
    { title: "Dinner", kind: "meal", minutes: 45, importance: 1 },
  ] });
  assert.deepEqual(r.unplaced.map((u) => u.title), ["study (if there's time)"]);
});
