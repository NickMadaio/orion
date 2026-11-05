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
        "and again in 15 mins to drink water", "again in 20 min to stretch", "once more in an hour to check the oven", "and then again at 5pm to call mum", "same again in 10 mins to drink water",
    ])("%s", (said) => { expect(isAnotherReminder(said)).toBe(true); });
    it("is not one without a time, or when it is a different ask", () => {
        for (const s of ["another coffee", "add another block at 5pm", "remind me again", "i need another hour of sleep", "again", "ill try again at 5 if it fails"])
            expect(isAnotherReminder(s)).toBe(false);
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
describe("w20 r6 #17: ping, nudge and buzz are reminders", () => {
    it.each([
        ["scrap the water ping", ["water"]], ["ditch the water nudge", ["water"]], ["kill the water buzz", ["water"]], ["delete the dentist ping", ["dentist"]], ["cancel the stretch nudge please", ["stretch"]], ["get rid of the oven buzzer", ["oven"]],
    ])("%s", (said, words) => {
        const ask = readLedgerAsk(said);
        expect(ask?.targets).toEqual([words]);
        expect(ask?.kinds).toContain("reminder");
    });
});
describe("w20 r6 #60: the reply talks to him, so his words flip person", () => {
    const plan = async (message, label, time = "07:00") => {
        const p = await planReminder({ message, now: new Date(2026, 10, 5, 5, 0), extract: async () => ({ time, label }), list: async () => [] });
        return p && "reply" in p ? p.reply : p && "text" in p ? p.text : "";
    };
    it.each([
        ["remind me at 7am to pack my gym bag", "pack my gym bag", /to pack your gym bag\./],
        ["remind me at 7am to call my mum", "call my mum", /to call your mum\./],
        ["remind me at 7am to text dad that I'm running late", "text dad that I'm running late", /that you're running late\./],
        ["remind me at 7am to ask her if she can drive me", "ask her if she can drive me", /drive you\./],
        ["remind me at 7am to take my vitamins myself", "take my vitamins myself", /take your vitamins yourself\./],
        ["remind me at 7am about my dentist appointment", "about my dentist appointment", /about your dentist appointment\./],
        ["remind me at 7am to email prof about the thing I missed", "email prof about the thing I missed", /the thing you missed\./],
    ])("%s", async (message, label, re) => { expect(await plan(message, label)).toMatch(re); });
    it("leaves other words alone", async () => {
        expect(await plan("remind me at 7am to buy milk", "buy milk")).toMatch(/to buy milk\./);
        expect(await plan("remind me at 7am to call the dentist", "call the dentist")).toMatch(/to call the dentist\./);
        expect(await plan("remind me at 7am to ring emma", "ring emma")).toMatch(/to ring emma\./);
    });
});
