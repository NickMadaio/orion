import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { runLateFlow, LATE_ASK } from "./late-flow.js";
import { runMessagesRead } from "./messages-read.js";
function fakeApi() {
    const handlers = new Map();
    return {
        api: { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
        fire: async (name, event, ctx = {}) => {
            const out = [];
            for (const fn of handlers.get(name) ?? [])
                out.push(await fn(event, ctx));
            return out;
        },
    };
}
const NOTHING_BOOKED = "NOTHING WAS BOOKED on Friday (2026-10-16). Do not tell him anything was added or moved.\nChanged Friday 2026-10-16:\n  rebuilt the remaining day from fixed commitments and must-haves first";
function harness(decisions, extra = {}) {
    const f = fakeApi();
    const lateCalls = [];
    const readCalls = [];
    let flowCalls = 0;
    let i = 0;
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r8-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 15:10",
        decideImpl: async () => decisions[Math.min(i++, decisions.length - 1)],
        scheduleFlow: async () => { flowCalls += 1; return { outcome: "fallback", reason: "t" }; },
        lateFlow: (minutes) => runLateFlow({ minutes, exec: async (a) => { lateCalls.push(a); return { stdout: extra.lateOut ?? NOTHING_BOOKED, code: 0 }; } }),
        messagesRead: (req) => runMessagesRead(req, async (file, args) => { readCalls.push([file, args]); return { stdout: extra.readOut ?? "", code: extra.readCode ?? 0 }; }) });
    let n = 0;
    const turn = async (prompt, sessionKey = "agent:main:orion-chat-q029") => {
        const ctx = { runId: `r8-${n++}`, sessionKey };
        await f.fire("before_model_resolve", { prompt }, ctx);
        const replied = await f.fire("before_agent_reply", { cleanedBody: prompt }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return { ctx, replied, built, text: `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
    };
    return { f, turn, lateCalls, readCalls, flowCalls: () => flowCalls };
}
// q029 (2026-10-16 r8): "im running late" → "like 15 min" → "yeah push everything after it".
describe("q029: running late, three turns", () => {
    it("asks how late by code, stitches the answer, and says plainly that nothing was moved", async () => {
        const h = harness([{ move: "answer", answer: "Got it. Hope you make it safely." }, { move: "ignore" }, { move: "escalate", tier: "standard" }]);
        const one = await h.turn("im running late");
        expect(one.replied).toEqual([undefined]);
        expect(one.text).toContain(LATE_ASK);
        expect(h.lateCalls).toEqual([]);
        const two = await h.turn("like 15 min");
        expect(h.lateCalls).toEqual([["late", "15"]]);
        expect(two.replied).toEqual([undefined]);
        expect(two.text).toContain("Nothing was moved — what's left today is classes and plans with fixed times, which don't slide.");
        expect(two.text).not.toMatch(/Didn't catch that|No problem, I'll wait/);
        const three = await h.turn("yeah push everything after it");
        expect(h.lateCalls).toEqual([["late", "15"], ["late", "15"]]);
        expect(three.text).toContain("Nothing was moved");
        expect(three.text).toContain("do not call any tools");
        expect(h.flowCalls()).toBe(0);
    });
    it("a go-ahead after a late move that worked does not move the day twice", async () => {
        const h = harness([{ move: "answer", answer: "ok" }], { lateOut: "Changed Friday 2026-10-16:\n  moved Study: 16:00 → 16:15" });
        await h.turn("im running late");
        const two = await h.turn("15");
        expect(two.text).toContain("Done, pushed back 15 min: Study now 4:15 PM.");
        const three = await h.turn("yeah push everything after it");
        expect(h.lateCalls).toHaveLength(1);
        expect(three.text).toContain("That's already done.");
    });
    it("a minutes answer with no question pending is not the late flow", async () => {
        const h = harness([{ move: "answer", answer: "ok" }]);
        await h.turn("15");
        expect(h.lateCalls).toEqual([]);
    });
    it("a false 'adjusted' after the 9B's own exec is put in place from the scheduler's words", async () => {
        const h = harness([{ move: "escalate", tier: "standard" }]);
        const { ctx } = await h.turn("push my day back 15 minutes");
        await h.f.fire("after_tool_call", { toolName: "exec", params: { command: "/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule late 15" }, result: NOTHING_BOOKED }, ctx);
        const reply = "Your schedule has been adjusted for the 15-minute delay. Everything after has been pushed forward.";
        const messages = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: reply }] }];
        const [out] = await h.f.fire("before_agent_finalize", { lastAssistantMessage: reply, messages, hadDeterministicSideEffect: true }, ctx);
        expect(out).toBeUndefined();
        expect(JSON.stringify(messages[1])).toContain("I couldn't move anything, so nothing was moved — what's left today is classes and plans with fixed times, which don't slide.");
        expect(JSON.stringify(messages[1])).not.toContain("adjusted");
    });
});
describe("q066 / q069: reads run by code", () => {
    it("'read my last 3 texts' runs orion-messages recent 3 and hands the worker the result", async () => {
        const h = harness([{ move: "tool", tool: "brain", args: { do: "search", query: "last 3 texts" } }], { readOut: "2026-10-16 14:02  Gia: running late\n2026-10-16 13:10  Mom: call me" });
        const t = await h.turn("read my last 3 texts");
        expect(h.readCalls.map(([, a]) => a)).toEqual([["recent", "3"]]);
        expect(t.text).toContain("Gia: running late");
        expect(t.text).toMatch(/Do not call any tools/);
        const reply = "Gia texted at 2:02 PM that she's running late, and Mom asked you to call.";
        const [out] = await h.f.fire("before_agent_finalize", { lastAssistantMessage: reply, messages: [] }, t.ctx);
        expect(out).toBeUndefined();
    });
    it("a Full Disk Access failure is said exactly", async () => {
        const h = harness([{ move: "tool", tool: "brain", args: {} }], { readOut: "orion-messages: Full Disk Access is required to read Messages.", readCode: 4 });
        const t = await h.turn("read my last 3 texts");
        expect(t.text).toContain("I can't read your texts — ORION needs Full Disk Access.");
    });
    it("'search gmail for the internship offer' runs the read-only search", async () => {
        const h = harness([{ move: "tool", tool: "browser", args: { url: "https://mail.google.com/mail/u/0/#inbox" } }], { readOut: "Internship offer — HR <hr@acme.com> Oct 14" });
        const t = await h.turn("search gmail for the internship offer");
        expect(h.readCalls.map(([f, a]) => [f.split("/").pop(), a])).toEqual([["orion-gmail-search", ["internship offer"]]]);
        expect(t.text).toContain("hr@acme.com");
    });
    it("a text to someone is still not a read", async () => {
        const h = harness([{ move: "tool", tool: "messages", args: {} }]);
        await h.turn("text mom i'm late");
        expect(h.readCalls).toEqual([]);
    });
});
