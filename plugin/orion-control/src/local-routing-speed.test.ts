import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXACT_REPLY_PROMPT, registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import { runMessagesRead } from "./messages-read.js";
import type { MessagesRead } from "./messages-read.js";

// 2026-10-16 speed audit (docs/audits/2026-10-16-local-speed.md): prompt tokens are the cost of a local turn.
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

async function build(message: string, clock: string, extra: Record<string, unknown> = {}): Promise<{ systemPrompt: string; appendContext?: string }> {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-speed-")), "r.jsonl"), decideImpl: async () => ({ move: "escalate" }), clock: () => clock, brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), ...extra } as never);
  const ctx = { runId: "speed", sessionKey: "agent:main:orion-app-v2" };
  for (const fn of handlers.get("before_model_resolve") ?? []) await fn({ prompt: message }, ctx);
  return (await (handlers.get("before_prompt_build") ?? [])[0]!({ prompt: message, messages: [] }, ctx)) as { systemPrompt: string; appendContext?: string };
}

describe("code-written replies get a one-line system prompt", () => {
  it("a done flow: the exact text, no identity, no clock, no manual", async () => {
    const reply = "Done: small task 5:50 PM–6:20 PM.";
    const done = { scheduleFlow: async () => ({ outcome: "done", reply, calls: ["exec orion-reschedule add x"], outputs: ["ok"] }) };
    const built = await build("throw something small in before my class", "Fri 10:45", done);
    expect(built.systemPrompt).toContain(reply);
    expect(built.systemPrompt).toContain(EXACT_REPLY_PROMPT);
    expect(built.systemPrompt).not.toMatch(/Now:/);
    expect(built.systemPrompt.length).toBeLessThan(260);
    expect(built.appendContext).toContain(reply); // the latest message carries it too: history alone made the 9B paraphrase old turns
  });

  it("a say flow is just as small", async () => {
    const say = { scheduleFlow: async () => ({ outcome: "say", kind: "plain", text: "That doesn't fit before class; want it after?" }) };
    const built = await build("throw something small in before my class", "Fri 10:45", say);
    expect(built.systemPrompt).toContain("That doesn't fit before class; want it after?");
    expect(built.systemPrompt.length).toBeLessThan(260);
  });
});

type Case = { name: string; a: { message: string; extra: Record<string, unknown>; fact?: string }; b: { message: string; extra: Record<string, unknown>; fact?: string } };

const readOut = (out: string) => ({ messagesRead: (req: MessagesRead) => runMessagesRead(req, async () => ({ stdout: out, code: 0 })) });
const day = (line: string) => ({ readDay: async () => line });
const decide = (d: Decision) => ({ decideImpl: async () => d });
const remind = (label: string) => ({ ...decide({ move: "escalate" }), extractReminder: async () => ({ time: "17:00", label }) });

const cases: Case[] = [
  { name: "general", a: { message: "what did I decide about my thesis topic", extra: { brainSearch: async () => "## Thesis (Thesis.md)\n- topic: local LLM routing" }, fact: "## Thesis" },
    b: { message: "what did I decide about my thesis topic", extra: { brainSearch: async () => "## Lab (Lab.md)\n- partner: Priya" }, fact: "## Lab" } },
  { name: "overwhelmed", a: { message: "everything is too much today", extra: {} }, b: { message: "everything is too much today", extra: {} } },
  { name: "directive", a: { message: "set a timer for 10 minutes", extra: decide({ move: "tool", tool: "timer", args: { minutes: 10 } }), fact: "600" },
    b: { message: "set a timer for 25 minutes", extra: decide({ move: "tool", tool: "timer", args: { minutes: 25 } }), fact: "1500" } },
  { name: "reminder", a: { message: "remind me at 5 to call mom", extra: remind("call mom"), fact: "call mom" },
    b: { message: "remind me at 5 to email my professor", extra: remind("email my professor"), fact: "email my professor" } },
  { name: "read", a: { message: "read my last 3 texts", extra: { ...decide({ move: "tool", tool: "brain", args: { do: "search", query: "texts" } }), ...readOut("2026-10-16 14:02  Gia: running late") }, fact: "2026-10-16 14:02" },
    b: { message: "read my last 3 texts", extra: { ...decide({ move: "tool", tool: "brain", args: { do: "search", query: "texts" } }), ...readOut("2026-10-16 13:10  Mom: call me") }, fact: "2026-10-16 13:10" } },
  { name: "day", a: { message: "uh whats next on my schedule", extra: day("B1 09:00-10:30 CS1800 Lecture (FIXED)\nB2 13:45-14:30 CS Lab (FIXED)"), fact: "B1 09:00" },
    b: { message: "uh whats next on my schedule", extra: day("B1 11:00-12:00 Thesis meeting (FIXED)"), fact: "B1 11:00" } },
  { name: "messages", a: { message: "text Gia that I'm running late", extra: {} }, b: { message: "text Mom that I'm running late", extra: {} } },
];

const NOW_LINE = /Now: Fri 10:4\d \(Europe\/London\)\.[^\n]*$/;

describe("the worker prompt keeps a stable prefix", () => {
  for (const c of cases) {
    it(`${c.name}: the stable prefix is byte-identical across turns and the Now line is last`, async () => {
      const a = (await build(c.a.message, "Fri 10:45", c.a.extra)).systemPrompt;
      const b = (await build(c.b.message, "Fri 10:46", c.b.extra)).systemPrompt;
      expect(a).not.toBe(b);
      expect(a).toMatch(NOW_LINE);
      expect(b).toMatch(NOW_LINE);
      // The stable prefix ends where the per-turn content starts: the first fact, or the Now line when the turn adds none.
      const cut = (text: string, fact: string | undefined, clock: string) => (fact ? text.indexOf(fact) : text.indexOf(`Now: ${clock}`));
      const ai = cut(a, c.a.fact, "Fri 10:45");
      const bi = cut(b, c.b.fact, "Fri 10:46");
      expect(ai).toBeGreaterThan(200); // the identity and instructions come first
      expect(a.slice(0, ai)).toBe(b.slice(0, bi));
      // Everything from the per-turn content on ends with the clock: nothing stable follows it.
      expect(a.slice(ai)).toMatch(NOW_LINE);
      expect(a.slice(a.indexOf("Now: Fri 10:45"))).toMatch(/^Now: [^\n]*$/);
    });
  }

  it("per-turn facts (brain snippets) are present and come after the fixed instructions", async () => {
    const message = "what did I decide about my thesis topic";
    const withSnippet = (await build(message, "Fri 10:45", { brainSearch: async () => "## Thesis (Thesis.md)\n- topic: local LLM routing" })).systemPrompt;
    const without = (await build(message, "Fri 10:45")).systemPrompt;
    const at = withSnippet.indexOf("From his brain, matched");
    expect(at).toBeGreaterThan(0);
    expect(withSnippet).toContain("topic: local LLM routing");
    expect(withSnippet.slice(0, at).trimEnd()).toBe(without.slice(0, without.indexOf("Now: Fri 10:45")).trimEnd());
  });

  it("the day prompt keeps the evaluated wording", async () => {
    const built = (await build("uh whats next on my schedule", "Fri 10:45", day("B1 09:00-10:30 CS1800 Lecture (FIXED)"))).systemPrompt;
    expect(built).toContain("Answer his question from this list only, in one or two short spoken sentences");
  });
});

describe("the draft hand-off prompt", () => {
  const draftTurn = (draft: string, clock: string) => build("what time is it", clock, decide({ move: "answer", answer: draft }));

  it("keeps the identity and length rule first and the clock last, after the draft", async () => {
    const built = (await draftTurn("It's 3:40 PM.", "Fri 15:40")).systemPrompt;
    expect(built).toMatch(/^You are ORION/);
    expect(built).toContain("Reply in one to three short sentences");
    expect(built).toContain('You drafted this reply: "It\'s 3:40 PM."');
    expect(built.indexOf("Now: Fri 15:40")).toBeGreaterThan(built.indexOf("You drafted this reply"));
    expect(built).toMatch(/Now: Fri 15:40 \(Europe\/London\)\.[^\n]*$/);
  });

  it("the stable part is the same for two different drafts", async () => {
    const a = (await draftTurn("Sure thing.", "Fri 10:45")).systemPrompt;
    const b = (await draftTurn("Of course.", "Fri 10:46")).systemPrompt;
    expect(a.slice(0, a.indexOf("Sure thing."))).toBe(b.slice(0, b.indexOf("Of course.")));
  });
});
