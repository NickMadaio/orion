import { describe, expect, it } from "vitest";
import { BEDTIME_UNSAVED, withoutUnverifiedBedtimeClaims as guard } from "./bedtime-claims.js";

const none: Array<{ canonical: string }> = [];
describe("a bedtime change claimed with no sleep-plan write is dropped", () => {
  it.each([
    "Bedtime tonight only is 11:50 PM.", "Set bedtime to 11:30 PM tonight.", "Saved: your bedtime is half 11 every night now.", "I've moved your bedtime to midnight.",
    "Done, bedtime is now 11:45.", "Your bedtime is changed to 11 PM tonight.", "Okay, I pushed your bedtime to quarter to 12.",
  ])("%s", (said) => { expect(guard(said, none)).toBe(BEDTIME_UNSAVED); });
  it("keeps the rest of the reply", () => {
    expect(guard("Got it. Set bedtime to 11:30 PM tonight. Sleep well.", none)).toBe("Got it. Sleep well. " + BEDTIME_UNSAVED);
  });
});
describe("kept", () => {
  it("when orion-sleepplan wrote this turn", () => {
    expect(guard("Bedtime 11:50pm tonight.", [{ canonical: "exec orion-sleepplan bedtime 23:50 --tonight --json" }])).toBe("Bedtime 11:50pm tonight.");
  });
  it.each(["Want me to set your bedtime to 11:30?", "Your bedtime is usually around 11.", "What time should I set your bedtime to?", "Bedtime is a good time to put your phone down."])("%s", (said) => {
    expect(guard(said, none)).toBe(said);
  });
});
