// r8b2 (2026-10-16): live re-run at 11:08 — the 9B misread a day that HAD the lab (q009, q013) and "and after that?" (q006).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { codeDayAnswer, spokenSpan } from "./day-read-answers.js";

const DAY = [
  "B1 13:30–15:00 MKTG2201 Introduction to Marketing — Lecture (FIXED)",
  "B2 15:30–17:00 ECON1115 Principles of Macroeconomics — Lecture (FIXED)",
  "B3 17:50–18:20 Finish resume",
  "B4 19:25–20:10 CS Lab (FIXED)",
  "B5 20:15–21:00 Review spending",
  "All day: Macro Quiz 1",
].join("\n");
const NOW = 11 * 60 + 8;

describe("code answers for blocks that are on the day", () => {
  it("q009: minutes until the lab", () => {
    expect(codeDayAnswer("how many minutes until the lab starts", DAY, false, NOW)?.text).toBe("Your CS Lab starts at 7:25 PM, in about 8 h 17 min.");
  });
  it("q013: is today a lab day", () => {
    expect(codeDayAnswer("is today a lab day or nah", DAY, false, NOW)?.text).toBe("Yes — CS Lab, 7:25 to 8:10 PM.");
  });
  it("q006: next class, then 'and after that?' uses the remembered block", () => {
    const first = codeDayAnswer("how long till my next class", DAY, false, NOW)!;
    expect(first.text).toBe("Your next class is MKTG2201 Introduction to Marketing at 1:30 PM, in about 2 h 22 min.");
    const second = codeDayAnswer("and after that?", DAY, false, NOW, first.memory)!;
    expect(second.text).toBe("After that: ECON1115 Principles of Macroeconomics at 3:30 PM.");
    expect(codeDayAnswer("and after that?", DAY, false, NOW, second.memory)?.text).toBe("Nothing after that today.");
  });
  it("no memory, nothing to say; several matches are named in order; never 24-hour", () => {
    expect(codeDayAnswer("and after that?", DAY, false, NOW)).toBeNull();
    const two = `${DAY}\nB6 21:15–22:00 Chem Lab`;
    expect(codeDayAnswer("is today a lab day", two, false, NOW)?.text).toBe("Yes — CS Lab, 7:25 to 8:10 PM and Chem Lab, 9:15 to 10:00 PM.");
    expect(codeDayAnswer("when does the lab start", DAY, false, NOW)?.text).toBe("Your CS Lab starts at 7:25 PM and ends at 8:10 PM.");
    expect(spokenSpan(25)).toBe("25 min");
    expect(spokenSpan(120)).toBe("2 h");
  });
  it("a question that names no present block is not code's", () => {
    expect(codeDayAnswer("what's on today", DAY, false, NOW)).toBeNull();
  });
});

describe("through the route", () => {
  type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
  const setup = () => {
    const handlers = new Map<string, Handler[]>();
    registerLocalRouting({ on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) },
      { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), decideImpl: async () => ({ move: "escalate", tier: "quick" }), clock: () => "Fri 11:08",
        brainSearch: async () => "", now: () => new Date(2026, 9, 16, 11, 8), scheduleFlow: async () => ({ outcome: "fallback", reason: "a question" }), readDay: async () => DAY });
    return async (prompt: string) => {
      const ctx = { runId: `r${Math.random()}`, sessionKey: "agent:main:orion-chat-1" };
      for (const fn of handlers.get("before_model_resolve") ?? []) await fn({ prompt }, ctx);
      const [built] = await Promise.all((handlers.get("before_prompt_build") ?? []).map((fn) => fn({ prompt, messages: [] }, ctx))) as Array<{ appendContext?: string } | undefined>;
      return built?.appendContext ?? "";
    };
  };
  it("q009 and q006 follow-up reach the worker as exact text", async () => {
    const turn = setup();
    expect(await turn("how many minutes until the lab starts")).toContain("exactly: Your CS Lab starts at 7:25 PM, in about 8 h 17 min.");
    expect(await turn("how long till my next class")).toContain("Your next class is MKTG2201");
    expect(await turn("and after that?")).toContain("exactly: After that: ECON1115 Principles of Macroeconomics at 3:30 PM.");
  });
  it("'and after that?' with no earlier day answer is left to the worker", async () => {
    expect(await setup()("and after that?")).not.toContain("exactly: After that");
  });
});

// ---- H6 cut-off fragments + H4 finalize sanitizer (r8b2) ----
describe("cut-off fragments and raw text in replies", () => {
  type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
  const rig = () => {
    const handlers = new Map<string, H[]>();
    const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
    registerLocalRouting({ on: (n: string, fn: H) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) },
      { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), decideImpl: async () => ({ move: "escalate", tier: "quick" }), clock: () => "Fri 11:25", brainSearch: async () => "" });
    const spoken = (t: string) => `[Orion app context]\nNick SAID this out loud and your answer will be SPOKEN: short.\n\nUser message:\n${t}`;
    const turn = async (runId: string, prompt: string) => {
      const ctx = { runId, sessionKey: "agent:main:orion-chat-1" };
      await fire("before_model_resolve", { prompt: spoken(prompt) }, ctx);
      const [b] = (await fire("before_prompt_build", { prompt: spoken(prompt), messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
      return { text: `${b?.systemPrompt ?? ""}\n${b?.appendContext ?? ""}`, ctx };
    };
    return { turn, fire };
  };
  it("the bare 'can' is held with Go on.; the joined text reaches the worker", async () => {
    const r = rig();
    expect((await r.turn("h1", "can")).text).toContain("Go on.");
    const rest = (await r.turn("h2", "(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) you tell me what the weekly plan looks like")).text;
    expect(rest).toContain("The whole request, joined: \"can you tell me what the weekly plan looks like\"");
  });
  it("whole short questions are not held", async () => {
    for (const q of ["what time is it", "is it raining", "can you", "yes i can", "what's it like", "i love this"]) expect((await rig().turn("h", q)).text).not.toContain("exactly this text and nothing else, and do not call any tools:\nGo on.");
  });
  it("q070: the finalize puts a clean reply in place when the worker's ended in an Exec failed line", async () => {
    const r = rig();
    const { ctx } = await r.turn("f1", "search gmail for the internship offer please");
    const messages = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: "Nothing found.\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search internship`" }] }];
    await r.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: (messages[1]!.content as Array<{ text: string }>)[0]!.text, messages }, ctx);
    expect((messages[1]!.content as Array<{ text: string }>)[0]!.text).toBe("Nothing found.");
  });
});

// review 5 (2026-10-16 r8b): H2 follow-up keeps its day, H3 compound nouns, M6 length / end questions.
const TOMORROW = ["B1 09:00–10:30 CHEM1211 Lecture (FIXED)", "B2 11:00–12:00 Gym", "B3 14:00–15:30 PHIL1101 Lecture (FIXED)"].join("\n");
describe("review 5 fixes", () => {
  it("H2: 'and after that?' after a tomorrow answer reads tomorrow and finds the block by start time", () => {
    const first = codeDayAnswer("when's my next class tomorrow?", TOMORROW, true, NOW)!;
    expect(first.text).toBe("Your next class is CHEM1211 Lecture at 9:00 AM.");
    expect(first.memory.tomorrow).toBe(true);
    // an edit between turns inserts a block; the index would shift, the start time does not
    const edited = ["B1 08:00–08:30 Email", TOMORROW.replace(/^B1/m, "B2")].join("\n");
    const second = codeDayAnswer("and after that?", edited, first.memory.tomorrow, NOW, first.memory)!;
    expect(second.text).toBe("After that: PHIL1101 Lecture at 2:00 PM.");
    expect(second.memory.tomorrow).toBe(true);
  });
  it("H3: a kind word followed by a noun, or deadline talk, is not the block", () => {
    for (const q of ["how long until the lab report is due?", "when is my lab partner meeting", "how many minutes until the lab manual reading", "do i have a lab report due today?", "when is my lab grade posted", "what time is the gym membership thing"]) {
      expect(codeDayAnswer(q, DAY, false, NOW), q).toBeNull();
    }
    expect(codeDayAnswer("how many minutes until the lab starts", DAY, false, NOW)).not.toBeNull();
  });
  it("M6: length and end questions answer length and end, never the start; bare 'next' is not 'after that'", () => {
    expect(codeDayAnswer("how long is my lab?", DAY, false, NOW)?.text).toMatch(/^Your CS Lab is 45 min long, 7:25 to 8:10 PM\./);
    expect(codeDayAnswer("what time does my lab go until?", DAY, false, NOW)?.text).toMatch(/^Your CS Lab ends at 8:10 PM\./);
    const first = codeDayAnswer("how long till my next class", DAY, false, NOW)!;
    expect(codeDayAnswer("what's next", DAY, false, NOW, first.memory)).toBeNull();
    expect(codeDayAnswer("and then?", DAY, false, NOW, first.memory)?.text).toMatch(/^After that/);
  });
});
