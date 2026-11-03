import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asksTheTime, timeReply } from "./clock-answer.js";
import { registerLocalRouting } from "./local-routing.js";
// 2026-11-02 23:56, the live turn and the reply it got: "You're still working, Timmy. Orion's clock says it's 11:56 PM."
const LIVE = "Still working Timmy, utilize. Orion, what time is What time is Fuck";
describe("a time question is the clock's", () => {
    it.each([
        LIVE, "What time is Fuck", "Orion, what time is", "what time is it", "whats the time rn", "hey orion what time is it now",
        "ok so what's the time", "(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) what time is it",
    ])("%s → the clock", (line) => expect(asksTheTime(line)).toBe(true));
    it.each([
        "what time is my class", "what time does the gym close", "move gym to 7 and what time is it", "what time is it in tokyo",
        "orion what time is it and push my study block", "Still working Timmy what time is sunset", "remind me at what time i said",
    ])("%s → not only the time", (line) => expect(asksTheTime(line)).toBe(false));
    it("says the time and nothing else", () => {
        expect(timeReply(new Date(2026, 10, 2, 23, 56))).toBe("It's 11:56 PM.");
        expect(timeReply(new Date(2026, 10, 3, 0, 5))).toBe("It's 12:05 AM.");
        expect(timeReply(new Date(2026, 10, 3, 12, 0))).toBe("It's 12:00 PM.");
    });
});
const SPOKEN = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.
Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences, no lists, no markdown, times as "8:15 PM". Offer detail only if he asks.

User message:
`;
function harness(now, desk) {
    const handlers = new Map();
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "clock-")), "r.jsonl"), brainSearch: async () => "",
        clock: () => "Mon 23:56", now: () => now, decideImpl: async () => desk,
    });
    const fire = async (name, event, ctx) => {
        const out = [];
        for (const fn of handlers.get(name) ?? [])
            out.push(await fn(event, ctx));
        return out;
    };
    return async (prompt) => {
        const ctx = { runId: "c1", sessionKey: "agent:main:orion-chat-clock" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        if (direct?.reply?.text)
            return direct.reply.text;
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 60) ?? ""}`;
    };
}
describe("the live turn gets the time, not the room words back", () => {
    const now = new Date(2026, 10, 2, 23, 56);
    it("desk said ignore: the clock answers, plainly", async () => {
        const reply = await harness(now, { move: "ignore" })(`${SPOKEN}${LIVE}`);
        expect(reply).toBe("It's 11:56 PM.");
        expect(reply).not.toMatch(/timmy|still working/i);
    });
    it("desk answered with its own words: still the plain clock line", async () => {
        const reply = await harness(now, { move: "answer", answer: "You're still working, Timmy. It's 11:56 PM." })(`${SPOKEN}Orion, what time is it`);
        expect(reply).toBe("It's 11:56 PM.");
    });
    it("the cut-off logged line from his name on gets the time too", async () => {
        expect(await harness(now, { move: "ignore" })(`${SPOKEN}Orion, what time is`)).toBe("It's 11:56 PM.");
    });
    it("a calendar time question is not taken", async () => {
        const reply = await harness(now, { move: "escalate", tier: "standard" })(`${SPOKEN}what time is my class tomorrow`);
        expect(reply).not.toBe("It's 11:56 PM.");
    });
});
