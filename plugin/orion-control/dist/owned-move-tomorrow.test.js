// Wave 8 B: "move it to tomorrow" with no gym on today books tomorrow's and says today had none (rea-skip-gym-c).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const NOW = new Date(2030, 9, 21, 8, 0);
const CLASS = { title: "CS1802 Seminar — Lecture", start: "13:00", end: "14:30", fixed: true, kind: "class" };
const DAY = (blocks) => ({ date: "2030-10-21", now: "08:00", blocks });
describe("rea-skip-gym: 'move it to tomorrow' with no gym today", () => {
    const run = async (prompt, ok, blocks) => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const dir = mkdtempSync(join(tmpdir(), "tmrw-"));
        const scripts = [];
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => "Mon 08:00", now: () => NOW,
            decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "", readDayJson: async () => DAY(blocks),
            scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
            realityRun: async (_s, a) => { scripts.push(a); return ok ? { stdout: "Changed Tuesday:\n  added Gym 16:30–18:00", code: 0 } : { stdout: "NOT BOOKED: Gym did not fit", code: 1 }; } });
        const ctx = { runId: "s-2", sessionKey: "agent:main:orion-chat-y" };
        for (const fn of handlers.get("before_model_resolve") ?? [])
            await fn({ prompt }, ctx);
        let built;
        for (const fn of handlers.get("before_prompt_build") ?? [])
            built = (await fn({ prompt, messages: [] }, ctx)) ?? built;
        return { scripts, exact: /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1] };
    };
    it.each([
        ["skip gym today, im over it, move it to tomorrow", []],
        ["ugh skipping gym today, push it to tomorrow pls", [CLASS]],
        ["not doing gym today, shift it to tmrw", [CLASS]],
    ])("%s", async (m, blocks) => {
        const r = await run(m, true, blocks);
        expect(r.scripts).toEqual([["add", "Gym", "90", "--date", "tomorrow"]]);
        expect(r.exact).toMatch(/^Booked: gym tomorrow at 4:30 PM, 90 minutes\. Gym wasn't on today's calendar/);
    });
    it("no room: nothing changes and it says so", async () => {
        const r = await run("skip gym today, move it to tomorrow", false, []);
        expect(r.exact).toMatch(/no room for 90 minutes of it tomorrow, so nothing changed/);
    });
});
