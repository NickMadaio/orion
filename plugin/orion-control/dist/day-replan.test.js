// 2026-10-20 reschedule incident (docs/audits/2026-10-20-reschedule-incident.md): "reschedule my day after my marketing class, but put gym as
// the first event after i get back home" is read by code. Fixtures only: Nick's day as `show --json` gave it, a fake scheduler, no model.
import { describe, expect, it } from "vitest";
import { parseReplanRequest, planDayReplan, replanReply } from "./day-replan.js";
import { runScheduleFlow } from "./schedule-flow.js";
const SENTENCE = "reschedule my day after my marketing class, but put gym as the first event after i get back home";
// Tuesday: the CS lab and the economics lecture are over, marketing is on now (15:30-17:00), "finish resume" 17:50 and the Gym 20:15 are ORION's.
const day = (over = {}) => ({
    date: "2030-10-03", now: "16:16",
    plan: { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] },
    blocks: [
        { title: "CS Lab", start: "09:00", end: "11:15", fixed: true, kind: "class" },
        { title: "ECON1115 Principles of Macroeconomics — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" },
        { title: "MKTG2201 Introduction to Marketing — Lecture", start: "15:30", end: "17:00", fixed: true, kind: "class" },
        { title: "finish resume", start: "17:50", end: "18:50", fixed: false, kind: "study" },
        { title: "Gym", start: "20:15", end: "21:15", fixed: false, kind: "gym" },
    ],
    ...over,
});
describe("parseReplanRequest", () => {
    it("reads the anchor, the trip home and the order from the incident sentence", () => {
        expect(parseReplanRequest(SENTENCE)).toEqual({ order: ["gym"], anchor: "marketing class", home: true, explicit: true });
    });
    it.each([
        ["replan my evening, gym first", { order: ["gym"], home: false }],
        ["after class do gym then resume", { order: ["gym", "resume"], anchor: "class", home: false }],
        ["move everything after lab, gym first", { order: ["gym"], anchor: "lab", home: false }],
        ["reschedule my day, put gym first after I get home, then finish resume", { order: ["gym", "finish resume"], home: true }],
        ["Replan the rest of my day: gym first, then resume, then dinner", { order: ["gym", "resume", "dinner"], home: false }],
        ["Orion, can you reschedule my day after my marketing class, gym first after I get home?", { order: ["gym"], anchor: "marketing class", home: true }],
        ["when I get home do gym then resume", { order: ["gym", "resume"], home: true }],
    ])("%s", (message, want) => {
        expect(parseReplanRequest(message)).toMatchObject(want);
    });
    it.each([
        "gym first", // no reschedule or "after class" around it
        "what should I do first after class?", // a question
        "put gym at 6 after class, then resume", // he dictates the clock: not an order
        "reschedule my day", // no order given
        "after class I'll do gym", // a plan, not an order (the form reads it)
        "wake me first thing tomorrow after class",
    ])("leaves %j to the form", (message) => {
        expect(parseReplanRequest(message)).toBeUndefined();
    });
});
describe("only an imperative request rewrites his day", () => {
    it.each([
        "should I do gym first after class",
        "what if I put gym first after class",
        "don't put gym first after my class",
        "I rescheduled my day, gym first",
        "do not reschedule my day, gym first is fine",
        "I was going to reschedule my day, gym first, but never mind",
        "should I do gym first after class?",
        "I'm thinking of rescheduling my day, gym first",
        "maybe replan my evening, gym first",
        "could I reschedule my day after class with gym first",
        "I wonder whether to replan my evening, gym first",
        "reschedule my day after class, gym first - just kidding",
        "wanna reschedule my day, gym first? jk",
        "never reschedule my day, gym first always",
        "no reschedule my day, gym first",
        "she said reschedule my day, gym first",
        "imagine i reschedule my day after class, gym first",
        "rescheduling my day after class, gym first, was a mistake yesterday",
        "reschedule my day, gym first lol",
        "reschedule my day after class, gym first. actually no",
        "reschedule my day after class, gym first, ugh no forget about it",
        "reschedule my day after class, gym first? or is that dumb",
        "reschedule my day? nah, gym first is fine as is",
        "put gym first after class, she told me",
        "reschedule my day after class, gym first, hmm",
        "reschedule my day after class, gym first idk",
        "he said reschedule my day after class, gym first",
        "nvm, reschedule my day, gym first",
        "did you reschedule my day, gym first?",
    ])("%j fires nothing", (message) => {
        expect(parseReplanRequest(message)).toBeUndefined();
        expect(planDayReplan(message, day())).toBeUndefined();
    });
    it.each([
        SENTENCE,
        "can u reschedule my day after marketing, gym first",
        "Orion, can you reschedule my day after my marketing class, gym first after I get home?",
        "replan my evening, gym first",
        "reschedule my day, put gym first",
        "reschedule my day after marketing gym first",
        "ok so please can you replan my evening, gym first",
        "can you reschedule my day after class, gym first?",
    ])("%j still fires", (message) => {
        expect(planDayReplan(message, day())).toMatchObject({ args: expect.arrayContaining(["--plan", "Gym, 90, 17:50"]) });
    });
});
describe("planDayReplan", () => {
    it("puts the gym first at class end + the 45 min trip home + the 5 min gap, 90 minutes, then the rest in order", () => {
        const plan = planDayReplan(SENTENCE, day());
        expect(plan).toMatchObject({ start: "17:50", args: ["day", "--plan", "Gym, 90, 17:50"] });
        expect(plan && "args" in plan && plan.items).toEqual([{ title: "Gym", minutes: 90 }]);
    });
    it("keeps the order he gives and each block's own length; the anchor's length wins over a squeezed block", () => {
        const plan = planDayReplan("after class do gym then resume", day());
        expect(plan).toMatchObject({ start: "17:50", args: ["day", "--plan", "Gym, 90, 17:50", "--plan", "finish resume, 60, 19:25"] });
    });
    it("replan my evening, gym first: from the end of the class he is still in plus the trip home", () => {
        expect(planDayReplan("replan my evening, gym first", day())).toMatchObject({ start: "17:50", args: ["day", "--plan", "Gym, 90, 17:50"] });
    });
    it("replan my evening, gym first, once he is home: from now, rounded up to 5 minutes", () => {
        expect(planDayReplan("replan my evening, gym first", day({ now: "18:07" }))).toMatchObject({ start: "18:10" });
    });
    it("after an earlier class that is over, never into the class he is in: the first clear time", () => {
        expect(planDayReplan("move everything after lab, gym first", day())).toMatchObject({ start: "17:50" });
        expect(planDayReplan("move everything after lab, gym first", day({ now: "11:20" }))).toMatchObject({ start: "11:20" });
    });
    it("a gym he has no block for yet is added at its anchor's length", () => {
        const d = day();
        d.blocks = d.blocks.filter((b) => b.title !== "Gym");
        expect(planDayReplan(SENTENCE, d)).toMatchObject({ args: ["day", "--plan", "Gym, 90, 17:50"] });
    });
    it("asks, and writes nothing, when he names a thing it cannot place (a reschedule he asked for)", () => {
        expect(planDayReplan("replan my evening, laundry first", day())).toMatchObject({ say: "ask", text: expect.stringMatching(/laundry isn't on your day.*haven't changed.*how many minutes/i) });
        expect(planDayReplan("replan my evening, marketing first", day())).toMatchObject({ say: "cannot", text: expect.stringMatching(/class.*doesn't move/i) });
        expect(planDayReplan("reschedule my day after yoga, gym first", day())).toMatchObject({ say: "ask", text: expect.stringMatching(/don't see "yoga"/i) });
    });
    it("leaves a plan he states ('after class do laundry then gym') to the form when it cannot place a name", () => {
        expect(planDayReplan("after class do laundry then gym", day())).toBeUndefined();
    });
    it("another day with no anchor is the form's: there is no 'now' to start from", () => {
        expect(planDayReplan("replan my evening, gym first", day({ now: null }))).toBeUndefined();
    });
    it("commas in a title never split the --plan", () => {
        const d = day();
        d.blocks[3] = { ...d.blocks[3], title: "email Dr. Smith, then call" };
        const plan = planDayReplan("after class do gym then email dr smith", d);
        expect(plan && "args" in plan && plan.args).toEqual(["day", "--plan", "Gym, 90, 17:50", "--plan", "email Dr. Smith then call, 60, 19:25"]);
    });
});
describe("replanReply", () => {
    it("is one line: the new order with times, from the re-read day", () => {
        const plan = planDayReplan(SENTENCE, day());
        const after = day({ blocks: [...day().blocks.slice(0, 3),
                { title: "Gym", start: "17:50", end: "19:20", fixed: false, kind: "gym" }, { title: "finish resume", start: "19:25", end: "20:25", fixed: false, kind: "study" }] });
        const reply = replanReply(after, plan);
        expect(reply).toBe("Done, after your marketing class and the trip home: Gym 5:50–7:20 PM, then finish resume 7:25–8:25 PM.");
        expect(reply.split("\n")).toHaveLength(1);
    });
});
describe("the reply says what the scheduler did not do as asked", () => {
    const annika = () => { const d = day(); d.blocks.splice(4, 0, { title: "Annika", start: "19:00", end: "20:30", fixed: true }); return d; };
    it("gym cannot be first when Annika is at 19:00: says so, where gym went, and why", () => {
        const plan = planDayReplan(SENTENCE, annika());
        expect(plan).toMatchObject({ start: "20:35", pushed: { wanted: "17:50", because: "Annika" } });
        const after = { ...annika(), blocks: [...annika().blocks.slice(0, 3), annika().blocks[4], { title: "Gym", start: "20:35", end: "22:05", fixed: false, kind: "gym" }, { title: "finish resume", start: "17:50", end: "18:50", fixed: false, kind: "study" }] };
        const reply = replanReply(after, plan, []);
        expect(reply).toMatch(/^Done, but not as asked/);
        expect(reply).toContain("Gym couldn't go first at 5:50 PM because Annika is in the way");
        expect(reply).toContain("Gym 8:35–10:05 PM");
    });
    it("NOT BOOKED, skipped, shifted and squeezed-off blocks are named in plain words", () => {
        const plan = planDayReplan(SENTENCE, day());
        const after = { ...day(), blocks: [...day().blocks.slice(0, 3), { title: "Gym", start: "17:50", end: "19:20", fixed: false, kind: "gym" }] };
        const reply = replanReply(after, plan, ["Changed:\n  cleared 3 prior schedule blocks: finish resume, Gym, Dinner\n  NOT BOOKED: laundry (45 min) did not fit on Thursday\n  SKIPPED OPTIONAL: stretch (15 min) did not fit\n  SHIFTED: dinner could not go at 19:00 (Annika is there) — booked 20:35 instead; tell him\n  SHRUNK to fit: nap 90 → 75 min (low priority; tell him)"]);
        expect(reply.toLowerCase()).toContain("laundry didn't fit and is not booked");
        expect(reply.toLowerCase()).toContain("stretch was skipped, there was no room");
        expect(reply.toLowerCase()).toContain("dinner couldn't go at 7:00 pm because annika is there, so it's at 8:35 pm");
        expect(reply.toLowerCase()).toContain("nap is shorter now, 75 minutes instead of 90");
        expect(reply).toContain("Finish resume, Dinner came off your day");
    });
});
describe("the flow runs it with no model at all", () => {
    it("reads the day, makes one `day` call with the right plan, and answers from the day it re-reads", async () => {
        const calls = [];
        const after = { ...day(), blocks: [...day().blocks.slice(0, 3),
                { title: "Gym", start: "17:50", end: "19:20", fixed: false, kind: "gym" }, { title: "finish resume", start: "19:25", end: "20:25", fixed: false, kind: "study" }] };
        let written = false;
        const result = await runScheduleFlow({
            message: SENTENCE, clock: "Tue 16:16", now: new Date(2030, 9, 3, 16, 16),
            exec: async (args) => {
                calls.push(args);
                if (args[0] === "show")
                    return { stdout: JSON.stringify(written ? after : day()), code: 0 };
                written = true;
                return { stdout: "Changed Thursday 2030-10-03:\n  moved finish resume: 17:50 → 19:25\n  moved Gym: 20:15 → 17:50\nWritten to his calendar.", code: 0 };
            },
            ask: async () => { throw new Error("the form must not be called"); },
        });
        expect(calls.map((c) => c[0])).toEqual(["show", "day", "show"]);
        expect(calls[1]).toEqual(["day", "--plan", "Gym, 90, 17:50"]);
        expect(result).toMatchObject({ outcome: "done", reply: "Done, after your marketing class and the trip home: Gym 5:50–7:20 PM, then finish resume 7:25–8:25 PM." });
    });
    it("a refusal from the scheduler is said, not claimed", async () => {
        const result = await runScheduleFlow({
            message: SENTENCE, clock: "Tue 16:16", now: new Date(2030, 9, 3, 16, 16),
            exec: async (args) => args[0] === "show" ? { stdout: JSON.stringify(day()), code: 0 } : { stdout: "NOTHING WAS CHANGED: must-haves could not fit: Gym.", code: 1 },
            ask: async () => { throw new Error("the form must not be called"); },
        });
        expect(result).toMatchObject({ outcome: "say", text: expect.stringMatching(/didn't fit/i) });
    });
    it("past its deadline it writes nothing and hands the turn on", async () => {
        const calls = [];
        const result = await runScheduleFlow({
            message: SENTENCE, clock: "Tue 16:16", now: new Date(2030, 9, 3, 16, 16), deadlineAt: Date.now() - 1,
            exec: async (args) => { calls.push(args); return { stdout: JSON.stringify(day()), code: 0 }; },
            ask: async () => null,
        });
        expect(result).toEqual({ outcome: "fallback", reason: "too slow" });
        expect(calls.map((c) => c[0])).toEqual(["show"]);
    });
});
