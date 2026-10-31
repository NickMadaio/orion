import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginNow, pluginNowMs, resetClockCache, SANDBOX_TTL_MS } from "./plugin-clock.js";
const REAL = Date.parse("2026-10-31T20:00:00Z");
const SANDBOX = "2026-11-02T10:00:00.000Z";
let dir = "";
const realNow = () => REAL;
const age = (file, ms) => { const t = new Date(REAL - ms); utimesSync(join(dir, file), t, t); };
const marker = (ageMs = 105 * 60_000) => { writeFileSync(join(dir, "eval-mode"), "gate\n"); age("eval-mode", ageMs); };
const calendar = (body = { now: SANDBOX, events: [] }, ageMs = 60_000) => {
    writeFileSync(join(dir, "eval-calendar.json"), typeof body === "string" ? body : JSON.stringify(body));
    age("eval-calendar.json", ageMs);
};
describe("pluginNow (2026-10-31 gate sandbox clock)", () => {
    beforeEach(() => { resetClockCache(); dir = mkdtempSync(join(tmpdir(), "plugin-clock-")); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    it("is real time with no marker and no sandbox calendar", () => {
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
    });
    it("is real time when only the calendar exists (no marker)", () => {
        calendar();
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
    });
    it("is real time when the marker is live but there is no sandbox calendar", () => {
        marker();
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
    });
    it("is the sandbox now when the marker and a fresh calendar both exist", () => {
        marker();
        calendar();
        expect(pluginNow({ dir, realNow }).toISOString()).toBe(SANDBOX);
    });
    it("expires: a calendar older than two hours is ignored", () => {
        marker();
        calendar(undefined, SANDBOX_TTL_MS + 1000);
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
    });
    it("is real time when the marker is stale", () => {
        marker(SANDBOX_TTL_MS + 1000);
        calendar();
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
    });
    it("is real time when the calendar is not JSON or has no parseable now", () => {
        marker();
        calendar("{not json");
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
        calendar({ events: [] });
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
        calendar({ now: "yesterday-ish", events: [] });
        expect(pluginNowMs({ dir, realNow })).toBe(REAL);
    });
    it("the answer-deciding defaults follow the sandbox: localClock, dateLine, readClock", async () => {
        writeFileSync(join(dir, "eval-mode"), "gate\n");
        writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: "2026-11-02T23:30:00.000Z", events: [] }));
        const before = process.env.ORION_CONTROLLED_DIR;
        process.env.ORION_CONTROLLED_DIR = dir;
        try {
            const { localClock, dateLine } = await import("./local-routing.js");
            const { readClock } = await import("./ambient.js");
            const sandbox = new Date("2026-11-02T23:30:00.000Z");
            const hm = `${String(sandbox.getHours()).padStart(2, "0")}:${String(sandbox.getMinutes()).padStart(2, "0")}`;
            expect(localClock()).toContain(hm);
            expect(dateLine()).toContain(`${sandbox.getFullYear()}-${String(sandbox.getMonth() + 1).padStart(2, "0")}-${String(sandbox.getDate()).padStart(2, "0")}`);
            expect(readClock("UTC").iso).toBe("2026-11-02T23:30:00.000Z");
        }
        finally {
            if (before === undefined)
                delete process.env.ORION_CONTROLLED_DIR;
            else
                process.env.ORION_CONTROLLED_DIR = before;
        }
        // Back on real time once the sandbox is gone.
        resetClockCache(); // the 1 s cache would otherwise answer from before the removal
        rmSync(join(dir, "eval-calendar.json"));
        process.env.ORION_CONTROLLED_DIR = dir;
        try {
            const { readClock } = await import("./ambient.js");
            expect(Math.abs(Date.parse(readClock("UTC").iso) - Date.now())).toBeLessThan(5000);
        }
        finally {
            if (before === undefined)
                delete process.env.ORION_CONTROLLED_DIR;
            else
                process.env.ORION_CONTROLLED_DIR = before;
        }
    });
    it("honours ORION_CONTROLLED_DIR when no dir is passed", () => {
        marker();
        calendar();
        const before = process.env.ORION_CONTROLLED_DIR;
        process.env.ORION_CONTROLLED_DIR = dir;
        try {
            expect(pluginNow({ realNow }).toISOString()).toBe(SANDBOX);
        }
        finally {
            if (before === undefined)
                delete process.env.ORION_CONTROLLED_DIR;
            else
                process.env.ORION_CONTROLLED_DIR = before;
        }
    });
    describe("11b: a ~1 s cache", () => {
        afterEach(() => vi.useRealTimers());
        const live = (file, ms) => { const t = new Date(Date.now() - ms); utimesSync(join(dir, file), t, t); };
        const setup = () => {
            writeFileSync(join(dir, "eval-mode"), "gate\n");
            live("eval-mode", 105 * 60_000);
            writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: SANDBOX, events: [] }));
            live("eval-calendar.json", 1000);
        };
        it("answers repeat calls from the cache within a second, then looks again", () => {
            vi.useFakeTimers();
            vi.setSystemTime(Date.now());
            setup();
            expect(pluginNow({ dir }).toISOString()).toBe(SANDBOX);
            rmSync(join(dir, "eval-calendar.json"));
            vi.advanceTimersByTime(500);
            expect(pluginNow({ dir }).toISOString()).toBe(SANDBOX);
            vi.advanceTimersByTime(600);
            expect(Math.abs(pluginNowMs({ dir }) - Date.now())).toBeLessThan(5);
        });
        it("is keyed by directory and bypassed when realNow is injected", () => {
            setup();
            expect(pluginNow({ dir }).toISOString()).toBe(SANDBOX);
            const other = mkdtempSync(join(tmpdir(), "plugin-clock-other-"));
            try {
                expect(Math.abs(pluginNowMs({ dir: other }) - Date.now())).toBeLessThan(1000);
            }
            finally {
                rmSync(other, { recursive: true, force: true });
            }
            rmSync(join(dir, "eval-calendar.json"));
            expect(pluginNowMs({ dir, realNow })).toBe(REAL);
        });
    });
});
