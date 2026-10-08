// The everyday-distribution classifier: Nick's typical requests land in the job
// the V3 campaign tests them under (handoff §5.2 step 5, §6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobOf } from "../scripts/lib/eval/v3/jobs.mjs";

const cases = [
  ["redo my entire schedule, I'm out by four", "schedule"],
  ["move gym to 6", "schedule"],
  ["add finish resume to my to-dos", "todo"],
  ["remind me at 6:55 to call mom", "reminder"],
  ["wake me up at 7:30", "reminder"],
  ["start a focus session until 8", "focus"],
  ["turn the lights off", "lights"],
  ["when will it rain", "weather"],
  ["what time is it", "time"],
  ["what did I say about my resume in my notes", "brain"],
  ["what's next", "agenda"],
  ["how's it going", "chat"],
  ["Can you pretty please unblock my apps just until 12:45", "phone-lock"],
  ["20 more minutes of phone use please", "phone-lock"],
  ["Combine the magnesium zinc and calcium one into one item", "health"],
  ["Pause music", "media"],
  ["Open Orion on my mac", "app"],
  ["Wait. What is it gonna be, like, a high today?", "weather"],
];

for (const [text, job] of cases) test(`"${text}" → ${job}`, () => assert.equal(jobOf(text), job));

test("empty or unclear text is 'other', never a guess", () => {
  assert.equal(jobOf(""), "other");
  assert.equal(jobOf("like"), "other");
});

test("a cut-off continuation or a quick short follow-up takes the previous turn's job", () => {
  assert.equal(jobOf("(Continuing — my last message was cut off mid-sentence; this is the rest of it.) by four", "schedule"), "schedule");
  assert.equal(jobOf("Until eight PM.", "focus"), "focus");
  assert.equal(jobOf("Until eight PM."), "other");
  assert.equal(jobOf("turn the lights off", "schedule"), "lights");
});
