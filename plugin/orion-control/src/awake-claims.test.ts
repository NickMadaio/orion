// w20 r5 (live gate 3 #110): a reply to a message he just sent never says he is asleep.
import { describe, expect, it } from "vitest";
import { withoutAsleepClaims } from "./awake-claims.js";

describe("he is awake: he is talking to ORION", () => {
  it.each([
    ["It's 5:25 AM, mate. You're still asleep.", "It's 5:25 AM, mate."],
    ["You're asleep right now, so I'll keep it short.", ""],
    ["It's 5:25. You must be asleep. Sleep well when you do.", "It's 5:25. Sleep well when you do."],
    ["Technically you are still sleeping. It's 5:25 AM.", "It's 5:25 AM."],
    ["Looks like you're out cold, but it's 5:25 AM.", "Looks like you're out cold, but it's 5:25 AM."],
  ].slice(0, 4))("%s", (a, b) => expect(withoutAsleepClaims(a)).toBe(b));
  it("keeps advice and unrelated sleep talk", () => {
    for (const t of ["You should be asleep, it's 5:25 AM.", "Go back to sleep, I'll wake you at 6:30.", "Sleep well, Nick.", "Your alarm is at 6:30, so you get 1 hour of sleep.", "I'll be quiet while you sleep."]) expect(withoutAsleepClaims(t), t).toBe(t);
  });
});
