import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextWake } from "./wake-state.js";
import { parseWake, runWakeFlow } from "./wake-flow.js";
const dirs = [];
const state = (files) => {
    const d = mkdtempSync(join(tmpdir(), "wake-state-"));
    dirs.push(d);
    for (const [name, body] of Object.entries(files))
        writeFileSync(join(d, name), JSON.stringify(body));
    return d;
};
afterEach(() => { while (dirs.length)
    rmSync(dirs.pop(), { recursive: true, force: true }); });
const now = new Date(2026, 10, 4, 21, 57); // local 21:57, Wed 4 Nov
const at = (day, h, m) => new Date(2026, 10, day, h, m).toISOString();
const files = { "wake-plan.json": { alarms: [{ iso: at(5, 5, 50), at: "05:50" }, { iso: at(6, 9, 0), at: "09:00" }] }, "wake-request.json": { at: new Date(2026, 9, 19, 7, 0).toISOString() } };
describe("nextWake verifies before it states", () => {
    it("ignores a one-off request that is already in the past", () => {
        const n = nextWake(state(files), now);
        expect(n?.source).toBe("plan");
        expect(n?.at.getHours()).toBe(5);
        expect(n?.at.getMinutes()).toBe(50);
    });
    it("a request still ahead that is earlier than the plan wins", () => {
        const n = nextWake(state({ ...files, "wake-request.json": { at: at(5, 5, 0) } }), now);
        expect(n?.source).toBe("request");
    });
    it("nothing ahead is nothing", () => {
        expect(nextWake(state({ "wake-request.json": files["wake-request.json"] }), now)).toBeUndefined();
        expect(nextWake(undefined, now)).toBeUndefined();
    });
});
describe("L2: the bedtime reply never states a stale alarm", () => {
    const stale = async () => ({ stdout: "Wake-up set for Mon, 07:00 (asked 2026-10-19T00:43:25.230Z).", code: 0 });
    it("reads the real alarm", async () => {
        const out = await runWakeFlow({ message: "No. I took a really long nap, so I'm going to bed at eleven forty five.", decision: { move: "tool", tool: "wake", args: { at: "23:45" } }, now, exec: stale, stateDir: state(files) });
        expect(out).toMatchObject({ outcome: "say" });
        const text = out.text;
        expect(text).toContain("5:50 AM");
        expect(text).not.toContain("Mon");
    });
    it("with no alarm ahead it says goodnight and nothing about an alarm", async () => {
        const out = await runWakeFlow({ message: "going to bed now", decision: { move: "tool", tool: "wake", args: {} }, now, exec: stale, stateDir: state({ "wake-request.json": files["wake-request.json"] }) });
        expect(out.text).toBe("Goodnight.");
    });
    it("what time is my alarm reads the verified alarm", async () => {
        const out = await runWakeFlow({ message: "whats my alarm set for", now, exec: stale, stateDir: state(files) });
        expect(out.text).toContain("5:50 AM");
    });
});
describe("spoken times for the alarm", () => {
    it("eleven forty five is not a wake time when he said bed", () => {
        expect(parseWake("im going to bed at eleven forty five", { move: "tool", tool: "wake", args: { at: "23:45" } }, now)).toEqual({ kind: "bedtime" });
    });
    it("wake me up at six thirty", () => {
        expect(parseWake("wake me up at six thirty am", undefined, now)).toEqual({ kind: "set", time: "06:30" });
    });
});
