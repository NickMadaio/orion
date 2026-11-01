// Wave 8 C: a compound calendar reply reads as short sentences in order (done, knock-on moves, what could not happen, undo),
// built only from the parts the tools returned.
import { describe, expect, it } from "vitest";
import { compoundReply, knockOn } from "./compound-reply.js";
describe("compoundReply", () => {
    it("the live food-with-annika reply: done, then the shifted blocks, then what could not happen, then undo", () => {
        const text = compoundReply({
            did: ["food with annika 8:30 AM–10:30 AM"],
            knock: ["practice leetcode 9:31 AM → 11:20 AM", "Go over Orion learning plan 10:36 AM → 12:25 PM"],
            couldnt: ["gym isn't on the rest of today's calendar, so there was nothing to move"],
            undo: true,
        });
        expect(text).toBe("Done — food with annika 8:30 AM–10:30 AM. That also moved practice leetcode from 9:31 AM to 11:20 AM and Go over Orion learning plan from 10:36 AM to 12:25 PM. But gym isn't on the rest of today's calendar, so there was nothing to move. Say \"undo\" to revert.");
        expect(text).not.toMatch(/Not done:|Also:|Say "undo" to put it back/);
    });
    it("omits the parts that have nothing in them", () => {
        expect(compoundReply({ did: ["gym 6:00 PM"], knock: [], couldnt: [], undo: false })).toBe("Done — gym 6:00 PM.");
        expect(compoundReply({ did: ["gym 6:00 PM"], knock: [], couldnt: [], undo: true })).toBe("Done — gym 6:00 PM. Say \"undo\" to revert.");
    });
    it("several failures are joined, not listed as a label", () => {
        const text = compoundReply({ did: ["a 5 PM"], knock: [], couldnt: ["b didn't go in", "I couldn't tell when c ends"], undo: true });
        expect(text).toBe("Done — a 5 PM. But b didn't go in, and I couldn't tell when c ends. Say \"undo\" to revert.");
    });
    it("three or more done items read as a list with a final 'and'", () => {
        expect(compoundReply({ did: ["a 5 PM", "b 6 PM", "c 7 PM"], knock: [], couldnt: [], undo: false })).toBe("Done — a 5 PM, b 6 PM and c 7 PM.");
    });
});
describe("knockOn", () => {
    it("names moved blocks by their new time and other changes as they were said", () => {
        expect(knockOn(["x 9:00 AM → 10:00 AM"])).toBe("That also moved x from 9:00 AM to 10:00 AM.");
        expect(knockOn(["x 9:00 AM → 10:00 AM", "Gym is off today (no room)"])).toBe("That also moved x from 9:00 AM to 10:00 AM. Also, Gym is off today (no room).");
        expect(knockOn(["Gym now ends at 7:00 PM"])).toBe("Also, Gym now ends at 7:00 PM.");
        expect(knockOn([])).toBe("");
    });
});
