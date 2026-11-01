// Wave 6 (gate run-1101003318, rea-work-on-it-tomorrow-v): "ill do the resume tomorrow" booked the block and said a bare "Done", though
// his own history shows the resume sliding again and again. The reply now names the slip from that history (slips.jsonl, life-history.jsonl,
// over two weeks) and makes tomorrow's start small. With no history it adds nothing (no invented pattern). No real paths.
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deferralsOf, slipAck } from "./slip-history.js";
import { runDayRequest, readDayRequest } from "./day-requests.js";
const b = (title, start, end, fixed = false, kind) => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
const NOW = new Date(2026, 10, 2, 21, 0);
const iso = (d, hh = 10) => new Date(2026, 9, d, hh, 0).toISOString();
const slip = (d, title = "finish resume") => JSON.stringify({ date: `2026-10-${String(d).padStart(2, "0")}`, at: iso(d), planned: { title, start: 600, end: 690, kind: "other" }, missedMinutes: 90, replacedBy: null, reason: "gave-up" });
const missed = (d, what = "finish resume") => JSON.stringify({ at: iso(d, 14), what, kind: "other", plannedStart: 640, actualStart: null });
function state(slips, history = []) {
    const dir = mkdtempSync(join(tmpdir(), "w6s-"));
    if (slips.length)
        appendFileSync(join(dir, "slips.jsonl"), `${slips.join("\n")}\n`);
    if (history.length)
        appendFileSync(join(dir, "life-history.jsonl"), `${history.join("\n")}\n`);
    return dir;
}
const MON = () => ({ date: "2026-11-02", now: "21:00", blocks: [b("Gym", "17:00", "18:30", false, "gym"), b("Side project", "19:30", "20:30")] });
const TUE = () => ({ date: "2026-11-03", now: null, blocks: [b("ECON1115", "11:00", "12:30", true, "class"), b("Gym", "17:00", "18:30", false, "gym")] });
async function ask(said, stateDir) {
    const r = readDayRequest(said, NOW);
    const calls = [];
    const out = await runDayRequest(r, { now: NOW, stateDir, readDay: async () => MON(), readDayOn: async () => TUE(),
        run: async (_s, args) => { calls.push(args); return { stdout: "Changed Tuesday 2026-11-03:\n  added resume 13:20–14:05\nWritten to his calendar.", code: 0 }; } });
    return { text: "text" in out.flow ? out.flow.text : out.flow.outcome === "done" ? out.flow.reply : "", calls };
}
describe("a deferral of something that keeps sliding is named, and tomorrow is made small", () => {
    it("the gate shape: booked, then the slip from his history and a smaller first step", async () => {
        const dir = state([slip(22), slip(27)], [missed(24), missed(27)]);
        const { text, calls } = await ask("ill do the resume tomorrow", dir);
        expect(calls[0]).toEqual(["add", "resume", "45", "--date", "tomorrow"]);
        expect(text).toMatch(/^Done: Resume is on tomorrow, 1:20 PM–2:05 PM, 45 minutes\./);
        expect(text).toContain("That's the fourth time it's been pushed since Thu 22 Oct, so tomorrow isn't the big finish: give it the first 15 minutes, one section, then you can stop. What's been making it hard to start?");
    });
    it.each(["gonna work on my resume tmrw", "fine ill finish my resume tomorrow", "lemme do the resume tmrw"])("held out: '%s'", async (said) => {
        const { text } = await ask(said, state([slip(28)]));
        expect(text).toMatch(/That's the second time it's been pushed since Wed 28 Oct/);
    });
    it("no history: no invented pattern", async () => {
        const { text } = await ask("ill do the resume tomorrow", state([]));
        expect(text).not.toMatch(/pushed|slid/);
    });
});
describe("deferralsOf", () => {
    it("counts distinct days in the last two weeks, by the words of the title, from both records", () => {
        const dir = state([slip(10), slip(22), slip(27), slip(27, "Gym")], [missed(22), missed(25), missed(30, "Side project")]);
        expect(deferralsOf(dir, "resume", NOW)).toEqual({ count: 3, since: "2026-10-22" });
        expect(deferralsOf(dir, "gym", NOW)).toEqual({ count: 1, since: "2026-10-27" });
        expect(deferralsOf(undefined, "resume", NOW)).toEqual({ count: 0 });
    });
    it("slipAck is empty with nothing on record", () => {
        expect(slipAck({ count: 0 })).toBe("");
    });
});
