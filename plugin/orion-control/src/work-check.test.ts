import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCalendar, checkReply, checkWork, retryInstruction, type ToolResult } from "./work-check.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const labelled = JSON.parse(readFileSync(join(repo, "scripts/eval/v3/synthetic/claims-labelled.json"), "utf8")).items as Array<{
  id: string; reply: string; turn: Array<[string, string, number | null]>; conversation?: Array<[string, string, number | null]>;
}>;
const asResults = (rows: Array<[string, string, number | null]> = []): ToolResult[] => rows.map(([canonical, stdout, exit]) => ({ canonical, stdout, exit }));

describe("work check: claim checker (port of the V3 evaluation checker)", () => {
  it("gives the same verdict as the validated evaluation checker on every labelled reply", async () => {
    // @ts-expect-error -- plain ESM module from the evaluation, no type declarations
    const reference = await import("../../../scripts/lib/eval/v3/claims.mjs");
    for (const item of labelled) {
      const args = { reply: item.reply, turnResults: asResults(item.turn), conversationResults: asResults(item.conversation) };
      const ours = checkReply(args);
      const theirs = reference.checkReply(args);
      expect({ id: item.id, fc: ours.falseClaim, of: ours.omittedFailure, fd: ours.falseDenial, wd: ours.wrongDetail })
        .toEqual({ id: item.id, fc: theirs.falseClaim, of: theirs.omittedFailure, fd: theirs.falseDenial, wd: theirs.wrongDetail });
    }
  });

  it("flags a claimed booking that the tool says did not happen", () => {
    const v = checkReply({ reply: "All set — gym is booked for 6 PM.", turnResults: [{ canonical: 'exec orion-reschedule add "Gym" 60 --at 18:00', stdout: "NOTHING WAS BOOKED on Friday. NOT BOOKED: Gym (60 min) did not fit", exit: 0 }] });
    expect(v.falseClaim).toBe(true);
    expect(v.ok).toBe(false);
  });
});

describe("work check: the calendar after the change", () => {
  const day = (rows: Array<[string, number, number]>) => rows.map(([title, start, end]) => ({ title, start, end }));
  const before = day([["Study", 960, 1020], ["Gym", 1080, 1140], ["Dinner", 1155, 1200]]);

  it("finds overlaps still ahead, blocks lost without a removing command, and duplicates", () => {
    expect(checkCalendar({ before, after: day([["Study", 960, 1100], ["Gym", 1080, 1140], ["Dinner", 1155, 1200]]), now: 900, commands: [] })).toContain("overlap left");
    expect(checkCalendar({ before, after: day([["Study", 960, 1020], ["Dinner", 1155, 1200]]), now: 900, commands: ['orion-reschedule move "Study" --to 16:00'] })).toContain("block lost");
    expect(checkCalendar({ before, after: day([["Study", 960, 1020], ["Dinner", 1155, 1200]]), now: 900, commands: ['orion-reschedule drop "Gym"'] })).toEqual([]);
    expect(checkCalendar({ before, after: day([["Study", 960, 1020], ["Gym", 1080, 1140], ["Gym", 1150, 1210], ["Dinner", 1215, 1260]]), now: 900, commands: [] })).toContain("duplicate block");
  });

  it("ignores overlaps that are already in the past", () => {
    expect(checkCalendar({ before, after: day([["Study", 600, 700], ["Gym", 650, 720], ["Dinner", 1155, 1200]]), now: 900, commands: ['orion-reschedule move "Study"', 'orion-reschedule move "Gym"'] })).toEqual([]);
  });
});

describe("work check: verdict and retry instruction", () => {
  it("combines reply, last-change and calendar findings, and says what to fix", () => {
    const findings = checkWork({
      reply: "Done — study moved to 4.",
      turnResults: [{ canonical: 'exec orion-reschedule move "Study" --to 16:00', stdout: "NOTHING WAS CHANGED. NOT BOOKED: Study did not fit", exit: 0 }],
      finished: true,
    });
    expect(findings).toEqual(expect.arrayContaining(["claims what the tools don't show", "last change incomplete"]));
    const instruction = retryInstruction(findings);
    expect(instruction).toMatch(/did not happen|NOT BOOKED/i);
    expect(instruction.length).toBeLessThan(600);
  });

  it("finds nothing when the reply matches what the tools did", () => {
    expect(checkWork({
      reply: "Gym is at 7 PM now.",
      turnResults: [{ canonical: 'exec orion-reschedule move "Gym" --to 19:00', stdout: "Changed Friday:\n  Gym moved: 18:00 → 19:00–20:00\nWritten to his calendar.", exit: 0 }],
      finished: true,
    })).toEqual([]);
  });

  it("asking back on a clear change request, with nothing changed, is a failure the retry fixes", () => {
    const read = [{ canonical: "exec orion-agenda day today", stdout: "today 11:00 AM — CS1800 Discrete Structures — Lecture", exit: 0 }];
    const reply = "Would you like me to fill the entire time between your classes?";
    expect(checkWork({ reply, turnResults: read, finished: true, changeRequest: true })).toContain("asked instead of acting");
    expect(checkWork({ reply, turnResults: read, finished: true, changeRequest: false })).toEqual([]);
    expect(retryInstruction(["asked instead of acting"])).toMatch(/Do it now/);
  });

  // Live sweep 2026-10-16 (q007, q041, q049, q053, q072, q076): replies that report a lookup, a live
  // status, a promise or a "no access" with no tool call at all passed the check with findings [].
  it("flags a lookup, a status or a capability denial reported with no tool call", () => {
    const none: ToolResult[] = [];
    for (const reply of [
      "I checked the weather for London and it's not expected to rain.",
      "I checked your calendar and found that you have a free block after 3 PM.",
      "Your focus session is still active with 15 minutes remaining.",
      "Yes, your focus session is active.",
    ]) expect(checkWork({ reply, turnResults: none, finished: true }), reply).toContain("claims a lookup it did not do");
    expect(checkWork({ reply: "I don't have access to your vitamin D intake history.", turnResults: none, finished: true })).toContain("said it can't without checking");
  });

  it("flags a promise with no tool call on any turn, not only change requests", () => {
    const findings = checkWork({ reply: "Got it! I'll just note that you took your creatine.", turnResults: [], finished: true, changeRequest: false });
    expect(findings).toContain("promised but did not act");
    expect(retryInstruction(findings)).toMatch(/right tool/);
  });

  it("leaves pure answers and the same claims backed by a tool alone", () => {
    for (const reply of ["391", "17 times 23 is 391.", "Studies have found that creatine is safe for most people.", "Sure, 391. Let me know if you need anything else."]) {
      expect(checkWork({ reply, turnResults: [], finished: true }), reply).toEqual([]);
    }
    const status = [{ canonical: "exec orion-session status", stdout: "Focus session: CS1800 hw — 15 min left", exit: 0 }];
    expect(checkWork({ reply: "Your focus session is still active with 15 minutes remaining.", turnResults: status, finished: true })).toEqual([]);
    // A code-run flow read the status itself; its dictated line is not the worker's claim.
    expect(checkWork({ reply: "A focus session is already running — 15 minutes left.", turnResults: [], finished: true, dictated: true })).toEqual([]);
  });

  // Live sweep 2026-10-15 (q003, q004, q009, q011): an honest "nothing scheduled" after a real calendar read
  // was flagged as a false "scheduled" claim; the revise was then dropped by the host (a tool had run).
  it("'nothing is scheduled' after a calendar read is a denial, not a done-claim", () => {
    const empty = [{ canonical: "exec orion-agenda today", stdout: "today is Thursday, October 15, 2026\nnothing on the calendar today", exit: null }];
    for (const reply of ["Nothing is scheduled for today.", "There's nothing scheduled on your calendar today, Thursday October 15.", "There is no lab scheduled for today.", "There is no gym scheduled for today."]) {
      expect(checkWork({ reply, turnResults: empty, finished: true }), reply).toEqual([]);
    }
    // A real claim made over a read alone is still caught.
    expect(checkWork({ reply: "No problem, gym is scheduled for 6.", turnResults: empty, finished: true })).toContain("claims what the tools don't show");
    expect(checkWork({ reply: "No worries I booked gym for 6.", turnResults: empty, finished: true })).toContain("claims what the tools don't show");
  });

  // Live sweep 2026-10-15 (q030, q031, q036, q037, q039): "Reminder set for Thursday at 5:00 PM" was
  // flagged "reply times don't match" because the result's "5:00:00 PM" (with seconds) read as 12:00 PM.
  it("a reminder's time with seconds in the result matches the reply's time", () => {
    const set = (at: string, local: string): ToolResult => ({ canonical: `orion_task_run {"steps":[{"action":"alarm_set","at":"${at}","label":"call the dentist"}]}`, exit: null,
      stdout: JSON.stringify({ executed: true, outcome: "DONE — this really happened", reportToUser: "Done.", status: "succeeded", createdAt: "2026-10-15T22:31:19.237Z",
        steps: [{ stepId: "step-1", status: "verified", request: { action: "alarm_set", arguments: { at, label: "call the dentist" } },
          execution: { mode: "scheduled", target: "a452h1", output: { id: "a452h1", kind: "alarm", label: "call the dentist", dueIn: "0 seconds", dueAtLocal: local } },
          verification: { method: "reminder_stored", observed: true, evidence: "a452h1:present" } }], completedAt: "2026-10-15T22:31:19.238Z" }, null, 2) });
    expect(checkWork({ reply: "Reminder set for Thursday at 5:00 PM: call the dentist.", turnResults: [set("2026-10-15T17:00", "10/15/2026, 5:00:00 PM")], finished: true })).toEqual([]);
    expect(checkWork({ reply: "Reminder set for Friday at 7:00 AM: wake me up.", turnResults: [set("2026-10-16T07:00", "10/16/2026, 7:00:00 AM")], finished: true })).toEqual([]);
    expect(checkWork({ reply: "Reminder set for Thursday at 6:00 PM: call the dentist.", turnResults: [set("2026-10-15T17:00", "10/15/2026, 5:00:00 PM")], finished: true })).toContain("reply times don't match");
  });
});
