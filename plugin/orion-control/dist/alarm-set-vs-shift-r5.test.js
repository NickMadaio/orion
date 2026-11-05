// w20 round 5 check: a clock time sets the alarm; only an amount shifts it. Through the real routing hooks with a fake orion-sleepplan.
process.env.TZ = "Europe/London";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const NOW = new Date(2026, 10, 5, 22, 30);
function setup() {
    const calls = [];
    const sleepPlanRun = async (args) => {
        calls.push(args);
        if (args[0] === "wake-on")
            return { code: 0, stdout: JSON.stringify({ ok: true, changed: { date: args[2] }, days: [] }) };
        if (args[0] === "shift")
            return { code: 0, stdout: JSON.stringify({ ok: true, changed: { date: "2026-11-06", time: "07:10" }, days: [] }) };
        return { code: 0, stdout: JSON.stringify({ ok: true, phone: { state: "confirmed" }, link: { fresh: true }, alarms: [], days: [], next: { date: "2026-11-06", wake: "06:30", asked: true } }) };
    };
    const handlers = new Map();
    registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "asv-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 22:30", now: () => NOW,
        decideImpl: async () => ({ move: "escalate", tier: "quick" }), sleepPlanRun,
    });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `a${(n += 1)}`, sessionKey: "agent:main:orion-chat-asv" };
        for (const fn of handlers.get("before_model_resolve") ?? [])
            await fn({ prompt }, ctx);
        for (const fn of handlers.get("before_agent_reply") ?? []) {
            const o = (await fn({ prompt }, ctx));
            if (o?.reply?.text)
                return o.reply.text;
        }
        let out = "";
        for (const fn of handlers.get("before_prompt_build") ?? []) {
            const o = (await fn({ prompt, messages: [] }, ctx));
            out += `${o?.systemPrompt ?? ""}\n${o?.appendContext ?? ""}`;
        }
        return out;
    };
    return { turn, calls };
}
describe("a clock time sets the alarm", () => {
    it.each([
        ["wake me at quarter to 7", "06:45"], ["alarm for 7", "07:00"], ["wake me up at 8 tomorrow", "08:00"], ["set my alarm to half 6", "06:30"],
        ["wake me at ten to 7", "06:50"], ["alarm for quarter past 6", "06:15"], ["set my alarm to 6:10", "06:10"], ["wake me at 9 tomorrow", "09:00"],
    ])("%s", async (said, time) => {
        const h = setup();
        await h.turn(said);
        const wake = h.calls.find((c) => c[0] === "wake-on");
        expect(wake?.[wake.indexOf("--time") + 1]).toBe(time);
        expect(h.calls.some((c) => c[0] === "shift")).toBe(false);
    }, 30000);
});
describe("an amount shifts it", () => {
    it.each([["push my alarm 10 later", 10], ["alarm 20 later", 20], ["push my alarm back 15 min", 15], ["push my alarm back half an hour", 30], ["move my alarm up 10 minutes", -10]])("%s", async (said, minutes) => {
        const h = setup();
        await h.turn(said);
        const shift = h.calls.find((c) => c[0] === "shift");
        expect(shift, said).toBeDefined();
        expect(shift[shift.indexOf("--minutes") + 1]).toBe(String(minutes));
        expect(h.calls.some((c) => c[0] === "wake-on")).toBe(false);
    }, 30000);
    it("'push my alarm 10' with no direction word sets nothing by guess", async () => {
        const h = setup();
        await h.turn("push my alarm 10");
        expect(h.calls.some((c) => c[0] === "wake-on")).toBe(false);
    }, 30000);
});
