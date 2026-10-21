import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { isLateWithoutMinutes, runLateFlow } from "./late-flow.js";
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
    let scheduleCalls = 0;
    let i = 0;
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r8b-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 15:10",
        decideImpl: async () => decisions[Math.min(i++, decisions.length - 1)],
        scheduleFlow: async () => { scheduleCalls += 1; return extra.scheduleAsk ? { outcome: "say", kind: "ask", text: "Should I move Gym to 6:00 PM so dinner fits?" } : { outcome: "fallback", reason: "t" }; },
        lateFlow: (minutes) => runLateFlow({ minutes, exec: async (a) => { lateCalls.push(a); return { stdout: NOTHING_BOOKED, code: 0 }; } }),
        messagesRead: (req) => runMessagesRead(req, async () => ({ stdout: extra.readOut ?? "", code: 0 })) });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `r8b-${n++}`, sessionKey: "agent:main:orion-chat-r8b" };
        await f.fire("before_model_resolve", { prompt }, ctx);
        const replied = await f.fire("before_agent_reply", { cleanedBody: prompt }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return { ctx, replied, text: `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
    };
    return { f, turn, lateCalls, scheduleCalls: () => scheduleCalls };
}
// H1 (r8 review 1, 2026-10-16): a bare "yeah" after another flow's question must not run late again.
describe("H1: a bare yes is a late go-ahead only right after a late reply", () => {
    it("'yeah' / 'ok' after the schedule flow's question do not run late again", async () => {
        const h = harness([{ move: "answer", answer: "ok" }], { scheduleAsk: true });
        await h.turn("im running late");
        await h.turn("15");
        expect(h.lateCalls).toEqual([["late", "15"]]);
        const q = await h.turn("move dinner to 7 tonight");
        expect(q.text).toContain("Should I move Gym to 6:00 PM");
        await h.turn("yeah");
        await h.turn("ok");
        expect(h.lateCalls).toEqual([["late", "15"]]);
    });
    it("the q029 go-ahead right after the late reply still works", async () => {
        const h = harness([{ move: "answer", answer: "ok" }]);
        await h.turn("im running late");
        await h.turn("like 15 min");
        await h.turn("yeah push everything after it");
        expect(h.lateCalls).toHaveLength(2);
    });
});
// H2: only Nick's own bare lateness asks "how late?".
describe("H2: lateness that is not Nick's own running late", () => {
    const notHis = ["text mom I'm late", "sam is running late", "I'll be late tomorrow", "im running late for lab tomorrow", "remind me so I won't be late",
        "the bus is gonna be late", "I'm late on rent", "am i running late", "im behind schedule on everything"];
    for (const msg of notHis)
        it(`"${msg}" is not the late flow`, async () => {
            expect(isLateWithoutMinutes(msg)).toBe(false);
            const h = harness([{ move: "answer", answer: "ok" }]);
            await h.turn(msg);
            await h.turn("20");
            expect(h.lateCalls).toEqual([]);
        });
    for (const msg of ["im running late", "i'm running late", "gonna be a bit late", "i'm running a little late", "im behind schedule", "i'll be late"])
        it(`"${msg}" still is`, () => {
            expect(isLateWithoutMinutes(msg)).toBe(true);
        });
    it("q017 'im running 20 min late to cs1800 lecture, push the stuff after it back' keeps its path", async () => {
        const h = harness([{ move: "answer", answer: "ok" }]);
        await h.turn("im running 20 min late to cs1800 lecture, push the stuff after it back");
        expect(h.lateCalls).toEqual([]);
        expect(h.scheduleCalls()).toBe(1);
    });
});
// H4: code-run reads are not "host tools"; a correct summary of them is left alone.
describe("H4: the finalize safety net only replaces after host-run tools", () => {
    for (const [ask, readOut, reply] of [
        ["search gmail for the internship offer", "Internship offer — HR <hr@acme.com> Oct 15", "I found the offer email from Acme HR, sent October 15."],
        ["read my last 3 texts", "2026-10-16 14:02  Sam: dinner is booked for 7, confirmed", "Sam confirmed dinner is booked for 7."],
    ])
        it(`"${ask}": a correct summary stays`, async () => {
            const h = harness([{ move: "tool", tool: "brain", args: {} }], { readOut });
            const t = await h.turn(ask);
            const messages = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: reply }] }];
            for (const side of [false, true]) {
                const [out] = await h.f.fire("before_agent_finalize", { lastAssistantMessage: reply, messages, hadDeterministicSideEffect: side }, t.ctx);
                expect(out).toBeUndefined();
                expect(JSON.stringify(messages[1])).toContain(reply.slice(0, 20));
            }
        });
    it("q029: the host-run exec plus a false claim is still replaced (a push code does not read: \"push my day back 15 minutes\" itself is the late flow now)", async () => {
        const h = harness([{ move: "escalate", tier: "standard" }]);
        const { ctx } = await h.turn("push my day back 15 minutes, if that works");
        await h.f.fire("after_tool_call", { toolName: "exec", params: { command: "/x/scripts/orion-reschedule late 15" }, result: NOTHING_BOOKED }, ctx);
        const reply = "Your schedule has been adjusted. Everything has been pushed forward.";
        const messages = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: reply }] }];
        await h.f.fire("before_agent_finalize", { lastAssistantMessage: reply, messages, hadDeterministicSideEffect: false }, ctx);
        expect(JSON.stringify(messages[1])).toContain("I couldn't move anything, so nothing was moved");
    });
});
describe("LOW: a block pushed past midnight is spoken as AM", () => {
    it("24:05 is 12:05 AM", async () => {
        const flow = await runLateFlow({ minutes: 30, exec: async () => ({ stdout: "Changed:\n  moved Study: 23:35 → 24:05", code: 0 }) });
        expect(flow.reply).toContain("Study now 12:05 AM");
    });
});
