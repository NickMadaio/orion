import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptanceVerdict, honestLine, isCalendarTurn, putReplyInPlace, registerLocalRouting, userText } from "./local-routing.js";
import { writeFileSync } from "node:fs";
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
        names: () => [...handlers.keys()],
    };
}
const lines = (path) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
describe("local routing — shadow mode", () => {
    it("off registers nothing", () => {
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "off", logPath: "/dev/null" });
        expect(f.names()).toEqual([]);
    });
    it("logs the front desk's decision and the check's findings for a real turn without changing anything", async () => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "shadow.jsonl");
        const f = fakeApi();
        const decideImpl = async () => ({ move: "escalate", tier: "standard", say: "One moment.", ms: 900 });
        registerLocalRouting(f.api, { warm: false, mode: "shadow", logPath, decideImpl, clock: () => "Sat 18:00" });
        const ctx = { runId: "r1", sessionKey: "agent:main:orion-chat-1" };
        const resolved = await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
        expect(resolved).toEqual([undefined]); // shadow never overrides the model
        await f.fire("after_tool_call", { toolName: "exec", params: { command: 'orion-reschedule move "Gym" --to 19:00' }, result: { content: [{ type: "text", text: "NOTHING WAS CHANGED. NOT BOOKED: Gym did not fit" }] } }, ctx);
        const finalized = await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7.", model: "claude-haiku" }, ctx);
        expect(finalized).toEqual([undefined]); // shadow never revises
        const [entry] = lines(logPath);
        expect(entry).toMatchObject({ mode: "shadow", message: "move gym to 7", decision: { move: "escalate" }, model: "claude-haiku", tools: 1 });
        expect(entry.findings.flat()).toEqual(expect.arrayContaining(["claims what the tools don't show", "last change incomplete"]));
    });
    it("skips internal sessions (cron, heartbeat, eval, test, subagent)", async () => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "shadow.jsonl");
        const f = fakeApi();
        let calls = 0;
        registerLocalRouting(f.api, { warm: false, mode: "shadow", logPath, decideImpl: async () => { calls += 1; return { move: "answer", answer: "hi" }; } });
        await f.fire("before_model_resolve", { prompt: "status" }, { runId: "r2", sessionKey: "agent:main:cron:daily" });
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok" }, { runId: "r2", sessionKey: "agent:main:cron:daily" });
        expect(calls).toBe(0);
    });
    it("a failing front desk or log write never breaks the turn", async () => {
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "shadow", logPath: "/nonexistent-dir/x/shadow.jsonl", decideImpl: async () => { throw new Error("boom"); } });
        await expect(f.fire("before_model_resolve", { prompt: "hi" }, { runId: "r3", sessionKey: "agent:main:orion-chat-1" })).resolves.toEqual([undefined]);
        await expect(f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "hi" }, { runId: "r3", sessionKey: "agent:main:orion-chat-1" })).resolves.toEqual([undefined]);
    });
});
describe("local routing — on mode", () => {
    const setup = (decision) => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Sat 18:00", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), brainSearch: async () => "## Scheduling Rules  (20 Areas/Routine/Scheduling Rules.md)\n- [minimum] nap: at least 75 minutes" });
        return { f, logPath, ctx: { runId: "r9", sessionKey: "agent:main:orion-app-v2" } };
    };
    it("reads only Nick's words from a phone message wrapped in the channel brief", () => {
        expect(userText("You are answering over the phone…\n--- Nick's message follows ---\nmove gym to 7")).toBe("move gym to 7");
        expect(userText("plain message")).toBe("plain message");
    });
    it("never falls through to the cloud model: answers go to the worker with the front desk's draft, or straight out when the reply hook fires", async () => {
        const { f, ctx } = setup({ move: "answer", answer: "You're welcome, Nick." });
        expect(await f.fire("before_model_resolve", { prompt: "thanks" }, ctx)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
        const [built] = (await f.fire("before_prompt_build", { prompt: "thanks", messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/drafted this reply: "You're welcome, Nick\."/);
        expect(built?.systemPrompt.length).toBeLessThan(1200);
        expect(await f.fire("before_agent_reply", { cleanedBody: "thanks" }, ctx)).toEqual([{ handled: true, reply: { text: "You're welcome, Nick." }, reason: "front desk answered" }]);
    });
    it("a drafted answer about live data (sun times, weather, his texts) is never sent unchecked: the worker looks it up", async () => {
        // Live sweep 2026-10-15: q012 "Sunset is at 6:42 PM today." (invented), q001 "it's still warm outside",
        // q065 "I haven't seen any new messages" — all front-desk drafts sent with no tool call.
        const cases = [
            ["what's the sunset time today", "Sunset is at 6:42 PM today."],
            ["do i need a jacket tho", "Probably not, it's still warm outside."],
            ["did anyone text me", "No, I haven't seen any new messages from anyone yet."],
        ];
        for (const [said, draft] of cases) {
            const { f, ctx } = setup({ move: "answer", answer: draft });
            await f.fire("before_model_resolve", { prompt: said }, ctx);
            expect(await f.fire("before_agent_reply", { cleanedBody: said }, ctx)).toEqual([undefined]);
            const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
            expect(built?.systemPrompt).not.toMatch(/drafted this reply/);
            expect(built?.systemPrompt).not.toContain(draft);
            expect(built?.systemPrompt).toMatch(/can't check that right now/);
        }
    });
    it("plain chit-chat that only mentions a live-data word keeps its drafted answer (review, 2026-10-16)", async () => {
        for (const said of ["thanks for the message", "nice coat", "my day was rough", "it's dark out already lol"]) {
            const { f, ctx } = setup({ move: "answer", answer: "Glad to hear it, Nick." });
            await f.fire("before_model_resolve", { prompt: said }, ctx);
            expect(await f.fire("before_agent_reply", { cleanedBody: said }, ctx), said).toEqual([{ handled: true, reply: { text: "Glad to hear it, Nick." }, reason: "front desk answered" }]);
        }
    });
    it("pure answers keep the draft, but the worker drops claims about Nick it was never told (q082)", async () => {
        for (const [said, draft] of [["whats 17 times 23", "That's 391."], ["quick whats the capital of australia", "The capital of Australia is Canberra."], ["whats dfs vs bfs quick", "DFS goes deep first, BFS goes wide."]]) {
            const { f, ctx } = setup({ move: "answer", answer: draft });
            await f.fire("before_model_resolve", { prompt: said }, ctx);
            const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
            expect(built?.systemPrompt).toContain(`drafted this reply: "${draft}"`);
        }
        const { f, ctx } = setup({ move: "answer", answer: "You've been coding for hours and your brain needs rest, so sleep now. Rest is how it sticks." });
        await f.fire("before_model_resolve", { prompt: "should i sleep now or finish leetcode, be honest" }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: "should i sleep now or finish leetcode, be honest", messages: [] }, ctx));
        // r7 (2026-10-16): the claim sentence is cut by code, not left to the 9B to leave out.
        expect(built?.systemPrompt).toContain('drafted this reply: "Rest is how it sticks."');
        expect(built?.systemPrompt).not.toMatch(/coding for hours/);
        expect(built?.systemPrompt).toMatch(/leave (it|that) out/);
        expect(built?.systemPrompt).toMatch(/never mention the draft or the front desk/i);
    });
    it("never silences a message the front desk thinks is not for ORION — the worker answers instead", async () => {
        const { f, ctx } = setup({ move: "ignore" });
        expect(await f.fire("before_model_resolve", { prompt: "and the winner is" }, ctx)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
        expect(await f.fire("before_agent_reply", { cleanedBody: "and the winner is" }, ctx)).toEqual([undefined]);
    });
    it("routes tools and escalations to the worker with the instructions for that job", async () => {
        const { f, ctx } = setup({ move: "escalate", tier: "standard", say: "One moment." });
        expect(await f.fire("before_model_resolve", { prompt: "move gym to 7 and push dinner back" }, ctx)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
        const [built] = (await f.fire("before_prompt_build", { prompt: "move gym to 7 and push dinner back", messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/orion-reschedule/);
        expect(built?.systemPrompt).toMatch(/Now: Sat 18:00/);
        expect(built?.systemPrompt).toMatch(/full path of a script: \/Users\/nickmadaio\/Desktop\/ORION\/scripts\/orion-agenda/);
        expect(built?.systemPrompt).toMatch(/(tomorrow is|he means) \w+day \d{4}-\d{2}-\d{2}/);
        expect(built?.systemPrompt).toMatch(/orion-brain search/);
        expect(built?.systemPrompt).toMatch(/nap: at least 75 minutes/);
        const brain = setup({ move: "tool", tool: "brain", args: { do: "search" } });
        await brain.f.fire("before_model_resolve", { prompt: "what did I write about my thesis" }, brain.ctx);
        const [b] = (await brain.f.fire("before_prompt_build", { prompt: "what did I write about my thesis", messages: [] }, brain.ctx));
        expect(b?.systemPrompt).toMatch(/orion-brain/);
    });
    // Live sweep 2026-10-15 (16 items, q003 q030 q102 ...): the host ignores a "revise" once a tool has run
    // (event.hadDeterministicSideEffect) and sends the original reply; the turn then left no record either.
    it("after a tool ran the host drops a revise, so the honest line is put in place and the turn is logged", async () => {
        const { f, ctx, logPath } = setup({ move: "escalate", tier: "standard" });
        await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
        await f.fire("after_tool_call", { toolName: "exec", params: { command: 'orion-reschedule move "Gym" --to 19:00' }, result: "NOTHING WAS CHANGED. NOT BOOKED: Gym did not fit" }, ctx);
        const messages = [{ role: "assistant", content: [{ type: "text", text: "Done — gym is at 7." }] }];
        const [out] = await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7.", hadDeterministicSideEffect: true, messages }, ctx);
        expect(out).toBeUndefined();
        expect(JSON.stringify(messages)).not.toContain("Done — gym is at 7.");
        expect(lines(logPath).at(-1)).toMatchObject({ mode: "on", tools: 1, escalationNeeded: true });
    });
    it("a revise that is sent (no tool ran) is logged too, marked revised", async () => {
        const { f, ctx, logPath } = setup({ move: "escalate", tier: "standard" });
        await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
        const [first] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7." }, ctx));
        expect(first).toMatchObject({ action: "revise" });
        expect(lines(logPath).at(-1)).toMatchObject({ revised: true });
    });
    // r8 (2026-10-16, q029): OpenClaw ignores a revise once a tool ran, so after an exec the honest line goes in place at once,
    // from the scheduler's own words ("Gym did not fit"), not through two retries.
    it("a false 'done' after a failed exec is replaced in place with the scheduler's own words, never a revise", async () => {
        const { f, ctx, logPath } = setup({ move: "escalate", tier: "standard" });
        await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
        const failed = { toolName: "exec", params: { command: 'orion-reschedule move "Gym" --to 19:00' }, result: "NOTHING WAS CHANGED. NOT BOOKED: Gym did not fit" };
        await f.fire("after_tool_call", failed, ctx);
        const messages = [{ role: "user", content: "move gym to 7" }, { role: "assistant", content: [{ type: "text", text: "Done — gym is at 7." }] }];
        const [first] = await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7.", messages }, ctx);
        expect(first).toBeUndefined();
        expect(JSON.stringify(messages[1])).toContain("I couldn't move anything, so nothing was moved — Gym did not fit.");
        expect(JSON.stringify(messages[1])).not.toContain("gym is at 7");
        expect(lines(logPath).at(-1)).toMatchObject({ mode: "on", escalationNeeded: true });
    });
    it("finalizes untouched when the check finds nothing", async () => {
        const { f, ctx } = setup({ move: "tool", tool: "lights", args: { do: "off" } });
        await f.fire("before_model_resolve", { prompt: "lights off" }, ctx);
        await f.fire("after_tool_call", { toolName: "exec", params: { command: "orion-lights off" }, result: "Lights: sent off" }, ctx);
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Lights are off." }, ctx)).toEqual([undefined]);
    });
    it("a request to change his day is always work: an 'ask' or even an 'answer' from the front desk gets the scheduling instructions", async () => {
        const msg = "today, change of plans. please schedule me for cert courses the entire time between the two classes";
        for (const decision of [{ move: "ask", answer: "What time do you want it?" }, { move: "answer", answer: "Sounds good!" }]) {
            const { f, ctx } = setup(decision);
            await f.fire("before_model_resolve", { prompt: msg }, ctx);
            const [built] = (await f.fire("before_prompt_build", { prompt: msg, messages: [] }, ctx));
            expect(built?.systemPrompt).toMatch(/orion-reschedule/);
            expect(await f.fire("before_agent_reply", { cleanedBody: msg }, ctx)).toEqual([undefined]);
        }
    });
    it("with scheduleChangesToCloud, a calendar change keeps the configured model and its full prompt; other turns stay local", async () => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", scheduleChangesToCloud: true, logPath, decideImpl: async () => ({ move: "escalate", tier: "standard" }), clock: () => "Mon 00:05" });
        const ctx = { runId: "c1", sessionKey: "agent:main:orion-app-v2" };
        expect(await f.fire("before_model_resolve", { prompt: "schedule me for cert courses between my two classes today" }, ctx)).toEqual([undefined]);
        expect(await f.fire("before_prompt_build", { prompt: "x", messages: [] }, ctx)).toEqual([undefined]);
        const other = { runId: "c2", sessionKey: "agent:main:orion-app-v2" };
        expect(await f.fire("before_model_resolve", { prompt: "what did I write about my thesis" }, other)).toEqual([{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }]);
    });
    it("acceptanceVerdict still grades the record (a quality report now, not a switch)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "lr-"));
        const acceptancePath = join(dir, "acceptance.json");
        const now = Date.parse("2026-10-12T10:00:00Z");
        expect(acceptanceVerdict(acceptancePath, now).ok).toBe(false);
        writeFileSync(acceptancePath, JSON.stringify({ at: "2026-10-10T15:30:00Z", n: 21, pass: 7, medianMs: 35297 }));
        expect(acceptanceVerdict(acceptancePath, now)).toMatchObject({ ok: false, why: expect.stringMatching(/7\/21/) });
        writeFileSync(acceptancePath, JSON.stringify({ at: "2026-10-11T15:30:00Z", n: 40, pass: 36, medianMs: 12000 }));
        expect(acceptanceVerdict(acceptancePath, now).ok).toBe(true);
        writeFileSync(acceptancePath, JSON.stringify({ at: "2026-09-01T15:30:00Z", n: 40, pass: 36, medianMs: 12000 }));
        expect(acceptanceVerdict(acceptancePath, now).ok).toBe(false);
    });
    // 2026-10-16, Nick: "i dont want to EVER have to use the cloud model unless necessary" — local always, no
    // time limit. The gate assumed the cloud model was the safe fallback; with no credit it meant silence.
    it("'on' always runs local: a failing, missing or stale acceptance record and any testing window are ignored", async () => {
        const dir = mkdtempSync(join(tmpdir(), "lr-"));
        const failing = join(dir, "acceptance.json");
        writeFileSync(failing, JSON.stringify({ at: new Date().toISOString(), n: 21, pass: 7, medianMs: 35297 }));
        const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
        const local = [{ providerOverride: "ollama", modelOverride: "qwen3.5:9b" }];
        const cases = [
            { acceptancePath: failing }, { acceptancePath: join(dir, "none.json") },
            { acceptancePath: failing, testingUntil: inHours(-1) }, { acceptancePath: failing, testingUntil: inHours(100) },
        ];
        for (const [i, c] of cases.entries()) {
            const f = fakeApi();
            registerLocalRouting(f.api, { warm: false, mode: "on", ...c, logPath: join(dir, "r.jsonl"), brainSearch: async () => "", decideImpl: async () => ({ move: "escalate" }) });
            expect(await f.fire("before_model_resolve", { prompt: "move gym to 7" }, { runId: `la${i}`, sessionKey: "agent:main:x" }), JSON.stringify(c)).toEqual(local);
        }
    });
    it("a calendar change runs through the scheduling flow; the worker only phrases the scheduler's output", async () => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", decideImpl: async () => ({ move: "escalate" }),
            scheduleFlow: async () => ({ outcome: "done", calls: ['exec orion-reschedule move "do cert courses" --to 12:35 --until 15:25'], outputs: ["Changed Monday:\n  do cert courses moved: 17:50 → 12:35–15:25\nWritten to his calendar."] }) });
        const ctx = { runId: "f1", sessionKey: "agent:main:x" };
        const msg = "schedule cert courses the entire time between DS and my lab";
        await f.fire("before_model_resolve", { prompt: msg }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: msg, messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*do not call any tools[\s\S]*do cert courses now 12:35 PM–3:25 PM/);
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done: do cert courses now 12:35 PM–3:25 PM." }, ctx)).toEqual([undefined]);
        expect(lines(logPath).at(-1)).toMatchObject({ flow: { outcome: "done" }, findings: [[]] });
    });
    it("delivers the scheduler's own reply (rewriting a paraphrase) and an honest line instead of a false claim", async () => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", decideImpl: async () => ({ move: "escalate" }),
            scheduleFlow: async (m) => (/nuke/.test(m) ? { outcome: "done", calls: ["exec orion-reschedule drop --after lab"], outputs: ["Changed Monday:\n  cleared 2 prior schedule blocks: grind leetcode, deck"] } : { outcome: "fallback", reason: "t" }) });
        const ctx = { runId: "p1", sessionKey: "agent:main:x" };
        await f.fire("before_model_resolve", { prompt: "nuke everything after my lab" }, ctx);
        await f.fire("before_prompt_build", { prompt: "x", messages: [] }, ctx);
        const [revise] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done: grind leetcode 5:45 PM–7:20 PM" }, ctx));
        expect(revise).toMatchObject({ action: "revise" });
        expect(revise?.retry.instruction).toMatch(/exactly this text.*cleared grind leetcode, deck/);
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done: grind leetcode 5:45 PM–7:20 PM" }, ctx);
        const [sent] = (await f.fire("reply_payload_sending", { payload: { text: "Done: grind leetcode 5:45 PM–7:20 PM" }, runId: "p1", sessionKey: "agent:main:x" }, {}));
        expect(sent?.payload.text).toBe("Done: cleared grind leetcode, deck.");
        // A false claim that survives the retries is replaced at delivery.
        const ctx2 = { runId: "p2", sessionKey: "agent:main:y" };
        await f.fire("before_model_resolve", { prompt: "stick 45 mins of macro after leetcode" }, ctx2);
        await f.fire("before_prompt_build", { prompt: "x", messages: [] }, ctx2);
        for (let k = 0; k < 3; k++)
            await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I added 45 minutes of macro studying." }, ctx2);
        await f.fire("after_tool_call", { toolName: "exec", params: { command: "orion-agenda today" }, result: "today 5:15 PM — grind leetcode" }, ctx2);
        const [sent2] = (await f.fire("reply_payload_sending", { payload: { text: "I added 45 minutes of macro studying." }, runId: "p2", sessionKey: "agent:main:y" }, {}));
        expect(sent2?.payload.text).toMatch(/couldn't make that change/);
    });
    it("a timed reminder goes to alarm_set (never orion-tasks), with the day worked out by code", async () => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
        const f = fakeApi();
        let flowRan = false;
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", decideImpl: async () => ({ move: "tool", tool: "alarm" }), scheduleFlow: async () => { flowRan = true; return { outcome: "fallback", reason: "t" }; },
            extractReminder: async () => ({ time: "11:00", label: "text the marketing group chat" }) });
        const ctx = { runId: "rm1", sessionKey: "agent:main:x" };
        const msg = "can you remind me tomorrow around 11 am to text the marketing group chat";
        await f.fire("before_model_resolve", { prompt: msg }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: msg, messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/"action":"alarm_set","at":"\d{4}-\d{2}-\d{2}T11:00","label":"text the marketing group chat"/);
        expect(built?.appendContext).toMatch(/call tool_call now with .*openclaw:orion-control:orion_task_run/);
        expect(flowRan).toBe(false);
        // Replied without calling the tool → told to call it; still not called → honest line at delivery.
        const [r1] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I've set a reminder for 11." }, ctx));
        expect(r1?.retry.instruction).toMatch(/NOT set the reminder/);
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I've set a reminder for 11." }, ctx);
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I've set a reminder for 11." }, ctx);
        const [sent] = (await f.fire("reply_payload_sending", { payload: { text: "I've set a reminder for 11." }, runId: "rm1", sessionKey: "agent:main:x" }, {}));
        expect(sent?.payload.text).toMatch(/didn't manage to set that reminder/);
    });
    // 2026-10-15 12:12: one spoken request arrived as two turns. The first half ("…so if you can go ahead
    // and") resized a block on its own; the second ("put from 12:45 to 1:45 and push everything else") ran
    // without the first, so "meal prep" was never booked.
    describe("a request cut off mid-sentence", () => {
        const spoken = (text) => `[Orion app context]\nNick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n${text}`;
        const first = "I'm now, and I'm in a time block. But here's the thing. I don't really need to be in one right now. I'm gonna start meal prepping in about thirty minutes. So if you can go ahead and";
        const rest = "(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) Put from twelve forty five to one forty five and then push everything else to kinda follow that, that would be lovely.";
        const mealPrep = { outcome: "done", calls: ['exec orion-reschedule add "meal prep" 60 --at 12:45'], outputs: ["Changed:\n  planned meal prep: 12:45–13:45"], marks: ["m2"] };
        const harness = (flowFor) => {
            const f = fakeApi();
            const flows = [];
            const desk = [];
            registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 12:12",
                decideImpl: async ({ message }) => { desk.push(message); return { move: "escalate" }; },
                scheduleFlow: async (message, _clock, opts) => { flows.push({ message, undo: opts?.undo ?? [] }); return flowFor(message); } });
            const turn = async (runId, prompt) => {
                const ctx = { runId, sessionKey: "agent:main:orion-chat-1" };
                await f.fire("before_model_resolve", { prompt }, ctx);
                const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx));
                await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok" }, ctx);
                return built?.systemPrompt ?? "";
            };
            return { turn, flows, desk };
        };
        it("does not act on the half that trails off — it waits for the rest", async () => {
            const h = harness(() => ({ outcome: "fallback", reason: "t" }));
            expect(await h.turn("c1", spoken(first))).toMatch(/exactly this text[\s\S]*Go on\./);
            expect(h.flows).toEqual([]);
            expect(h.desk).toEqual([]); // no front-desk round trip for "go on"
        });
        it("reads the rest together with the first half, without the app's marker", async () => {
            const h = harness(() => mealPrep);
            await h.turn("c1", spoken(first));
            await h.turn("c2", spoken(rest));
            expect(h.flows).toHaveLength(1);
            expect(h.flows[0].message).toMatch(/^I'm now.*meal prepping.*go ahead and Put from twelve forty five.*follow that/);
            expect(h.flows[0].message).not.toMatch(/Continuing/);
            expect(h.desk.at(-1)).toMatch(/meal prepping.*twelve forty five/);
        });
        it("if the first half did change his day, the rest is told to undo exactly that first", async () => {
            const h = harness((m) => (/twelve forty five/.test(m) ? mealPrep
                : { outcome: "done", calls: ['exec orion-reschedule resize "finish resume" 30'], outputs: ["Changed:\n  finish resume is now 30 min: 11:20–11:50"], marks: ["m1"] }));
            await h.turn("c1", spoken("I'm in a time block but I don't need it. I'm gonna start meal prepping in about thirty minutes."));
            await h.turn("c2", spoken(rest));
            expect(h.flows.map((x) => x.undo)).toEqual([[], ["m1"]]);
            expect(h.flows[1].message).toMatch(/^I'm in a time block.*Put from twelve forty five/);
        });
        it("a typed message that trails off is not held", async () => {
            const h = harness(() => ({ outcome: "fallback", reason: "t" }));
            await h.turn("c1", "move gym to 6 and");
            expect(h.flows).toHaveLength(1);
        });
    });
    // 2026-10-15 sweep: the flow ran on any scheduling word, whatever the front desk decided. "text myself
    // bring the charger to lab" booked a block at 11:45 PM, a to-do became add … 0, "cancel that" dropped
    // an arbitrary block.
    describe("the calendar flow only runs for calendar requests", () => {
        const harness = (decision) => {
            const f = fakeApi();
            const flows = [];
            registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 23:40",
                decideImpl: async () => decision, scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "t" }; } });
            const turn = async (prompt) => {
                const ctx = { runId: `h${flows.length}${prompt.length}`, sessionKey: "agent:main:orion-chat-1" };
                await f.fire("before_model_resolve", { prompt }, ctx);
                await f.fire("before_prompt_build", { prompt, messages: [] }, ctx);
            };
            return { turn, flows };
        };
        const cases = [
            ["text myself bring the charger to lab", { move: "tool", tool: "tasks", args: { do: "add", title: "bring the charger to lab" } }],
            ["text myself my gym schedule for the week", { move: "escalate", tier: "standard" }],
            ["add a todo to email prof about office hours by thurs", { move: "tool", tool: "tasks", args: { do: "add" } }],
            ["focus mode on for an hour, leetcode", { move: "tool", tool: "session", args: { do: "start", task: "leetcode" } }],
            ["i take creatine every morning at 8", { move: "answer", answer: "Got it." }],
            ["cancel that", { move: "ask", answer: "Cancel what?" }],
            ["make it longer", { move: "ask", answer: "What do you want to make longer?" }],
            ["book me a flight to mars for next week", { move: "escalate", tier: "deep" }],
        ];
        for (const [msg, decision] of cases) {
            it(`"${msg}" does not touch his calendar`, async () => {
                const h = harness(decision);
                await h.turn(msg);
                expect(h.flows).toEqual([]);
            });
        }
        const still = [
            ["move gym to 7", { move: "tool", tool: "reschedule" }],
            ["add 45 mins of leetcode after my lab", { move: "escalate" }],
            ["cancel the gym", { move: "ask", answer: "Which gym?" }],
            ["push it to 7pm", { move: "ask", answer: "Push what?" }],
            ["put leetcode at 9pm", { move: "tool", tool: "agenda" }],
            ["i need to do leetcode, add an hour of it at 9pm", { move: "escalate" }],
            ["i go to the gym every morning, put it at 7 tomorrow", { move: "escalate" }],
        ];
        for (const [msg, decision] of still) {
            it(`"${msg}" still runs the calendar flow`, async () => {
                const h = harness(decision);
                await h.turn(msg);
                expect(h.flows).toEqual([msg]);
            });
        }
    });
    it("after midnight, 'tomorrow' means today's date", async () => {
        const { meansTomorrow } = await import("./schedule-flow.js");
        expect(meansTomorrow("remind me tomorrow at 11", new Date(2026, 9, 13, 0, 44))).toBe(false);
        expect(meansTomorrow("remind me tomorrow at 11", new Date(2026, 9, 13, 14, 0))).toBe(true);
        expect(meansTomorrow("remind me at 11", new Date(2026, 9, 13, 14, 0))).toBe(false);
    });
});
describe("local routing — focus sessions and false claims (2026-10-15)", () => {
    const SAID = "Can you go ahead and, uh, start a focus session? I wanna do some work.";
    const setup = (decision, sessionFlow) => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Thu 22:40",
            scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), brainSearch: async () => "", readDay: async () => "1. Gym 18:00",
            ...(sessionFlow ? { sessionFlow } : {}) });
        return { f, logPath, ctx: { runId: "fs1", sessionKey: "agent:main:orion-chat-1" } };
    };
    const started = { outcome: "done", calls: ["exec orion-session start Focus --json"], outputs: ['{"ok":true,"status":"running"}'], reply: "Your focus session is running: block 1 of 3, 50 minutes." };
    it("code starts the session; the worker is told the exact reply and to call nothing", async () => {
        const asked = [];
        const { f, ctx, logPath } = setup({ move: "tool", tool: "session", args: { do: "start" } }, async (m) => { asked.push(m); return started; });
        await f.fire("before_model_resolve", { prompt: SAID }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: SAID, messages: [] }, ctx));
        expect(asked).toEqual([SAID]);
        expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*Your focus session is running: block 1 of 3, 50 minutes\./);
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Your focus session is running: block 1 of 3, 50 minutes." }, ctx)).toEqual([undefined]);
        expect(lines(logPath).at(-1)).toMatchObject({ tools: 1, flow: { outcome: "done", calls: ["exec orion-session start Focus --json"] } });
    });
    it("a session start phrased as a question is still started, not answered from his calendar", async () => {
        const { f, ctx } = setup({ move: "tool", tool: "session", args: { do: "start" } }, async () => started);
        await f.fire("before_model_resolve", { prompt: "can you start a focus block?" }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: "can you start a focus block?", messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/Your focus session is running/);
        expect(built?.systemPrompt).not.toMatch(/read just now from his calendar/);
    });
    it("the front desk's draft never answers a session start in place of starting it", async () => {
        const { f, ctx } = setup({ move: "answer", answer: "Starting your focus session now." }, async () => started);
        await f.fire("before_model_resolve", { prompt: "start a focus session" }, ctx);
        expect(await f.fire("before_agent_reply", {}, ctx)).toEqual([undefined]);
    });
    it("a failed start is said plainly, exactly as the flow wrote it", async () => {
        const { f, ctx } = setup({ move: "tool", tool: "session", args: { do: "start" } }, async () => ({ outcome: "say", kind: "plain", text: "I couldn't start the focus session: Orion is not running. Nothing is running." }));
        await f.fire("before_model_resolve", { prompt: SAID }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: SAID, messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*I couldn't start the focus session: Orion is not running\./);
        expect(built?.systemPrompt).not.toMatch(/That doesn't fit/);
    });
    it("tonight's replay: a claimed action with no tool call ends with the honest line DICTATED, not left to delivery", async () => {
        // No session flow wired, so nothing runs — exactly the shape of the turn that lied.
        const { f, ctx } = setup({ move: "answer", answer: "Right here, Nick. What's on your mind?" });
        await f.fire("before_model_resolve", { prompt: "Right now." }, ctx);
        const lie = "I've started the focus session right now with those apps allowed.";
        const [first] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie }, ctx));
        expect(first).toMatchObject({ action: "revise" });
        const [second] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie }, ctx));
        expect(second).toMatchObject({ action: "revise" });
        expect(second?.retry.instruction).toMatch(/whole reply must be exactly this text.*I didn't actually do that — nothing was started or changed\./);
        expect(second?.retry.instruction).not.toMatch(/calendar changed/);
    });
    // 2026-10-15 22:35 (sweep q042): "ok mark the oats one done" — no tool call, three passes all flagged,
    // and Nick still heard "buy more oats has been marked as done". The Mac chat and phone use
    // `openclaw agent --json`, which never runs reply_payload_sending; its reply is read from the turn's
    // last assistant message, so the honest line must be put there.
    it("on the agent-CLI route the honest line replaces the false claim in the final message itself", async () => {
        const { f, ctx } = setup({ move: "tool", tool: "supplements", args: { do: "done", name: "oats" } });
        await f.fire("before_model_resolve", { prompt: "ok mark the oats one done" }, ctx);
        await f.fire("before_prompt_build", { prompt: "ok mark the oats one done", messages: [] }, ctx);
        const lie = "The task \"buy more oats\" has been marked as done.";
        const said = () => ({ role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "text", text: lie }], stopReason: "stop" });
        const passes = [];
        for (let k = 0; k < 3; k++)
            passes.push({ role: "user", content: "x" }, said());
        for (let k = 0; k < 3; k++)
            await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie, messages: passes.slice(0, 2 * k + 2) }, ctx);
        const final = passes.at(-1);
        expect(final.content).toEqual([{ type: "thinking", thinking: "…" }, { type: "text", text: honestLine(false) }]);
        expect(passes[1].content[1].text).toBe(lie); // only the reply that goes out is replaced
    });
    it("on the agent-CLI route a paraphrase of the scheduler's reply is replaced by the scheduler's own words", async () => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl");
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, brainSearch: async () => "", decideImpl: async () => ({ move: "escalate" }),
            scheduleFlow: async () => ({ outcome: "done", calls: ["exec orion-reschedule drop --after lab"], outputs: ["Changed Monday:\n  cleared 2 prior schedule blocks: grind leetcode, deck"] }) });
        const ctx = { runId: "p9", sessionKey: "agent:main:x" };
        await f.fire("before_model_resolve", { prompt: "nuke everything after my lab" }, ctx);
        await f.fire("before_prompt_build", { prompt: "x", messages: [] }, ctx);
        const paraphrase = "Done: grind leetcode 5:45 PM–7:20 PM";
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: paraphrase, messages: [{ role: "assistant", content: [{ type: "text", text: paraphrase }] }] }, ctx);
        const final = { role: "assistant", content: paraphrase };
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: paraphrase, messages: [final] }, ctx);
        expect(final.content).toBe("Done: cleared grind leetcode, deck.");
    });
    it("a calendar false claim keeps the calendar wording", async () => {
        const { f, ctx } = setup({ move: "escalate", tier: "standard" });
        await f.fire("before_model_resolve", { prompt: "move gym to 7" }, ctx);
        for (let k = 0; k < 1; k++)
            await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7." }, ctx);
        const [second] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done — gym is at 7." }, ctx));
        expect(second?.retry.instruction).toMatch(/nothing on your calendar changed/);
    });
});
describe("local routing — distress (2026-10-16 live sweep)", () => {
    const setup = (decision) => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
        const f = fakeApi();
        const flows = [];
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Thu 23:46", brainSearch: async () => "",
            scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "test" }; }, readDay: async () => "1. Macro quiz 00:00" });
        return { f, logPath, flows, ctx: { runId: "d1", sessionKey: "agent:main:orion-chat-1" } };
    };
    it("q103: 'i literally cant do this anymore' gets the fixed safety reply (asks if he is safe, UK numbers), not the front desk's draft", async () => {
        const said = "i literally cant do this anymore";
        const { f, ctx, flows, logPath } = setup({ move: "answer", answer: "I hear you. Want to take a break or talk about what's going on?" });
        await f.fire("before_model_resolve", { prompt: said }, ctx);
        const [direct] = (await f.fire("before_agent_reply", { cleanedBody: said }, ctx));
        expect(direct?.reply.text).toMatch(/Are you safe right now\?/);
        expect(direct?.reply.text).toMatch(/Samaritans[^.]*116 123/);
        expect(direct?.reply.text).toMatch(/\b999\b/);
        const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/exactly this text[\s\S]*do not call any tools[\s\S]*Are you safe right now\?/);
        expect(built?.systemPrompt).not.toMatch(/drafted this reply/);
        expect(flows).toEqual([]);
        const [revise] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I hear you. Want to take a break?" }, ctx));
        expect(revise?.retry.instruction).toMatch(/exactly this text[\s\S]*Samaritans/);
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I hear you. Want to take a break?" }, ctx);
        const [sent] = (await f.fire("reply_payload_sending", { payload: { text: "I hear you. Want to take a break?" }, runId: "d1", sessionKey: "agent:main:orion-chat-1" }, {}));
        expect(sent?.payload.text).toMatch(/Samaritans/);
        expect(lines(logPath).at(-1)).toMatchObject({ flow: { outcome: "say" }, tools: 0 });
    });
    it("text owed by an earlier turn is never delivered on the next turn in that session (review LOW)", async () => {
        const said = "i literally cant do this anymore";
        const { f, ctx } = setup({ move: "escalate", tier: "standard" });
        await f.fire("before_model_resolve", { prompt: said }, ctx);
        await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx);
        for (let i = 0; i < 3; i++)
            await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "ok" }, ctx);
        const next = { runId: "d2", sessionKey: ctx.sessionKey };
        await f.fire("before_model_resolve", { prompt: "thanks, I'm ok now" }, next);
        const [sent] = (await f.fire("reply_payload_sending", { payload: { text: "Glad to hear it." }, runId: "d2", sessionKey: ctx.sessionKey }, {}));
        expect(sent?.payload?.text ?? "Glad to hear it.").not.toMatch(/Samaritans/);
    });
    it("q102: 'im so overwhelmed i dont even know where to start' gets empathy and one small step, with no lookups", async () => {
        const said = "im so overwhelmed i dont even know where to start";
        const { f, ctx, flows } = setup({ move: "escalate", tier: "standard" });
        await f.fire("before_model_resolve", { prompt: said }, ctx);
        expect(await f.fire("before_agent_reply", { cleanedBody: said }, ctx)).toEqual([undefined]);
        const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/overwhelmed[\s\S]*ONE small first step[\s\S]*Do not call any tools/);
        expect(built?.systemPrompt).not.toMatch(/orion-agenda|orion-brain/);
        expect(flows).toEqual([]);
    });
    it("an ordinary 'I can't do this' about a task is still a calendar change", async () => {
        const said = "I can't do this task today, move it to tomorrow";
        const { f, ctx, flows } = setup({ move: "escalate", tier: "quick" });
        await f.fire("before_model_resolve", { prompt: said }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        expect(flows).toEqual([said]);
        expect(built?.systemPrompt).not.toMatch(/Samaritans|overwhelmed/);
    });
});
describe("local routing — review of the 2026-10-16 sweep fixes", () => {
    const setup = (decision, opts = {}) => {
        const logPath = join(mkdtempSync(join(tmpdir(), "lr-")), "routing.jsonl");
        const f = fakeApi();
        const flows = [];
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Fri 10:00",
            brainSearch: opts.brainSearch ?? (async () => ""), readDay: opts.readDay ?? (async () => "1. Gym 17:00"),
            scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "test" }; } });
        return { f, flows, ctx: { runId: "rv1", sessionKey: "agent:main:orion-chat-rv" } };
    };
    const build = async (f, ctx, said) => {
        await f.fire("before_model_resolve", { prompt: said }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        return built;
    };
    it("overwhelm with a real request in it still does the request", async () => {
        for (const [said, decision] of [
            ["i'm so stressed, remind me at 3 to call mom", { move: "tool", tool: "alarm" }],
            ["im overwhelmed, start a focus session for 25 minutes", { move: "tool", tool: "session" }],
            ["i'm burnt out, what's on my calendar today?", { move: "tool", tool: "agenda" }],
        ]) {
            const { f, ctx } = setup(decision);
            const built = await build(f, ctx, said);
            expect(built?.systemPrompt ?? "", said).not.toMatch(/Do not call any tools, do not look anything up/);
        }
    });
    it("overwhelm alone gets the warm note, and a warm 'I'll be here' reply is delivered as is", async () => {
        const { f, ctx } = setup({ move: "answer", answer: "hang in there" });
        const built = await build(f, ctx, "im so overwhelmed i dont even know where to start");
        expect(built?.systemPrompt).toMatch(/Do not call any tools/);
        const reply = "I hear you, Nick. Take one slow breath and write down the one thing due first — I'll be right here.";
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: reply, messages: [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: reply }] }] }, ctx)).toEqual([undefined]);
    });
    it("an answer from the day code read is not sent back to 'look it up', and never told to undo", async () => {
        const { f, ctx } = setup({ move: "tool", tool: "agenda" });
        await build(f, ctx, "what's on my calendar tomorrow?");
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "According to your calendar, you have gym at 5 PM." }, ctx)).toEqual([undefined]);
    });
    it("the honest-stop retry only says 'undo' when this turn wrote something", async () => {
        const { f, ctx } = setup({ move: "escalate", tier: "standard" });
        await build(f, ctx, "ok mark the oats one done");
        const lie = "The task \"buy more oats\" has been marked as done.";
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie }, ctx);
        const [second] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie }, ctx));
        expect(second?.retry.instruction).not.toMatch(/undo/i);
        expect(second?.retry.instruction).toMatch(/exactly this text/);
    });
    it("a made-up lookup that survives both retries is replaced by an honest line", async () => {
        const { f, ctx } = setup({ move: "tool", tool: "weather" });
        await build(f, ctx, "is it gonna rain later this week");
        const lie = "I checked the weather for London and it's not expected to rain later this week.";
        const messages = [{ role: "user", content: "is it gonna rain" }, { role: "assistant", content: [{ type: "text", text: lie }] }];
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie, messages }, ctx);
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie, messages }, ctx);
        await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie, messages }, ctx);
        expect(messages[1].content[0].text).toMatch(/didn't actually check/);
    });
    it("putReplyInPlace never rewrites an earlier turn's reply when this turn has none", () => {
        const messages = [{ role: "user", content: "a" }, { role: "assistant", content: [{ type: "text", text: "old answer" }] }, { role: "user", content: "b" }];
        expect(putReplyInPlace(messages, "honest line")).toBe(false);
        expect(messages[1].content[0].text).toBe("old answer");
    });
    it("a front-desk 'tasks' pick does not stop a real calendar change with a time; 'plan my day around my todos' still plans", () => {
        expect(isCalendarTurn("add gym at 5 today", { move: "tool", tool: "tasks" })).toBe(true);
        expect(isCalendarTurn("plan my day around my todos", { move: "escalate", tier: "standard" })).toBe(true);
        expect(isCalendarTurn("add a todo to email prof about office hours by thurs", { move: "tool", tool: "tasks" })).toBe(false);
        expect(isCalendarTurn("focus mode on for an hour, leetcode", { move: "tool", tool: "session" })).toBe(false);
    });
    it("overwhelm with a request in it is not swallowed, whatever the front desk picked (HIGH 4)", async () => {
        for (const said of ["i'm so stressed, remind me at 3 to call mom", "im overwhelmed, start a focus session for 25 minutes", "panicking, text mom im late", "i'm burnt out, what's on my calendar today?"]) {
            const { f, ctx } = setup({ move: "escalate", tier: "standard" });
            const built = await build(f, ctx, said);
            expect(built?.systemPrompt ?? "", said).not.toMatch(/Do not call any tools, do not look anything up/);
        }
    });
    it("an overwhelm reply is never sent back for tools: the note forbade them (HIGH 1)", async () => {
        const { f, ctx } = setup({ move: "answer", answer: "hang in there" });
        await build(f, ctx, "im so overwhelmed i dont even know where to start");
        const reply = "That sounds like a lot, Nick. Write down the one thing due first, and I'll check in with you in a bit.";
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: reply }, ctx)).toEqual([undefined]);
    });
    it("the live-data 'can't check' sentence with a small tail is still the honest answer (HIGH 2c)", async () => {
        const { f, ctx } = setup({ move: "escalate", tier: "standard" });
        await build(f, ctx, "did anyone text me");
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Sorry Nick, I can't check that right now." }, ctx)).toEqual([undefined]);
    });
    it("real live-data phrasings get the live-data note (LOW)", async () => {
        for (const said of ["how cold is it", "any new mail", "how long is left in my focus"]) {
            const { f, ctx } = setup({ move: "escalate", tier: "standard" });
            const built = await build(f, ctx, said);
            expect(built?.systemPrompt ?? "", said).toMatch(/can't check that right now/);
        }
    });
    it("the front desk's tool pick is only a hint for a real calendar change (MEDIUM 3)", () => {
        expect(isCalendarTurn("add 2 hours of study this afternoon", { move: "tool", tool: "tasks" })).toBe(true);
        expect(isCalendarTurn("add gym at 5 today", { move: "tool", tool: "brain" })).toBe(true);
        expect(isCalendarTurn("turn the lights off at 11", { move: "tool", tool: "lights" })).toBe(false);
        expect(isCalendarTurn("what's the weather at 5", { move: "tool", tool: "weather" })).toBe(false);
        expect(isCalendarTurn("buy oats", { move: "tool", tool: "tasks" })).toBe(false);
    });
    it("to-dos are a capture only when he adds one (MEDIUM 4)", () => {
        const esc = { move: "escalate", tier: "standard" };
        expect(isCalendarTurn("fit my to-dos into this afternoon", esc)).toBe(true);
        expect(isCalendarTurn("make time for my todos this afternoon", esc)).toBe(true);
        expect(isCalendarTurn("add gym to my todos", esc)).toBe(false);
        expect(isCalendarTurn("new todo: call the bank", esc)).toBe(false);
    });
    it("brain snippets in the prompt never excuse a made-up live lookup (HIGH 2b)", async () => {
        const { f, ctx } = setup({ move: "escalate", tier: "standard" }, { brainSearch: async () => "## Weather notes  (Areas/Weather.md)\n- he hates rain" });
        await build(f, ctx, "is it gonna rain later this week");
        const [first] = (await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I checked the weather and it's not expected to rain." }, ctx));
        expect(first?.action).toBe("revise");
    });
    it("an answer from brain snippets is not a fabricated lookup (HIGH 2b)", async () => {
        const { f, ctx } = setup({ move: "escalate", tier: "standard" }, { brainSearch: async () => "## Scheduling Rules  (20 Areas/Routine/Scheduling Rules.md)\n- [minimum] nap: at least 75 minutes" });
        await build(f, ctx, "how long should my naps be");
        expect(await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I found in your notes that a nap should be at least 75 minutes." }, ctx)).toEqual([undefined]);
    });
});
// Live sweep 2026-10-15, round 2 (routing polish).
describe("local routing — sweep round 2 polish (2026-10-16)", () => {
    const setup = (decision, extra = {}) => {
        const f = fakeApi();
        const flows = [];
        const sessions = [];
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), decideImpl: async () => decision, clock: () => "Thu 22:40",
            brainSearch: async () => "", scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "t" }; },
            sessionFlow: async (m, hint) => { sessions.push([m, hint]); return { outcome: "done", calls: ["exec orion-session start leetcode --minutes 60 --json"], outputs: ['{"ok":true}'], reply: "Your focus session is running: 60 minutes." }; },
            ...extra });
        const ctx = { runId: "rp1", sessionKey: "agent:main:orion-chat-1" };
        const build = async (prompt) => {
            await f.fire("before_model_resolve", { prompt }, ctx);
            const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx));
            return built?.systemPrompt ?? "";
        };
        return { f, ctx, flows, sessions, build };
    };
    it("q051: a front-desk session start runs the session flow with its task, never the calendar", async () => {
        const h = setup({ move: "tool", tool: "session", args: { do: "start", task: "leetcode", minutes: "60" } });
        const prompt = await h.build("focus mode on for an hour, leetcode");
        expect(h.flows).toEqual([]);
        expect(h.sessions).toEqual([["focus mode on for an hour, leetcode", { start: true, task: "leetcode", minutes: 60 }]]);
        expect(prompt).toMatch(/exactly this text[\s\S]*Your focus session is running/);
    });
    it("q079/q101: the draft hand-off never names the front desk as its source, nor lets the worker swap it", async () => {
        const h = setup({ move: "answer", answer: "Why did the calendar go to the doctor? Because it was out of date!" });
        const prompt = await h.build("tell me a joke");
        expect(prompt).not.toMatch(/The front desk drafted/);
        expect(prompt).not.toMatch(/otherwise answer him/);
        expect(prompt).toMatch(/never name the model/i);
    });
    it("q063: an 'ask' hint is not attributed to the front desk", async () => {
        const h = setup({ move: "ask", answer: "I don't have access to your gym locker code. Is there anything else I can help you with?" });
        expect(await h.build("whats my gym locker code")).not.toMatch(/front desk/i);
    });
    it("q094/q095: filler and gibberish get a fixed short question, typed or spoken; nothing about his session", async () => {
        for (const said of ["asdf jkl qwer", "Nick SAID this out loud:\n--- Nick's message follows ---\nhm"]) {
            const h = setup({ move: "ignore" });
            expect(await h.build(said)).toMatch(/exactly this text[\s\S]*Didn't catch that — what do you need\?/);
        }
    });
    it("a longer 'ignore' still goes to the worker, told to ask rather than report his day or session", async () => {
        const h = setup({ move: "ignore" });
        const prompt = await h.build("Nick SAID this out loud:\n--- Nick's message follows ---\nno I mean, I can unlock it manually if I want");
        expect(prompt).not.toMatch(/Didn't catch that/);
        expect(prompt).toMatch(/not his session or his day/);
    });
});
