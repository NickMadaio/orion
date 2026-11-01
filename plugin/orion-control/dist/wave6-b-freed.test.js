// Wave 6 B (gate run-1101003318, sch-no-class-c): both classes cancelled, "use the time". `orion-reschedule fill` booked Dinner,
// Wind down and a Break, moved Gym 17:00 → 19:20 to clear the routine dinner, and the reply named neither move. The freed class time
// now goes by his priorities (gym if it is missing > deadlines/study > side project if missing), placed with one `day --plan`, and the
// reply says what went where, that gym stays, and every other change the scheduler printed.
import { describe, expect, it } from "vitest";
import { cancelledFrom, planFreedTime } from "./freed-class-time.js";
import { readReality, runReality } from "./reality.js";
const PLAN = { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] };
const dayWith = (extra = []) => ({ date: "2026-11-02", now: "10:00", plan: PLAN, blocks: [
        { title: "ECON1115", start: "11:00", end: "12:30", fixed: true, kind: "class" },
        { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" },
        ...extra,
    ] });
const GYM = { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" };
const SIDE = { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" };
const OFF_OUT = "Changed Monday 2026-11-02:\n  cancelled ECON1115 11:00–12:30 — marked off in ORION's planning (still in Apple Calendar, not deleted)\n  cancelled MKTG2201 13:30–15:30 — marked off in ORION's planning (still in Apple Calendar, not deleted)\nWritten. \"orion-reschedule undo\" puts them back.";
describe("planFreedTime: priorities, not routines", () => {
    const cancelled = cancelledFrom(OFF_OUT);
    it("reads the cancelled spans", () => {
        expect(cancelled).toEqual([{ title: "ECON1115", start: "11:00", end: "12:30" }, { title: "MKTG2201", start: "13:30", end: "15:30" }]);
    });
    it("gym booked already: the freed slots become study for those classes", () => {
        const plans = planFreedTime({ day: dayWith([GYM, SIDE]), cancelled, nowMin: 600, deadlines: [] });
        expect(plans.map((p) => [p.title, p.start, p.minutes])).toEqual([["Study ECON1115", "11:00", 90], ["Study MKTG2201", "13:30", 120]]);
    });
    it("a deadline he has is what the study is for", () => {
        const plans = planFreedTime({ day: dayWith([GYM, SIDE]), cancelled, nowMin: 600, deadlines: ["CS2100 problem set"] });
        expect(plans.every((p) => p.title === "Study for CS2100 problem set")).toBe(true);
    });
    it("no gym today: gym takes the first slot long enough for 90 minutes, before any study", () => {
        const plans = planFreedTime({ day: dayWith([SIDE]), cancelled, nowMin: 600, deadlines: [] });
        expect(plans[0]).toMatchObject({ title: "Gym", start: "11:00", minutes: 90 });
        expect(plans.map((p) => p.title)).toEqual(["Gym", "Study MKTG2201"]);
    });
    it("time already past is not planned", () => {
        expect(planFreedTime({ day: dayWith([GYM]), cancelled, nowMin: 16 * 60, deadlines: [] })).toEqual([]);
        expect(planFreedTime({ day: dayWith([GYM]), cancelled, nowMin: 12 * 60 + 10, deadlines: [] }).map((p) => p.start)).toEqual(["13:30"]);
    });
});
describe("no classes + use the time: no routine fill, every change named", () => {
    const run = (afterDay, planOut) => {
        const runs = [];
        return { runs, deps: {
                run: async (script, args) => {
                    runs.push([script, ...args]);
                    if (script === "orion-declare")
                        return { stdout: JSON.stringify({ ok: true, id: `fact-${runs.length}` }), code: 0 };
                    if (args[0] === "classes-off")
                        return { stdout: OFF_OUT, code: 0 };
                    if (args[0] === "show")
                        return { stdout: JSON.stringify(afterDay), code: 0 };
                    return { stdout: planOut, code: 0 };
                },
                readDay: async () => dayWith([GYM, SIDE]), now: new Date(2026, 10, 2, 10, 0), source: "chat",
            } };
    };
    it.each([
        "i dont have marketing or macro today, both are cancelled, use the time",
        "econ and mktg both got cancelled today so fill that time w something useful",
        "no econ or marketing today theyre cancelled, make use of the gap pls",
    ])("%s", async (text) => {
        const read = readReality(text, new Date(2026, 10, 2, 10, 0));
        expect(read?.reality).toMatchObject({ kind: "no-classes", fill: true });
        if (!read)
            return;
        const after = dayWith([{ title: "Study ECON1115", start: "11:00", end: "12:30", fixed: false, kind: "study" }, { title: "Study MKTG2201", start: "13:30", end: "15:30", fixed: false, kind: "study" }, GYM, { ...SIDE, start: "19:40", end: "20:40" }]);
        const f = run(after, "Changed Monday 2026-11-02:\n  planned Study ECON1115: 11:00–12:30\n  planned Study MKTG2201: 13:30–15:30\n  moved Side project: 19:30 → 19:40\nWritten to his calendar.");
        const out = await runReality(read, { ...f.deps, text });
        const reply = out.flow.reply;
        expect(f.runs.some((a) => a[1] === "fill")).toBe(false);
        expect(f.runs.find((a) => a[1] === "day")).toEqual(["orion-reschedule", "day", "--plan", "Study ECON1115, 90, 11:00", "--plan", "Study MKTG2201, 120, 13:30"]);
        expect(reply).toMatch(/Study ECON1115 11:00 AM/);
        expect(reply).toMatch(/Study MKTG2201 1:30 PM/);
        expect(reply).toMatch(/Gym stays at 5:00 PM/);
        expect(reply).toMatch(/Side project 7:30 PM → 7:40 PM/);
        expect(reply).not.toMatch(/Dinner|Wind down|Break/);
        expect(out.writes).toBe(2);
    });
});
