// w20 xf-other (live gate 2 #86): everyday venting gets a light tease, never a therapy tone.
import { describe, expect, it } from "vitest";
import { ventTease } from "./vent-tease.js";
describe("everyday venting", () => {
    it.each([
        "i hate this uni so much lol", "ugh i hate my lectures so much haha", "i cant stand this module lol", "so sick of the commute tbh lol", "i hate this course so much",
        "honestly i hate my coursework rn lol", "i hate the bus every morning lmao".replace("every morning ", ""), "lol i hate this uni", "this uni is the worst lol", "lectures are so boring lol", "uni sucks lol", "lol this place is a joke", "the commute is so draining haha",
    ])("%s is a tease only", (m) => {
        const t = ventTease(m);
        expect(t, m).not.toBeNull();
        expect(t).not.toMatch(/sorry|sounds (?:really )?(?:tough|hard|difficult)|hear you|here for you|want to talk|are you ok|how are you|try again/i);
        expect(t.length).toBeLessThan(80);
    });
    it.each([
        "i hate my life", "i hate everything about this uni", "i hate this uni so much i want to die", "i hate this uni, can you move my lecture to 3", "why do i hate uni so much",
        "i hate myself", "i hate this uni and i feel hopeless", "i hate this uni so much im crying", "i hate people at uni lol", "this uni is killing me, i cant cope", "uni is boring, can you move my lecture to 3", "is uni boring lol",
    ])("%s keeps its normal path", (m) => expect(ventTease(m), m).toBeNull());
});
describe("through the routing", () => {
    it("the desk's therapy draft is replaced by the tease", async () => {
        const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
        const { registerLocalRouting } = await import("./local-routing.js");
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "vt-")), "r.jsonl"), clock: () => "Thu 15:00", brainSearch: async () => "",
            decideImpl: async () => ({ move: "answer", answer: "I hear you. That sounds really tough right now." }), scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) });
        const ctx = { runId: "vt-1", sessionKey: "agent:main:orion-chat-vt" };
        const fire = async (n, e) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, ctx)); return out; };
        const said = "i hate this uni so much lol";
        await fire("before_model_resolve", { prompt: said });
        const [direct] = (await fire("before_agent_reply", { cleanedBody: said }));
        expect(direct?.reply?.text).toBe(ventTease(said));
        expect(direct?.reply?.text).not.toMatch(/tough/);
    });
});
