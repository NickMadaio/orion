import { describe, expect, it } from "vitest";
import { isBareConfirm } from "./bare-confirm.js";
describe("a bare go-ahead", () => {
    it("is recognised in the ways he says it", () => {
        for (const m of ["go", "yeah go on", "go ahead", "ok do it", "yep go for it pls", "sure, go", "Go.", "yes", "yeah lol", "lets go then", "sounds good", "do it"])
            expect(isBareConfirm(m), m).toBe(true);
    });
    it("never swallows a real request", () => {
        for (const m of ["go to the gym at 5", "do my laundry tomorrow", "go on youtube", "yes move leetcode to 3", "what is going on with my plan", "ok but remember the wifi code", "continue the orion plan at 4pm"])
            expect(isBareConfirm(m), m).toBe(false);
    });
});
describe("through the routing: a bare go-ahead never searches his notes", () => {
    async function prompt(said) {
        const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
        const { registerLocalRouting } = await import("./local-routing.js");
        const handlers = new Map(), searched = [];
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "bc-")), "r.jsonl"), clock: () => "Tue 23:50",
            decideImpl: async () => ({ move: "escalate", tier: "standard" }),
            brainSearch: async (q) => { searched.push(q); return "You're still awake past your bedtime of 23:45. Sleep wins tonight."; },
            scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) });
        const ctx = { runId: "bc-1", sessionKey: "agent:main:orion-chat-bc" };
        const fire = async (n, e) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, ctx)); return out; };
        await fire("before_model_resolve", { prompt: said });
        await fire("before_agent_reply", { cleanedBody: said });
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }));
        return { prompt: built?.systemPrompt ?? "", searched };
    }
    it("go / yeah go on: no search, no stale note in the prompt", async () => {
        for (const said of ["go", "yeah go on", "ok go ahead"]) {
            const r = await prompt(said);
            expect(r.searched, said).toEqual([]);
            expect(r.prompt, said).not.toContain("Sleep wins tonight");
        }
    });
    it("a real question still searches", async () => {
        const r = await prompt("whats the wifi code at my flat");
        expect(r.searched.length).toBeGreaterThan(0);
    });
});
