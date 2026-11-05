// w20 xf-other (live gate 2 #72): at 2:34 AM "how long til my first thing" was answered "about five hours" by the front desk; the first thing was 9:00 (6 h 26 min).
import { describe, expect, it } from "vitest";
import { codeDayAnswer, isFirstThingQuestion } from "./day-read-answers.js";
const DAY = ["B1 09:00–10:30 CS1800 Discrete Structures — Lecture (FIXED)", "B2 12:25–13:25 Go over Orion learning plan", "B3 17:50–18:50 practice leetcode"].join("\n");
const NOW = 2 * 60 + 34;
describe("how long until the first thing", () => {
    it("is arithmetic from the day, not a guess", () => {
        for (const m of ["how long til my first thing", "how long until my first thing tomorrow morning", "whens my first thing", "how many minutes til my next thing", "how long till my first event"])
            expect(codeDayAnswer(m, DAY, false, NOW)?.text, m).toMatch(/CS1800 Discrete Structures at 9:00 AM/);
        expect(codeDayAnswer("how long til my first thing", DAY, false, NOW)?.text).toContain("in about 6 h 26 min");
    });
    it("skips what has already started", () => {
        expect(codeDayAnswer("how long til my next thing", DAY, false, 11 * 60)?.text).toMatch(/Go over Orion learning plan at 12:25 PM, in about 1 h 25 min/);
    });
    it("says so when nothing is left", () => expect(codeDayAnswer("how long til my next thing", DAY, false, 20 * 60)?.text).toMatch(/nothing left/i));
    it("recognises the question and not a request", () => {
        expect(isFirstThingQuestion("how long til my first thing")).toBe(true);
        expect(isFirstThingQuestion("move my first thing to 10")).toBe(false);
        expect(isFirstThingQuestion("first thing tomorrow remind me to call mum")).toBe(false);
    });
});
describe("through the routing: a drafted 'about five hours' is never what he hears", () => {
    it("answers from the day", async () => {
        const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
        const { registerLocalRouting } = await import("./local-routing.js");
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const dir = mkdtempSync(join(tmpdir(), "ft-"));
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), stateDir: dir, clock: () => "Thu 02:34", now: () => new Date(2026, 10, 5, 2, 34), brainSearch: async () => "",
            decideImpl: async () => ({ move: "answer", answer: "You have about five hours before your first thing." }),
            readDay: async () => DAY, scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) });
        const ctx = { runId: "ft-1", sessionKey: "agent:main:orion-chat-ft" };
        const fire = async (n, e) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, ctx)); return out; };
        const said = "how long til my first thing";
        await fire("before_model_resolve", { prompt: said });
        const [direct] = (await fire("before_agent_reply", { cleanedBody: said }));
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }));
        const heard = `${direct?.reply?.text ?? ""} ${built?.systemPrompt ?? ""} ${built?.appendContext ?? ""}`;
        expect(heard).toContain("6 h 26 min");
        expect(heard).not.toContain("five hours");
    });
});
