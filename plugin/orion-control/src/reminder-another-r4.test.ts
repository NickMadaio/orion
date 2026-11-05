// w20 round 4: "another one in N min" after a reminder, and cancelling by description with trailing words.
import { describe, expect, it } from "vitest";
import { isAnotherReminder, planReminder } from "./reminder-flow.js";
import { readLedgerAsk } from "./ledger-ask.js";
import { parseWake } from "./wake-flow.js";

const NOW = new Date(2026, 10, 5, 14, 0);
describe("a second reminder, asked with no verb", () => {
  it.each([
    "and another in 15 mins to drink water", "another in 20 min to stretch", "also another at 5pm to call mum", "one more in an hour to check the oven",
    "and a second one in 10 mins for tea", "another one at 6 to eat",
  ])("%s", (said) => { expect(isAnotherReminder(said)).toBe(true); });
  it("is not one without a time, or when it is a different ask", () => {
    for (const s of ["another coffee", "add another block at 5pm", "remind me again", "i need another hour of sleep"]) expect(isAnotherReminder(s)).toBe(false);
  });
  it("plans a new alarm_set, never a correction of the last one", async () => {
    const plan = await planReminder({ message: "and another in 15 mins to drink water", now: NOW, extract: async () => ({ time: null, label: "drink water" }), list: async () => [], last: { label: "ring the dentist", at: "2026-11-05T15:00" } });
    expect(plan?.kind).toBe("call");
    expect(plan && "args" in plan ? plan.args : "").toContain('"label":"drink water"');
    expect(plan && "args" in plan ? plan.args : "").not.toContain("reminder_cancel");
  });
});
describe("cancel by description", () => {
  it.each([
    ["ditch the water reminder as well", ["water"]], ["kill the water reminder too", ["water"]], ["scrap the dentist reminder also", ["dentist"]], ["delete the stretch reminder please", ["stretch"]],
  ])("%s", (said, words) => { expect(readLedgerAsk(said)?.targets).toEqual([words]); });
});
describe("a bedtime reset never reaches orion-wake", () => {
  it.each(["stop using a fixed bedtime, go back to working it out from my alarm", "go back to working it out from my alarm", "reset my bedtime"])("%s", (said) => {
    expect(parseWake(said, { move: "tool", tool: "wake", args: { at: "07:45" } }, NOW)).toBeNull();
  });
});
