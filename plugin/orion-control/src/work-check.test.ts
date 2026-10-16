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
});

describe("work check — review of the 2026-10-16 sweep fixes", () => {
  it("a warm 'I'll be here' is not a promise to act; a named action still is", () => {
    for (const reply of ["Goodnight Nick, I'll be here if you need anything.", "I hear you. Let's start small: take one slow breath, and I'll be right here."])
      expect(checkWork({ reply, turnResults: [], finished: true }), reply).not.toContain("promised but did not act");
    expect(checkWork({ reply: "I'll add that to your list now.", turnResults: [], finished: true })).toContain("promised but did not act");
    expect(checkWork({ reply: "Let me check your calendar.", turnResults: [], finished: true })).toContain("promised but did not act");
  });

  it("'let me know' on a change request is not a promise", () => {
    expect(checkWork({ reply: "Let me know which block you mean?", turnResults: [], finished: true, changeRequest: true })).not.toContain("promised but did not act");
  });

  it("data code supplied (his day, brain snippets) is not a fabricated lookup", () => {
    for (const reply of ["According to your calendar, you have gym at 5 PM.", "Your calendar shows a free block at 3 PM.", "I found in your notes that the deadline is Friday."])
      expect(checkWork({ reply, turnResults: [], finished: true, provided: true }), reply).toEqual([]);
    expect(checkWork({ reply: "According to your calendar, you have gym at 5 PM.", turnResults: [], finished: true })).toContain("claims a lookup it did not do");
  });

  it("the exact sentence the live-data prompt asks for is not 'said it can't without checking'", () => {
    expect(checkWork({ reply: "I can't check that right now.", turnResults: [], finished: true })).toEqual([]);
    expect(checkWork({ reply: "I don't have access to your messages.", turnResults: [], finished: true })).toContain("said it can't without checking");
  });
});
