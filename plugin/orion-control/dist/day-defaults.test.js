// Wave 4 gate (run-1031202318, clusters 6 and 7): defaults instead of a clarifier, and replies grounded in the real day.
// Phrasings here are held out: none of them appears in scripts/eval/gate/scenarios/.
import { describe, expect, it } from "vitest";
import { readDayDefault, runDayDefault } from "./day-defaults.js";
const monday = { date: "2026-11-02", now: null, plan: { commuteMinutes: 20, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [
        { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" },
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
    ] };
const tuesday = { date: "2026-11-03", now: null, plan: { commuteMinutes: 20, bufferMinutes: 5, anchors: [] }, blocks: [
        { title: "CS2100", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "ECON1115", start: "11:00", end: "12:30", fixed: true, kind: "class" },
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Laundry", start: "18:45", end: "19:15", fixed: false, kind: "other" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
    ] };
const at = (h, m = 0) => new Date(2026, 10, 2, h, m);
function deps(now, opts = {}) {
    const calls = [];
    const d = {
        now,
        readDay: async (dateArgs) => (dateArgs.includes("tomorrow") ? opts.tomorrow ?? tuesday : opts.today ?? monday),
        run: async (_script, args) => { calls.push(args); return { stdout: opts.out ? opts.out(args) : "Written to his calendar.", code: 0 }; },
        ...(opts.deadlines ? { deadlines: async () => ({ events: [], tasks: [{ title: "CS2100 midterm", due: new Date(2026, 10, 5, 9).toISOString() }] }) } : {}),
    };
    return { d, calls };
}
describe("readDayDefault: which defaultable request this is", () => {
    it.each([
        "can u make tomorrow a light one",
        "i need an easy day tmrw honestly",
        "lets keep today low key",
        "tmr should be pretty relaxed, a lot on my mind",
    ])("lighten: %s", (m) => expect(readDayDefault(m)?.kind).toBe("lighten"));
    it.each([
        "my roommate wants to grab dinner right now",
        "sam just invited me to get lunch rn",
        "jess is asking if i wanna go for coffee now",
    ])("a plan with a person: %s", (m) => expect(readDayDefault(m)?.kind).toBe("with-person"));
    it.each([
        "squeeze a bit of review in before my lecture",
        "can i get some studying done before class",
        "put some reading before my next class pls",
    ])("before class: %s", (m) => expect(readDayDefault(m)?.kind).toBe("before-class"));
    it.each(["ok so what now", "whats up next lol", "alright what am i supposed to be doing rn", "now what", "k what should i do next"])("what now: %s", (m) => expect(readDayDefault(m)?.kind).toBe("whats-now"));
    it.each([
        // fully specified, or not a defaultable request: the schedule flow / day read / chat keeps them
        "make tomorrow lighter: keep classes and gym, cut side project to 30 min",
        "is tomorrow chill",
        "today was chill",
        "going to get food with sam from 5 to 7",
        "remind me to text sam about dinner now",
        "add a 30 min econ review before my 1:30 class",
        "uh whats next on my schedule",
        "whats my next class",
        "ok",
        "the food here is fine",
    ])("none: %s", (m) => expect(readDayDefault(m)).toBeNull());
    it.each([
        "sam wants to grab dinner now but idk",
        "maybe get food with jess rn",
        "should i go get coffee with my roommate now",
        "thinking about getting lunch with sam right now",
        "not sure if i wanna get pizza with the boys rn",
        "sam wants to get dinner right now?",
    ])("a hedged plan with a person is a question, no write: %s", async (m) => {
        const read = readDayDefault(m);
        expect(read).toMatchObject({ kind: "with-person", hedged: true });
        const { d, calls } = deps(at(17, 0));
        const out = await runDayDefault(read, d);
        expect(calls).toEqual([]);
        expect(out.writes).toBe(0);
        expect(out.flow).toMatchObject({ outcome: "say", kind: "ask" });
    });
    it("a firm plan with a person still holds the time", () => {
        expect(readDayDefault("sam wants to grab dinner now")).not.toMatchObject({ hedged: true });
    });
    it("at 01:00 'tmrw needs to be chill' lightens today, and by day it lightens tomorrow", () => {
        expect(readDayDefault("tmrw needs to be chill", undefined, new Date(2026, 10, 2, 1, 0))).toEqual({ kind: "lighten", tomorrow: false });
        expect(readDayDefault("tmrw needs to be chill", undefined, new Date(2026, 10, 2, 14, 0))).toEqual({ kind: "lighten", tomorrow: true });
    });
    it("a bare ack is read against a stale 'Next:' line ORION sent", () => {
        expect(readDayDefault("ok", "Session done. Next: CS2100 at 9:00 AM.")).toEqual({ kind: "ack-claim", claim: { title: "CS2100", at: "9:00 AM" } });
        expect(readDayDefault("cool thanks", "Session done. Next: CS2100 at 9:00 AM.")?.kind).toBe("ack-claim");
        expect(readDayDefault("ok", "Time to start: Gym")).toBeNull();
    });
});
describe("runDayDefault: acts on the default and says the assumption", () => {
    it("lighten tomorrow: drops the chore, keeps the side project hour when something else came off, adds rest; classes and gym untouched", async () => {
        const { d, calls } = deps(at(21));
        const out = await runDayDefault({ kind: "lighten", tomorrow: true }, d);
        expect(calls).toContainEqual(["drop", "Laundry", "--date", "2026-11-03"]);
        expect(calls.some((c) => c[0] === "add" && c[1] === "Rest" && c.includes("--date"))).toBe(true);
        expect(calls.some((c) => /CS2100|ECON1115|Gym/.test(c[1] ?? ""))).toBe(false);
        expect(out.flow.outcome).toBe("done");
        const text = out.flow.outcome === "done" ? out.flow.reply : "";
        expect(text).toMatch(/Laundry/);
        expect(text).toMatch(/rest/i);
        expect(text).toMatch(/Gym stays/);
        expect(text).toMatch(/I took/); // the assumption, in one clause
        expect(out.writes).toBe(calls.length);
    });
    it("lighten tomorrow with nothing optional on it: the side project goes to 30 minutes, plus rest", async () => {
        const plain = { ...tuesday, blocks: tuesday.blocks.filter((b) => b.title !== "Laundry") };
        const { d, calls } = deps(at(21), { tomorrow: plain });
        const out = await runDayDefault({ kind: "lighten", tomorrow: true }, d);
        expect(calls).toContainEqual(["resize", "Side project", "30", "--date", "2026-11-03"]);
        expect(out.flow.outcome === "done" && out.flow.reply).toMatch(/Side project.*30 minutes/);
    });
    it("a plan with a person: two hours assumed from now, ORION's blocks slide out of it, said with the assumption", async () => {
        const { d, calls } = deps(at(16, 30), { out: (a) => (a[0] === "busy" ? "moved Gym: 17:00 → 18:35\nWritten to his calendar." : "") });
        const out = await runDayDefault({ kind: "with-person", who: "sam", what: "food" }, d);
        expect(calls).toEqual([["busy", "16:30-18:30", "--why", "food with sam"]]);
        const text = out.flow.outcome === "done" ? out.flow.reply : "";
        expect(text).toMatch(/two hours/);
        expect(text).toMatch(/Gym 5:00 PM → 6:35 PM/);
        expect(out.writes).toBe(1);
    });
    it("a plan with a person with nothing in the way changes nothing and says so", async () => {
        const { d, calls } = deps(at(10));
        const out = await runDayDefault({ kind: "with-person", who: "sam", what: "coffee" }, d);
        expect(calls).toEqual([]);
        expect(out.flow.outcome === "say" && out.flow.text).toMatch(/nothing of yours is in the way/i);
    });
    it("before class: a 30 minute block ending a buffer before the next class, nothing else moved", async () => {
        const { d, calls } = deps(at(10));
        const out = await runDayDefault({ kind: "before-class", title: "Study", minutes: 30 }, d);
        expect(calls).toEqual([["add", "Study", "30", "--at", "12:55", "--date", "2026-11-02"]]);
        expect(out.flow.outcome === "done" && out.flow.reply).toMatch(/12:55–1:25 PM.*MKTG2201 at 1:30 PM/);
    });
    it("before class with no class left today: no write, says when the next one is", async () => {
        const { d, calls } = deps(at(16));
        const out = await runDayDefault({ kind: "before-class", title: "Study", minutes: 30 }, d);
        expect(calls).toEqual([]);
        expect(out.flow.outcome === "say" && out.flow.text).toMatch(/no class left today.*CS2100.*tomorrow at 9:00 AM/i);
    });
    it("what now: the block under way, with its times, then what follows", async () => {
        const { d } = deps(at(17));
        const out = await runDayDefault({ kind: "whats-now" }, d);
        const text = out.flow.outcome === "say" ? out.flow.text : "";
        expect(text).toMatch(/Gym, now \(5:00–6:30 PM\)/);
        expect(text).toMatch(/Side project at 7:30 PM/);
        expect(text).not.toMatch(/caught up|rest/i);
    });
    it("what now with a free stretch first: the next block and the nearest deadline", async () => {
        const { d } = deps(at(16), { deadlines: true });
        const out = await runDayDefault({ kind: "whats-now" }, d);
        const text = out.flow.outcome === "say" ? out.flow.text : "";
        expect(text).toMatch(/Gym at 5:00 PM/);
        expect(text).toMatch(/CS2100 midterm/);
    });
    it("what now with nothing left today: tomorrow's first thing, never 'all caught up'", async () => {
        const { d } = deps(at(21));
        const out = await runDayDefault({ kind: "whats-now" }, d);
        expect(out.flow.outcome === "say" && out.flow.text).toMatch(/Nothing else is on today.*CS2100 at 9:00 AM tomorrow/);
    });
    it("an ack to a stale 'Next:' line gets the correction from the calendar, without repeating the stale claim", async () => {
        const { d } = deps(at(17));
        const out = await runDayDefault({ kind: "ack-claim", claim: { title: "CS2100", at: "9:00 AM" } }, d);
        const text = out.flow.outcome === "say" ? out.flow.text : "";
        expect(text).toMatch(/Gym, now \(5:00–6:30 PM\)/);
        expect(text).toMatch(/CS2100 is tomorrow/);
        expect(text).not.toMatch(/CS2100 at 9/);
    });
    it("an ack to a 'Next:' line that is right: a short confirmation", async () => {
        const { d } = deps(at(16, 50));
        const out = await runDayDefault({ kind: "ack-claim", claim: { title: "Gym", at: "5:00 PM" } }, d);
        expect(out.flow.outcome === "say" && out.flow.text).toMatch(/^Got it\. Gym at 5:00 PM/);
    });
    it("no calendar read: says it could not check, changes nothing", async () => {
        const { d, calls } = deps(at(17));
        const out = await runDayDefault({ kind: "whats-now" }, { ...d, readDay: async () => undefined });
        expect(calls).toEqual([]);
        expect(out.flow.outcome === "say" && out.flow.text).toMatch(/couldn't read your calendar/);
    });
});
