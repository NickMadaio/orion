import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { parseTodoDone, runTodoDone } from "./todo-done-flow.js";
// q042 (2026-10-16 r8): "ok mark the oats one done" -> front desk supplements {do: take, name: oats} ->
// supplement_take "oats" and "Done." with the to-do still open.
const stub = (stdout = 'Changed "buy more oats": done (ticked off Orion).', code = 0) => {
    const calls = [];
    return { calls, exec: async (args) => { calls.push(args); return { stdout, code }; } };
};
describe("parseTodoDone", () => {
    it.each([
        ["ok mark the oats one done", "oats"],
        ["tick off buy oats", "buy oats"],
        ["check off the oats todo", "oats"],
        ["mark buy more oats as complete", "buy more oats"],
        ["tick the oats one off", "oats"],
    ])("%s -> %s", (message, words) => expect(parseTodoDone(message)?.words).toBe(words));
    it.each([
        "took my creatine", "mark creatine as taken", "I'm done with the gym block", "mark my 3pm reminder done",
        // H3 (2026-10-16 r8 review): statements and loose imperatives never write.
        "i finished the milk", "done with the oats", "I'm done with work", "i finished buy more oats",
        "check if the lights are off", "check whether the oven is off", "put my phone on do not disturb until i'm done",
        "set the oats as done", "ok i finished the zebra painting thing and the garage tiling, check them off", "check them off", "tick it off",
        "did i finish the oats?", "mark it done", "whats the weather", "tick off the focus session",
    ])("ignores %s", (message) => expect(parseTodoDone(message)).toBeNull());
});
describe("runTodoDone", () => {
    it("runs done with his words and says it ticked off", async () => {
        const s = stub();
        const r = await runTodoDone({ message: "ok mark the oats one done", exec: s.exec });
        expect(s.calls).toEqual([["done", "oats"]]);
        expect(r).toMatchObject({ outcome: "done", reply: 'Ticked off "buy more oats".', calls: ['exec orion-tasks done "oats"'] });
    });
    it("two matches is a question", async () => {
        const s = stub('NOTHING WAS CHANGED: more than one to-do matches "oats": "buy oats", "cook oats" — ask him which', 1);
        expect(await runTodoDone({ message: "mark the oats one done", exec: s.exec })).toMatchObject({ outcome: "say", kind: "ask", text: 'Which one: "buy oats" or "cook oats"? Nothing was changed yet.' });
    });
    it("no match: an imperative says so, a statement falls through", async () => {
        const s = stub('NOTHING WAS CHANGED: no to-do called "creatine" on Orion. To-dos: none', 1);
        expect(await runTodoDone({ message: "mark creatine done", exec: s.exec })).toMatchObject({ outcome: "say", text: 'I couldn\'t find a to-do matching "creatine" — nothing was changed.' });
        expect(await runTodoDone({ message: "i finished creatine", exec: s.exec })).toMatchObject({ outcome: "fallback" });
        expect(s.calls).toEqual([["done", "creatine"]]);
    });
    it("not a completion runs nothing", async () => {
        const s = stub();
        expect(await runTodoDone({ message: "took my creatine", exec: s.exec })).toMatchObject({ outcome: "fallback" });
        expect(s.calls).toEqual([]);
    });
});
describe("routing: the front desk's supplements choice cannot hijack it", () => {
    it("runs orion-tasks done, replies from it, and no supplement_take directive", async () => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const fire = async (n, e, c) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, c)); return out; };
        const s = stub();
        const supplements = { move: "tool", tool: "supplements", args: { do: "take", name: "oats" } };
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "td-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 10:00",
            decideImpl: async () => supplements, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
            todoDoneFlow: (message) => runTodoDone({ message, exec: s.exec }) });
        const said = "ok mark the oats one done";
        const ctx = { runId: "td1", sessionKey: "agent:main:x" };
        await fire("before_model_resolve", { prompt: said }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        expect(s.calls).toEqual([["done", "oats"]]);
        expect(built?.systemPrompt).toContain('Ticked off "buy more oats".');
        expect(`${built?.systemPrompt}\n${built?.appendContext ?? ""}`).not.toMatch(/supplement_take/);
    });
});
