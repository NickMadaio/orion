import { describe, expect, it } from "vitest";
import { runScheduleFlow, isUnnamedThing, type Day, type Intent } from "./schedule-flow.js";

// r8 (2026-10-16 10:45 live): "throw something in before my class" booked 5:50 PM with no anchor.
const friday: Day = {
  date: "2026-10-16", now: "10:45",
  blocks: [
    { title: "MKTG2201 Introduction to Marketing — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" },
    { title: "ECON1115 Principles of Macroeconomics — Lecture", start: "15:30", end: "17:00", fixed: true, kind: "class" },
    { title: "finish resume", start: "17:50", end: "19:20", fixed: false, kind: "other" },
    { title: "CS Lab", start: "19:25", end: "20:10", fixed: false, kind: "study" },
    { title: "Review spending", start: "20:15", end: "21:00", fixed: false, kind: "other" },
  ],
};
const SAID = "I'm up a little bit earlier than expected. So can you go ahead and throw something in before my class? Just something small.";

function run(message: string, steps: Intent[], opts: { day?: Day; dry?: string } = {}) {
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "show") return { stdout: JSON.stringify(opts.day ?? friday), code: 0 };
    if (args.includes("--dry-run")) return { stdout: opts.dry ?? "Would change Friday:\n  planned x: 10:50–11:20", code: 0 };
    return { stdout: "Changed Friday:\n  planned x: 10:50–11:20\nWritten to his calendar.", code: 0 };
  };
  return runScheduleFlow({ message, clock: "Fri 10:45", exec, ask: async () => ({ steps }) }).then((result) => ({ result, calls }));
}

describe("anchored add (r8)", () => {
  it("an unnamed thing is not a title", () => {
    for (const w of ["something", "something small", "a thing", "anything", "small task", "a task", "stuff"]) expect(isUnnamedThing(w)).toBe(true);
    for (const w of ["resume work", "stretch", "email prof"]) expect(isUnnamedThing(w)).toBe(false);
  });

  it("his exact sentence with an unnamed 'small task': asks what to put before the 1:30 PM class, runs nothing", async () => {
    const { result, calls } = await run(SAID, [{ do: "add", what: "small task", minutes: 30 }]);
    expect(result).toEqual({ outcome: "say", kind: "ask", text: "What should I put before your 1:30 PM class?" });
    expect(calls.filter((c) => c[0] !== "show")).toEqual([]);
  });

  it("same when the form wrote before:B1", async () => {
    const { result } = await run(SAID, [{ do: "add", what: "small task", minutes: 30, before: "B1" }]);
    expect(result).toMatchObject({ outcome: "say", kind: "ask", text: "What should I put before your 1:30 PM class?" });
  });

  it("a named add carries --before the class start even when the form omitted it", async () => {
    const { result, calls } = await run("add a 30 minute email block before my class", [{ do: "add", what: "email block", minutes: 30 }]);
    expect(result.outcome).toBe("done");
    const real = calls.filter((c) => c[0] === "add" && !c.includes("--dry-run"));
    expect(real).toEqual([["add", "email block", "30", "--before", "13:30"]]);
    expect(calls.some((c) => c.includes("--dry-run") && c.includes("--before"))).toBe(true);
  });

  it("before a time, and before a named block", async () => {
    const a = await run("put a 20 minute stretch before 12:30 pm", [{ do: "add", what: "stretch", minutes: 20 }]);
    expect(a.calls.find((c) => c[0] === "add" && !c.includes("--dry-run"))).toEqual(["add", "stretch", "20", "--before", "12:30"]);
    const b = await run("add reading before the econ lecture", [{ do: "add", what: "reading", minutes: 20 }]);
    expect(b.calls.find((c) => c[0] === "add" && !c.includes("--dry-run"))).toEqual(["add", "reading", "20", "--before", "15:30"]);
  });

  it("between two blocks anchors after the first and before the second", async () => {
    const { calls } = await run("add reading between marketing and econ", [{ do: "add", what: "reading", minutes: 20 }]);
    expect(calls.find((c) => c[0] === "add" && !c.includes("--dry-run"))).toEqual(["add", "reading", "20", "--after", "MKTG2201 Introduction to Marketing — Lecture", "--before", "15:30"]);
  });

  it("a named block with a class in the way refuses when the gap is too small (15:05 to 15:30 is 25 min)", async () => {
    const { result } = await run("add reading before the econ lecture", [{ do: "add", what: "reading", minutes: 30 }]);
    expect(result).toEqual({ outcome: "say", kind: "cannot", text: "There's no room before your 3:30 PM class." });
  });

  it("no room before the anchor refuses instead of placing it elsewhere", async () => {
    const tight = { ...friday, now: "13:10" };
    const { result, calls } = await run("add a 30 minute email block before my class", [{ do: "add", what: "email block", minutes: 30 }], { day: tight });
    expect(result).toEqual({ outcome: "say", kind: "cannot", text: "There's no room before your 1:30 PM class." });
    expect(calls.filter((c) => c[0] !== "show")).toEqual([]);
    const past = { ...friday, now: "14:00" };
    const gone = await run("add a 30 minute email block before my first class", [{ do: "add", what: "email block", minutes: 30 }], { day: past });
    expect(gone.result).toMatchObject({ outcome: "say", kind: "cannot" });
    expect(gone.calls.filter((c) => c[0] === "add")).toEqual([]);
  });

  it("an add that would push other blocks asks first and writes nothing", async () => {
    const { result, calls } = await run("add a 30 minute email block", [{ do: "add", what: "email block", minutes: 30 }],
      { dry: "Would change Friday:\n  moved finish resume: 17:50 → 18:30\n  moved CS Lab: 19:25 → 20:05\n  planned email block: 17:50–18:20" });
    expect(result).toEqual({ outcome: "say", kind: "ask", text: "That would push finish resume and CS Lab later — go ahead?" });
    expect(calls.filter((c) => c[0] === "add" && !c.includes("--dry-run"))).toEqual([]);
  });

  it("an add with a time he stated is not previewed (he asked for it there)", async () => {
    const { calls } = await run("add a 15 minute stretch block at 7:30 am", [{ do: "add", what: "stretch", minutes: 15, to: "07:30" }]);
    expect(calls.some((c) => c.includes("--dry-run"))).toBe(false);
  });
});
