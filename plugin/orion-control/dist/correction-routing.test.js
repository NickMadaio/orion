// Tube audit T3 (11-05 12:17): a correction of the last calendar change goes back to the scheduling lane, and no drafted "Got it" is sent for it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
function chat(desk) {
    const handlers = new Map();
    const seen = [];
    let n = 0;
    registerLocalRouting({ on: (nm, fn) => handlers.set(nm, [...(handlers.get(nm) ?? []), fn]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "cr-")), "r.jsonl"), clock: () => "Thu 12:17", now: () => new Date(2026, 10, 5, 12, 17), brainSearch: async () => "",
        decideImpl: async (i) => desk(i.message),
        scheduleFlow: async (m) => { seen.push(m); return { outcome: "done", calls: ['exec orion-reschedule swap "DS Lab 05" "CS Lab"'], outputs: ["Changed Thursday 2026-11-05:\n  CS Lab now 12:30–13:15"], marks: [`m${seen.length}`], reply: "Swapped DS Lab 05 with CS Lab." }; } });
    const fire = async (nm, e, ctx) => { const out = []; for (const fn of handlers.get(nm) ?? [])
        out.push(await fn(e, ctx)); return out; };
    const turn = async (said) => {
        const ctx = { runId: `cr-${n++}`, sessionKey: "agent:main:orion-chat-cr" };
        await fire("before_model_resolve", { prompt: said }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: said }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        const heard = `${direct?.reply?.text ?? ""} ${built?.systemPrompt ?? ""} ${built?.appendContext ?? ""}`;
        await fire("before_agent_finalize", { runId: ctx.runId, lastAssistantMessage: direct?.reply?.text ?? "Swapped DS Lab 05 with CS Lab.", messages: [] }, ctx);
        return { heard, direct: direct?.reply?.text };
    };
    return { turn, seen };
}
describe("a correction of the last change", () => {
    it.each([
        "yes, but not the NEW CS Lab, just CS Lab", "not the new cs lab, only cs lab", "no not New CS Lab, i meant CS Lab", "nah i meant CS Lab", "actually not the new one, it's CS Lab", "no, the other one",
    ])("%s goes back to the scheduling lane with the previous ask", async (said) => {
        const c = chat((m) => (/^replace/.test(m) ? { move: "escalate", tier: "standard" } : { move: "answer", answer: "Got it. Just the CS Lab reminder, not the new one." }));
        await c.turn("replace DS Lab 05 with CS Lab");
        const r = await c.turn(said);
        expect(c.seen).toHaveLength(2);
        expect(c.seen[1]).toContain("replace DS Lab 05 with CS Lab");
        expect(c.seen[1]).toContain("correction of what you just did");
        expect(r.heard).not.toMatch(/reminder|Got it/);
    });
    it("with nothing changed before, a correction is not rewritten (no previous action to repeat)", async () => {
        const c = chat(() => ({ move: "escalate", tier: "standard" }));
        await c.turn("not the new cs lab, just cs lab");
        expect(c.seen.join(" ")).not.toContain("correction of what you just did");
    });
    it("a drafted 'Got it' for a change request is never sent, with or without a correction", async () => {
        const c = chat(() => ({ move: "answer", answer: "Got it. Moved the gym to 6." }));
        const r = await c.turn("move the gym to 6 please");
        expect(r.direct ?? "").not.toMatch(/Got it/);
    });
});
