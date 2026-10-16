import { describe, expect, it } from "vitest";
import { FORM_PROMPT, intentSchema, parseAskContext, runScheduleFlow, spokenReply, type AskContext, type Day, type Intent } from "./schedule-flow.js";
import { isCalendarTurn } from "./local-routing.js";

// 16:30, a planned resume block 14:00-16:00 (not started), a class this morning.
const day: Day = { date: "2030-10-03", now: "16:30", blocks: [
  { title: "CS1800 Discrete Structures — Lecture", start: "09:00", end: "10:30", fixed: true },
  { title: "finish resume", start: "14:00", end: "16:00", fixed: false },
] };

/** Runs the flow with a stubbed form and records the orion-reschedule argv. */
async function flow(message: string, steps: Intent[], askContext?: AskContext) {
  const calls: string[][] = [];
  const result = await runScheduleFlow({ message, clock: "Thu 16:30", ...(askContext ? { askContext } : {}),
    exec: async (args) => {
      calls.push(args);
      return { stdout: args[0] === "show" ? JSON.stringify(day) : "Changed Thursday 2030-10-03:\n  logged gym 14:00–16:00\nLogged gym 2-4. Finish resume moved to 7-9.", code: 0 };
    },
    ask: async () => ({ steps }) });
  return { result, logs: calls.filter((c) => c[0] === "log") };
}
const window: AskContext = { start: "14:00", end: "now" };

describe("schedule flow: log step", () => {
  it("'i'm at the gym' with an ask window logs from the ask start to now", async () => {
    const { logs } = await flow("i'm at the gym", [{ do: "log", what: "gym" }], window);
    expect(logs).toEqual([["log", "gym", "--from", "14:00", "--to", "now"]]);
  });

  it("'was at the library since 2' is 14:00 to now", async () => {
    expect((await flow("was at the library since 2", [{ do: "log", what: "library", from: "14:00", to: "now" }])).logs).toEqual([["log", "library", "--from", "14:00", "--to", "now"]]);
    // a form that writes 02:00 is read as PM when 02:00 is more than 12 h behind now
    expect((await flow("was at the library since 2", [{ do: "log", what: "library", from: "02:00" }])).logs).toEqual([["log", "library", "--from", "14:00", "--to", "now"]]);
  });

  it("'gym 2-4' is a fully past block", async () => {
    expect((await flow("gym 2-4", [{ do: "log", what: "gym", from: "14:00", to: "16:00" }])).logs).toEqual([["log", "gym", "--from", "14:00", "--to", "16:00"]]);
  });

  it("'did gym instead of resume' adds --instead and takes the planned block's window", async () => {
    const { logs } = await flow("did gym instead of resume", [{ do: "log", what: "gym", instead: "B2" }]);
    expect(logs).toEqual([["log", "gym", "--from", "14:00", "--to", "16:00", "--instead", "finish resume"]]);
  });

  it("a mismatch nudge's block is the default", async () => {
    const ctx = parseAskContext('[ORION context: 5 min ago you said "Finish resume was down for 2:00 - how\'s it going?" (finish resume, planned 14:00-16:00, not started).]');
    expect(ctx?.block).toEqual({ title: "finish resume", start: "14:00", end: "16:00" });
    expect((await flow("gym", [{ do: "log", what: "gym" }], ctx)).logs).toEqual([["log", "gym", "--from", "14:00", "--to", "16:00", "--instead", "finish resume"]]);
  });

  it("'nothing really' logs nothing, with or without a form that says otherwise", async () => {
    const quiet = await flow("nothing really", [{ do: "answer", text: "Okay, nothing logged." }], window);
    expect(quiet.logs).toEqual([]);
    expect(quiet.result).toMatchObject({ outcome: "say", kind: "plain" });
    expect((await flow("nothing really", [{ do: "answer", text: "ok" }])).logs).toEqual([]);
    expect((await flow("nothing really", [{ do: "log", what: "nothing" }], window)).logs).toEqual([]);
  });

  it("with no times and no ask it asks since when, and writes nothing", async () => {
    const { result, logs } = await flow("i'm at the gym", [{ do: "log", what: "gym" }]);
    expect(logs).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", kind: "ask", text: expect.stringMatching(/Since when/) });
  });

  it("logging is for today only", async () => {
    const calls: string[][] = [];
    const result = await runScheduleFlow({ message: "gym 2-4 tomorrow", clock: "Thu 16:30",
      exec: async (a) => { calls.push(a); return { stdout: JSON.stringify({ ...day, now: null }), code: 0 }; }, ask: async () => ({ steps: [{ do: "log", what: "gym", from: "14:00", to: "16:00" }] }) });
    expect(calls.some((c) => c[0] === "log")).toBe(false);
    expect(result.outcome).toBe("say");
  });

  it("the reply is the scheduler's own one-line summary", async () => {
    const { result } = await flow("gym 2-4", [{ do: "log", what: "gym", from: "14:00", to: "16:00" }]);
    expect(result.outcome).toBe("done");
    expect(spokenReply((result as { outputs: string[] }).outputs)).toBe("Logged gym 2-4. Finish resume moved to 7-9.");
    expect(spokenReply(["Logged gym 2-4."])).toBe("Logged gym 2-4.");
  });

  it("the form knows the step, its examples, and a schema field for it", () => {
    expect(FORM_PROMPT).toMatch(/i'm at the gym/); expect(FORM_PROMPT).toMatch(/was at the library since 2/); expect(FORM_PROMPT).toMatch(/gym 2-4/);
    expect(FORM_PROMPT).toMatch(/did gym instead of resume/); expect(FORM_PROMPT).toMatch(/nothing really/);
    const props = (intentSchema(day) as any).properties.steps.items.properties;
    expect(props.do.enum).toContain("log"); expect(props.from).toBeDefined(); expect(props.instead.enum).toEqual(["B1", "B2"]);
  });

  it("routing: a statement of what he did, or any reply to an open ask, is a calendar turn", () => {
    expect(isCalendarTurn("was at the library since 2", { move: "answer" } as any)).toBe(true);
    expect(isCalendarTurn("nothing really", { move: "answer" } as any, true)).toBe(true);
    expect(isCalendarTurn("thanks", { move: "answer" } as any)).toBe(false);
  });
});
