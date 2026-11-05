// w20 r5 (live gate 3 #100): "open youtube in safari and tell me whats the weather" opened Safari only. Both asks are done: code opens, the question is answered.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitLeadOpen } from "./chat-asks.js";
import { registerLocalRouting } from "./local-routing.js";

describe("an open followed by a question", () => {
  it.each([
    ["open youtube in safari and tell me whats the weather", "https://www.youtube.com", "tell me whats the weather"],
    ["open amazon uk then whats on my list", "https://www.amazon.co.uk", "whats on my list"],
    ["pull up youtube in chrome and tell me what the weather is like", "https://www.youtube.com", "tell me what the weather is like"],
    ["open the german ebay, then check how much protein is in a wrap", "https://www.ebay.de", "check how much protein is in a wrap"],
    ["open safari and show me whats on tomorrow", undefined, "show me whats on tomorrow"],
    ["open youtube and also tell me the time", "https://www.youtube.com", "tell me the time"],
  ])("%s", (m, url, rest) => {
    const s = splitLeadOpen(m);
    expect(s?.rest, m).toBe(rest);
    if (url) expect(s?.req).toMatchObject({ kind: "url", url });
    else expect(s?.req).toMatchObject({ kind: "app", name: "safari" });
  });
  it("is not fooled by a single ask or a non-open head", () => {
    for (const m of ["open youtube in safari", "tell me the weather and open safari", "what is on and open it later", "open safari and open youtube"]) expect(splitLeadOpen(m), m).toBeNull();
  });
});

type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
describe("through the routing", () => {
  it("opens by code, then the worker is told the open is done and answers the rest", async () => {
    const handlers = new Map<string, H[]>(); const opened: string[][] = [];
    registerLocalRouting({ on: (n: string, fn: H) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) } as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lo-")), "r.jsonl"), clock: () => "Thu 15:00", brainSearch: async () => "",
      decideImpl: async () => ({ move: "escalate", tier: "standard" }) as never, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
      chatRun: { open: async (a: string[]) => { opened.push(a); return { stdout: "", code: 0 }; }, installed: async () => true, tasks: async () => ({ stdout: "", code: 0 }) } } as never);
    const ctx = { runId: "lo-1", sessionKey: "agent:main:orion-chat-lo" };
    const fire = async (n: string, e: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(n) ?? []) out.push(await fn(e, ctx)); return out; };
    const said = "open youtube in safari and tell me whats the weather";
    await fire("before_model_resolve", { prompt: said });
    const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] })) as Array<{ systemPrompt?: string } | undefined>;
    expect(opened).toEqual([["-a", "Safari", "https://www.youtube.com"]]);
    expect(built?.systemPrompt).toContain("Opened youtube.com in Safari.");
    expect(built?.systemPrompt).toMatch(/weather/i);
  });

  async function hear(said: string, decide: unknown = { move: "escalate", tier: "standard" }) {
    const handlers = new Map<string, H[]>(); const opened: string[][] = []; const mouse: string[][] = [];
    registerLocalRouting({ on: (n: string, fn: H) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) } as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lo2-")), "r.jsonl"), clock: () => "Thu 06:23", now: () => new Date(2026, 10, 5, 6, 23), brainSearch: async () => "",
      decideImpl: async () => decide as never, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
      chatRun: { open: async (a: string[]) => { opened.push(a); return { stdout: "", code: 0 }; }, installed: async () => true, tasks: async () => ({ stdout: "", code: 0 }) },
      mouseRun: async (a: string[]) => { mouse.push(a); return { stdout: JSON.stringify({ ok: true, popup: true, say: "Here it is." }), code: 0 }; } } as never);
    const ctx = { runId: "lo-2", sessionKey: "agent:main:orion-chat-lo2" };
    const fire = async (n: string, e: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(n) ?? []) out.push(await fn(e, ctx)); return out; };
    await fire("before_model_resolve", { prompt: said });
    const [direct] = (await fire("before_agent_reply", { cleanedBody: said })) as Array<{ reply?: { text?: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] })) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
    return { opened, mouse, heard: `${direct?.reply?.text ?? ""} ${built?.systemPrompt ?? ""} ${built?.appendContext ?? ""}` };
  }
  it("open notes and tell me the time (live gate 4 #97): both are done, and the open is said once", async () => {
    const r = await hear("open notes and tell me the time", { move: "answer", answer: "It's 6:23 AM on Thursday." });
    expect(r.opened).toEqual([["-a", "notes"]]);
    expect(r.heard).toMatch(/Opened Notes\./);
    expect(r.heard).toMatch(/6:23 AM/);
    expect(r.heard.match(/Opened Notes\./g)?.length).toBe(1);
  });
  it("open the mouse mapper and whats the weather tomorrow (live gate 4 #98): the popup opens and the weather is still answered", async () => {
    const r = await hear("open the mouse mapper and whats the weather tomorrow");
    expect(r.mouse).toEqual([["setup", "--again", "--json"]]);
    expect(r.heard).toMatch(/Here it is\./);
    expect(r.heard).toMatch(/weather/i);
  });
});
