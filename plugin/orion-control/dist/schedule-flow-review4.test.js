import { describe, expect, it } from "vitest";
import { runScheduleFlow } from "./schedule-flow.js";
import { answerPending } from "./schedule-pending.js";
// r8 review 4 (2026-10-16): MEDIUM-2 a passed bare hour is PM, MEDIUM-3 two adds with an unanchored step ask which,
// MEDIUM-4 a continuation's undo is never lost silently, LOW stored argvs carry the absolute date.
const day = (now) => ({ date: "2026-10-16", now, blocks: [
        { title: "Study", start: "12:00", end: "13:00", fixed: false },
        { title: "MKTG2201 Introduction to Marketing — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" },
        { title: "Gym", start: "16:00", end: "17:00", fixed: false },
        { title: "Dinner", start: "18:30", end: "19:15", fixed: false },
    ] });
const WROTE = "Changed Friday 2026-10-16:\n  planned X: 10:10–10:40\nWritten to his calendar.";
async function run(message, steps, opts = {}) {
    const calls = [];
    let mark = 0;
    let top = opts.undo ? opts.undo[opts.undo.length - 1] : null;
    const exec = async (a) => {
        calls.push(a);
        if (a[0] === "show")
            return { stdout: JSON.stringify(opts.day ?? day("10:05")), code: 0 };
        if (a.includes("--dry-run"))
            return { stdout: opts.preview ?? "Would change Friday 2026-10-16:\n  planned X: 10:10–10:40", code: 0 };
        if (a[0] === "undo") {
            top = "older";
            return { stdout: "Undone: Study back to 11:00–12:00", code: 0 };
        }
        top = `m${mark += 1}`;
        return { stdout: WROTE, code: 0 };
    };
    const result = await runScheduleFlow({ message, clock: "Fri 11:18", now: opts.dateWords ?? new Date(2026, 9, 16, 11, 18), exec, undoTop: () => top, ask: async () => ({ steps }), ...(opts.undo ? { undo: opts.undo } : {}), ...(opts.pending ? { pending: opts.pending } : {}) });
    return { result, calls, writes: calls.filter((a) => a[0] !== "show" && !a.includes("--dry-run") && a[0] !== "undo") };
}
const text = (r) => (r.outcome === "say" ? r.text : "");
describe("MEDIUM-2 a bare hour that has passed means PM", () => {
    it.each(["8", "9", "11"])("at 11:18, 'add 20 min reading before %s' is the evening", async (h) => {
        const { result, writes } = await run(`add 20 min reading before ${h}`, [{ do: "add", what: "Reading", minutes: 20 }], { day: day("11:18") });
        expect(text(result)).not.toMatch(/no room before/i);
        expect(writes).toEqual([["add", "Reading", "20", "--before", `${String(Number(h) + 12)}:00`]]);
    });
    it("an hour still ahead stays AM", async () => {
        const early = day("07:00");
        const { writes } = await run("add 20 min reading before 11", [{ do: "add", what: "Reading", minutes: 20 }], { day: early });
        expect(writes).toEqual([["add", "Reading", "20", "--before", "11:00"]]);
    });
});
describe("MEDIUM-3 two adds, one without an anchor", () => {
    const steps = [{ do: "add", what: "Walk", minutes: 30 }, { do: "add", what: "Reading", minutes: 30, after: "B4" }];
    it("asks which goes where and books nothing", async () => {
        const { result, writes } = await run("add gym before my class and reading after dinner", steps);
        expect(writes).toEqual([]);
        expect(result).toMatchObject({ outcome: "say", kind: "ask" });
        expect(text(result)).toMatch(/before your class.*after dinner.*which one goes where/i);
    });
    it("does not ask when every step is anchored or has a time", async () => {
        const { writes } = await run("add gym before my class and reading after dinner", [{ do: "add", what: "Walk", minutes: 30, before: "B2" }, steps[1]]);
        expect(writes).toHaveLength(2);
    });
    it("does not ask when the message has no before/after phrase", async () => {
        const { writes } = await run("add gym and reading", [{ do: "add", what: "Walk", minutes: 30 }, { do: "add", what: "Reading", minutes: 30 }]);
        expect(writes).toHaveLength(2);
    });
});
describe("MEDIUM-4 a continuation that undid the first half and then asks or fails says so", () => {
    it("a preview failure says what was taken back", async () => {
        const { result, writes } = await run("(Continuing) add a 30 min walk", [{ do: "add", what: "Walk", minutes: 30 }], { undo: ["frag-1"], preview: "NOTHING WAS BOOKED on Friday.\n  NOT BOOKED: Walk (30 min) did not fit on Friday" });
        expect(writes).toEqual([]);
        expect(text(result)).toMatch(/took back/i);
    });
    it("a push question says what was taken back", async () => {
        const { result } = await run("(Continuing) add a 30 min walk", [{ do: "add", what: "Walk", minutes: 30 }], { undo: ["frag-1"], preview: "Would change Friday:\n  moved Gym: 16:00 → 16:45\n  planned Walk: 16:00–16:30" });
        expect(text(result)).toMatch(/took back.*push Gym later/i);
    });
    it("without an undo the wording is unchanged", async () => {
        const { result } = await run("add a 30 min walk", [{ do: "add", what: "Walk", minutes: 30 }], { preview: "Would change Friday:\n  moved Gym: 16:00 → 16:45\n  planned Walk: 16:00–16:30" });
        expect(text(result)).toBe("That would push Gym later — go ahead?");
    });
});
describe("LOW stored argvs carry the absolute date", () => {
    it("a tomorrow push question stores --date <the day's date>", async () => {
        const tomorrow = { ...day("10:05"), date: "2026-10-17", now: null };
        const { result } = await run("add a 60 min focus block tomorrow", [{ do: "add", what: "Focus", minutes: 60 }], { day: tomorrow, preview: "Would change Saturday:\n  moved Gym: 16:00 → 16:45\n  planned Focus: 16:00–17:00" });
        const p = result.pending;
        expect(p.argvs).toEqual([["add", "Focus", "60", "--date", "2026-10-17"]]);
    });
    it("a title question stores the absolute date for the re-compile", async () => {
        const { result } = await run("throw something in before my class", [{ do: "add", what: "small task", minutes: 30 }]);
        const p = result.pending;
        expect(p.dateArgs).toEqual(["--date", "2026-10-16"]);
        const a = answerPending(p, "laundry");
        const second = await run("laundry", [], { pending: a.run });
        expect(second.calls.find((c) => c[0] === "show")).toEqual(["show", "--json", "--date", "2026-10-16"]);
    });
});
