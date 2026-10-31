import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginNow, pluginNowMs, SANDBOX_TTL_MS } from "./plugin-clock.js";
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
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "plugin-clock-")); });
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
});
