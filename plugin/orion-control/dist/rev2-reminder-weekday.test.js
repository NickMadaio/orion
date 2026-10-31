// REV2 finding 15 (2026-10-31): "remind me at 6 to study for the quiz on friday" was set for Friday 6 PM, after the quiz. A weekday counts
// only next to the time; one elsewhere in the sentence is asked about.
import { describe, expect, it } from "vitest";
import { planReminder } from "./reminder-flow.js";
const sat = new Date(2026, 9, 31, 13, 30);
const plan = (message, time, label) => planReminder({ message, now: sat, extract: async () => ({ time, label }), list: async () => [] });
describe("finding 15: the weekday belongs to the reminder only when it is next to the time", () => {
    it.each([["remind me at 6 to study for the quiz on friday", "study for the quiz"], ["remind me at 7 to prep for my presentation on monday", "prep for my presentation"],
        ["yo remind me at 5 to email prof about the essay due thursday", "email prof about the essay"]])("%s is asked, nothing set", async (m, label) => {
        const p = await plan(m, m.includes("at 6") ? "18:00" : m.includes("at 7") ? "19:00" : "17:00", label);
        expect(p).toMatchObject({ kind: "say" });
        expect(p.text).toMatch(/or today\?.*Nothing's set yet\.$/);
    });
    it.each([["remind me to call my mom on sunday at 6", "2026-11-01T18:00"], ["remind me at 6 on sunday to call mom", "2026-11-01T18:00"], ["remind me sunday 6pm to call mom", "2026-11-01T18:00"]])("%s is Sunday", async (m, at) => {
        expect(await plan(m, "18:00", "call mom")).toMatchObject({ kind: "call", at });
    });
});
