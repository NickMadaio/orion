// REV2 NICE (2026-10-31): "give me a sec" set a 10-minute nudge; a sec is 5, like "in a sec".
import { describe, expect, it } from "vitest";
import { readFocusMove } from "./focus-moves.js";
describe("give me a sec is five minutes", () => {
    it.each(["give me a sec", "ok gimme a second", "ya give me a minute"])("%s", (m) => {
        expect(readFocusMove(m)).toEqual({ kind: "stall", minutes: 5 });
    });
    it("after this video is still 10", () => {
        expect(readFocusMove("after this video")).toEqual({ kind: "stall", minutes: 10 });
    });
});
