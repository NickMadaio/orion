// 2026-10-15 live sweep: a question about his day typed without a "?" ("whats on tomorrow morning",
// "uh whats next on my schedule") skipped the code read of the day, went to the calendar-change flow,
// came back "a question, not a change", and the worker listed 1:30 PM and 3:30 PM as "morning" (q014).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isQuestion, registerLocalRouting } from "./local-routing.js";
import { meansTomorrow } from "./schedule-flow.js";
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
function harness(decision) {
    const f = fakeApi();
    const flows = [];
    const reads = [];
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"),
        decideImpl: async () => decision, clock: () => "Thu 23:25", brainSearch: async () => "",
        scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "a question, not a change" }; },
        readDay: async (tomorrow) => { reads.push(tomorrow); return "B1 09:00–10:30 CS1800 Lecture (FIXED) (already happened)\nB2 13:45–14:30 CS Lab (FIXED) (already happened)"; } });
    const turn = async (prompt) => {
        const ctx = { runId: `dq${prompt.length}`, sessionKey: "agent:main:orion-chat-1" };
        await f.fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.systemPrompt ?? "";
    };
    return { turn, flows, reads };
}
describe("local routing — day questions without a question mark (2026-10-15 sweep)", () => {
    // The tomorrow flag follows meansTomorrow (before 5 AM "tomorrow" is today's date), so the test holds at any hour.
    const questions = [
        ["q003", "uh whats next on my schedule", false],
        ["q006", "how long till my next class", false],
        ["q009", "how many minutes until the lab starts", false],
        ["q011", "when's my gym thing today", false],
        ["q013", "is today a lab day or nah", false],
        ["q014", "whats on tomorrow morning", true],
        ["q015", "how much time do i have before my nap block ends", false],
    ];
    for (const [id, said, tomorrow] of questions) {
        it(`${id}: "${said}" is answered from the day code read, not sent to the change flow`, async () => {
            const h = harness({ move: "escalate", tier: "quick" });
            const prompt = await h.turn(said);
            expect(h.flows).toEqual([]);
            expect(h.reads).toEqual([tomorrow && meansTomorrow(said)]);
            // r8 (2026-10-16): the stub day has no gym or nap block, so code says so itself instead of handing the day to the worker.
            expect(prompt).toMatch(/^[\s\S]*(read just now from his calendar|There's no (gym|nap) block on your calendar today|Your CS Lab|Yes — CS Lab|You have no more classes|Your next class)/);
        });
    }
    it("q014: the day read tells the worker what morning, afternoon, evening and next mean", async () => {
        const prompt = await harness({ move: "escalate", tier: "quick" }).turn("whats on tomorrow morning");
        expect(prompt).toMatch(/morning[^.]*before 12:00/i);
        expect(prompt).toMatch(/next[^.]*not already happened/i);
    });
    // The question words must not swallow a change: these still go to the calendar flow.
    for (const said of ["can u make lecture 10 min longer lol", "how about you move gym to 7", "is it ok to push dinner to 8", "move gym to 6"]) {
        it(`"${said}" still runs the calendar flow`, async () => {
            const h = harness({ move: "tool", tool: "reschedule" });
            await h.turn(said);
            expect(h.flows).toEqual([said]);
            expect(h.reads).toEqual([]);
        });
    }
});
// (review, 2026-10-16) "when" as an opener made plans into questions.
describe("isQuestion — a 'when' clause is a plan, not a question", () => {
    for (const said of ["when i get back from lab i'm going to study until dinner", "when i get home i'll do laundry then gym"]) {
        it(`"${said}" is not a question`, () => expect(isQuestion(said)).toBe(false));
    }
    for (const said of ["when is my next class", "when does lab start", "when's my gym thing today", "when do i eat dinner", "when are my classes tomorrow", "when should i go to the gym today", "when can i nap today"]) {
        it(`"${said}" is a question`, () => expect(isQuestion(said)).toBe(true));
    }
});
