import { describe, expect, it } from "vitest";
import { decide, frontDeskRequest } from "./front-desk.js";
import { FRONT_DESK_MODEL, FRONT_DESK_SYSTEM } from "./front-desk-prompt.js";

const reply = (content: string) => async () => new Response(JSON.stringify({ message: { content } }), { status: 200 });

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
      (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    ];
    for (const fetchImpl of cases) {
      const d = await decide({ message: "x", clock: "Fri 10:00" }, { fetchImpl: fetchImpl as typeof fetch, timeoutMs: 50 });
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
