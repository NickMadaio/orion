import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_ENVELOPE, MIN_BATTERY_PERCENT_UNPLUGGED, URGENT_WINDOW_MS, checkBudget, routeJob, shouldPause, } from "./self-development-scheduling.js";
const NOW = new Date("2026-09-06T12:00:00Z");
function job(overrides = {}) {
    return {
        id: "job-1",
        description: "refactor a test helper",
        urgency: "routine",
        requestedAt: "2026-09-06T09:00:00Z",
        failedLocalReview: false,
        ...overrides,
    };
}
describe("routeJob: local unless one of three things is true", () => {
    it("a routine job with no deadline and no prior failure goes LOCAL", () => {
        const result = routeJob(job(), NOW);
        expect(result.route).toBe("local");
    });
    it("a job declared time_sensitive goes to CLOUD even with no deadline at all", () => {
        const result = routeJob(job({ urgency: "time_sensitive" }), NOW);
        expect(result.route).toBe("cloud");
        expect(result.reason).toContain("time_sensitive");
    });
    it("a job that already failed local review goes to CLOUD even when routine", () => {
        const result = routeJob(job({ failedLocalReview: true }), NOW);
        expect(result.route).toBe("cloud");
        expect(result.reason).toContain("failed local review once");
    });
    it("a routine job with a FAR deadline still goes LOCAL", () => {
        const result = routeJob(job({ deadlineAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000).toISOString() }), NOW);
        expect(result.route).toBe("local");
    });
    it("a routine job whose deadline has entered the urgent window goes to CLOUD", () => {
        const result = routeJob(job({ deadlineAt: new Date(NOW.getTime() + URGENT_WINDOW_MS - 60_000).toISOString() }), NOW);
        expect(result.route).toBe("cloud");
        expect(result.reason).toContain("urgent window");
    });
    it("a routine job whose deadline has ALREADY PASSED goes to CLOUD, not a crash", () => {
        const result = routeJob(job({ deadlineAt: new Date(NOW.getTime() - 60_000).toISOString() }), NOW);
        expect(result.route).toBe("cloud");
    });
    it("throws a clear error on an unparseable deadline rather than routing on garbage", () => {
        expect(() => routeJob(job({ deadlineAt: "not-a-date" }), NOW)).toThrow(/not a parseable/);
    });
    it("failedLocalReview outranks a far deadline: BOTH being true still means cloud", () => {
        const result = routeJob(job({
            failedLocalReview: true,
            deadlineAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000).toISOString(),
        }), NOW);
        expect(result.route).toBe("cloud");
        expect(result.reason).toContain("failed local review once");
    });
});
describe("checkBudget", () => {
    it("reports within budget when every dimension is under its ceiling", () => {
        const result = checkBudget({ elapsedMs: 1000, modelCalls: 1, tokensUsed: 1000 });
        expect(result).toEqual({ withinBudget: true, exceeded: [] });
    });
    it("flags duration alone", () => {
        const result = checkBudget({
            elapsedMs: DEFAULT_BUDGET_ENVELOPE.maxDurationMs + 1,
            modelCalls: 1,
            tokensUsed: 1,
        });
        expect(result.withinBudget).toBe(false);
        expect(result.exceeded).toEqual(["duration"]);
    });
    it("flags modelCalls alone", () => {
        const result = checkBudget({
            elapsedMs: 1,
            modelCalls: DEFAULT_BUDGET_ENVELOPE.maxModelCalls + 1,
            tokensUsed: 1,
        });
        expect(result.exceeded).toEqual(["modelCalls"]);
    });
    it("flags tokens alone", () => {
        const result = checkBudget({
            elapsedMs: 1,
            modelCalls: 1,
            tokensUsed: DEFAULT_BUDGET_ENVELOPE.maxTokens + 1,
        });
        expect(result.exceeded).toEqual(["tokens"]);
    });
    it("flags all three together, in a fixed order", () => {
        const result = checkBudget({
            elapsedMs: DEFAULT_BUDGET_ENVELOPE.maxDurationMs + 1,
            modelCalls: DEFAULT_BUDGET_ENVELOPE.maxModelCalls + 1,
            tokensUsed: DEFAULT_BUDGET_ENVELOPE.maxTokens + 1,
        });
        expect(result.withinBudget).toBe(false);
        expect(result.exceeded).toEqual(["duration", "modelCalls", "tokens"]);
    });
    it("respects a custom envelope rather than only the default", () => {
        const tinyEnvelope = { maxDurationMs: 10, maxModelCalls: 1, maxTokens: 10 };
        const result = checkBudget({ elapsedMs: 20, modelCalls: 2, tokensUsed: 20 }, tinyEnvelope);
        expect(result.exceeded).toEqual(["duration", "modelCalls", "tokens"]);
    });
    it("is exactly-at-ceiling inclusive: equal to the max does not trip it", () => {
        const result = checkBudget({
            elapsedMs: DEFAULT_BUDGET_ENVELOPE.maxDurationMs,
            modelCalls: DEFAULT_BUDGET_ENVELOPE.maxModelCalls,
            tokensUsed: DEFAULT_BUDGET_ENVELOPE.maxTokens,
        });
        expect(result.withinBudget).toBe(true);
    });
});
describe("shouldPause", () => {
    const healthy = {
        batteryPercent: 90,
        isCharging: true,
        thermalPressure: "nominal",
        quietHoursActive: false,
    };
    it("does not pause when everything is healthy", () => {
        expect(shouldPause(healthy)).toEqual({ paused: false, reasons: [] });
    });
    it("pauses for quiet hours alone", () => {
        const result = shouldPause({ ...healthy, quietHoursActive: true });
        expect(result.paused).toBe(true);
        expect(result.reasons).toEqual(["quiet hours are active"]);
    });
    it("pauses for serious thermal pressure", () => {
        const result = shouldPause({ ...healthy, thermalPressure: "serious" });
        expect(result.paused).toBe(true);
        expect(result.reasons[0]).toContain("thermal pressure is serious");
    });
    it("pauses for critical thermal pressure", () => {
        const result = shouldPause({ ...healthy, thermalPressure: "critical" });
        expect(result.paused).toBe(true);
    });
    it("does NOT pause for merely 'fair' thermal pressure", () => {
        const result = shouldPause({ ...healthy, thermalPressure: "fair" });
        expect(result.paused).toBe(false);
    });
    it("pauses for low battery while unplugged", () => {
        const result = shouldPause({
            ...healthy,
            isCharging: false,
            batteryPercent: MIN_BATTERY_PERCENT_UNPLUGGED - 1,
        });
        expect(result.paused).toBe(true);
        expect(result.reasons[0]).toContain("not charging");
    });
    it("does NOT pause for low battery WHILE CHARGING", () => {
        const result = shouldPause({
            ...healthy,
            isCharging: true,
            batteryPercent: 5,
        });
        expect(result.paused).toBe(false);
    });
    it("reports every applicable reason at once, not just the first", () => {
        const result = shouldPause({
            batteryPercent: 5,
            isCharging: false,
            thermalPressure: "critical",
            quietHoursActive: true,
        });
        expect(result.paused).toBe(true);
        expect(result.reasons).toHaveLength(3);
    });
});
