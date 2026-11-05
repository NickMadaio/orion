// w20 review H3: "Say go and I'll retry it." is kept: a bare go runs the failed message again.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const OFFER = "I couldn't log that just now, so nothing was logged. Say go and I'll retry it.";
function harness() {
    const handlers = new Map();
    const fire = async (name, event, ctx) => {
        for (const fn of handlers.get(name) ?? [])
            await fn(event, ctx);
    };
    const logPath = join(mkdtempSync(join(tmpdir(), "retry-")), "r.jsonl");
    registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, { warm: false, mode: "on", logPath, decideImpl: async () => ({ move: "escalate", tier: "standard" }), clock: () => "Fri 10:00", now: () => new Date(2026, 9, 16, 10, 0) });
    let n = 0;
    const turn = async (prompt, reply, session = "agent:main:orion-chat-1") => {
        const ctx = { runId: `rt-${n++}`, sessionKey: session };
        await fire("before_model_resolve", { prompt }, ctx);
        await fire("before_agent_finalize", { runId: ctx.runId, lastAssistantMessage: reply, messages: [] }, ctx);
        const rows = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
        return rows[rows.length - 1].message;
    };
    const said = async (prompt, reply) => {
        const ctx = { runId: `rt-${n++}`, sessionKey: "agent:main:orion-chat-1" };
        const messages = [{ role: "assistant", content: [{ type: "text", text: reply }] }];
        await fire("before_model_resolve", { prompt }, ctx);
        await fire("before_agent_finalize", { runId: ctx.runId, lastAssistantMessage: reply, messages }, ctx);
        return JSON.stringify(messages);
    };
    return { turn, said };
}
describe("a bare go after a retry offer", () => {
    it("runs the message that failed, and again if it fails again", async () => {
        const { turn } = harness();
        expect(await turn("log my breakfast it was beans on toast", OFFER)).toBe("log my breakfast it was beans on toast");
        expect(await turn("yeah go", OFFER)).toBe("log my breakfast it was beans on toast");
        expect(await turn("go", "Logged it.")).toBe("log my breakfast it was beans on toast");
    });
    it("is just a word once the offer is used up or something else was said", async () => {
        const { turn } = harness();
        await turn("log my breakfast it was beans on toast", OFFER);
        expect(await turn("whats on today", "Nothing much.")).toBe("whats on today");
        expect(await turn("go", "ok")).toBe("go");
    });
    it("keeps one chat's offer out of another's", async () => {
        const { turn } = harness();
        await turn("log my breakfast it was beans on toast", OFFER, "agent:main:a");
        expect(await turn("go", "ok", "agent:main:b")).toBe("go");
    });
    it("a reply to a bare go that offers a retry has nothing to replay, so it stops promising one", async () => {
        const { said } = harness();
        const out = await said("go", OFFER);
        expect(out).not.toMatch(/say go and i'll retry/i);
        expect(out).toContain("Ask me again");
    });
});
