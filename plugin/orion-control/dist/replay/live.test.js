import { describe, expect, it } from "vitest";
import { words } from "./live-backend.js";
import { percentile, sample } from "./live-run.js";
import { loadScenarios } from "./schedule-suites.js";
const c = (id) => ({ id, say: id, expect: {} });
describe("live layer helpers (no model needed)", () => {
    it("percentile: median and p90 of turn latencies", () => {
        expect(percentile([], 50)).toBe(0);
        expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    });
    it("sample keeps every audit turn and an even spread of the good ones", () => {
        const cases = [c("real-audit-e1"), c("real-audit-e2"), ...Array.from({ length: 100 }, (_, i) => c(`real-good-${i}`))];
        const picked = sample(cases, 25);
        expect(picked.filter((x) => x.id.startsWith("real-audit-"))).toHaveLength(2);
        expect(picked.filter((x) => x.id.startsWith("real-good-")).length).toBeLessThanOrEqual(25);
        expect(picked.filter((x) => x.id.startsWith("real-good-")).length).toBeGreaterThanOrEqual(20);
    });
    it("words splits a worker's exec line without a shell", () => {
        expect(words('orion-reschedule move "Gym session" --to 19:00')).toEqual(["orion-reschedule", "move", "Gym session", "--to", "19:00"]);
        expect(words("orion-agenda today; rm -rf x")).toEqual(["orion-agenda", "today;", "rm", "-rf", "x"]);
    });
    it("both existing schedule suites load (36 scenarios)", () => {
        const all = loadScenarios();
        expect(all).toHaveLength(36);
        expect(all.every((s) => s.id && s.say)).toBe(true);
        expect(new Set(all.map((s) => s.id)).size).toBe(36);
    });
});
