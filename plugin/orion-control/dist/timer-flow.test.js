// w20 round 4: timers are set by code and read back; held-out phrasings in his style.
import { describe, expect, it } from "vitest";
import { readTimer, runTimer } from "./timer-flow.js";
describe("readTimer", () => {
    const cases = [
        ["start a 10 min timer for the pasta", 600, "pasta"],
        ["set a 10 min timer", 600, "Timer"],
        ["put on a 20 minute timer for my eggs", 1200, "eggs"],
        ["set me a 5 min timer pls", 300, "Timer"],
        ["run a 2 hour timer for laundry", 7200, "laundry"],
        ["timer for 45 seconds", 45, "Timer"],
        ["set a 15min timer for tea", 900, "tea"],
        ["put a 25 minute timer on for my laundry pls", 1500, "laundry"],
        ["set a ten minute timer for rice", 600, "rice"],
        ["can you start a 3 min timer", 180, "Timer"],
    ];
    it.each(cases)("%s", (said, seconds, label) => { expect(readTimer(said)).toEqual({ seconds, label }); });
    it("is not a timer when it asks about, cancels or has no length", () => {
        for (const s of ["cancel the timer for 10 min", "is my timer for 20 min still running", "set a timer", "whats my timer at"])
            expect(readTimer(s)).toBeUndefined();
    });
});
describe("runTimer", () => {
    const now = new Date(2026, 10, 5, 3, 31, 0);
    const deps = (over = {}) => {
        const store = [];
        return { store, deps: {
                now,
                add: async (seconds, label) => { if (over.fail)
                    throw new Error("locked"); const r = { id: "tx1", kind: "timer", label, dueAt: now.getTime() + seconds * 1000, createdAt: now.getTime() }; if (!over.drop)
                    store.push(r); return r; },
                list: async () => store,
            } };
    };
    it("sets it and the reply is the read-back", async () => {
        const { deps: d, store } = deps();
        const r = await runTimer({ seconds: 600, label: "pasta" }, d);
        expect(r.ok).toBe(true);
        expect(store).toHaveLength(1);
        expect(r.text).toBe("Timer set: 10 minutes for the pasta, it rings at 3:41 AM.");
    });
    it("says so when the store did not keep it, and when the write fails", async () => {
        expect((await runTimer({ seconds: 600, label: "Timer" }, deps({ drop: true }).deps)).text).toMatch(/couldn't set that timer.*nothing is running/);
        expect((await runTimer({ seconds: 600, label: "Timer" }, deps({ fail: true }).deps)).ok).toBe(false);
    });
});
