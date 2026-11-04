import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPlanReasons, whyFirstAnswer, whyFirstAsk, type PlanReasons } from "./plan-why.js";

// The plan of 2026-11-04 as day --todos leaves it: the reasons are written in code, never made up by the model.
const REASONS: PlanReasons = { version: 1, date: "2026-11-04", items: [
  { title: "GET A GP", rank: 1, reason: "overdue since 2 Nov and high priority", why: ["overdue since 2 Nov", "high priority"], start: 14 * 60, end: 14 * 60 + 45 },
  { title: "DS Lab 05", rank: 2, reason: "overdue since 30 Oct and coursework", why: ["overdue since 30 Oct", "coursework"], start: 14 * 60 + 50, end: 15 * 60 + 35 },
  { title: "finish resume", rank: 4, reason: "overdue since 24 Oct", why: ["overdue since 24 Oct"], start: 16 * 60 + 50, end: 18 * 60 + 20 },
  { title: "Student oyster card", rank: 5, reason: "no deadline, so it sits behind what is due", why: [], start: 18 * 60 + 35, end: 19 * 60 + 20 },
] };

describe("whyFirstAsk: held-out phrasings in his style", () => {
  const cases: Array<[string, string]> = [
    ["why is finish resume first", "finish resume"],
    ["wait why is my resume first thing", "resume"],
    ["why did u put the resume first??", "resume"],
    ["why's get a gp at the top", "get a gp"],
    ["why am i doing ds lab first", "ds lab"],
    ["how come resume is first lol", "resume"],
    ["why do i have to do the resume first", "resume"],
    ["ok but why is the first thing finish resume", "finish resume"],
    ["why is that first", ""],
    ["why would you schedule my oyster card up first", "oyster card"],
  ];
  for (const [message, subject] of cases) it(`reads "${message}"`, () => expect(whyFirstAsk(message)).toBe(subject));

  for (const message of ["put resume first", "what's first today", "why is the sky blue", "move gym first please", "when is my first class", "why did the gym get cancelled"]) {
    it(`leaves "${message}" alone`, () => expect(whyFirstAsk(message)).toBeNull());
  }
});

describe("whyFirstAnswer", () => {
  it("the first item: says its real reason and its time", () => {
    const text = whyFirstAnswer("get a gp", REASONS)!;
    expect(text).toMatch(/^GET A GP is first at 2:00 PM because it's overdue since 2 Nov and high priority\./);
  });
  it("'why is that first' means whatever is first", () => expect(whyFirstAnswer("", REASONS)).toMatch(/^GET A GP is first/));
  it("an item that is not first: says who is, and why this one is where it is", () => {
    const text = whyFirstAnswer("resume", REASONS)!;
    expect(text).toMatch(/^Finish resume isn't first: GET A GP is, because it's overdue since 2 Nov and high priority\./);
    expect(text).toMatch(/number 3 at 4:50 PM because it's overdue since 24 Oct\.$/);
  });
  it("an item with no deadline says so, plainly", () => {
    expect(whyFirstAnswer("oyster card", REASONS)).toMatch(/no deadline and isn't high priority, so it sits behind what's due\.$/);
  });
  it("something that is not in the plan, or no plan: null, so the turn goes on as before", () => {
    expect(whyFirstAnswer("laundry", REASONS)).toBeNull();
    expect(whyFirstAnswer("resume", null)).toBeNull();
  });
});

describe("readPlanReasons", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const dir = (content?: string) => { const d = mkdtempSync(join(tmpdir(), "plan-why-")); dirs.push(d); if (content !== undefined) writeFileSync(join(d, "plan-reasons.json"), content); return d; };
  it("reads today's file", () => expect(readPlanReasons(dir(JSON.stringify(REASONS)), "2026-11-04")?.items).toHaveLength(4));
  it("yesterday's reasons are not today's", () => expect(readPlanReasons(dir(JSON.stringify(REASONS)), "2026-11-05")).toBeNull());
  it("a missing or broken file is null", () => {
    expect(readPlanReasons(dir(), "2026-11-04")).toBeNull();
    expect(readPlanReasons(dir("{nope"), "2026-11-04")).toBeNull();
  });
});
