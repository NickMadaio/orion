// w20 r6 (live gate 4 #53): "what should i be doing right now" is the current block, the next block and the top to-do, in a sentence that parses.
import { describe, expect, it } from "vitest";
import { runDayDefault } from "./day-defaults.js";
const day = { date: "2026-11-05", now: null, blocks: [{ title: "CS1800 Discrete Structures", start: "09:00", end: "10:30", fixed: true }, { title: "Go over Orion learning plan", start: "12:25", end: "13:25", fixed: false }] };
const deps = (at) => ({ run: async () => ({ stdout: "", code: 0 }), readDay: async () => day, now: at,
    deadlines: async () => ({ events: [], tasks: [{ title: "New CS Lab", due: new Date(2026, 10, 9, 12).toISOString() }] }) });
describe("what should i be doing now", () => {
    it("in a gap: the next block, how long, and the top to-do for the gap", async () => {
        const r = await runDayDefault({ kind: "whats-now" }, deps(new Date(2026, 10, 5, 6, 12)));
        const t = r.flow.text ?? "";
        expect(t).toBe("Next is CS1800 Discrete Structures at 9:00 AM, in 2 h 48 min. For the gap, New CS Lab is the one to chip at (due Monday).");
        expect(t).not.toMatch(/Until then|best use of the time/);
    });
    it("in a block: that block, then the next", async () => {
        const r = await runDayDefault({ kind: "whats-now" }, deps(new Date(2026, 10, 5, 9, 30)));
        expect(r.flow.text).toMatch(/^CS1800 Discrete Structures, now \(.*\)\. After that, Go over Orion learning plan at 12:25 PM\.$/);
    });
});
