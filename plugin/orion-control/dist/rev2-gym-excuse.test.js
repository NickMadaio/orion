// REV2 findings 7 and 8 (2026-10-31): gym was dropped on an excuse. "im exhausted, skip gym and side project" took gym off because
// exhausted counted as ill, and "not feeling it, ill do gym tmrw morning" at 8 AM deleted today's gym for tomorrow's (which already had one).
import { describe, expect, it } from "vitest";
import { readDayRequest, runDayRequest } from "./day-requests.js";
import { readGymSkip } from "./anchor-guards.js";
const now = new Date(2026, 9, 30, 14, 0);
const day = { date: "2026-10-30", blocks: [
        { title: "Gym", start: "16:30", end: "18:00", fixed: false, kind: "gym" },
        { title: "YouTube editing", start: "18:30", end: "19:30", fixed: false, kind: "side_project" },
        { title: "Laundry", start: "20:00", end: "20:45", fixed: false },
    ] };
const fake = () => { const calls = []; return { calls, run: async (s, a) => { calls.push([s, ...a]); return { stdout: "Changed\nWritten to his calendar.", code: 0 }; } }; };
describe("finding 7: tired is not ill; gym stays with pushback, the rest he named comes off", () => {
    it.each(["im exhausted, skip gym and laundry", "im wrecked, cancel gym and laundry", "ugh im so tired, drop the gym and laundry"])("%s", async (m) => {
        const req = readDayRequest(m, now);
        expect(req).toMatchObject({ kind: "clauses", ill: false, gymKept: true });
        const f = fake();
        const out = await runDayRequest(req, { run: f.run, readDay: async () => day, now });
        expect(f.calls.some((c) => c.includes("Gym"))).toBe(false);
        expect(f.calls).toContainEqual(["orion-reschedule", "drop", "Laundry"]);
        expect(out.flow.reply).toMatch(/Gym's still on at 4:30 PM.*30 minutes instead of 90/);
    });
    it.each(["im sick, skip gym and laundry", "im ill, cancel gym and laundry", "feeling sick, drop gym and laundry"])("real illness takes gym off: %s", (m) => {
        expect(readDayRequest(m, now)).toMatchObject({ kind: "clauses", ill: true });
    });
    it("gym alone on an excuse is the gym guard's", () => {
        expect(readDayRequest("im exhausted, skip gym", now)).toBeNull();
        expect(readGymSkip("im exhausted, skip gym")).toEqual({ kind: "excuse" });
    });
});
describe("finding 8: 'ill do gym tmrw' is a deferral, read as such (the gym turn decides against today's gym)", () => {
    it.each(["not feeling it, ill do gym tmrw morning", "nah ill hit the gym tomorrow", "meh ill go to the gym tomorrow evening"])("%s", (m) => {
        expect(readGymSkip(m)).toMatchObject({ kind: "tomorrow", deferred: true });
    });
    it("an explicit move to tomorrow is his instruction, not a deferral", () => {
        expect(readGymSkip("skip gym, move it to tomorrow")).toEqual({ kind: "tomorrow" });
    });
});
