import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asksRecall, tellsFact } from "./memory-facts.js";
import { registerLocalRouting } from "./local-routing.js";
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
const turn = async (said, decision) => {
    const f = fakeApi();
    let flowRan = false;
    let reminderAsked = false;
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "mf-")), "r.jsonl"), clock: () => "Thu 22:25",
        decideImpl: async () => decision, brainSearch: async () => "",
        scheduleFlow: async () => { flowRan = true; return { outcome: "fallback", reason: "t" }; },
        extractReminder: async () => { reminderAsked = true; return { time: "12:00", label: "peanut allergy reminder" }; } });
    const ctx = { runId: `mf-${said}`, sessionKey: "agent:main:orion-chat-sweep" };
    await f.fire("before_model_resolve", { prompt: said }, ctx);
    const [reply] = await f.fire("before_agent_reply", { cleanedBody: said }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
    return { reply, prompt: built?.systemPrompt ?? "", context: built?.appendContext ?? "", flowRan, reminderAsked };
};
describe("facts he tells ORION are saved to his brain, not drafted (sweep 2026-10-15)", () => {
    const facts = [
        ["q055", "remember my wifi password is on the sticky note in my desk drawer", { move: "answer", answer: "Got it. Your wifi password is on the sticky note in your desk drawer." }],
        ["q057", "my lab partner for ds lab is priya", { move: "answer", answer: "Nice to meet you, Priya. Good luck with the lab." }],
        ["q064", "i take creatine every morning at 8", { move: "answer", answer: "Got it. Creatine logged for today at 8 AM." }],
        ["q058", "im allergic to peanuts btw, dont let me forget that", { move: "tool", tool: "supplements", args: {}, answer: "Got it. I'll add a note about your peanut allergy to your health info." }],
        ["q061", "note that my car insurance renews on the 3rd of november", { move: "tool", tool: "brain", args: { do: "learn", query: "car insurance renews on 3 nov" } }],
    ];
    for (const [id, said, decision] of facts) {
        it(`${id}: "${said}" → orion-brain learn into his own note, no draft, no calendar, no alarm`, async () => {
            const t = await turn(said, decision);
            expect(t.reply).toBeUndefined();
            expect(t.flowRan).toBe(false);
            expect(t.reminderAsked).toBe(false);
            expect(t.prompt).not.toMatch(/drafted this reply|alarm_set/);
            expect(t.prompt).toMatch(/orion-brain learn "Nick" "fact"/);
            expect(t.prompt).toMatch(/repair queue is only for problems with ORION/);
            expect(t.context).toMatch(/orion-brain learn "Nick"/);
        });
    }
    it("a reminder at a time, a change to his day and a plain question are not facts", async () => {
        expect((await turn("don't let me forget to call mom at 5", { move: "tool", tool: "alarm" })).reminderAsked).toBe(true);
        expect((await turn("remember to move gym to 7", { move: "tool", tool: "reschedule" })).prompt).not.toMatch(/orion-brain learn "Nick" "fact"/);
        expect((await turn("my meeting is at 3pm", { move: "tool", tool: "reschedule" })).prompt).not.toMatch(/orion-brain learn "Nick" "fact"/);
        expect((await turn("thanks", { move: "answer", answer: "You're welcome, Nick." })).reply).toMatchObject({ handled: true });
    });
});
describe("questions about what he told ORION search the brain first (sweep 2026-10-15)", () => {
    const recalls = [
        ["q055 t2", "what did i say about my wifi password", { move: "ask", answer: "I don't remember. Did you mention it recently?" }],
        ["q056", "what did i say about my advisor", { move: "ask", answer: "I don't recall. Did you mention a specific topic or meeting?" }],
        ["q057 t2", "who's my lab partner", { move: "ask", answer: "I don't have that info, Nick. Who are you working with?" }],
        ["q059", "whats my allergy", { move: "answer", answer: "You're allergic to shellfish." }],
        ["q064 t2", "ok and what time do i usually take it", { move: "ask", answer: "Which supplement are you asking about?" }],
    ];
    for (const [id, said, decision] of recalls) {
        it(`${id}: "${said}" → brain search before replying, never an offer to search`, async () => {
            const t = await turn(said, decision);
            expect(t.reply).toBeUndefined();
            expect(t.flowRan).toBe(false);
            expect(t.prompt).not.toMatch(/drafted this reply/);
            expect(t.prompt).toMatch(/orion-brain search/);
            expect(t.prompt).toMatch(/Never offer to search/);
            // q056: a course policy is "your ECON1115 notes say…", not "You mentioned…".
            expect(t.prompt).toMatch(/only for facts saved in his "Nick" note/);
            expect(t.context).toMatch(/orion-brain search/);
        });
    }
    it("questions about his day stay with the day reader", async () => {
        const t = await turn("what's my next class?", { move: "tool", tool: "agenda" });
        expect(t.prompt).not.toMatch(/Never offer to search/);
    });
});
describe("recall, calendar statements (review, 2026-10-16)", () => {
    it("inbox, gmail, imessage and phone time are messages questions, not recall", () => {
        for (const m of ["whats my inbox look like", "whats my latest imessage", "whats my gmail say", "whats my phone time"])
            expect(asksRecall(m), m).toBe(false);
        expect(asksRecall("who's my lab partner")).toBe(true);
    });
    it("a statement with a day or time goes to the calendar, not memory; without one it stays a fact", async () => {
        for (const m of ["my meeting with priya is moved to friday", "my dentist appointment is on friday at 3"]) {
            expect(tellsFact(m), m).toBe(false);
            expect((await turn(m, { move: "tool", tool: "reschedule" })).prompt).not.toMatch(/orion-brain learn "Nick" "fact"/);
        }
        expect(tellsFact("my dentist is dr smith")).toBe(true);
        expect(tellsFact("my lab partner for ds lab is priya")).toBe(true);
    });
    it("a recall answered from brain snippets counts as provided: no revise for a claimed lookup", async () => {
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "mf-")), "r.jsonl"), clock: () => "Thu 22:25",
            decideImpl: async () => ({ move: "ask", answer: "?" }), brainSearch: async () => "## Nick  (Nick.md)\n- DS lab partner is Priya" });
        const ctx = { runId: "mf-prov", sessionKey: "agent:main:orion-chat-sweep" };
        await f.fire("before_model_resolve", { prompt: "who's my lab partner" }, ctx);
        await f.fire("before_prompt_build", { prompt: "who's my lab partner", messages: [] }, ctx);
        const [out] = await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "I checked your notes: your Nick note says your lab partner is Priya." }, ctx);
        expect(out).toBeUndefined();
    });
});
// r7-memory, 2026-10-16: the live re-run's three memory failures, with their real inputs.
describe("recall reads his Nick note and never misframes or leaks exec errors (r7-memory)", () => {
    const NOTE = "# Nick\n\nWho ORION works for.\n\n## Observations\n- [identity] Nick Madaio\n\n## Learned\n- [fact] Nick takes creatine every morning at 8 (2026-10-16)\n";
    const POLICY = "## ECON1115 Final Exam  (20 Areas/School/Courses/ECON1115 Final Exam.md)\n- [support] For exceptional circumstances affecting the final assessment, contact the instructor and advisor.";
    const run = async (said, o) => {
        const f = fakeApi();
        registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "mf-")), "r.jsonl"), clock: () => "Thu 22:25",
            decideImpl: async () => ({ move: "ask", answer: "Which one?" }), brainSearch: async () => o.search ?? "", nickNote: () => o.note ?? "" });
        const ctx = { runId: `r7-${said}`, sessionKey: "agent:main:orion-chat-sweep" };
        await f.fire("before_model_resolve", { prompt: said }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        for (const stdout of o.tools ?? [])
            await f.fire("after_tool_call", { toolName: "exec", params: { command: "x" }, result: stdout }, ctx);
        const messages = [{ role: "user", content: said }, { role: "assistant", content: [{ type: "text", text: o.reply }] }];
        await f.fire("before_agent_finalize", { lastAssistantMessage: o.reply, messages }, ctx);
        return { built, text: messages[1].content[0].text };
    };
    it("q064: a fact learned seconds ago, below the search snippet, is handed to the worker", async () => {
        const r = await run("ok and what time do i usually take it", { note: NOTE, search: "## Nick  (20 Areas/Me/Nick.md)\n# Nick\n\nWho ORION works for.", reply: "I don't have a record." });
        expect(r.built.systemPrompt).toContain("Nick takes creatine every morning at 8");
        expect(r.built.systemPrompt).toMatch(/only these are "you told me"/);
    });
    it("q059: the prompt names the full allowlisted path, and a refused search is never spoken raw", async () => {
        const r = await run("whats my allergy", { reply: "I can't search right now.\n⚠️ 🛠️ Exec failed: `orion-brain search \"allergy\"`", tools: ['{"error":"exec denied: allowlist miss"}'] });
        expect(r.built.appendContext).toContain("/Users/nickmadaio/Desktop/ORION/scripts/orion-brain search");
        expect(r.built.systemPrompt).toMatch(/bare orion-brain is refused/);
        expect(r.text).not.toMatch(/Exec failed/);
        expect(r.text).toMatch(/couldn't search your notes/);
    });
    it("q056: a course policy is not 'you told me'", async () => {
        const r = await run("what did i say about my advisor", { note: NOTE, search: POLICY, reply: "You told me that you should contact the instructor and advisor." });
        expect(r.built.systemPrompt).toMatch(/NOT things he said/);
        expect(r.text).toBe("Your notes say you should contact the instructor and advisor.");
    });
    it("a real saved fact keeps 'you told me'", async () => {
        const r = await run("what time do i take creatine", { note: NOTE, reply: "You told me you take creatine at 8." });
        expect(r.text).toBe("You told me you take creatine at 8.");
    });
});
