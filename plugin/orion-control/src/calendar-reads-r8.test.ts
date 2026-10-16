// Round 8 live sweep (2026-10-16): calendar reads. q004 left the all-day quiz out of "whats on today", q015 invented a nap
// block's end time, q041 read a lecture's time out as the all-day quiz's. Written by Claude on 2026-10-16.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { meansTomorrow } from "./schedule-flow.js";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import { dayRead, noBlockReply } from "./day-read-answers.js";
import { deadlineReply, parseTasks, asksDeadlines, type DeadlineRead } from "./deadline-read.js";

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

const DAY = "B1 13:30–15:00 MKTG2201 Introduction to Marketing — Lecture (FIXED)\nB2 15:30–17:00 ECON1115 Principles of Macroeconomics — Lecture (FIXED)";
const QUIZ = "All day: Macro (ECON1115) — Quiz 1";

function harness(decision: Decision, opts: { day?: string; deadlines?: DeadlineRead | null; sessionStatus?: boolean } = {}) {
  const f = fakeApi();
  const reads: boolean[] = [];
  const logPath = join(mkdtempSync(join(tmpdir(), "cr8-")), "r.jsonl");
  registerLocalRouting(f.api, { warm: false, mode: "on", logPath, decideImpl: async () => decision, clock: () => "Fri 03:31", brainSearch: async () => "",
    now: () => new Date(2026, 9, 16, 3, 31),
    scheduleFlow: async () => ({ outcome: "fallback", reason: "a question, not a change" }),
    readDay: async (tomorrow) => { reads.push(tomorrow); return opts.day ?? `${DAY}\n${QUIZ}`; },
    readDeadlines: async () => opts.deadlines ?? null });
  const turn = async (prompt: string, reply = "ok") => {
    const ctx = { runId: `r8-${prompt.length}`, sessionKey: "agent:main:orion-chat-1" };
    await f.fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
    await f.fire("before_agent_finalize", { runId: ctx.runId, lastAssistantMessage: reply, messages: [] }, ctx);
    const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    return { prompt: built?.systemPrompt ?? "", log: lines[lines.length - 1] as Record<string, unknown> };
  };
  return { turn, reads };
}

describe("q004: the day read includes all-day events", () => {
  it("dayRead adds an All day line after the blocks, and none when there are none", () => {
    const json = { date: "2026-10-16", now: "03:31", allDay: ["Macro (ECON1115) — Quiz 1"], blocks: [{ title: "Lab", start: "13:30", end: "15:00", fixed: true }] };
    expect(dayRead(json)).toBe("B1 13:30–15:00 Lab (FIXED)\nAll day: Macro (ECON1115) — Quiz 1");
    expect(dayRead({ ...json, allDay: [] })).toBe("B1 13:30–15:00 Lab (FIXED)");
    expect(dayRead({ ...json, allDay: undefined })).toBe("B1 13:30–15:00 Lab (FIXED)");
  });
  it("the worker is handed that line for 'whats on today like all of it'", async () => {
    const { prompt } = await harness({ move: "escalate", tier: "standard" }).turn("whats on today like all of it");
    expect(prompt).toContain("All day: Macro (ECON1115) — Quiz 1");
    expect(prompt).toMatch(/all day/i);
  });
});

describe("q015: a named block that is not on the day", () => {
  it("noBlockReply names what is there, with 12-hour times", () => {
    expect(noBlockReply("how much time do i have before my nap block ends", DAY, false))
      .toBe("There's no nap block on your calendar today. You have MKTG2201 Introduction to Marketing at 1:30 PM and ECON1115 Principles of Macroeconomics at 3:30 PM.");
  });
  it("says tomorrow for a question about tomorrow", () => {
    expect(noBlockReply("when is my gym tomorrow", DAY, true)).toMatch(/^There's no gym block on your calendar tomorrow\./);
  });
  it("says nothing is left when everything already happened", () => {
    const past = "B1 09:00–10:00 CS1800 Lecture (FIXED) (already happened)";
    expect(noBlockReply("how long until my nap", past, false)).toBe("There's no nap block on your calendar today. Everything on it has already happened.");
  });
  it("returns null when a matching block exists, or the question names no block", () => {
    expect(noBlockReply("how many minutes until my lab", `${DAY}\nB3 17:30–18:30 DS Lab (FIXED)`, false)).toBeNull();
    expect(noBlockReply("how much time before the nap", "B1 13:00–14:30 Nap", false)).toBeNull();
    expect(noBlockReply("whats on today like all of it", DAY, false)).toBeNull();
    expect(noBlockReply("whats next on my schedule", DAY, false)).toBeNull();
    expect(noBlockReply("how long till my next class", DAY, false)).toBeNull();
  });
  it("routes: code dictates the reply, no worker guess, marked provided", async () => {
    const { prompt, log } = await harness({ move: "tool", tool: "session", args: { do: "status" } }).turn("how much time do i have before my nap block ends");
    expect(prompt).toContain("Reply to Nick with exactly this text");
    expect(prompt).toContain("There's no nap block on your calendar today. You have MKTG2201 Introduction to Marketing at 1:30 PM");
    expect(log.provided).toBe(true);
    expect(log.reads).toEqual(["day"]);
  });
  it("routes: a lab question with no lab is code-dictated; with one it still goes to the worker", async () => {
    const none = await harness({ move: "escalate", tier: "quick" }).turn("is today a lab day or nah");
    expect(none.prompt).toContain("There's no lab block on your calendar today.");
    const some = await harness({ move: "escalate", tier: "quick" }, { day: `${DAY}\nB3 17:30–18:30 DS Lab (FIXED)` }).turn("how many minutes until the lab starts");
    expect(some.prompt).toMatch(/read just now from his calendar/);
  });
});

const local = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();
describe("q041: what's due is read by code", () => {
  const read: DeadlineRead = {
    events: [
      { title: "Macro (ECON1115) — Quiz 1", start: local(16, 0, 0), allDay: "true", isDeadline: true },
      { title: "MKTG2201 Introduction to Marketing — Lecture", start: local(16, 13, 30), allDay: "false", isDeadline: false },
      { title: "Annika", start: local(19, 22, 30), allDay: "false", isDeadline: false },
      { title: "DUE 13:00 — Marketing: Panopto presentation", start: local(26, 13, 0), allDay: "false", isDeadline: true },
    ],
    tasks: [{ title: "Review spending", due: "2026-10-17" }, { title: "send applications", due: "2026-11-02" }],
  };
  const today = new Date(2026, 9, 16, 3, 31);
  it("recognises the questions, not changes", () => {
    for (const m of ["whats due this week", "what's due today", "any deadlines tomorrow?", "do i have anything due soon"]) expect(asksDeadlines(m)).toBe(true);
    for (const m of ["make the essay due friday", "whats on today", "remind me when it's due"]) expect(asksDeadlines(m)).toBe(false);
  });
  it("this week: the quiz is all day (never a time), plus the to-do, nothing from lectures or people", () => {
    expect(deadlineReply("whats due this week", read, today))
      .toBe("Due this week: Macro (ECON1115) — Quiz 1, today (all day); Review spending (to-do), tomorrow.");
  });
  it("nothing in the window names the next deadline after it", () => {
    expect(deadlineReply("whats due tomorrow", { ...read, tasks: [] }, new Date(2026, 9, 16, 10, 0)))
      .toBe("Nothing is due tomorrow. The next deadline is DUE 13:00 — Marketing: Panopto presentation, Monday Oct 26 at 1:00 PM.");
  });
  it("parses orion-tasks list lines", () => {
    expect(parseTasks("- finish resume · due 2026-10-17 · medium\n- Student oyster card · medium\n- CS Lab · due 2026-10-19 · medium · \"x\"")).toEqual([{ title: "finish resume", due: "2026-10-17" }, { title: "CS Lab", due: "2026-10-19" }]);
  });
  it("routes: dictated reply from the read, before the worker; marked provided and logged", async () => {
    const { prompt, log } = await harness({ move: "tool", tool: "agenda", args: { day: "today" } }, { deadlines: read }).turn("whats due this week");
    expect(prompt).toContain("Reply to Nick with exactly this text");
    expect(prompt).toContain("Macro (ECON1115) — Quiz 1, today (all day)");
    expect(log.provided).toBe(true);
    expect(log.reads).toEqual(["deadlines"]);
  });
  it("falls through to the worker when the read fails", async () => {
    const { prompt } = await harness({ move: "tool", tool: "agenda", args: { day: "today" } }, { deadlines: null }).turn("whats due this week");
    expect(prompt).not.toContain("Reply to Nick with exactly this text");
  });
});

describe("routing log: provided and reads", () => {
  it("a turn code gave no data to logs provided false and no reads", async () => {
    const { log } = await harness({ move: "answer", answer: "Hey." }).turn("hello there");
    expect(log.provided).toBe(false);
    expect(log.reads).toEqual([]);
  });
  it("a day read logs provided true and reads day; tomorrow logs day-tomorrow", async () => {
    const today = await harness({ move: "escalate", tier: "quick" }).turn("whats next on my schedule");
    expect(today.log.provided).toBe(true);
    expect(today.log.reads).toEqual(["day"]);
    const tmr = await harness({ move: "escalate", tier: "quick" }).turn("whats on tomorrow morning");
    expect(tmr.log.reads).toEqual([meansTomorrow("whats on tomorrow morning") ? "day-tomorrow" : "day"]);
  });
  it("a change the schedule flow read the day for logs day (q019, q024)", async () => {
    const { log } = await harness({ move: "tool", tool: "reschedule" }).turn("cancel my 4:30 meal prep");
    expect(log.reads).toEqual(["day"]);
  });
});
