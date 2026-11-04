// w18 audit2 (item E), 11-04 10:32-10:34: ORION asked "Where are you at? I'll log it." and answered "what do you mean" with "I asked because you
// didn't answer my message", then answered "what was your question? ... im at portsoken" with "I don't see a question in your message".
// A clarification of ORION's own question is answered from the question's text, by code, never by the model's guess.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { asksYourQuestion, outreachNote } from "./outreach-reply.js";
import { whyAnswer } from "./why-answer.js";

const ASKED = "Where are you at? I'll log it.";
const label = (text: string, minutes = 2) => `[ORION context: you messaged him first, ${minutes} min ago: "${text}". This message MAY be his answer.]\n`;

describe("asksYourQuestion", () => {
  it.each(["what was your question?", "what was your question? (other than where am i). im at portsoken im still in my Discrete Structures Seminar", "wait what did you ask",
    "what were you asking", "whats your question", "what question"])("yes: %s", (m) => expect(asksYourQuestion(m)).toBe(true));
  it.each(["what was the question on the econ exam", "what is my next class", "ok", "what do you mean by that exactly, the second line"])("no: %s", (m) => expect(asksYourQuestion(m)).toBe(false));
});

describe("whyAnswer restates the question it asked", () => {
  it("quotes the question and keeps the promise it made", () => {
    expect(whyAnswer({ text: ASKED, minutes: 2, kind: "info" })).toEqual({ kind: "say", text: 'I was asking: "Where are you at?" Just tell me. I\'ll log it.' });
  });
  it("no question in the text, nothing restated", () => expect(whyAnswer({ text: "Your phone battery is at 12%.", minutes: 1, kind: "info" })).toBeUndefined());
});

describe("the notes the worker gets", () => {
  it("a mixed message (his answer plus 'what was your question') carries the question and forbids denying it", () => {
    const note = outreachNote({ text: ASKED, minutes: 2, kind: "info" }, "what was your question? (other than where am i). im at portsoken im still in my Discrete Structures Seminar");
    expect(note).toContain("Where are you at?");
    expect(note).toMatch(/never say you see no question/i);
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness() {
  const handlers = new Map<string, Handler[]>();
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "a2q-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Wed 10:32", now: () => new Date("2026-11-04T10:34:00Z"),
    decideImpl: async () => ({ move: "escalate", tier: "standard" }) } as never);
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  return async (prompt: string) => {
    const ctx = { runId: `q${n += 1}`, sessionKey: "agent:main:orion-chat-a2q" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string; prependContext?: string; systemPrompt?: string } | undefined>;
    return { direct: direct?.reply?.text, built: `${built?.prependContext ?? ""}\n${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
  };
}

describe("the turn", () => {
  it.each(["what do you mean", "what was your question?", "huh", "wdym"])("'%s' after the question is the question again, from code", async (said) => {
    const out = await harness()(`${label(ASKED)}${said}`);
    expect(out.direct ?? out.built).toMatch(/I was asking: "Where are you at\?"/);
    expect(`${out.direct ?? ""}`).not.toMatch(/didn't answer my message/);
  });
  it("his answer plus 'what was your question' reaches the worker with the question and the rule", async () => {
    const out = await harness()(`${label(ASKED)}what was your question? (other than where am i). im at portsoken im still in my Discrete Structures Seminar`);
    expect(out.direct).toBeUndefined();
    expect(out.built).toContain("Where are you at?");
    expect(out.built).toMatch(/never say you see no question/i);
  });
});
