import { describe, expect, it } from "vitest";
import { FORM_PROMPT, compile, dayArgsFor, intentSchema, runScheduleFlow, spokenFailure } from "./schedule-flow.js";
// His real Thursday, 2026-10-15, at 22:25 — the live sweep ran after every block had ended.
const thursday = {
    date: "2026-10-15", now: "22:25",
    blocks: [
        { title: "CS1800 Discrete Structures — Lecture", start: "09:00", end: "10:30", fixed: true },
        { title: "finish resume", start: "11:20", end: "11:50", fixed: false },
        { title: "DS Lab", start: "12:55", end: "13:40", fixed: false },
        { title: "CS Lab", start: "13:45", end: "14:30", fixed: false },
        { title: "Review spending", start: "14:45", end: "15:30", fixed: false },
    ],
};
describe("schedule flow — past gaps and blocks that are not there (sweep 2026-10-15)", () => {
    it("a gap that already passed is said so, never 'only 0 minutes' (q019, q021, q028)", () => {
        const out = compile({ do: "fill_between", what: "gym", after: "B4", before: "B5" }, thursday);
        expect(out).toMatchObject({ say: "cannot", text: expect.stringMatching(/already passed today/) });
        expect(JSON.stringify(out)).not.toMatch(/0 minutes/);
    });
    it("a gap still ahead reports its real size", () => {
        const morning = { ...thursday, now: "13:00" };
        expect(compile({ do: "fill_between", what: "gym", after: "B3", before: "B4" }, morning)).toMatchObject({ say: "cannot", text: expect.stringMatching(/only 5 minutes between DS Lab and CS Lab/) });
    });
    it("'skip gym today' with no gym on his day says so instead of booking gym somewhere (q019)", () => {
        expect(compile({ do: "skip", what: "gym" }, thursday)).toEqual({ say: "cannot", text: "there's no gym on today's calendar" });
        expect(compile({ do: "drop", what: "gym" }, thursday)).toEqual({ say: "cannot", text: "there's no gym on today's calendar" });
        // A class named by its title is still a real block: the correction round can name its id.
        expect(compile({ do: "skip", what: "discrete" }, thursday)).toMatchObject({ error: expect.any(String) });
    });
    it("the scheduler's 'already ended' line is spoken plainly", () => {
        expect(spokenFailure("NOTHING WAS CHANGED: Review spending already ended at 15:30 today (Thursday 2026-10-15) — if he meant another day, run again with --date YYYY-MM-DD."))
            .toBe("Review spending already ended at 3:30 PM today");
    });
});
describe("schedule flow — a weekday he names is that day (q027)", () => {
    const thu = new Date(2026, 9, 15, 22, 25);
    it("'friday' reads and changes Friday, not today", () => {
        expect(dayArgsFor("i gotta leave early friday, cut the last block to 20 min", thu)).toEqual({ args: ["--date", "friday"], label: "Friday" });
        expect(dayArgsFor("on mon push gym back an hour", thu)).toEqual({ args: ["--date", "monday"], label: "Monday" });
        expect(dayArgsFor("next tuesday drop the gym", thu)).toEqual({ args: ["--date", "tuesday"], label: "Tuesday" });
    });
    it("the weekday that is today stays today; 'tomorrow' still wins; a destination day is not the day to read", () => {
        expect(dayArgsFor("cut the last block off thursday", thu)).toEqual({ args: [], label: undefined });
        expect(dayArgsFor("move gym tomorrow", thu)).toEqual({ args: ["--date", "tomorrow"], label: "tomorrow" });
        expect(dayArgsFor("push gym to friday", thu)).toEqual({ args: [], label: undefined });
        expect(dayArgsFor("move gym to 7", thu)).toEqual({ args: [], label: undefined });
    });
    it("the flow reads Friday and passes --date friday to the change", async () => {
        const calls = [];
        let asked = "";
        const friday = { date: "2026-10-16", now: null, blocks: [{ title: "MKTG2201 Lecture", start: "13:30", end: "15:00", fixed: true }, { title: "Review spending", start: "15:10", end: "16:00", fixed: false }] };
        const exec = async (args) => { calls.push(args); return args[0] === "show" ? { stdout: JSON.stringify(friday), code: 0 } : { stdout: "Changed Friday 2026-10-16:\n  Review spending is now 20 min: 15:10–15:30 (was 50 min)\nWritten to his calendar.", code: 0 }; };
        const result = await runScheduleFlow({ message: "i gotta leave early friday, cut the last block to 20 min", clock: "Thu 22:25", now: new Date(2026, 9, 15, 22, 25), exec,
            ask: async (_s, user) => { asked = user; return { steps: [{ do: "resize", what: "B2", minutes: 20 }] }; } });
        expect(calls[0]).toEqual(["show", "--json", "--date", "friday"]);
        expect(calls[1]).toEqual(["resize", "Review spending", "20", "--date", "friday"]);
        expect(asked).toMatch(/His day \(Friday\)/);
        expect(result).toMatchObject({ outcome: "done", reply: expect.stringMatching(/^Done for Friday/) });
    });
});
describe("schedule flow — running late and running over (q017, q029)", () => {
    const morning = { ...thursday, now: "09:10" };
    it("the form has late and overrun steps", () => {
        const schema = intentSchema(thursday);
        expect(schema.properties.steps.items.properties.do.enum).toEqual(expect.arrayContaining(["late", "overrun"]));
        expect(FORM_PROMPT).toMatch(/- late:/);
        expect(FORM_PROMPT).toMatch(/- overrun:/);
    });
    it("late N loses N minutes from now; overrun N pushes what follows a class", () => {
        expect(compile({ do: "late", minutes: 15 }, morning)).toEqual({ args: ["late", "15"] });
        expect(compile({ do: "overrun", what: "B1", minutes: 20 }, morning)).toEqual({ args: ["overrun", "20", "--what", "CS1800 Discrete Structures — Lecture"] });
    });
    it("his own block running over is an extend; late needs minutes and today", () => {
        expect(compile({ do: "overrun", what: "B2", minutes: 20 }, morning)).toEqual({ args: ["extend", "finish resume", "--until", "12:10"] });
        expect(compile({ do: "late" }, morning)).toMatchObject({ error: expect.any(String) });
        expect(compile({ do: "late", minutes: 15 }, { ...thursday, now: null })).toMatchObject({ say: "cannot" });
    });
});
describe("schedule flow — words that only look like days", () => {
    const thu = new Date(2026, 9, 15, 12, 0);
    for (const msg of ["skip gym, the sun is out", "i sat in class too long, push study", "c'mon move gym to 7", "i do gym on fridays, add it today"]) {
        it(`"${msg}" stays today`, () => expect(dayArgsFor(msg, thu).args).toEqual([]));
    }
    it("'on sat' is Saturday", () => expect(dayArgsFor("drop the gym on sat", thu).args).toEqual(["--date", "saturday"]));
});
describe("schedule flow — a stated start time on an add (smoke 2026-10-16)", () => {
    it("the form is shown the 'at 7:30 am' example, and the compile keeps it as --at", () => {
        expect(FORM_PROMPT).toMatch(/stretch block tomorrow at 7:30 am.*"to":"07:30"/);
        expect(compile({ do: "add", what: "stretch", minutes: 15, to: "07:30" }, { date: "2026-10-17", now: null, blocks: [] })).toEqual({ args: ["add", "stretch", "15", "--at", "07:30"] });
    });
});
// (review, 2026-10-16) A weekday in passing is not the day of the change.
describe("schedule flow — a weekday in passing is not the date (review HIGH 4)", () => {
    const fri = new Date(2026, 9, 16, 10, 0);
    for (const msg of ["add a study block today for my monday exam", "prep 2 hours for wednesday's quiz this afternoon", "put revision for the tuesday deadline at 4pm", "add revision tonight for the friday quiz"]) {
        it(`"${msg}" stays today`, () => expect(dayArgsFor(msg, fri)).toEqual({ args: [], label: undefined }));
    }
    it("a real day still counts", () => expect(dayArgsFor("add revision on monday at 4pm", fri).args).toEqual(["--date", "monday"]));
});
// (re-review, 2026-10-16) "today" beats only a weekday in passing, never one he names as the target.
describe("schedule flow — a named weekday beats a later 'today' (re-review MEDIUM 5)", () => {
    const thu = new Date(2026, 9, 15, 10, 0);
    for (const [msg, day] of [["plan my friday, today is too packed", "friday"]]) {
        it(`"${msg}" is ${day}`, () => expect(dayArgsFor(msg, thu).args).toEqual(["--date", day]));
    }
});
// (round 6, 2026-10-16) Both "today" and a later weekday: ask, never pick.
describe("schedule flow — today and a weekday together is a question (round 6 HIGH 2)", () => {
    const thu = new Date(2026, 9, 15, 10, 0);
    for (const [msg, day] of [["skip gym today, i'll go saturday", "Saturday"], ["add a study block today, exam is monday", "Monday"], ["move gym today since i'm busy friday", "Friday"], ["prep 2 hours this afternoon for wednesday", "Wednesday"]]) {
        it(`"${msg}" asks`, () => expect(dayArgsFor(msg, thu)).toEqual({ args: [], label: undefined, ask: `Today or ${day}?` }));
        it(`"${msg}" writes nothing`, async () => {
            const calls = [];
            const r = await runScheduleFlow({ message: msg, clock: "Thu 10:00", now: thu, exec: async (a) => { calls.push(a); return { stdout: "{}", code: 0 }; }, ask: async () => null });
            expect(r).toMatchObject({ outcome: "say", kind: "ask", text: `Today or ${day}?` });
            expect(calls).toEqual([]);
        });
    }
});
// (final round, 2026-10-16) A weekday before "today" is just as ambiguous.
describe("schedule flow — a weekday before today asks too (final round)", () => {
    const thu = new Date(2026, 9, 15, 10, 0);
    for (const [msg, day] of [["i'll go saturday instead of today, skip gym", "Saturday"], ["move my friday gym to today", "Friday"], ["friday i want gym at 6, today i'm resting", "Friday"]]) {
        it(`"${msg}" asks`, () => expect(dayArgsFor(msg, thu)).toEqual({ args: [], label: undefined, ask: `Today or ${day}?` }));
    }
});
