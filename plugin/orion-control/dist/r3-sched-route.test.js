// w20 round 3: the routes (hooks), not just the pieces: what Nick is actually told, at 1:30 AM on Thu 5 Nov 2026.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
function fakeApi() {
    const handlers = new Map();
    return {
        api: { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
        fire: async (name, event, ctx = {}) => { const out = []; for (const fn of handlers.get(name) ?? [])
            out.push(await fn(event, ctx)); return out; },
    };
}
const NIGHT = new Date(2026, 10, 5, 1, 30);
const DAY = "B1 09:00–10:30 CS1800 Discrete Structures — Lecture (FIXED)\nB2 11:20–12:20 practice leetcode";
function harness(decision, extra = {}) {
    const f = fakeApi();
    const flows = [];
    let n = 0;
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r3-")), "r.jsonl"), now: () => NIGHT,
        decideImpl: async () => decision, clock: () => "Thu 01:30", brainSearch: async () => "",
        scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "a question, not a change" }; },
        readDay: async () => DAY, ...extra });
    const turn = async (prompt, messages = []) => {
        n += 1;
        const ctx = { runId: `r3-${n}`, sessionKey: "agent:main:orion-chat-r3" };
        await f.fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt, messages }, ctx));
        return `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}`;
    };
    return { turn, flows, f };
}
describe("1:30 AM: tomorrow, and yesterday", () => {
    it("'whats tomorrow looking like' is the coming day, dated, from the calendar read, not the model's weekday", async () => {
        const h = harness({ move: "escalate", tier: "quick" });
        const said = await h.turn("whats tomorrow looking like");
        expect(said).toMatch(/Thursday 5 Nov/);
        expect(said).toMatch(/Friday 6 Nov/);
        expect(said).toMatch(/CS1800 Discrete Structures at 9:00 AM/);
        expect(h.flows).toEqual([]);
    });
    it("'what did i have on yesterday evening' reads that day's agenda", async () => {
        const asked = [];
        const h = harness({ move: "escalate", tier: "quick" }, { agendaDay: async (date) => { asked.push(date); return { date, events: [{ title: "Dinner with Sam", start: "18:30" }, { title: "Gym", start: "20:00" }] }; } });
        const said = await h.turn("what did i have on yesterday evening");
        expect(asked).toEqual(["2026-11-04"]);
        expect(said).toMatch(/On Wednesday 4 Nov evening you had Dinner with Sam at 6:30 PM and Gym at 8:00 PM\./);
        expect(said).not.toMatch(/access/);
    });
});
describe("stop the focus session", () => {
    it("runs the stop and tells him what the session reads back", async () => {
        const calls = [];
        let stopped = false;
        const sessionExec = async (args) => { calls.push(args[0]); if (args[0] === "abandon")
            stopped = true; return { stdout: JSON.stringify({ ok: true, status: stopped ? "inactive" : "running", task: "essay", servedFocusSeconds: 600 }), code: 0 }; };
        const h = harness({ move: "escalate", tier: "quick" }, { sessionExec, sessionStatus: async () => ({ outcome: "fallback", reason: "x" }) });
        const said = await h.turn("actually stop the focus session, im knackered");
        expect(calls).toContain("abandon");
        expect(said).toMatch(/Stopped: your essay session is over and nothing is running now/);
    });
});
describe("a long chat", () => {
    it("57 turns of history are trimmed in place before the prompt is built", async () => {
        const h = harness({ move: "escalate", tier: "quick" });
        const messages = Array.from({ length: 57 }, (_, i) => [{ role: "user", content: `m${i} ${"x".repeat(1500)}` }, { role: "assistant", content: [{ type: "text", text: `r${i} ${"y".repeat(1500)}` }] }]).flat();
        await h.turn("hey", messages);
        expect(messages.length).toBeLessThan(60);
        expect(messages[0].role).toBe("user");
    });
    it("the host's raw overflow error is replaced at finalize, with a retry offered", async () => {
        const h = harness({ move: "escalate", tier: "quick" });
        await h.turn("add gym at half 5");
        const raw = "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.";
        const messages = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: raw }] }];
        await h.f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: raw, messages }, { runId: "r3-2", sessionKey: "agent:main:orion-chat-r3" });
        expect(JSON.stringify(messages)).not.toMatch(/Context overflow|\/reset/);
        expect(JSON.stringify(messages)).toMatch(/Say go and I'll retry it/);
    });
});
describe("what he says reaches the right route", () => {
    const dayJson = { date: "2026-11-05", now: "01:30", blocks: [{ title: "Call with mum", start: "17:40", end: "18:20", fixed: true, kind: "other" }] };
    function edits() {
        const calls = [];
        const realityRun = async (script, args) => { calls.push([script, ...args]); return script === "orion-declare" ? { stdout: JSON.stringify({ id: "fact-abcd1234" }), code: 0 } : { stdout: "Changed Thursday 2026-11-05:\n  moved it\nWritten to his calendar.", code: 0 }; };
        const h = harness({ move: "escalate", tier: "quick" }, { realityRun, readDayJson: async () => dayJson, agendaDay: async (date) => ({ date, events: [{ title: "Dinner", start: "18:00" }, { title: "CS1800 Discrete Structures — Lecture", start: "09:00" }] }) });
        return { calls, h };
    }
    it("'i actually did dinner at 7 not 6 earlier' rewrites last evening's dinner", async () => {
        const { calls, h } = edits();
        const said = await h.turn("i actually did dinner at 7 not 6 earlier");
        expect(calls.find((c) => c[1] === "log")).toEqual(expect.arrayContaining(["Dinner", "--from", "19:00", "--date", "yesterday"]));
        expect(said).toMatch(/Dinner/);
        expect(h.flows).toEqual([]);
    });
    it("'i didnt go to the lecture yesterday, i was at the library 2-4 instead' marks it missed and logs the library", async () => {
        const { calls, h } = edits();
        const said = await h.turn("i didnt go to the lecture yesterday, i was at the library 2-4 instead");
        expect(calls.find((c) => c[0] === "orion-declare")).toEqual(expect.arrayContaining(["--date", "2026-11-04"]));
        expect(calls.find((c) => c[1] === "log")).toEqual(expect.arrayContaining(["Library", "--from", "14:00", "--to", "16:00"]));
        expect(said).toMatch(/missed yesterday/);
    });
    it("'i actually called mum at 4 not 5 so shift it' moves the call to 4", async () => {
        const { calls, h } = edits();
        await h.turn("i actually called mum at 4 not 5 so shift it");
        expect(calls.find((c) => c[1] === "move")).toEqual(expect.arrayContaining(["Call with mum", "--to", "16:00"]));
    });
    it("'set a 10 min timer for my pasta' is the timer tool's, never the calendar's", async () => {
        const h = harness({ move: "escalate", tier: "quick" }, { scheduleFlow: async () => { throw new Error("the calendar flow must not run for a timer"); } });
        const said = await h.turn("set a 10 min timer for my pasta");
        expect(said).toMatch(/timer_set/);
        expect(said).toMatch(/600/);
        expect(h.flows).toEqual([]);
    });
});
describe("try again", () => {
    it("after a refused add, 'try again' runs that same add again", async () => {
        const seen = [];
        const refused = "I couldn't add the call: the tool didn't show it booked. Want me to try it a different way?";
        const h = harness({ move: "escalate", tier: "quick" }, { scheduleFlow: async (m) => { seen.push(m); return seen.length === 1 ? { outcome: "say", kind: "plain", text: refused } : { outcome: "fallback", reason: "x" }; } });
        await h.turn("add a 40 min call with mum after lunch");
        const messages = [{ role: "user", content: "add a 40 min call with mum after lunch" }, { role: "assistant", content: [{ type: "text", text: refused }] }];
        await h.f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: refused, messages }, { runId: "r3-1", sessionKey: "agent:main:orion-chat-r3" });
        await h.turn("try again");
        expect(seen).toEqual(["add a 40 min call with mum after lunch", "add a 40 min call with mum after lunch"]);
    });
});
