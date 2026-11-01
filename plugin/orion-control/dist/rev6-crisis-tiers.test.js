// Wave 4 review 2 (2026-11-01): crisis signals are tiered. Clear ones keep the full safety reply (now also: being a burden, no reason to
// keep going, life has no meaning, no future). "hate my life / done with life / rather die / sleeping forever" said with a mundane cause
// or a joking marker in the same message is GENTLE: the turn runs as normal and the reply opens with one short, warm check-in line.
// "i'd love to die on this hill" is an idiom and gets nothing. Ambiguous with no mundane cause stays FULL.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRISIS_REPLY, crisisTier, gentleCheckIn, isCrisis, touchesLifeOrDeath } from "./distress.js";
import { readPreference } from "./preference-remember.js";
import { registerLocalRouting } from "./local-routing.js";
const FULL_NEW = [
    // being a burden
    "i'm just a burden to everyone", "i feel like such a burden on my family", "honestly i'm a burden",
    "everyone would be happier if i wasn't around to burden them", "i feel like a burden lol",
    // no reason to keep going
    "there's no reason to keep going", "i don't see any reason to keep going", "i have nothing to keep going for",
    "cant find a reason to carry on anymore", "why should i even keep going",
    // life has no meaning
    "life has no meaning", "my life has no purpose", "my life doesn't mean anything", "there's no meaning to my life", "nothing matters anymore",
    // no future
    "i have no future", "i don't have a future", "there's no future for me", "i can't see a future for myself", "my future is gone",
];
const FULL_AMBIGUOUS = ["i hate my life", "i'd rather die", "i'm done with life", "i love the idea of sleeping forever", "honestly i hate my life so much",
    // a joke marker beside a clear signal never softens it
    "i hate my life lol i want to kill myself", "i'd rather die lol, nobody would miss me", "i hate my life rn and i cant do this anymore"];
const GENTLE = ["i hate my life lol this class is so boring", "i hate my life rn the wifi is down", "honestly i'd rather die lol",
    "i'm done with life today lol", "i love the idea of sleeping forever on sunday",
    // held out
    "ugh i hate my life the printer jammed again", "id rather die than sit through another group meeting lmao", "im so done with life haha this lecture is endless",
    "i hate my life the bus is late again", "i'd love to sleep forever this weekend"];
const NOTHING = ["i'd love to die on this hill", "this is the hill i'll die on", "not a hill to die on lol", "i love my life", "the burden of proof is on them",
    "is there any reason to keep going with this project", "no future meetings this week", "the meaning of life is 42 apparently", "i can't see a future where i pass this module without help"];
describe("FULL: clear signals get the fixed safety reply", () => {
    it.each([...FULL_NEW, ...FULL_AMBIGUOUS])("%s", (m) => {
        expect(crisisTier(m)).toBe("full");
        expect(isCrisis(m)).toBe(true);
    });
});
describe("GENTLE: a mundane cause or a joke beside a heavy phrase", () => {
    it.each(GENTLE)("%s", (m) => {
        expect(crisisTier(m)).toBe("gentle");
        expect(isCrisis(m)).toBe(false);
        expect(touchesLifeOrDeath(m)).toBe(true);
        expect(readPreference(m)).toBeUndefined();
    });
});
describe("NOTHING: idioms and ordinary lines", () => {
    it.each(NOTHING)("%s", (m) => {
        expect(crisisTier(m)).toBeNull();
        expect(isCrisis(m)).toBe(false);
    });
    it("the hill idiom still never becomes a preference", () => expect(readPreference("i'd love to die on this hill")).toBeUndefined());
});
describe("the gentle check-in line", () => {
    it("is one short warm question, names the cause when he gave one, never preachy", () => {
        expect(gentleCheckIn("i hate my life rn the wifi is down")).toMatch(/wifi/i);
        for (const m of GENTLE) {
            const line = gentleCheckIn(m);
            expect(line.split(/[.?!]\s/).length, m).toBeLessThanOrEqual(2);
            expect(line.length, m).toBeLessThan(70);
            expect(line, m).toMatch(/\?$/);
            expect(line, m).not.toMatch(/samaritans|999|crisis|therapy|please reach out|you should/i);
        }
    });
    it("varies across messages, and is stable for the same one", () => {
        expect(new Set(GENTLE.map(gentleCheckIn)).size).toBeGreaterThan(3);
        expect(gentleCheckIn(GENTLE[2])).toBe(gentleCheckIn(GENTLE[2]));
    });
});
function route() {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "rev6-crisis-"));
    const now = new Date(2026, 10, 2, 13, 0);
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon 13:00", now: () => now,
        decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "",
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) });
    let n = 0;
    return async (prompt, reply) => {
        const ctx = { runId: `rev6c-${n += 1}`, sessionKey: "agent:main:orion-chat-rev6c" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        const messages = [{ role: "assistant", content: [{ type: "text", text: exact ?? reply }] }];
        await fire("before_agent_finalize", { lastAssistantMessage: exact ?? reply, messages }, ctx);
        return { direct: direct?.reply?.text, exact, final: messages[0].content[0].text };
    };
}
describe("through the chat route", () => {
    it.each(GENTLE.slice(0, 5))("gentle: %s → normal turn, check-in first", async (m) => {
        const t = await route()(m, "Ugh, that sounds annoying.");
        expect(t.direct).toBeUndefined();
        expect(t.exact).not.toBe(CRISIS_REPLY);
        expect(t.final).toBe(`${gentleCheckIn(m)} Ugh, that sounds annoying.`);
    });
    it.each(["i'm just a burden to everyone", "there's no reason to keep going", "i hate my life"])("full: %s → the fixed reply", async (m) => {
        const t = await route()(m, "whatever");
        expect(t.direct).toBe(CRISIS_REPLY);
    });
    it("the idiom gets no check-in", async () => {
        expect((await route()("i'd love to die on this hill", "Fair enough.")).final).toBe("Fair enough.");
    });
});
