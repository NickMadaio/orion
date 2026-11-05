// w20 r5 (live gate 3 #100): "open youtube in safari and tell me whats the weather" opened Safari only. Both asks are done: code opens, the question is answered.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitLeadOpen } from "./chat-asks.js";
import { registerLocalRouting } from "./local-routing.js";
describe("an open followed by a question", () => {
    it.each([
        ["open youtube in safari and tell me whats the weather", "https://www.youtube.com", "tell me whats the weather"],
        ["open amazon uk then whats on my list", "https://www.amazon.co.uk", "whats on my list"],
        ["pull up youtube in chrome and tell me what the weather is like", "https://www.youtube.com", "tell me what the weather is like"],
        ["open the german ebay, then check how much protein is in a wrap", "https://www.ebay.de", "check how much protein is in a wrap"],
        ["open safari and show me whats on tomorrow", undefined, "show me whats on tomorrow"],
        ["open youtube and also tell me the time", "https://www.youtube.com", "tell me the time"],
    ])("%s", (m, url, rest) => {
        const s = splitLeadOpen(m);
        expect(s?.rest, m).toBe(rest);
        if (url)
            expect(s?.req).toMatchObject({ kind: "url", url });
        else
            expect(s?.req).toMatchObject({ kind: "app", name: "safari" });
    });
    it("is not fooled by a single ask or a non-open head", () => {
        for (const m of ["open youtube in safari", "tell me the weather and open safari", "what is on and open it later", "open safari and open youtube"])
            expect(splitLeadOpen(m), m).toBeNull();
    });
});
describe("through the routing", () => {
    it("opens by code, then the worker is told the open is done and answers the rest", async () => {
        const handlers = new Map();
        const opened = [];
        registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lo-")), "r.jsonl"), clock: () => "Thu 15:00", brainSearch: async () => "",
            decideImpl: async () => ({ move: "escalate", tier: "standard" }), scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
            chatRun: { open: async (a) => { opened.push(a); return { stdout: "", code: 0 }; }, installed: async () => true, tasks: async () => ({ stdout: "", code: 0 }) } });
        const ctx = { runId: "lo-1", sessionKey: "agent:main:orion-chat-lo" };
        const fire = async (n, e) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, ctx)); return out; };
        const said = "open youtube in safari and tell me whats the weather";
        await fire("before_model_resolve", { prompt: said });
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }));
        expect(opened).toEqual([["-a", "Safari", "https://www.youtube.com"]]);
        expect(built?.systemPrompt).toContain("Opened youtube.com in Safari.");
        expect(built?.systemPrompt).toMatch(/weather/i);
    });
});
