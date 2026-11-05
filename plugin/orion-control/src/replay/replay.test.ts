/*
 The regression guard (w20 replay): Nick's real turns, anonymised, through the real routing with recorded model outputs.
 A case that is allowed to fail carries expectFail with its tube-audit id; this test goes red only for a case that is NOT.
 Run `npx vitest run src/replay` for the count; `scripts/orion-replay` prints the same table and runs the live layer.
*/
import { describe, expect, it } from "vitest";
import { readCases, REPO_CASES } from "./cases.js";
import { gradeOutcome } from "./grade.js";
import { BANNED_SHAPES, shapesIn } from "./shapes.js";
import { report, runDeterministic, summarize, summaryLine } from "./suite.js";
import type { Outcome } from "./types.js";

const outcome = (over: Partial<Outcome>): Outcome => ({ route: "worker", reply: "", scripts: [], calls: [], revised: 0, ...over });

describe("banned reply shapes", () => {
  it.each([
    ["Can you say it again?", "say-it-again"],
    ["Tell me differently and I'll try again.", "rephrase"],
    ["…", "bare-ellipsis"],
    ["I couldn't run that lookup just now. I could not do that.", "lookup-excuse"],
    ["ORION refused or could not run that (exit 1).", "third-person-self"],
    ["Not done: gym didn't fit.", "fit-no-reason"],
    ["6P 23C 8 degrees Fahrenheit, 190 kcal", "fahrenheit-macros"],
  ])("%s is banned", (text, id) => expect(shapesIn(text)).toContain(id));
  it.each([
    "Done: gym 10:00 PM–11:00 PM.",
    "Gym didn't fit because your day ends at 9:50 PM.",
    "I put the museum at 7 and the gym at 10, and moved sleep to 11:45.",
    "Okay, I'll stay quiet until you say Orion.",
  ])("%s is fine", (text) => expect(shapesIn(text)).toEqual([]));
  it("every shape has a reason", () => expect(BANNED_SHAPES.every((s) => s.why.length > 5)).toBe(true));
});

describe("grader", () => {
  it("checks route, calls, asks and shapes, and nothing about exact wording", () => {
    const o = outcome({ route: "schedule", reply: "Done: gym 10 PM.", scripts: [{ script: "orion-reschedule", args: ["add", "Gym", "60", "--at", "22:00"] }] });
    expect(gradeOutcome({ route: "schedule", calls: [{ script: "orion-reschedule", args: "--at 22:00" }], asks: [{ id: "gym", call: { script: "orion-reschedule", args: "gym" } }] }, o)).toEqual([]);
    expect(gradeOutcome({ route: "workout" }, o)).toEqual(["route: wanted workout, got schedule"]);
    expect(gradeOutcome({ noCalls: [{ script: "orion-reschedule", args: "22:00" }] }, o)).toHaveLength(1);
    expect(gradeOutcome({ asks: [{ id: "sleep", reply: ["sleep"] }] }, o)).toEqual(["ask not addressed: sleep"]);
    expect(gradeOutcome({}, outcome({ reply: "Can you say it again?" }))).toEqual(["banned shape: say-it-again"]);
  });
  it("a read-only turn that writes is caught", () => {
    expect(gradeOutcome({ readOnly: true }, outcome({ reply: "ok", scripts: [{ script: "orion-reschedule", args: ["show", "--json"] }] }))).toEqual([]);
    expect(gradeOutcome({ readOnly: true }, outcome({ reply: "ok", scripts: [{ script: "orion-workout", args: ["--text", "x"] }] }))).toHaveLength(1);
  });
});

describe("replay: Nick's real turns, anonymised (deterministic layer)", () => {
  const cases = readCases(REPO_CASES);
  it("has every one of the 41 tube-audit turns", () => {
    const audit = new Set(cases.map((c) => c.audit).filter(Boolean));
    for (const id of [..."E".repeat(19)].map((_, i) => `E${i + 1}`).concat(["L1", "L2"], [...Array(7)].map((_, i) => `A${i + 1}`), [...Array(13)].map((_, i) => `M${i + 1}`))) expect(audit.has(id), id).toBe(true);
  });
  it("every known failure names the audit bug it stands for", () => {
    for (const c of cases.filter((x) => x.expectFail)) expect(c.expectFail?.why.length, c.id).toBeGreaterThan(10);
  });
  it("no case regressed: only expected failures fail", { timeout: 120_000 }, async () => {
    const verdicts = await runDeterministic(cases);
    const summary = summarize(verdicts);
    console.log(`replay: ${summaryLine(summary)}\n${report(verdicts)}`);
    expect(verdicts.filter((v) => v.status === "fail").map((v) => `${v.id}: ${v.failures.join("; ")}`)).toEqual([]);
    expect(summary.total).toBe(cases.length);
  });
});
