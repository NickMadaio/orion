// 2026-10-19 ~21:00-22:05 BST: ORION kept failing to put "CS Lab" from now until 22:30. Every phrasing below is the one Nick used
// (docs/audits/2026-10-19-cslab-incident.md). Fixtures only: no real paths, no real calendar.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPoliteRequest, isQuestion, answersAsk, registerLocalRouting, userText, REFUSED_NOTHING_CHANGED } from "./local-routing.js";
import { clockAfter, eveningTime, parseDirectAdd, spokenTimesToDigits } from "./direct-add.js";
import { parseAskContext, runScheduleFlow } from "./schedule-flow.js";
import { CRISIS_REPLY, SUPPORT_LINE, isCrisis } from "./distress.js";
import { guardToolCall } from "./tool-guards.js";
// The line the Mac app wrote at 21:54 BST, word for word, then the app context and his words.
const BLANK_ASK = '[ORION context: 1 min ago you asked "Nothing planned till 10:30 - what are you up to? I could put CS Lab there." (blank ask about 17:00-now, he is home). If he says what he did or is doing, log it.]';
const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.
Firm enforcement: not active.
Temporary allowed work apps: none established.
Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.
Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences, no lists, no markdown, times as "8:15 PM". Offer detail only if he asks.

User message:
`;
const asked = (said) => `${BLANK_ASK}\n\n${APP}${said}`;
const spoken = (said) => `${APP}${said}`;
// His day at 21:54: the real classes, Annika at 22:30, and the cs lab he logged 17:50-21:00 (a block that has already happened).
const day = (now = "21:54") => ({ date: "2026-10-19", now, blocks: [
        { title: "CS2100 Program Design & Implementation 1 — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "CS1800 Discrete Structures — Lecture", start: "11:00", end: "12:30", fixed: true, kind: "class" },
        { title: "CS2101 Lab for Program Design & Implementation 1", start: "15:30", end: "17:00", fixed: true, kind: "class" },
        { title: "cs lab", start: "17:50", end: "21:00", fixed: false, kind: "study" },
        { title: "Annika", start: "22:30", end: "23:30", fixed: true },
    ] });
/** Runs the flow with a form that must not be asked (it picked the lab CLASS tonight) and records the scheduler argv. */
async function flow(message, opts = {}) {
    const calls = [];
    let formAsked = 0;
    const askContext = opts.ask ? parseAskContext(opts.ask) : undefined;
    const result = await runScheduleFlow({ message, clock: "Mon 21:54", ...(askContext ? { askContext } : {}),
        exec: async (args) => { calls.push(args); return { stdout: args[0] === "show" ? JSON.stringify(day(opts.now)) : "Changed Monday 2026-10-19:\n  planned CS Lab: 21:55–22:30\nWritten to his calendar.", code: 0 }; },
        ask: async () => { formAsked += 1; return { steps: opts.steps ?? [{ do: "move", what: "B3", until: "10:30" }] }; } });
    return { result, adds: calls.filter((c) => c[0] === "add"), formAsked, calls };
}
describe("the label ORION's own blank ask leaves in his prompt", () => {
    it("carries the offer and the free stretch it named, with the window", () => {
        expect(parseAskContext(BLANK_ASK)).toEqual({ start: "17:00", end: "now",
            text: "Nothing planned till 10:30 - what are you up to? I could put CS Lab there.", suggest: "CS Lab", till: "10:30" });
        expect(userText(asked("yes, put cs lab until 10:30"))).toBe("yes, put cs lab until 10:30");
    });
    it("an ask that offers nothing carries no offer", () => {
        expect(parseAskContext('[ORION context: 3 min ago you asked "Nothing else planned today - what are you up to? Want me to put something there?" (blank ask about 17:00-now, he is home).]')).toMatchObject({ start: "17:00" });
        expect(parseAskContext('[ORION context: 3 min ago you asked "Nothing else planned today - what are you up to? Want me to put something there?" (blank ask about 17:00-now, he is home).]')?.suggest).toBeUndefined();
    });
});
describe("a: 'yes' / 'put X until T' run as an add from now, never the form", () => {
    it("'yes, put cs lab until 10:30' accepts ORION's offer: CS Lab 21:55 to 22:30 (10:30 is the evening)", async () => {
        const r = await flow("yes, put cs lab until 10:30", { ask: BLANK_ASK });
        expect(r.formAsked).toBe(0);
        expect(r.adds).toEqual([["add", "CS Lab", "35", "--at", "21:55", "--again"]]);
        expect(r.result.outcome).toBe("done");
    });
    it("a bare 'yes' accepts the same offer, to the time the ask named", async () => {
        for (const yes of ["yes", "Yeah, do it", "sure", "yes please"]) {
            const r = await flow(yes, { ask: BLANK_ASK });
            expect(r.adds, yes).toEqual([["add", "CS Lab", "35", "--at", "21:55", "--again"]]);
        }
    });
    it("a yes with no offer on the table adds nothing", async () => {
        const r = await flow("yes", { steps: [{ do: "answer", text: "ok" }] });
        expect(r.adds).toEqual([]);
    });
    it("'put CS lab from now until ten thirty' (spelled out) is the same add", async () => {
        const r = await flow("put CS lab from now until ten thirty");
        expect(r.formAsked).toBe(0);
        expect(r.adds).toEqual([["add", "cs lab", "35", "--at", "21:55", "--again"]]);
    });
    it("'Can you please put CS lab from now until ten thirty?' after 'I'm fine…' is the same add", async () => {
        const r = await flow("I'm fine. It's... I'm just annoyed. Can you please put CS lab from now until ten thirty?");
        expect(r.adds).toEqual([["add", "cs lab", "35", "--at", "21:55", "--again"]]);
    });
    it("the continuation, with the noise before it and 'CS' for the title: 'Put CS for right now until ten thirty'", async () => {
        const r = await flow("Pissing Okay. Okay. Yes. Yes. Put CS for right now until ten thirty.");
        expect(r.adds).toEqual([["add", "cs lab", "35", "--at", "21:55", "--again"]]);
    });
    it("an end time already past is refused with a reason, nothing booked", async () => {
        const r = await flow("put cs lab until 9:30 pm");
        expect(r.adds).toEqual([]);
        expect(r.result).toMatchObject({ outcome: "say", text: expect.stringMatching(/too close to now/) });
    });
    it("another day is not this shape: the form decides", async () => {
        expect(parseDirectAdd("put cs lab until ten thirty tomorrow", { ...day(), now: null })).toBeUndefined();
    });
});
describe("a time said without am/pm: the next time that clock shows", () => {
    it("10:30 at 21:55 is 22:30; at 09:00 it is 10:30", () => {
        expect(clockAfter("10:30", 21 * 60 + 55)).toBe(22 * 60 + 30);
        expect(clockAfter("10:30", 9 * 60)).toBe(10 * 60 + 30);
        expect(clockAfter("10:30 am", 21 * 60 + 55)).toBe(10 * 60 + 30);
        expect(clockAfter("22:30", 21 * 60 + 55)).toBe(22 * 60 + 30);
    });
    it("a form that wrote the morning for an evening clock is corrected, unless he said am/pm", () => {
        expect(eveningTime("10:30", 21 * 60 + 54, "until 10:30")).toBe("22:30");
        expect(eveningTime("10:30", 21 * 60 + 54, "until 10:30 am")).toBe("10:30");
        expect(eveningTime("10:30", 9 * 60, "until 10:30")).toBe("10:30");
        expect(eveningTime("22:30", 21 * 60 + 54, "until 22:30")).toBe("22:30");
    });
    it("the form's own add at 10:30 is written at 22:30 in the evening", async () => {
        const r = await flow("schedule some reading at 10:30 for 30 minutes", { steps: [{ do: "add", what: "reading", minutes: 30, to: "10:30" }] });
        expect(r.adds).toEqual([["add", "reading", "30", "--at", "22:30"]]);
    });
});
describe("spelled-out times are recognised", () => {
    it("only after a time word", () => {
        expect(spokenTimesToDigits("put cs lab until ten thirty")).toBe("put cs lab until 10:30");
        expect(spokenTimesToDigits("from now till eleven forty five")).toBe("from now till 11:45");
        expect(spokenTimesToDigits("at three o'clock")).toBe("at 3:00");
        expect(spokenTimesToDigits("by five")).toBe("by 5");
        expect(spokenTimesToDigits("until ten oh five")).toBe("until 10:05");
        expect(spokenTimesToDigits("I'll take ten thirty of them")).toBe("I'll take ten thirty of them");
    });
});
describe("a polite request that ends in '?' is a request", () => {
    it("is not a question, so the schedule flow runs (it was answered 'I can't add that')", () => {
        const said = "I'm fine. It's... I'm just annoyed. Can you please put CS lab from now until ten thirty?";
        expect(isPoliteRequest(said)).toBe(true);
        expect(isQuestion(said)).toBe(false);
        expect(isQuestion("could you move gym to 5?")).toBe(false);
    });
    it("real questions stay questions", () => {
        for (const q of ["can you tell me what's next?", "what's on after my lab?", "can you hear me?", "is gym still at 5?"])
            expect(isQuestion(q), q).toBe(true);
    });
    it("answersAsk: a yes answers an ask only when ORION offered something", () => {
        const offer = parseAskContext(BLANK_ASK);
        expect(answersAsk("yes", offer)).toBe(true);
        expect(answersAsk("yes, put cs lab until 10:30", offer)).toBe(true);
        expect(answersAsk("yes")).toBe(false);
        expect(answersAsk("yes", { start: "17:00", end: "now" })).toBe(false);
    });
});
const DONE = { outcome: "done", calls: ["exec orion-reschedule add \"CS Lab\" 35 --at 21:55 --again"], outputs: ["Changed Monday 2026-10-19:\n  planned CS Lab: 21:55–22:30\nWritten to his calendar."], marks: ["m1"] };
function harness(flowFor = () => DONE) {
    const handlers = new Map();
    const seen = [];
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 21:54",
        decideImpl: async () => ({ move: "escalate", tier: "standard", say: "Checking your calendar." }),
        scheduleFlow: async (message, _clock, opts) => { seen.push({ message, ask: opts?.askContext }); return flowFor(message); }
    });
    const fire = async (name, event, ctx) => {
        const out = [];
        for (const fn of handlers.get(name) ?? [])
            out.push(await fn(event, ctx));
        return out;
    };
    let n = 0;
    const turn = async (prompt, sessionKey = "agent:main:orion-chat-cslab") => {
        const ctx = { runId: `c${n += 1}`, sessionKey };
        await fire("before_model_resolve", { prompt }, ctx);
        const reply = (await fire("before_agent_reply", { prompt }, ctx)).find((x) => x && typeof x === "object");
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return { ctx, prompt: `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}`, reply };
    };
    return { turn, seen, fire };
}
describe("the turns, as the app sent them", () => {
    it("20:54Z 'yes, put cs lab until 10:30' goes to the schedule flow with ORION's offer, not to the worker", async () => {
        const h = harness();
        const t = await h.turn(asked("yes, put cs lab until 10:30"));
        expect(h.seen).toHaveLength(1);
        expect(h.seen[0]).toMatchObject({ message: "yes, put cs lab until 10:30", ask: { suggest: "CS Lab", till: "10:30" } });
        expect(t.prompt).toMatch(/already made this change/);
        expect(t.prompt).not.toMatch(/confirm/i);
    });
    it("21:04Z 'Can you please put CS lab from now until ten thirty?' reaches the flow, not the 'I can't add that' worker", async () => {
        const h = harness();
        const t = await h.turn(spoken("I'm fine. It's... I'm just annoyed. Can you please put CS lab from now until ten thirty?"));
        expect(h.seen).toHaveLength(1);
        expect(h.seen[0].message).toContain("put CS lab from now until ten thirty");
        expect(t.prompt).toMatch(/already made this change/);
    });
});
describe("f: the crisis reply", () => {
    const FIRST = "I'm can kill you. Orion, I'm I'm going to I'm going to die. I can't. I can't. You see that?";
    const REST = "(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) Pissing Okay. Okay. Yes. Yes. Put CS for right now until ten thirty.";
    it("his first message still gets the support reply, unchanged", async () => {
        expect(isCrisis(FIRST)).toBe(true);
        const h = harness();
        const t = await h.turn(spoken(FIRST));
        expect(t.reply).toMatchObject({ handled: true, reply: { text: CRISIS_REPLY } });
        expect(t.prompt).toContain(CRISIS_REPLY);
        expect(h.seen).toHaveLength(0);
    });
    it("the continuation is not the same canned text twice: its request runs, with one short support line", async () => {
        const h = harness();
        await h.turn(spoken(FIRST));
        const t = await h.turn(spoken(REST));
        expect(t.reply).toBeUndefined(); // no fixed crisis reply this time
        expect(h.seen).toHaveLength(1);
        expect(h.seen[0].message).toBe("Pissing Okay. Okay. Yes. Yes. Put CS for right now until ten thirty."); // read alone, not with the first half
        expect(t.prompt).not.toContain(CRISIS_REPLY);
        expect(t.prompt).toContain(SUPPORT_LINE);
        expect(SUPPORT_LINE.length).toBeLessThan(80); // one short line
    });
    it("a continuation that itself signals danger still gets the full support reply", async () => {
        const h = harness();
        await h.turn(spoken(FIRST));
        const t = await h.turn(spoken("(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) I really can't do this anymore."));
        expect(t.reply).toMatchObject({ handled: true, reply: { text: CRISIS_REPLY } });
    });
    it("a continuation after an ordinary message is read with it, as before", async () => {
        const h = harness();
        await h.turn(spoken("so if you can go ahead and"));
        await h.turn(spoken("(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) put gym at 5"));
        expect(h.seen.at(-1).message).toBe("so if you can go ahead and put gym at 5");
    });
});
describe("b: the worker's dead end", () => {
    const SAID = 'orion-reschedule add "CS Lab" 120 --at 10:30 --date 2026-10-19';
    it("the guard no longer tells the worker to ask him to confirm", () => {
        const r = guardToolCall("exec", { command: SAID }, { scriptNames: () => ["orion-reschedule"] });
        expect(r?.block).toBe(true);
        expect(r?.blockReason).toMatch(/in words/i);
        expect(r?.blockReason).toMatch(/already asked/i);
        expect(r?.blockReason).toMatch(/Never tell him you can't, and never ask him to confirm again/);
        expect(r?.blockReason).not.toMatch(/ask him to confirm\)/);
    });
    it("refused and nothing acted: his reply is never 'I need you to confirm'; with no restated time, an honest 'nothing changed'", async () => {
        const h = harness(() => ({ outcome: "fallback", reason: "t" }));
        const t = await h.turn(asked("tell the worker something odd"));
        await h.fire("before_tool_call", { toolName: "exec", params: { command: SAID } }, t.ctx);
        const messages = [{ role: "user", content: "x" }, { role: "assistant", content: "CS Lab is not being added yet — I need to ask you to confirm the change first." }];
        await h.fire("before_agent_finalize", { runId: t.ctx.runId, lastAssistantMessage: messages[1].content, messages, hadDeterministicSideEffect: false }, t.ctx);
        expect(messages[1].content).toBe(REFUSED_NOTHING_CHANGED);
        expect(REFUSED_NOTHING_CHANGED).not.toMatch(/confirm|can't add/i);
    });
    it("refused, but the worker restated the exact change: the schedule flow runs it and its reply is the scheduler's", async () => {
        const restated = "I'll put CS Lab on today's calendar from 9:55 PM to 10:30 PM.";
        const h = harness((m) => (m === restated ? DONE : { outcome: "fallback", reason: "t" }));
        const t = await h.turn(asked("tell the worker something odd"));
        await h.fire("before_tool_call", { toolName: "exec", params: { command: SAID } }, t.ctx);
        const messages = [{ role: "user", content: "x" }, { role: "assistant", content: restated }];
        await h.fire("before_agent_finalize", { runId: t.ctx.runId, lastAssistantMessage: restated, messages, hadDeterministicSideEffect: false }, t.ctx);
        expect(h.seen.at(-1).message).toBe(restated);
        expect(String(messages[1].content)).toMatch(/CS Lab/);
        expect(String(messages[1].content)).not.toMatch(/confirm/i);
    });
});
