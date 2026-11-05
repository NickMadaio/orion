import { describe, expect, it } from "vitest";
import { asksChatSummary, chatSummary } from "./chat-summary.js";
describe("asking for a summary", () => {
    it("is recognised", () => {
        for (const m of ["what have we done in this chat", "what did we do so far", "recap this chat", "what have you done for me in this conversation", "whats been changed so far today".replace("whats been changed", "what have we changed")])
            expect(asksChatSummary(m), m).toBe(true);
    });
    it("leaves other questions alone", () => {
        for (const m of ["what have i got on today", "what should we do today", "what did i eat", "do the summary slides for ma 2201", "undo what we did"])
            expect(asksChatSummary(m), m).toBe(false);
    });
});
describe("the summary", () => {
    it("says nothing was done when nothing was", () => expect(chatSummary([], 0)).toMatch(/haven't made or changed anything/));
    it("lists only what the ledger holds, never a bedtime", () => {
        const t = chatSummary([{ kind: "block", label: "haircut", at: 1 }, { kind: "water", label: "water", at: 2, count: 2 }], 1);
        expect(t).toContain('put "haircut" on your day');
        expect(t).toContain("2 water bottles");
        expect(t).toContain("changed your calendar once");
        expect(t).not.toMatch(/bedtime|alarm/i);
    });
});
describe("through the routing: the desk's drafted summary is never what he hears", () => {
    it("answers from the ledger even when the desk drafted a claim", async () => {
        const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
        const { registerLocalRouting } = await import("./local-routing.js");
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const dir = mkdtempSync(join(tmpdir(), "cs-"));
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), stateDir: dir, clock: () => "Wed 14:00", brainSearch: async () => "",
            decideImpl: async () => ({ move: "answer", answer: "We adjusted your bedtime to midnight and set your alarm for 7:45 AM." }),
            scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) });
        const ctx = { runId: "cs-1", sessionKey: "agent:main:orion-chat-cs" };
        const fire = async (n, e) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, ctx)); return out; };
        const said = "what have we done in this chat";
        await fire("before_model_resolve", { prompt: said });
        const [direct] = (await fire("before_agent_reply", { cleanedBody: said }));
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }));
        const heard = `${direct?.reply?.text ?? ""} ${built?.systemPrompt ?? ""}`;
        expect(heard).toContain("haven't made or changed anything");
        expect(heard).not.toMatch(/midnight|7:45/);
    });
});
