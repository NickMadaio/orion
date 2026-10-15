import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";

// Live sweep 2026-10-15 (memory-facts): "remember …", "note that …" and "my X is Y" were answered by the
// front desk's draft and never saved ("I've noted that", no tool call), a habit went to the calendar, a
// fact went to an alarm, the one fact that was saved went to the ORION repair queue, and recall questions
// were answered with "I can look it up if you'd like" or a course policy read back as "You mentioned…".
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

const turn = async (said: string, decision: Decision) => {
  const f = fakeApi(); let flowRan = false; let reminderAsked = false;
  registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "mf-")), "r.jsonl"), clock: () => "Thu 22:25",
    decideImpl: async () => decision, brainSearch: async () => "",
    scheduleFlow: async () => { flowRan = true; return { outcome: "fallback", reason: "t" }; },
    extractReminder: async () => { reminderAsked = true; return { time: "12:00", label: "peanut allergy reminder" }; } });
  const ctx = { runId: `mf-${said}`, sessionKey: "agent:main:orion-chat-sweep" };
  await f.fire("before_model_resolve", { prompt: said }, ctx);
  const [reply] = await f.fire("before_agent_reply", { cleanedBody: said }, ctx);
  const [built] = (await f.fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
  return { reply, prompt: built?.systemPrompt ?? "", context: built?.appendContext ?? "", flowRan, reminderAsked };
};

describe("facts he tells ORION are saved to his brain, not drafted (sweep 2026-10-15)", () => {
  const facts: Array<[string, string, Decision]> = [
    ["q055", "remember my wifi password is on the sticky note in my desk drawer", { move: "answer", answer: "Got it. Your wifi password is on the sticky note in your desk drawer." }],
    ["q057", "my lab partner for ds lab is priya", { move: "answer", answer: "Nice to meet you, Priya. Good luck with the lab." }],
    ["q064", "i take creatine every morning at 8", { move: "answer", answer: "Got it. Creatine logged for today at 8 AM." }],
    ["q058", "im allergic to peanuts btw, dont let me forget that", { move: "tool", tool: "supplements", args: {}, answer: "Got it. I'll add a note about your peanut allergy to your health info." }],
    ["q061", "note that my car insurance renews on the 3rd of november", { move: "tool", tool: "brain", args: { do: "learn", query: "car insurance renews on 3 nov" } }],
  ];
  for (const [id, said, decision] of facts) {
    it(`${id}: "${said}" → orion-brain learn into his own note, no draft, no calendar, no alarm`, async () => {
      const t = await turn(said, decision);
      expect(t.reply).toBeUndefined();
      expect(t.flowRan).toBe(false);
      expect(t.reminderAsked).toBe(false);
      expect(t.prompt).not.toMatch(/drafted this reply|alarm_set/);
      expect(t.prompt).toMatch(/orion-brain learn "Nick" "fact"/);
      expect(t.prompt).toMatch(/repair queue is only for problems with ORION/);
      expect(t.context).toMatch(/orion-brain learn "Nick"/);
    });
  }

  it("a reminder at a time, a change to his day and a plain question are not facts", async () => {
    expect((await turn("don't let me forget to call mom at 5", { move: "tool", tool: "alarm" })).reminderAsked).toBe(true);
    expect((await turn("remember to move gym to 7", { move: "tool", tool: "reschedule" })).prompt).not.toMatch(/orion-brain learn "Nick" "fact"/);
    expect((await turn("my meeting is at 3pm", { move: "tool", tool: "reschedule" })).prompt).not.toMatch(/orion-brain learn "Nick" "fact"/);
    expect((await turn("thanks", { move: "answer", answer: "You're welcome, Nick." })).reply).toMatchObject({ handled: true });
  });
});

describe("questions about what he told ORION search the brain first (sweep 2026-10-15)", () => {
  const recalls: Array<[string, string, Decision]> = [
    ["q055 t2", "what did i say about my wifi password", { move: "ask", answer: "I don't remember. Did you mention it recently?" }],
    ["q056", "what did i say about my advisor", { move: "ask", answer: "I don't recall. Did you mention a specific topic or meeting?" }],
    ["q057 t2", "who's my lab partner", { move: "ask", answer: "I don't have that info, Nick. Who are you working with?" }],
    ["q059", "whats my allergy", { move: "answer", answer: "You're allergic to shellfish." }],
    ["q064 t2", "ok and what time do i usually take it", { move: "ask", answer: "Which supplement are you asking about?" }],
  ];
  for (const [id, said, decision] of recalls) {
    it(`${id}: "${said}" → brain search before replying, never an offer to search`, async () => {
      const t = await turn(said, decision);
      expect(t.reply).toBeUndefined();
      expect(t.flowRan).toBe(false);
      expect(t.prompt).not.toMatch(/drafted this reply/);
      expect(t.prompt).toMatch(/orion-brain search/);
      expect(t.prompt).toMatch(/Never offer to search/);
      // q056: a course policy is "your ECON1115 notes say…", not "You mentioned…".
      expect(t.prompt).toMatch(/only for facts saved in his "Nick" note/);
      expect(t.context).toMatch(/orion-brain search/);
    });
  }

  it("questions about his day stay with the day reader", async () => {
    const t = await turn("what's my next class?", { move: "tool", tool: "agenda" });
    expect(t.prompt).not.toMatch(/Never offer to search/);
  });
});
