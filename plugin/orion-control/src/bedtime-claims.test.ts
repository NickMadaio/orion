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

describe("review r6: only a claimed CHANGE to the bedtime is dropped", () => {
  it.each([
    "Yes, your bedtime is set for 11:30 PM already, so you are on track.",
    "You set your bedtime to 11 yesterday and kept it.",
    "I changed your gym to 6, that leaves time before bedtime at 11.",
    "Your bedtime is set for 11:30 PM.",
    "Your bedtime is usually 11:30.",
    "I moved your gym to 7. Your bedtime stays at 11:30 PM.",
    "Gym ends at 10, so you have an hour before bedtime at 11.",
  ])("kept: %s", (said) => { expect(guard(said, none)).toBe(said); });
  it("drops only the bedtime sentence and keeps the gym one", () => {
    expect(guard("I moved your gym to 6. I set your bedtime to 11:30 PM tonight.", none)).toBe("I moved your gym to 6. " + BEDTIME_UNSAVED);
  });
  it("a claim is kept when the time it states is the bedtime the plan already holds", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "bc-"));
    writeFileSync(join(dir, "wake-plan.json"), JSON.stringify({ bedtimes: [{ date: "2026-11-05", sleepBy: "23:30" }] }));
    expect(guard("I set your bedtime to 11:30 PM tonight.", none, dir)).toBe("I set your bedtime to 11:30 PM tonight.");
    expect(guard("I set your bedtime to 11:45 PM tonight.", none, dir)).toBe(BEDTIME_UNSAVED);
  });
});
