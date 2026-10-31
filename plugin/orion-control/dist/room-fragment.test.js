// 2026-10-31 17:40 (build 1052): the wake word fired on a body-cam video and this reached the gateway as a spoken turn. It trails off
// ("…And then"), so it was held as half a request and ORION said "Go on." to the television. A long spoken fragment with no "orion"
// and nothing request- or status-shaped in it is the room, not half a request: silent, never "Go on.".
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { roomTalk } from "./chatter.js";
import { registerLocalRouting } from "./local-routing.js";
const BODY_CAM = "insert at just the right point in the shoe to pick it up properly and reliably. And then";
describe("roomTalk: a long trailing fragment without his name", () => {
    it("is room when it trails off and is neither a request nor a status", () => {
        expect(roomTalk(BODY_CAM, { spoken: true, streak: false, trailing: true })).toBe("room");
    });
    it.each(["can", "can you move gym to after my", "move gym to right after marketing and then", "i need to leave at 5 and",
        "orion I was going to say that the"])("half a request is still held: %s", (m) => {
        expect(roomTalk(m, { spoken: true, streak: false, trailing: true })).not.toBe("room");
    });
    it("typed text and a finished line are not touched", () => {
        expect(roomTalk(BODY_CAM, { spoken: false, streak: false, trailing: true })).toBeNull();
        expect(roomTalk(BODY_CAM, { spoken: true, streak: false, trailing: false })).toBeNull();
    });
});
describe("through the route", () => {
    const rig = () => {
        const handlers = new Map();
        const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
            o.push(await fn(e, c)); return o; };
        registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), decideImpl: async () => ({ move: "escalate", tier: "quick" }), clock: () => "Sat 17:40", brainSearch: async () => "" });
        const spoken = (t) => `[Orion app context]\nNick SAID this out loud and your answer will be SPOKEN: short.\n\nUser message:\n${t}`;
        return async (runId, prompt) => {
            const ctx = { runId, sessionKey: "agent:main:orion-chat-1" };
            await fire("before_model_resolve", { prompt: spoken(prompt) }, ctx);
            const [b] = (await fire("before_prompt_build", { prompt: spoken(prompt), messages: [] }, ctx));
            return `${b?.systemPrompt ?? ""}\n${b?.appendContext ?? ""}`;
        };
    };
    it("the body-cam fragment gets no 'Go on.'", async () => {
        const text = await rig()("b1", BODY_CAM);
        expect(text).not.toContain("Go on.");
    });
    it("half a spoken request still gets 'Go on.'", async () => {
        expect(await rig()("b2", "can you move gym to after my")).toContain("Go on.");
    });
});
