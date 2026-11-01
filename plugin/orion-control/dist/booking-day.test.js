import { describe, expect, it } from "vitest";
import { otherDayNamed } from "./booking-day.js";
import { takeLength } from "./intent-time.js";
describe("otherDayNamed", () => {
    it.each([["finish resume on friday at 10", "friday"], ["put it on the 4th", "on the 4th"], ["do it next week", "next week"], ["gym sat 9am", "sat"], ["in 3 days", "in 3 days"]])("%s", (t, w) => expect(otherDayNamed(t)).toBe(w));
    it.each(["tomorrow at 10am", "tonight 8pm", "finish resume at 4", "monitor the thing"])("none in '%s'", (t) => expect(otherDayNamed(t)).toBeUndefined());
});
describe("a leading duration phrase leaves the title (W8-A)", () => {
    it.each([
        ["an hour of youtube editing", 60, "youtube editing"],
        ["2 hours of studying for econ", 120, "studying for econ"],
        ["30 mins of reading", 30, "reading"],
        ["half an hour of piano", 30, "piano"],
        ["45 min walk", 45, "walk"],
        ["1h of gym", 60, "gym"],
    ])("%s", (text, minutes, rest) => expect(takeLength(text)).toEqual({ minutes, rest }));
});
