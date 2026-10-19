// 2026-10-19 live audit, item 5: the day review goes at 22:00 (or 60 min before bed if earlier), never after midnight, about the
// day that is ending, spoken at home / texted otherwise, exempt from the low-value budget, and never sent next morning.
// Incident: bed-minus-30 (23:32 on 10-16, dropped by the ceiling on 10-17, sent at 00:01 on 10-19 describing the new day).
import test from "node:test";
import assert from "node:assert/strict";
import { reviewMinute, reviewDue, bedOnEvening } from "../scripts/lib/reach/review-time.mjs";
import { world, at } from "./incident-world.mjs";

const m = (h, mi = 0) => h * 60 + mi;
const reviewRows = (w) => w.outreach().filter((r) => /^curiosity: review-/.test(r.why ?? ""));
const cal = (iso) => [{ identifier: "cs", title: "CS2100", start: iso(9, 0), end: iso(10, 30) }];

test("5: 22:00, or 60 minutes before bedtime if that is earlier, and never at or after midnight", () => {
  assert.equal(reviewMinute({ bedtime: "23:45" }), m(22));
  assert.equal(reviewMinute({ bedtime: "22:30" }), m(21, 30));
  assert.equal(reviewMinute({ bedtime: "00:30" }), m(22), "a 00:30 bed is 1470 on the evening's clock, so 22:00 stands");
  assert.equal(reviewMinute({ bedtime: "00:00" }), m(22));
  assert.equal(bedOnEvening("00:30"), 1470);
  for (const bedtime of ["23:45", "21:00", "03:00", "12:00", "garbage"]) assert.ok(reviewMinute({ bedtime }) < 1440, bedtime);
  assert.equal(reviewMinute({ bedtime: "23:45", config: { reviewAt: "21:00" } }), m(21));
});

test("5: it is only due on the day it is about, from the review minute to midnight: a missed one is not sent at 00:01", () => {
  const due = (minute, date, today) => reviewDue({ minute, date, today, bedtime: "23:45" });
  assert.equal(due(m(21, 59), "2026-10-18", "2026-10-18"), false);
  assert.equal(due(m(22), "2026-10-18", "2026-10-18"), true);
  assert.equal(due(m(23, 59), "2026-10-18", "2026-10-18"), true);
  assert.equal(due(1, "2026-10-18", "2026-10-19"), false, "00:01 on 10-19: the review for 10-18 is over");
  assert.equal(due(m(22, 30), "2026-10-18", "2026-10-19"), false, "and next morning, nor the evening of the next day for the old date");
});

test("5: the tick sends the review once at 22:05 for the day that is ending, as a text with the Mac bubble when home is unknown", () => {
  const w = world({ day: 18, cal, awOver: { location: { state: "unknown", placeId: null, homeKnown: true } } });
  w.tick(21, 50);
  assert.equal(reviewRows(w).length, 0, "not before 22:00");
  const t = w.tick(22, 5);
  assert.equal(t.status, 0, t.stderr);
  const [row] = reviewRows(w);
  assert.equal(row.why, "curiosity: review-2026-10-18");
  assert.equal(row.channel, "phone", "home unknown: a text");
  assert.equal(row.tier, "protected");
  assert.ok(w.lines("open.log").some((l) => l.includes("orion://reach?id=")), "and the silent Mac bubble every phone send posts");
  w.tick(22, 10); w.tick(22, 40);
  assert.equal(reviewRows(w).length, 1, "once a night");
});

test("5: at the Mac at home it is spoken (mac, loud)", () => {
  const w = world({ day: 18, cal });   // home, Mac active
  w.tick(22, 5);
  const [row] = reviewRows(w);
  assert.equal(row.channel, "mac-voice"); assert.equal(row.loud, true);
});

test("5: missed (nothing at 22:00-23:59): at 00:30 and the next morning no review goes, and orion-day-review --send refuses the old date", () => {
  const w = world({ day: 18, cal });
  assert.equal(reviewRows(w).length, 0);
  for (const [d, h, mi] of [[19, 0, 1], [19, 0, 30], [19, 9, 15]]) w.tick(h, mi, undefined, [], d);
  assert.equal(reviewRows(w).length, 0, "yesterday's review is not sent the next morning");
  const r = w.run("orion-day-review", ["--send", "--date", "2026-10-18"], 0, 1, { d: 19 });
  assert.equal(r.status, 0); assert.match(r.stdout, /^Not sent: that review was for 2026-10-18/);
  assert.equal(reviewRows(w).length, 0);
});

test("5: the review describes the ending day: dated for it, with its own date", () => {
  const w = world({ day: 18, cal });
  const r = w.run("orion-day-review", ["--json"], 22, 5);
  const out = JSON.parse(r.stdout);
  assert.equal(out.date, "2026-10-18");
  assert.match(out.text, /unknown/, "a stretch nobody knows about is unknown, never nothing");
});

test("5: it is exempt from the low-value budget and the ceiling: 20 ladder messages used, the review still goes", () => {
  const w = world({ day: 18, cal, awOver: { location: { state: "unknown", placeId: null, homeKnown: true } } });
  w.appendOutreach(Array.from({ length: 22 }, (_, i) => ({ id: `r${i}`, at: at(18, 10, i * 5).toISOString(), text: `ping ${i}`, kind: "checkin", why: `plan: b${i % 8}`, channel: "phone", ask: { type: "mismatch", title: `task ${i % 8}` } })));
  w.tick(22, 5);
  const [row] = reviewRows(w);
  assert.ok(row, "the review was attempted");
  assert.equal(row.status, undefined, "not dropped");
  assert.equal(row.channel, "phone");
});
