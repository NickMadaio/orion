import { describe, expect, it } from "vitest";
import { runScheduleFlow, type Day, type Intent, type FlowResult } from "./schedule-flow.js";
import { answerPending, ADD_DECLINED, titleAnswer, type PendingRun } from "./schedule-pending.js";

// r8 review 3 on 90a7520 (2026-10-16): follow-ups for the new add questions, no early return after a write,
// per-step anchors, an honest room check, bare-hour anchors, and a displaced() that names removals.
const today: Day = { date: "2026-10-16", now: "10:05", blocks: [
  { title: "Breakfast", start: "09:00", end: "09:30", fixed: false },
  { title: "Study", start: "11:00", end: "12:00", fixed: false },
  { title: "Lunch", start: "12:15", end: "12:45", fixed: false },
  { title: "MKTG2201 Introduction to Marketing — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" },
  { title: "Gym", start: "16:00", end: "17:00", fixed: false },
  { title: "Dinner", start: "18:30", end: "19:15", fixed: false },
] };
const CLASS = "MKTG2201 Introduction to Marketing — Lecture";
const PLAIN_DRY = "Would change Friday 2026-10-16:\n  planned X: 10:10–10:40";
const WROTE = "Changed Friday 2026-10-16:\n  planned X: 10:10–10:40\nWritten to his calendar.";

async function run(message: string, steps: Intent[], opts: { day?: Day; preview?: string | ((a: string[]) => string); pending?: PendingRun } = {}) {
  const calls: string[][] = [];
  let mark = 0; let top: string | null = null;
  const exec = async (a: string[]) => {
    calls.push(a);
    if (a[0] === "show") return { stdout: JSON.stringify(opts.day ?? today), code: 0 };
    if (a.includes("--dry-run")) return { stdout: typeof opts.preview === "function" ? opts.preview(a) : opts.preview ?? PLAIN_DRY, code: 0 };
    if (a[0] === "undo") return { stdout: "Undone", code: 0 };
    top = `m${mark += 1}`;
    return { stdout: WROTE, code: 0 };
  };
  const result = await runScheduleFlow({ message, clock: "Fri 10:05", now: new Date(2026, 9, 16, 10, 5), exec, undoTop: () => top, ask: async () => ({ steps }), ...(opts.pending ? { pending: opts.pending } : {}) });
  const writes = calls.filter((a) => a[0] !== "show" && !a.includes("--dry-run"));
  return { result, calls, writes };
}
const asked = (r: FlowResult) => (r.outcome === "say" ? (r as { pending?: unknown }).pending : undefined);

describe("H1 pending follow-up", () => {
  it("a push question carries the exact argv; a bare yes runs exactly it and nothing else", async () => {
    const push = "Would change Friday:\n  moved Gym: 16:00 → 16:45\n  moved Dinner: 18:30 → 19:00\n  planned Focus: 16:00–17:00";
    const first = await run("add a 60 min focus block", [{ do: "add", what: "Focus", minutes: 60 }], { preview: push });
    expect(first.result).toMatchObject({ outcome: "say", kind: "ask", text: "That would push Gym and Dinner later — go ahead?" });
    expect(first.writes).toEqual([]);
    const pending = asked(first.result) as { kind: string; argvs: string[][] };
    expect(pending).toMatchObject({ kind: "push", argvs: [["add", "Focus", "60"]] });
    const answer = answerPending(pending as never, "yes go ahead");
    expect(answer).toMatchObject({ kind: "run" });
    const second = await run("yes go ahead", [{ do: "add", what: "Wrong", minutes: 5 }], { pending: (answer as { run: PendingRun }).run });
    expect(second.writes).toEqual([["add", "Focus", "60"]]);
    expect(second.calls.some((c) => c.includes("--dry-run"))).toBe(false);
    expect(second.result).toMatchObject({ outcome: "done", calls: ["exec orion-reschedule add Focus 60"], marks: ["m1"] });
  });

  it("the unnamed-thing ask carries the anchor; a short title compiles again with it (still previewed)", async () => {
    const live = "I'm up a little bit earlier than expected. So can you go ahead and throw something in before my class? Just something small.";
    const first = await run(live, [{ do: "add", what: "small task", minutes: 30 }]);
    expect(first.result).toMatchObject({ outcome: "say", kind: "ask", text: "What should I put before your 1:30 PM class?" });
    const pending = asked(first.result) as { kind: string };
    expect(pending.kind).toBe("title");
    const answer = answerPending(pending as never, "laundry");
    expect(answer).toMatchObject({ kind: "run", run: { title: "Laundry" } });
    const second = await run("laundry", [], { pending: (answer as { run: PendingRun }).run });
    expect(second.calls.some((c) => c[0] === "add" && c.includes("--dry-run"))).toBe(true);
    expect(second.writes).toEqual([["add", "Laundry", "30", "--before", "13:30"]]);
  });

  it("a title answer that would push asks again and keeps the stored add", async () => {
    const first = await run("throw something in before my class, something small", [{ do: "add", what: "something", minutes: 30 }]);
    const answer = answerPending(asked(first.result) as never, "laundry") as { run: PendingRun };
    const second = await run("laundry", [], { pending: answer.run, preview: "Would change:\n  moved Lunch: 12:15 → 12:50\n  planned Laundry: 12:00–12:30" });
    expect(second.result).toMatchObject({ kind: "ask", text: "That would push Lunch later — go ahead?" });
    expect(asked(second.result)).toMatchObject({ kind: "push", argvs: [["add", "Laundry", "30", "--before", "13:30"]] });
    expect(second.writes).toEqual([]);
  });

  it("no / nah declines; a yes to the title question asks again; anything else is not an answer", async () => {
    const title = asked((await run("throw something in before my class", [{ do: "add", what: "something", minutes: 30 }])).result) as never;
    const push = { kind: "push", argvs: [["add", "Focus", "60"]], displaced: ["Gym"] } as never;
    expect(answerPending(push, "no")).toEqual({ kind: "decline" });
    expect(answerPending(title, "nah")).toEqual({ kind: "decline" });
    expect(answerPending(title, "yes")).toMatchObject({ kind: "reask" });
    expect(answerPending(push, "what's the weather like")).toBeUndefined();
    expect(answerPending(push, "laundry")).toBeUndefined();
    expect(answerPending(title, "what's the weather like?")).toBeUndefined();
    expect(answerPending(title, "move gym to 5")).toBeUndefined();
    expect(ADD_DECLINED).toBe("Okay, I left your day as it is.");
    expect(titleAnswer("um maybe stretching")).toBe("Stretching");
  });
});

describe("H2 no early return after an earlier step wrote", () => {
  const steps: Intent[] = [{ do: "move", what: "B2", to: "15:00" }, { do: "add", what: "Walk", minutes: 30, after: "B3" }];
  it("a push question runs nothing and holds the whole sequence", async () => {
    const { result, writes } = await run("move study to 3 and add a 30 min walk after lunch", steps, { preview: "Would change Friday:\n  moved Gym: 16:00 → 16:45\n  planned Walk: 12:50–13:20" });
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", kind: "ask", text: "That would push Gym later — go ahead?" });
    const p = asked(result) as { argvs: string[][] };
    expect(p.argvs).toEqual([["move", "Study", "--to", "15:00"], ["add", "Walk", "30", "--after", "Lunch"]]);
    const yes = await run("yes", [], { pending: answerPending(p as never, "yes") && (answerPending(p as never, "yes") as { run: PendingRun }).run });
    expect(yes.writes).toEqual(p.argvs);
    expect(yes.result).toMatchObject({ outcome: "done", marks: ["m1", "m2"] });
  });

  it("a failed preview writes nothing and says so", async () => {
    const { result, writes } = await run("move study to 3 and add a 30 min walk", [steps[0]!, { do: "add", what: "Walk", minutes: 30 }],
      { preview: "NOTHING WAS BOOKED on Friday (2026-10-16). Do not tell him anything was added or moved.\nWould change Friday:\n  NOT BOOKED: Walk (30 min) did not fit on Friday — ask whether" });
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ outcome: "say", kind: "plain" });
    expect((result as { text: string }).text).toMatch(/Not done: Walk didn't fit/);
    expect((result as { text: string }).text).toMatch(/nothing else was changed/i);
  });

  it("a harmless preview runs every step and records every mark", async () => {
    const { result, writes } = await run("move study to 3 and add a 30 min walk after lunch", steps);
    expect(writes).toHaveLength(2);
    expect(result).toMatchObject({ outcome: "done", marks: ["m1", "m2"] });
  });
});

describe("H3 per-step anchors win", () => {
  it("two adds keep their own anchors, the message anchor is not stamped on both", async () => {
    const { writes } = await run("add gym before my class and reading after dinner",
      [{ do: "add", what: "Walk", minutes: 30, before: "B4" }, { do: "add", what: "Reading", minutes: 30, after: "B6" }]);
    expect(writes).toEqual([["add", "Walk", "30", "--before", "13:30"], ["add", "Reading", "30", "--after", "Dinner"]]);
  });
  it("one add reads both sides from the message", async () => {
    const { writes } = await run("i need 30 minutes for a call with mom, add it after my class and before gym", [{ do: "add", what: "Call with mom", minutes: 30 }]);
    expect(writes).toEqual([["add", "Call with mom", "30", "--after", CLASS, "--before", "16:00"]]);
  });
  it("'before i head out after lunch' is after Lunch, not before it", async () => {
    const { writes } = await run("add 30 min of email before i head out after lunch", [{ do: "add", what: "Email", minutes: 30 }]);
    expect(writes).toEqual([["add", "Email", "30", "--after", "Lunch"]]);
  });
  it("a form anchor beats the message on that side", async () => {
    const { writes } = await run("add reading before my class", [{ do: "add", what: "Reading", minutes: 30, before: "B5" }]);
    expect(writes).toEqual([["add", "Reading", "30", "--before", "16:00"]]);
  });
});

describe("H4 room check", () => {
  const seminar: Day = { ...today, blocks: [
    { title: "Study", start: "11:00", end: "12:00", fixed: false },
    { title: "Seminar", start: "17:00", end: "18:00", fixed: true, kind: "class" },
    { title: "Dinner", start: "18:30", end: "19:15", fixed: false },
  ] };
  it("a fixed block earlier in the day does not make the whole day 'no room'", async () => {
    const { result, writes } = await run("add a 90 min study block before dinner", [{ do: "add", what: "Essay", minutes: 90 }], { day: seminar });
    expect((result as { text?: string }).text ?? "").not.toMatch(/no room/);
    expect(writes).toEqual([["add", "Essay", "90", "--before", "18:30"]]);
  });
  it("still refuses when every gap is too small", async () => {
    const tight: Day = { ...today, now: "13:10" };
    const { result, writes } = await run("add a 30 minute email block before my class", [{ do: "add", what: "email block", minutes: 30 }], { day: tight });
    expect(result).toEqual({ outcome: "say", kind: "cannot", text: "There's no room before your 1:30 PM class." });
    expect(writes).toEqual([]);
  });
});

describe("M1 bare hour is an anchor", () => {
  it("before 5 is 5 PM", async () => {
    const { writes } = await run("add a 30 min reading block before 5", [{ do: "add", what: "Reading", minutes: 30 }]);
    expect(writes).toEqual([["add", "Reading", "30", "--before", "17:00"]]);
  });
  it("before 30 minutes is not an hour", async () => {
    const { writes } = await run("add a reading block, done before 30 minutes", [{ do: "add", what: "Reading", minutes: 30 }]);
    expect(writes[0]).toEqual(["add", "Reading", "30"]);
  });
});

describe("M2 displaced names removals and shortening", () => {
  const ask = async (preview: string) => (await run("add a 60 min focus block", [{ do: "add", what: "Focus", minutes: 60 }], { preview })).result as { text: string };
  it("cleared + skipped optional is 'take YouTube off'", async () => {
    expect((await ask("Would change Friday 2026-10-16:\n  rebuilt the remaining day from fixed commitments and must-haves first\n  cleared 1 prior schedule block: YouTube\n  planned Focus: 16:00–17:00\n  SKIPPED OPTIONAL: YouTube (60 min) did not fit on Friday")).text)
      .toBe("That would take YouTube off — go ahead?");
  });
  it("SHRUNK and 'now ends at' are shortened, not pushed", async () => {
    expect((await ask("Would change Friday:\n  SHRUNK to fit: YouTube 60 → 30 min (low priority; tell him)\n  planned Focus: 16:00–17:00")).text).toBe("That would shorten YouTube — go ahead?");
    expect((await ask("Would change Friday:\n  Study now ends at 10:40\n  planned Focus: 10:45–11:45")).text).toBe("That would shorten Study — go ahead?");
  });
  it("an existing block not booked is taken off; mixed cases are all named", async () => {
    expect((await ask("Would change Friday:\n  moved Gym: 16:00 → 17:05\n  NOT BOOKED: Reading (30 min) did not fit on Friday\n  planned Focus: 16:00–17:00")).text)
      .toBe("That would push Gym later and take Reading off — go ahead?");
  });
  it("the new block not fitting is a failure, not a question", async () => {
    const r = (await ask("NOTHING WAS BOOKED on Friday (2026-10-16).\nWould change Friday:\n  NOT BOOKED: Focus (60 min) did not fit on Friday")) as { kind?: string };
    expect(r.kind).toBe("plain");
  });
});
