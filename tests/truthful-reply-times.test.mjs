import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReplyTimes, mentions } from "../scripts/lib/remote/reply-times.mjs";

const booked = [{ title: "finish resume", start: 870, end: 960 }, { title: "send internship applications", start: 960, end: 1020 }];

test("the 30 September resume mismatch", () => {
  const r = checkReplyTimes("Resume at 4:00 PM, applications at 4", booked);
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatches, [{ title: "finish resume", said: 960, booked: 870 }]);
});

test("ranges match start and end", () => {
  assert.equal(checkReplyTimes("Resume 2:30–4 PM", booked).ok, true);
});

test("noon and midnight", () => {
  const m = mentions("Lunch at noon, asleep by midnight").map((x) => x.minute);
  assert.deepEqual(m, [720, 0]);
});

test("bare hour rules", () => {
  assert.deepEqual(mentions("gym at 9").map((x) => x.minute), [540]);
  assert.deepEqual(mentions("call at 3").map((x) => x.minute), [900]);
});

test("unmatched times are listed not failed", () => {
  const r = checkReplyTimes("Lab ends at 12:30", booked);
  assert.equal(r.ok, true);
  assert.deepEqual(r.unmatched, ["12:30"]);
});

test("no times is ok", () => {
  const r = checkReplyTimes("Added four tasks.", booked);
  assert.equal(r.ok, true);
  assert.deepEqual(r.mismatches, []);
});

test("invalid input throws", () => {
  assert.throws(() => checkReplyTimes(null, booked), TypeError);
  assert.throws(() => checkReplyTimes("x", null), TypeError);
});

test("the night of 30 September: dinner and gym read from their own clauses", () => {
  const day = [{ title: "gym", start: 1170, end: 1230 }, { title: "dinner", start: 1230, end: 1275 }, { title: "Wind down", start: 1410, end: 1440 }];
  const r = checkReplyTimes("After: dinner 7:30, gym 7:30–8:30, wind down 11:30 PM.", day);
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatches, [{ title: "dinner", said: 1170, booked: 1230 }]);
  assert.equal(checkReplyTimes("After soccer: gym 7:30–8:30, dinner 8:30, wind down 11:30 PM.", day).ok, true);
});
