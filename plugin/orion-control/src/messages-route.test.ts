import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { CANNOT_EMAIL, CANNOT_TEXT_SELF, cannotSend, isMessagesJob } from "./messages-route.js";
import type { Decision } from "./front-desk.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function fakeApi() {
  const handlers = new Map<string, Handler[]>();
  return {
    api: { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    fire: async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown> = {}) => {
      const out = [];
      for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
      return out;
    },
  };
}

// Live sweep 2026-10-15, q065-q071: the front desk's real decisions for each message.
describe("local routing — texts and email (2026-10-15 live sweep)", () => {
  const setup = (decision: Decision) => {
    const f = fakeApi(); const flows: string[] = []; const days: boolean[] = [];
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), clock: () => "Thu 22:30",
      decideImpl: async () => decision, brainSearch: async () => "## ORION Manual - Index\n- sections",
      scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "t" }; },
      readDay: async (t) => { days.push(t); return "1. Gym 18:00"; } });
    const ctx = { runId: "m1", sessionKey: "agent:main:orion-chat-1" };
    const build = async (said: string) => {
      await f.fire("before_model_resolve", { prompt: said }, ctx);
      const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
      return built;
    };
    return { f, ctx, flows, days, build };
  };

  const reads: Array<[string, Decision, RegExp]> = [
    ["did anyone text me", { move: "answer", answer: "No, I haven't seen any new messages from anyone yet." }, /messages_recent/],
    ["read my last 3 texts", { move: "tool", tool: "brain", args: { do: "read", query: "last 3 texts" } }, /messages_recent/],
    ["search gmail for the internship offer", { move: "tool", tool: "browser", args: { url: "https://mail.google.com" } }, /orion-gmail-search/],
    ["any new emails from northeastern", { move: "tool", tool: "brain", args: { do: "search", query: "northeastern" } }, /orion-gmail-search/],
  ];
  for (const [said, decision, tool] of reads) {
    it(`"${said}" gives the worker the read tools, not the manual or a draft`, async () => {
      const { build, flows, f, ctx } = setup(decision);
      const built = await build(said);
      expect(built?.systemPrompt).toMatch(tool);
      expect(built?.systemPrompt).not.toMatch(/ORION Manual - Index|orion-brain read|drafted this reply/);
      expect(flows).toEqual([]);
      expect(await f.fire("before_agent_reply", {}, ctx)).toEqual([undefined]);
    });
  }

  const cannot: Array<[string, Decision, string]> = [
    ["text myself bring the charger to lab", { move: "tool", tool: "tasks", args: { do: "add", title: "bring the charger to lab" } }, CANNOT_TEXT_SELF],
    ["email myself the list of my tasks for today", { move: "escalate", tier: "standard" }, CANNOT_EMAIL],
    ["text myself my gym schedule for the week", { move: "escalate", tier: "standard" }, CANNOT_TEXT_SELF],
  ];
  for (const [said, decision, line] of cannot) {
    it(`"${said}" is told plainly what ORION cannot send, and nothing is booked`, async () => {
      const { build, flows, f, ctx } = setup(decision);
      const built = await build(said);
      expect(flows).toEqual([]);
      expect(built?.systemPrompt).toContain(`exactly this text and nothing else, and do not call any tools:\n${line}`);
      // The worker paraphrased into "I've listed your tasks" (q068): the exact line is put back.
      const final = { role: "assistant", content: "I've listed your tasks for today." };
      await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: final.content, messages: [final] }, ctx);
      await f.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: final.content, messages: [final] }, ctx);
      expect(final.content).toBe(line);
    });
  }

  it("a text to someone he names goes to the worker with messages_send and its approval", async () => {
    const { build, flows } = setup({ move: "escalate", tier: "quick" });
    const built = await build("text mom I'll be late for dinner");
    expect(built?.systemPrompt).toMatch(/messages_send\(recipient, body\)[\s\S]*approval/);
    expect(flows).toEqual([]);
  });

  it("'did anyone text me today?' reads his texts, not his calendar", async () => {
    const { build, days } = setup({ move: "escalate", tier: "quick" });
    const built = await build("did anyone text me today?");
    expect(built?.systemPrompt).toMatch(/messages_recent/);
    expect(days).toEqual([]);
  });

  it("a to-do about email and an ordinary day change are not message jobs", () => {
    expect(cannotSend("add a todo to email prof about office hours by thurs")).toBeNull();
    expect(isMessagesJob("add a todo to email prof about office hours by thurs")).toBe(false);
    expect(isMessagesJob("remind me at 9 to text mom")).toBe(false);
    expect(isMessagesJob("move gym to 7")).toBe(false);
    expect(isMessagesJob("put the message board deck at 3pm")).toBe(false);
    expect(cannotSend("send prof an email about the extension")).toBe(CANNOT_EMAIL);
    expect(cannotSend("can you send me a text with my gym times")).toBe(CANNOT_TEXT_SELF);
    expect(cannotSend("text carla running late")).toBeNull();
  });
});

describe("a leading email that is a question (review, 2026-10-16)", () => {
  it("'email from northeastern, anything new?' is a read, not a send", () => {
    const m = "email from northeastern, anything new?";
    expect(cannotSend(m)).toBeNull();
    expect(isMessagesJob(m)).toBe(true);
    expect(cannotSend("email prof that i'll be late")).toBe(CANNOT_EMAIL);
    expect(cannotSend("email myself the list of my tasks for today")).toBe(CANNOT_EMAIL);
  });
  it("inbox, gmail and imessage questions are messages jobs", () => {
    for (const m of ["whats my inbox look like", "whats my latest imessage", "whats my gmail say"]) expect(isMessagesJob(m), m).toBe(true);
  });
});
