import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findThirdPerson, toSecondPerson } from "../scripts/lib/remote/reply-person.mjs";

test("the 2026-10-01 reply", () => {
  const input = "His apps are locked until 7:15 AM—that's 7 hours away, which is past his bedtime.";
  const expected = "Your apps are locked until 7:15 AM—that's 7 hours away, which is past your bedtime.";
  assert.equal(toSecondPerson(input), expected);
});

test("verbs agree", () => {
  const input = "He needs sleep and he's got class at 9.";
  const expected = "You need sleep and you've got class at 9.";
  assert.equal(toSecondPerson(input), expected);
});

test("someone else's he is left alone", () => {
  const input = "Your dad called; he wants you to ring back.";
  assert.equal(toSecondPerson(input), input);
});

test("quotes are untouched", () => {
  const input = 'He said "he needs rest" and went to bed.';
  const expected = 'You said "he needs rest" and went to bed.';
  assert.equal(toSecondPerson(input), expected);
});

test("findThirdPerson lists phrases with indexes", () => {
  const input = "His phone is loud.";
  const results = findThirdPerson(input);
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  assert.equal(results[0].phrase, "His");
  assert.equal(results[0].index, 0);
});

test("no change when already second person", () => {
  const input = "You need sleep.";
  assert.equal(toSecondPerson(input), input);
});

test("invalid input throws", () => {
  assert.throws(() => findThirdPerson(null), TypeError);
  assert.throws(() => toSecondPerson(undefined), TypeError);
  assert.throws(() => findThirdPerson(123), TypeError);
  assert.throws(() => toSecondPerson({}), TypeError);
});
