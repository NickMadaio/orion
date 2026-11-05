// w20 r5 (live gate 3 #30 #52): "go" answers the offer ORION made last in THIS chat, not an old retry slot left under another key.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const RETRY = "I haven't made anything like \"before\" in this chat that I can take off, so nothing changed. Say go and I'll retry it.";
const BUILD = "I can't do that from chat yet. Want me to build that?";
function harness() {
    const handlers = new Map();
    let clock = new Date(2026, 10, 5, 5, 0).getTime();
    const fire = async (name, event, ctx) => { for (const fn of handlers.get(name) ?? [])
        await fn(event, ctx); };
    const logPath = join(mkdtempSync(join(tmpdir(), "ob-")), "r.jsonl");
    registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, { warm: false, mode: "on", logPath, decideImpl: async () => ({ move: "escalate", tier: "standard" }), clock: () => "Thu 05:00", now: () => new Date(clock) });
    let n = 0;
    const turn = async (prompt, reply, session, gapMs = 10_000) => {
        clock += gapMs;
        const ctx = { runId: `ob-${n++}`, sessionKey: session };
        await fire("before_model_resolve", { prompt }, ctx);
        await fire("before_agent_finalize", { runId: ctx.runId, lastAssistantMessage: reply, messages: [] }, ctx);
        const rows = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
        return rows[rows.length - 1].message;
    };
    return { turn };
}
const A = "agent:main:orion-chat-a", B = "agent:main:orion-chat-b";
describe("go and the latest offer", () => {
    it("an old slot under another chat key does not answer a go here", async () => {
        const h = harness();
        await h.turn("revert that and the one before it as well", RETRY, A);
        expect(await h.turn("go", "ok", B, 5 * 60_000)).toBe("go");
    });
    it("a fresh slot under another key still answers (the phone's several keys)", async () => {
        const h = harness();
        await h.turn("log my breakfast it was beans on toast", "I couldn't log that. Say go and I'll retry it.", A);
        expect(await h.turn("go", "ok", B, 20_000)).toBe("log my breakfast it was beans on toast");
    });
    it("a build offer made after the slot owns the go in this chat", async () => {
        const h = harness();
        await h.turn("log my breakfast it was beans on toast", "I couldn't log that. Say go and I'll retry it.", A);
        await h.turn("open the thing", BUILD, A);
        expect(await h.turn("go", "ok", A)).toBe("go");
    });
    it.each(["yeah go", "go on", "do it", "yeah go on", "ok go ahead"])("%s with the slot as the latest offer still replays it", async (w) => {
        const h = harness();
        await h.turn("log my breakfast it was beans on toast", "I couldn't log that. Say go and I'll retry it.", A);
        expect(await h.turn(w, "ok", A)).toBe("log my breakfast it was beans on toast");
    });
});
