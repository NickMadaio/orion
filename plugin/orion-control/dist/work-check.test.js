import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCalendar, checkReply, checkWork, retryInstruction } from "./work-check.js";
const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const labelled = JSON.parse(readFileSync(join(repo, "scripts/eval/v3/synthetic/claims-labelled.json"), "utf8")).items;
const asResults = (rows = []) => rows.map(([canonical, stdout, exit]) => ({ canonical, stdout, exit }));
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
    const day = (rows) => rows.map(([title, start, end]) => ({ title, start, end }));
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
});
