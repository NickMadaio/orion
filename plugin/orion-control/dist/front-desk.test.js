import { describe, expect, it } from "vitest";
import { decide, frontDeskRequest, keepWarm } from "./front-desk.js";
import { FRONT_DESK_MODEL, FRONT_DESK_SYSTEM } from "./front-desk-prompt.js";
const reply = (content) => async () => new Response(JSON.stringify({ message: { content } }), { status: 200 });
describe("front desk", () => {
    it("sends the frozen prompt, stable text first and Nick's message last, as forced JSON at temperature 0", () => {
        const body = frontDeskRequest({ message: "lights off", clock: "Fri 21:40", history: [{ role: "assistant", content: "Gym is at 6 PM." }] });
        expect(body.model).toBe(FRONT_DESK_MODEL);
        expect(body.messages[0]).toEqual({ role: "system", content: FRONT_DESK_SYSTEM });
        expect(body.messages[1]?.content).toMatch(/^Now: Fri 21:40\.\n\nEarlier:\nORION: Gym is at 6 PM\.\n\nMessage:\nNick: lights off$/);
        expect(body.format.required).toEqual(["move", "tool", "args", "tier", "think", "say", "answer"]);
        expect(body.options.temperature).toBe(0);
        expect(body.think).toBe(false);
        expect(body.stream).toBe(false);
    });
    it("returns the model's move when it is valid", async () => {
        const d = await decide({ message: "lights off", clock: "Fri 21:40" }, { fetchImpl: reply('{"move":"tool","tool":"lights","args":{"do":"off"},"tier":"quick","think":"off","say":"Turning them off.","answer":""}') });
        expect(d).toMatchObject({ move: "tool", tool: "lights", args: { do: "off" }, say: "Turning them off." });
        expect(d.fallback).toBeUndefined();
    });
    it("never blocks a turn: bad JSON, an unknown move or tool, an HTTP error and a timeout all hand the turn to the worker", async () => {
        const cases = [
            reply("not json"),
            reply('{"move":"dance"}'),
            reply('{"move":"tool","tool":"teleport","args":{}}'),
            async () => new Response("boom", { status: 500 }),
            (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
        ];
        for (const fetchImpl of cases) {
            const d = await decide({ message: "x", clock: "Fri 10:00" }, { fetchImpl: fetchImpl, timeoutMs: 50 });
            expect(d.move).toBe("escalate");
            expect(d.fallback).toBeTruthy();
        }
    });
    it("an answer move must carry its answer text; otherwise the worker answers", async () => {
        const d = await decide({ message: "what time is it", clock: "Fri 10:00" }, { fetchImpl: reply('{"move":"answer","tool":"","args":{},"tier":"quick","think":"off","say":"","answer":""}') });
        expect(d.move).toBe("escalate");
        expect(d.fallback).toBe("empty answer");
    });
});
// 2026-10-14: the 9B was never warmed and anything else (a terminal `ollama run`, a different
// num_ctx) unloaded the models, so turns paid cold loads. keepWarm reloads only what is missing.
describe("keepWarm", () => {
    const fakeOllama = (loaded) => {
        const loads = [];
        const fetchImpl = (async (url, init) => {
            if (String(url).endsWith("/api/ps"))
                return { ok: true, json: async () => ({ models: loaded }) };
            const body = JSON.parse(init?.body ?? "{}");
            loads.push({ model: body.model, num_ctx: body.options?.num_ctx });
            return { ok: true, json: async () => ({}) };
        });
        return { fetchImpl, loads };
    };
    const models = [{ model: "qwen3.5:4b-q4_K_M", numCtx: 16384 }, { model: "qwen3.5:9b", numCtx: 32768 }];
    it("loads the models that are not in memory, at the context the gateway uses", async () => {
        const { fetchImpl, loads } = fakeOllama([{ name: "qwen3.5:4b-q4_K_M", context_length: 16384 }]);
        expect(await keepWarm(models, { fetchImpl })).toEqual(["qwen3.5:9b"]);
        expect(loads).toEqual([{ model: "qwen3.5:9b", num_ctx: 32768 }]);
    });
    it("reloads a model loaded at another context size, and leaves warm ones alone", async () => {
        const { fetchImpl, loads } = fakeOllama([{ name: "qwen3.5:4b-q4_K_M", context_length: 16384 }, { name: "qwen3.5:9b", context_length: 8192 }]);
        expect(await keepWarm(models, { fetchImpl })).toEqual(["qwen3.5:9b"]);
        const warm = fakeOllama([{ name: "qwen3.5:4b-q4_K_M", context_length: 16384 }, { name: "qwen3.5:9b", context_length: 32768 }]);
        expect(await keepWarm(models, { fetchImpl: warm.fetchImpl })).toEqual([]);
        expect(warm.loads).toEqual([]);
    });
    it("never throws when Ollama is down", async () => {
        const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); });
        expect(await keepWarm(models, { fetchImpl })).toEqual([]);
    });
});
