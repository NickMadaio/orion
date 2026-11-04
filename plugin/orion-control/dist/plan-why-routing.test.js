// "why is X first" through the chat route: answered by code from the plan's reasons (plan-why.ts), never by the model. Held-out phrasings.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const NOW = new Date(2026, 10, 4, 10, 0);
const REASONS = { version: 1, date: "2026-11-04", items: [
        { title: "GET A GP", rank: 1, reason: "x", why: ["overdue since 2 Nov", "high priority"], start: 840, end: 885 },
        { title: "finish resume", rank: 4, reason: "x", why: ["overdue since 24 Oct"], start: 1010, end: 1100 },
    ] };
function route(withReasons) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "planwhy-"));
    if (withReasons)
        writeFileSync(join(dir, "plan-reasons.json"), JSON.stringify(REASONS));
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => "Wed 10:00", now: () => NOW,
        decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "", stateDir: dir,
        readDayJson: async () => ({ date: "2026-11-04", now: "10:00", blocks: [] }), readDay: async () => "",
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
        realityRun: async () => ({ stdout: "", code: 0 }) });
    let n = 0;
    return async (prompt) => {
        const ctx = { runId: `pw-${n += 1}`, sessionKey: "agent:main:orion-chat-planwhy" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    };
}
describe("why is X first, through the route", () => {
    it.each([
        ["wait why is my resume first thing", /^Finish resume isn't first: GET A GP is, because it's overdue since 2 Nov and high priority\. Finish resume is number 2 at 4:50 PM because it's overdue since 24 Oct\./],
        ["why did u put get a gp first??", /^GET A GP is first at 2:00 PM because it's overdue since 2 Nov and high priority\./],
        ["why is it first on my plan lol", /^GET A GP is first at 2:00 PM/],
    ])("%s", async (message, reply) => {
        expect(await route(true)(message)).toMatch(reply);
    });
    it("with no reasons on file the question is not answered by code", async () => {
        expect(await route(false)("why is my resume first")).toBeUndefined();
    });
});
