// Live 11-05 11:21 "open my CS group on safari" -> "Opened google.com in Safari.": a page he names himself is looked up or asked about, never searched.
import { describe, expect, it } from "vitest";
import { openRequest } from "./open-request.js";
import { nameWords, pageCandidates } from "./named-page.js";
import { readChatAsks, runChatAsks, type ChatDeps } from "./chat-asks.js";

describe("a page he names in his own words", () => {
  it.each([
    ["open my CS group on safari", "CS group", "Safari"],
    ["open my cs group in chrome", "cs group", "Google Chrome"],
    ["pull up our uni portal on safari", "uni portal", "Safari"],
    ["open my cs group", "cs group", undefined],
    ["open my lab group chat", "lab group chat", undefined],
    ["open my econ page in safari", "econ", "Safari"],
  ])("%s", (m, name, browser) => expect(openRequest(m)).toEqual({ kind: "personal", name, ...(browser ? { browser } : {}) }));
  it("known sites, folders, apps and his own app things are not personal pages", () => {
    expect(openRequest("open the uk amazon in safari")).toMatchObject({ kind: "url" });
    expect(openRequest("open my downloads folder")).toEqual({ kind: "folder", folder: "downloads" });
    expect(openRequest("open youtube in safari")).toMatchObject({ kind: "url", url: "https://www.youtube.com" });
    expect(openRequest("open safari")).toEqual({ kind: "app", name: "safari" });
    for (const m of ["open my tasks", "open my schedule", "open my mail in safari", "open my notes", "open my day"]) expect(openRequest(m)?.kind, m).not.toBe("personal");
  });
});

describe("candidates", () => {
  it("name words drop the generic ones", () => { expect(nameWords("CS group")).toEqual(["cs"]); expect(nameWords("group chat")).toEqual(["group", "chat"]); });
  it("an address written next to the name in his notes", () => {
    const snippets = "## Uni\n- CS group chat: https://chat.example.org/cs-group (ask Sam for the invite)\n- Gym: https://gym.example.com/login";
    expect(pageCandidates("CS group", { snippets })).toEqual(["https://chat.example.org/cs-group"]);
  });
  it("domains he has been on that carry the word as a label", () => {
    expect(pageCandidates("CS group", { domains: ["claude.ai", "cs.nulondon.ac.uk", "nulondon.instructure.com"] })).toEqual(["https://cs.nulondon.ac.uk"]);
    expect(pageCandidates("CS group", { domains: ["claude.ai", "krillion.io", "google.com"] })).toEqual([]);
  });
  it("one per host", () => expect(pageCandidates("lab", { snippets: "lab: https://a.example.com/x and lab: https://a.example.com/y", domains: ["a.example.com"] })).toHaveLength(1));
});

describe("what is done", () => {
  const deps = (found: string[], opened: string[][]): ChatDeps => ({ open: async (a) => { opened.push(a); return { stdout: "", code: 0 }; }, installed: async () => true, tasks: async () => ({ stdout: "", code: 0 }), resolveNamed: async () => found });
  const ask = readChatAsks("open my CS group on safari")!;
  it("is a chat ask, not a search", () => expect(ask).toEqual([{ kind: "open", req: { kind: "personal", name: "CS group", browser: "Safari" } }]));
  it("one clear match is opened in the browser he named", async () => {
    const opened: string[][] = [];
    const out = await runChatAsks(ask, deps(["https://chat.example.org/cs-group"], opened));
    expect(opened).toEqual([["-a", "Safari", "https://chat.example.org/cs-group"]]);
    expect(out.text).toBe("Opened chat.example.org for your CS group in Safari.");
  });
  it("two matches are asked about, nothing opens", async () => {
    const opened: string[][] = [];
    const out = await runChatAsks(ask, deps(["https://cs.a.example.com", "https://cs.b.example.com"], opened));
    expect(opened).toEqual([]);
    expect(out.text).toBe("Which one for your CS group: cs.a.example.com or cs.b.example.com?");
  });
  it("no match asks for the link and never opens google.com", async () => {
    const opened: string[][] = [];
    const out = await runChatAsks(ask, deps([], opened));
    expect(opened).toEqual([]);
    expect(out.text).toMatch(/^What's the link for your CS group\?/);
    expect(out.text + JSON.stringify(opened)).not.toMatch(/google/i);
  });
  it("with no lookup wired it still asks", async () => {
    const out = await runChatAsks(ask, { open: async () => ({ stdout: "", code: 0 }), installed: async () => true, tasks: async () => ({ stdout: "", code: 0 }) });
    expect(out.text).toMatch(/What's the link/);
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "./local-routing.js";
type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
describe("through the routing (the 11:21 message)", () => {
  it("never opens a search; asks for the link", async () => {
    const handlers = new Map<string, H[]>(); const opened: string[][] = [];
    registerLocalRouting({ on: (n: string, fn: H) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) } as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "np-")), "r.jsonl"), clock: () => "Thu 11:21", brainSearch: async () => "",
      decideImpl: async () => ({ move: "escalate", tier: "standard" }) as never, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
      chatRun: { open: async (a: string[]) => { opened.push(a); return { stdout: "", code: 0 }; }, installed: async () => true, tasks: async () => ({ stdout: "", code: 0 }), resolveNamed: async () => [] } } as never);
    const ctx = { runId: "np-1", sessionKey: "agent:main:orion-chat-np" };
    const fire = async (n: string, e: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(n) ?? []) out.push(await fn(e, ctx)); return out; };
    const said = "open my CS group on safari";
    await fire("before_model_resolve", { prompt: said });
    const [direct] = (await fire("before_agent_reply", { cleanedBody: said })) as Array<{ reply?: { text?: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] })) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
    expect(opened).toEqual([]);
    expect(`${direct?.reply?.text ?? ""} ${built?.systemPrompt ?? ""}`).toMatch(/What's the link for your CS group\?/);
    expect(`${direct?.reply?.text ?? ""} ${built?.systemPrompt ?? ""}`).not.toMatch(/google/i);
  });
});
