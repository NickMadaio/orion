// Round 8 review 2 (2026-10-16): false-claim findings on ordinary turns, the deadline question gate and labels, a bare "ok"
// after a late reply, the day-absence words. Every exec is stubbed. Written by Claude on 2026-10-16.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { runLateFlow } from "./late-flow.js";
import { asksDeadlines, deadlineReply } from "./deadline-read.js";
import { noBlockReply } from "./day-read-answers.js";
function harness(opts = {}, extra = {}) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const out = []; for (const fn of handlers.get(n) ?? [])
        out.push(await fn(e, c)); return out; };
    const lateCalls = [];
    const sched = [];
    let n = 0;
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r8r2-")), "r.jsonl"), brainSearch: async () => extra.brain ?? "", clock: () => "Fri 15:10",
        now: () => new Date(2026, 9, 16, 15, 10),
        decideImpl: async () => ({ move: "escalate", tier: "standard" }),
        scheduleFlow: async (m) => { sched.push(m); return { outcome: "say", kind: "ask", text: "FORM-ASK" }; },
        lateFlow: (minutes) => runLateFlow({ minutes, exec: async (a) => { lateCalls.push(a); return { stdout: extra.lateOut ?? "Changed Friday:\n  moved Gym: 16:00 → 16:15", code: 0 }; } }),
        nickNote: () => "", ...opts });
    const turn = async (prompt) => {
        const ctx = { runId: `r2-${n++}`, sessionKey: "agent:main:orion-chat-r2" };
        await fire("before_model_resolve", { prompt }, ctx);
        const replied = await fire("before_agent_reply", { cleanedBody: prompt }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return { ctx, replied, text: `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
    };
    const finalize = async (ctx, reply, side = false) => {
        const messages = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: reply }] }];
        const [out] = await fire("before_agent_finalize", { lastAssistantMessage: reply, messages, hadDeterministicSideEffect: side }, ctx);
        return { out: out, final: (messages[1].content[0]).text };
    };
    return { turn, finalize, lateCalls, sched };
}
describe("HIGH-1: a false claim on an ordinary worker turn is still caught", () => {
    for (const brain of ["", "## Groceries\nmilk, oats, eggs"]) {
        it(`"log 500ml of water", no tool, "Logged 500ml of water." (brain snippets: ${!!brain})`, async () => {
            const h = harness({}, { brain });
            const t = await h.turn("log 500ml of water");
            let r = await h.finalize(t.ctx, "Logged 500ml of water.");
            if (r.out?.action !== "revise")
                expect(r.final).not.toBe("Logged 500ml of water.");
            else
                expect(r.out.action).toBe("revise");
        });
    }
    it("a gmail read that code ran keeps its summary", async () => {
        const h = harness({ messagesRead: async () => ({ calls: ["gmail search"], outputs: ["Offer from Acme HR, Oct 15"], data: "Offer from Acme HR, sent October 15." }) });
        const t = await h.turn("search my gmail for the offer email");
        const reply = "I found the offer email from Acme HR, sent October 15.";
        const r = await h.finalize(t.ctx, reply);
        expect(r.out?.action).not.toBe("revise");
        expect(r.final).toBe(reply);
    });
});
const RD = async () => ({ events: [{ title: "Macro Quiz 2", start: "2026-10-20T00:00:00", allDay: "true", isDeadline: true }], tasks: [] });
describe("HIGH-2: the deadline read needs a real question", () => {
    const passes = ["whats due this week", "what's due friday?", "any deadlines coming up", "my deadlines", "upcoming deadlines", "deadlines this week", "any deadlines i should know about"];
    const falls = ["i dont have anything due this week so plan a chill day for me", "nothing is due today so put a 3 hour gym block at 2", "tell sam whats due friday", "text mom i have deadlines this week",
        "i wonder what's due", "remind me what's due friday", "since nothing's due tomorrow clear my afternoon", "my deadlines are killing me", "ugh so many deadlines", "make the essay due friday"];
    for (const m of passes)
        it(`reads: ${m}`, async () => {
            const h = harness({ readDeadlines: RD });
            const r = await h.turn(m);
            expect(r.text).toMatch(/Due |Nothing is due/);
        });
    for (const m of falls)
        it(`does not read: ${m}`, async () => {
            const h = harness({ readDeadlines: RD });
            const r = await h.turn(m);
            expect(r.text).not.toMatch(/Due this|Nothing is due|Due friday|Due tomorrow/);
            expect(asksDeadlines(m, false)).toBe(false);
        });
    it("the plan-a-chill-day message reaches the schedule flow", async () => {
        const h = harness({ readDeadlines: RD });
        await h.turn("i dont have anything due this week so plan a chill day for me");
        expect(h.sched).toHaveLength(1);
    });
});
describe("HIGH-3 / M2: labels and windows", () => {
    const MON = new Date(2026, 9, 19, 9, 0);
    const read = { events: [{ title: "Essay", start: new Date(2026, 9, 30, 0, 0).toISOString(), allDay: "true", isDeadline: true }, { title: "Lab", start: new Date(2026, 9, 23, 9, 0).toISOString(), isDeadline: true }, { title: "Thu thing", start: new Date(2026, 9, 22, 9, 0).toISOString(), isDeadline: true }], tasks: [] };
    it("next friday says its date", () => {
        expect(deadlineReply("what's due next friday", read, MON)).toBe("Due next Friday, Oct 30: Essay, Friday Oct 30 (all day).");
        expect(deadlineReply("what's due next friday", { events: [], tasks: [] }, MON)).toMatch(/^Nothing is due next Friday, Oct 30\./);
    });
    it("by friday is today through Friday; before friday leaves Friday out", () => {
        expect(deadlineReply("what's due by friday", read, MON)).toContain("Lab");
        const before = deadlineReply("what's due before friday", read, MON);
        expect(before).toContain("Thu thing");
        expect(before).not.toContain("Lab");
    });
    it("between midnight and 5 AM items are described by weekday, not today", () => {
        const night = new Date(2026, 9, 22, 2, 0);
        const r = deadlineReply("whats due today", read, night);
        expect(r).toContain("Thu thing, Thursday at 9:00 AM");
        expect(r).not.toMatch(/today|tomorrow/i);
    });
});
describe("MEDIUM-1: a bare ok after a late reply that asked nothing", () => {
    const NB = "NOTHING WAS BOOKED on Friday (2026-10-16). Do not tell him anything was added or moved.\nChanged Friday 2026-10-16:\n  rebuilt the remaining day from fixed commitments and must-haves first";
    it("does not run late again", async () => {
        const h = harness({}, { lateOut: NB });
        for (const m of ["im running late", "like 15 min", "ok"])
            await h.turn(m);
        expect(h.lateCalls).toHaveLength(1);
    });
    it("the explicit go-ahead still works", async () => {
        const h = harness({}, { lateOut: NB });
        for (const m of ["im running late", "like 15 min"])
            await h.turn(m);
        const r = await h.turn("yeah push everything after it");
        expect(r.replied.find(Boolean) ?? r.text).toBeTruthy();
        expect(h.lateCalls.length).toBeLessThanOrEqual(2);
    });
});
describe("MEDIUM-3: day absence words", () => {
    const day = (titles) => titles.map((t, i) => `B${i + 1} ${String(16 + i).padStart(2, "0")}:00–${String(16 + i).padStart(2, "0")}:45 ${t}`).join("\n");
    const present = [
        ["when is my lab today", ["CHEM1211 Labs"]], ["when's my workout today", ["Yoga"]], ["when is my gym session", ["Leg day"]], ["when is my gym session", ["Pilates"]],
        ["when is my meal prep", ["Meal-prep"]], ["when does the gym close today", ["Study"]], ["how long is the gym open today", ["Study"]],
        ["when is my study block", ["CS2500 HW4"]], ["when is my study block", ["Homework"]], ["when is my lab today", ["Lab: CS2500"]],
    ];
    for (const [q, t] of present)
        it(`${q} / ${t.join(",")} is null`, () => expect(noBlockReply(q, day(t), false)).toBeNull());
    it("still claims absence when none is there", () => {
        expect(noBlockReply("when is my lab today", day(["Dinner"]), false)).toMatch(/^There's no lab block/);
        expect(noBlockReply("when is my meal prep", day(["Dinner"]), false)).toMatch(/^There's no meal prep block/);
    });
});
