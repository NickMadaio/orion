// REV2 finding 6 (2026-10-31): "plans moved to 8pm" (his friend's plans, said in passing) moved his next block, deadline study or gym.
import { describe, expect, it } from "vitest";
import { readDayRequest, runDayRequest } from "./day-requests.js";
const now = new Date(2026, 9, 30, 14, 0);
const studyNext = { date: "2026-10-30", blocks: [
        { title: "Study for econ midterm", start: "14:30", end: "16:00", fixed: false, kind: "study" },
        { title: "Gym", start: "16:30", end: "18:00", fixed: false, kind: "gym" },
    ] };
const fake = () => { const calls = []; return { calls, run: async (s, a) => { calls.push([s, ...a]); return { stdout: "Changed\nWritten to his calendar.", code: 0 }; } }; };
describe("finding 6: an unnamed move never guesses gym or study", () => {
    it.each(["plans moved to 8pm", "our plans moved to 8", "plan moved to 9 tonight"])("%s is not an unnamed move", (m) => {
        expect(readDayRequest(m, now)?.kind).not.toBe("unnamed-move");
    });
    it.each(["it got moved to 8", "its moved to 8pm", "moved to 8 tonight"])("%s with study or gym next asks first", async (m) => {
        const req = readDayRequest(m, now);
        expect(req.kind).toBe("unnamed-move");
        const f = fake();
        const out = await runDayRequest(req, { run: f.run, readDay: async () => studyNext, now });
        expect(f.calls).toEqual([]);
        expect(out.flow).toMatchObject({ outcome: "say", kind: "ask" });
    });
    it("a block that would run past midnight is not moved", async () => {
        const late = { date: "2026-10-30", blocks: [{ title: "YouTube editing", start: "21:00", end: "23:00", fixed: false, kind: "side_project" }] };
        const f = fake();
        const out = await runDayRequest({ kind: "unnamed-move", at: "11pm" }, { run: f.run, readDay: async () => late, now: new Date(2026, 9, 30, 20, 0) });
        expect(f.calls).toEqual([]);
        expect(out.flow.text).toMatch(/past midnight/);
    });
});
