// w20 r3 review: meal words and before/after events carry (or do not carry) a time-of-day cue. 15 held-out phrasings.
import { describe, expect, it } from "vitest";
import { readDayEdit } from "./day-edit.js";
import { pickClock } from "./day-edit-time.js";
import { eveningTime } from "./direct-add.js";
import { PART } from "./calendar-intent.js";
import { resolveStart } from "./intent-time.js";
import { estimateTokens, trimHistory } from "./history-trim.js";
const NIGHT = new Date(2026, 10, 5, 1, 30);
const NOON = new Date(2026, 10, 5, 12, 0);
/** The minute the first add/move in his message lands on, via the day-edit reader. */
function read(m, now = NIGHT) {
    const p = readDayEdit(m, now)?.parts[0];
    const s = p && "at" in p && p.at ? p.at : p && p.op === "move" ? p.to : undefined;
    return s ? pickClock(s, now.getHours() * 60 + now.getMinutes(), "future") : undefined;
}
const hm = (h, m = 0) => h * 60 + m;
describe("time-of-day cues", () => {
    it.each([
        ["put dinner at 7 before class", hm(19)],
        ["add gym at 6 before work", hm(18)],
        ["add study at 5 before my lecture", hm(17)],
        ["put breakfast at 6:30", hm(6, 30)],
        ["add breakfast at 7", hm(7)],
        ["put tea at 6", hm(18)],
        ["add supper at 8", hm(20)],
        ["add lunch at 1", hm(13)],
        ["put a walk at 4 this arvo", hm(16)],
        ["add gym at half 5 tonight", hm(17, 30)],
        ["add a run at 6 first thing", hm(6)],
        ["put reading at 9 this evening", hm(21)],
        ["add coffee at 3 after lunch", hm(15)],
        ["put a call at 5 after class", hm(17)],
        ["add a run at 6 in the morning", hm(6)],
    ])("%s", (m, want) => {
        expect(read(m), m).toBe(want);
    });
    it("the form path agrees", () => {
        expect(eveningTime("07:00", 90, "put dinner at 7 before class")).toBe("19:00");
        expect(eveningTime("06:30", 90, "put breakfast at 6:30")).toBe("06:30");
        expect(PART("put dinner at 7 before class")).toBe("evening");
        expect(PART("put breakfast at 7")).toBe("morning");
        expect(resolveStart({ h: 7, m: 0, exact: false }, { day: "today", now: 90, part: PART("dinner at 7") })).toEqual({ at: hm(19) });
    });
});
describe("history trim never splits a tool call from its result", () => {
    const big = (n) => "z".repeat(n);
    it("when the current turn's tool chain alone exceeds the budget, old tool results lose their content, not their place", () => {
        const messages = [
            { role: "user", content: "old" }, { role: "assistant", content: "old reply" },
            { role: "user", content: "do the thing" },
            { role: "assistant", content: [{ type: "toolCall", id: "a", name: "exec" }] },
            { role: "toolResult", toolCallId: "a", content: big(9000) },
            { role: "assistant", content: [{ type: "toolCall", id: "b", name: "exec" }] },
            { role: "toolResult", toolCallId: "b", content: big(9000) },
            { role: "assistant", content: [{ type: "toolCall", id: "c", name: "exec" }] },
            { role: "toolResult", toolCallId: "c", content: big(500) },
        ];
        trimHistory(messages, 1500);
        const roles = messages.map((m) => m.role);
        expect(roles[0]).toBe("user");
        expect(roles.filter((r) => r === "toolResult")).toHaveLength(3);
        for (let i = 0; i < roles.length; i += 1)
            if (roles[i] === "toolResult")
                expect(roles[i - 1]).toBe("assistant");
        expect(estimateTokens(messages)).toBeLessThanOrEqual(1500);
    });
});
