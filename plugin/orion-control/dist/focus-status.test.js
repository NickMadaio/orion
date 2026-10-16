// Live sweep r8 (2026-10-16): q053 "is my focus session on", q050 "what am i supposed to be working on right now",
// q052 "how long have i been focusing today". Every exec is stubbed; nothing here touches a session.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { runSessionStatus } from "./session-flow.js";
import { asksFocusOn, asksFocusToday, focusTodayReply, focusTodayTotal, noSessionReply } from "./focus-status.js";
const NONE = JSON.stringify({ ok: true, status: "finished", phase: "abandoned", servedFocusSeconds: 2.2, dayKey: "2026-10-15" });
const RUNNING = JSON.stringify({ ok: true, status: "running", phase: "focus", task: "cs1800 hw", remainingSeconds: 1500, servedFocusSeconds: 1800, totalBlocks: 1, blockNumber: 1 });
const DAY = "B1 13:30–15:00 MKTG2201 Introduction to Marketing — Lecture (FIXED)\nB2 15:30–17:00 ECON1115 Principles of Macroeconomics — Lecture (FIXED)";
const NOW = new Date(2026, 9, 16, 11, 0);
function setup(decision, over = {}) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const execs = [];
    const logPath = join(mkdtempSync(join(tmpdir(), "r8fs-")), "r.jsonl");
    registerLocalRouting(api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Fri 11:00", brainSearch: async () => "",
        now: () => over.now ?? NOW, scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
        sessionStatus: () => runSessionStatus({ exec: async (args) => { execs.push(args); return { stdout: over.status ?? NONE, code: 0 }; } }),
        focusHistory: () => over.rows ?? [], readDay: async () => over.day ?? DAY });
    const turn = async (prompt) => {
        const ctx = { runId: `r8${prompt.length}`, sessionKey: "agent:main:orion-chat-1" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        await fire("before_agent_finalize", { runId: ctx.runId, messages: [], lastAssistantMessage: "x" }, ctx);
        const log = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
        return { prompt: built?.systemPrompt ?? "", execs, log };
    };
    return { turn };
}
const exactly = (prompt) => /exactly this text and nothing else[^\n]*\n(.*)/.exec(prompt)?.[1];
describe("q053: is my focus session on", () => {
    it("recognises it", () => { expect(asksFocusOn("is my focus session on")).toBe(true); expect(asksFocusOn("start a focus session")).toBe(false); });
    it("the status read is recorded as a tool", async () => {
        const out = await setup({ move: "tool", tool: "session", args: { do: "status" } }).turn("is my focus session on");
        expect(exactly(out.prompt)).toBe("No focus session is running right now.");
        expect(out.log?.tools).toBe(1);
        expect(out.execs).toEqual([["status", "--json"]]);
    });
    it("works without the front desk picking the tool", async () => {
        const out = await setup({ move: "ask", answer: "?" }, { status: RUNNING }).turn("is my focus session on");
        expect(exactly(out.prompt)).toBe("Your focus session on cs1800 hw is running: 25 minutes left.");
    });
});
describe("q050: what am i supposed to be working on right now", () => {
    const ask = "what am i supposed to be working on right now";
    it("a running session is the answer, with its time left", async () => {
        const out = await setup({ move: "ask", answer: "?" }, { status: RUNNING }).turn(ask);
        expect(exactly(out.prompt)).toBe("Your focus session on cs1800 hw is running: 25 minutes left.");
        expect(out.log?.tools).toBe(1);
    });
    it("no session: the next block today, built by code, both reads recorded", async () => {
        const out = await setup({ move: "ask", answer: "?" }).turn(ask);
        expect(exactly(out.prompt)).toBe("No focus session is running. Next on your calendar: MKTG2201 Introduction to Marketing at 1:30 PM.");
        expect(out.log?.tools).toBe(2);
    });
    it("no session and an empty day read (a failed read looks the same): only the status is said, no day claim", async () => {
        const out = await setup({ move: "ask", answer: "?" }, { day: "" }).turn(ask);
        expect(exactly(out.prompt)).toBe("No focus session is running right now.");
        expect(out.log?.tools).toBe(1);
    });
    it("no session: the block he is in now", () => {
        expect(noSessionReply(DAY, "14:10")).toBe("No focus session is running. Right now on your calendar: MKTG2201 Introduction to Marketing until 3:00 PM.");
    });
    it("blocks that already happened are skipped; nothing left says so", () => {
        expect(noSessionReply("B1 09:00–10:00 Gym (already happened)", "11:00")).toBe("No focus session is running, and nothing else is on your calendar today.");
        expect(noSessionReply("", "11:00")).toBe("No focus session is running, and nothing else is on your calendar today.");
    });
});
describe("q052: how long have i been focusing today", () => {
    const ask = "how long have i been focusing today";
    const rows = [
        { dayKey: "2026-10-16", servedFocusSeconds: 3000, reason: "completed" },
        { dayKey: "2026-10-16", servedFocusSeconds: 1800, reason: "abandoned" },
        { dayKey: "2026-10-16", servedFocusSeconds: 2.2, reason: "abandoned" },
        { dayKey: "2026-10-15", servedFocusSeconds: 9000, reason: "completed" },
    ];
    it("recognises it, and not the time-left question", () => {
        expect(asksFocusToday(ask)).toBe(true);
        expect(asksFocusToday("how much focus time have i done today")).toBe(true);
        expect(asksFocusToday("how much focus time is left")).toBe(false);
    });
    it("sums today's focused minutes (abandoned count only what was served), not yesterday's", async () => {
        const out = await setup({ move: "ask", answer: "?" }, { rows }).turn(ask);
        expect(exactly(out.prompt)).toBe("You've focused for 1 h 20 min today across 2 sessions.");
        expect(out.log?.tools).toBe(2);
    });
    it("a running session counts what it has served so far", async () => {
        const out = await setup({ move: "ask", answer: "?" }, { rows: [rows[0]], status: RUNNING }).turn(ask);
        expect(exactly(out.prompt)).toBe("You've focused for 1 h 20 min today across 2 sessions.");
    });
    it("nothing today", async () => {
        const out = await setup({ move: "ask", answer: "?" }, { rows: [rows[3]] }).turn(ask);
        expect(exactly(out.prompt)).toBe("You haven't logged any focus time today.");
    });
    it("formats", () => {
        expect(focusTodayReply({ seconds: 2100, sessions: 1 })).toBe("You've focused for 35 min today across 1 session.");
        expect(focusTodayReply({ seconds: 7200, sessions: 3 })).toBe("You've focused for 2 h today across 3 sessions.");
        expect(focusTodayTotal([], "2026-10-16")).toEqual({ seconds: 0, sessions: 0 });
    });
});
describe("start and time-left still behave", () => {
    it("how much focus time is left reads the session", async () => {
        const out = await setup({ move: "tool", tool: "session", args: { do: "status" } }, { status: RUNNING }).turn("how much focus time is left");
        expect(exactly(out.prompt)).toBe("Your focus session on cs1800 hw is running: 25 minutes left.");
        expect(out.execs).toEqual([["status", "--json"]]);
    });
});
