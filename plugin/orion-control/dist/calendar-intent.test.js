// The calendar intent layer, table-driven: EVERY phrasing from the three audits (docs/audits/2026-10-19-cslab-incident.md,
// 2026-10-20-reschedule-incident.md, 2026-10-20-live-as-nick.md, first run and re-run) and the positives and negatives of the earlier
// review rounds (day-replan, direct-add, cslab-incident, desk-invented-values, live-as-nick tests), each with the structured intent it must
// read or the refusal it must give. Fixtures only: no calendar, no model.
import { describe, expect, it } from "vitest";
import { readIntent } from "./calendar-intent.js";
import { parseAskContext } from "./schedule-flow.js";
const at = (h, m = 0) => new Date(2030, 9, 3, h, m);
const BLANK_ASK = parseAskContext('[ORION context: 1 min ago you asked "Nothing planned till 10:30 - what are you up to? I could put CS Lab there." (blank ask about 17:00-now, he is home).]');
const LAST_TODAY = { order: ["gym", "resume"], home: false, explicit: true };
const LAST_TOMORROW = { order: ["gym", "resume"], anchor: "first class", home: false, explicit: true, day: "tomorrow", date: "2030-10-04" };
const LAST_9A = { order: ["gym"], anchor: "first class", home: false, explicit: true, day: "tomorrow", date: "2030-10-04" };
const read = (m, ctx) => readIntent(m, { now: ctx.now, ...(ctx.last ? { last: ctx.last } : {}), ...(ctx.ask ? { ask: ctx.ask } : {}) });
// ---- the audits ----
const AUDITS = [
    // 2026-10-20 live as Nick, first run (about 20:55-21:03)
    ["live #1", "reschedule the rest of my day, gym first", { now: at(20, 55) }, { intent: { verb: "replan", day: "today", items: [{ name: "gym" }], anchor: { kind: "now" } } }],
    ["live #2a", "can u redo my evening, gym first then resume", { now: at(20, 56) }, { intent: { verb: "replan", day: "today", items: [{ name: "gym" }, { name: "resume" }] } }],
    ["live #2b", "actually do resume before gym", { now: at(20, 57), last: LAST_TODAY }, { intent: { verb: "reorder", day: "today", items: [{ name: "resume" }, { name: "gym" }], replan: { again: true } } }],
    ["live #2b with nothing on record", "actually do resume before gym", { now: at(20, 57) }, { refused: "second-thoughts" }],
    ["live #2c (run 3: in code)", "ok and push everything 30 min", { now: at(20, 58) }, { intent: { verb: "move", all: true, items: [{ name: "everything", by: 30 }] } }],
    ["live #3", "should i do gym first tonight?", { now: at(20, 59) }, { refused: "question" }],
    ["live #4", "reschedule my night, gym first. actually no nvm", { now: at(21, 0) }, { refused: "take-back" }],
    ["live #5", "put cs lab from now until ten thirty", { now: at(20, 58) }, { intent: { verb: "add", until: true, day: "today", items: [{ name: "cs lab", fromNow: true, start: "21:00", end: "22:30", minutes: 90 }] } }],
    ["live #6", "ok so reschedule my day and put gym frist then whatevers left by priorty, im kinda tired tho", { now: at(21, 1) }, { intent: { verb: "replan", items: [{ name: "gym" }] } }],
    ["live #7", "reschedule the rest of my day, put piano practice first", { now: at(21, 2) }, { intent: { verb: "replan", items: [{ name: "piano practice" }] } }],
    // the re-run, 22:40-22:47, against tomorrow
    ["re-run #2a", "can u redo tomorrow after my first class, gym first then resume", { now: at(22, 40) }, { intent: { verb: "replan", day: "tomorrow", anchor: { kind: "block", name: "first class" }, items: [{ name: "gym" }, { name: "resume" }] } }],
    ["re-run #2b", "actually do resume before gym", { now: at(22, 41), last: LAST_TOMORROW }, { intent: { verb: "reorder", day: "tomorrow", date: "2030-10-04", anchor: { kind: "block", name: "first class" }, items: [{ name: "resume" }, { name: "gym" }] } }],
    ["re-run #2c (run 3: in code)", "ok and push everything 30 min", { now: at(22, 42) }, { intent: { verb: "move", all: true, items: [{ by: 30 }] } }],
    ["re-run #5 at 22:42: 10:30 PM has passed", "put cs lab from now until ten thirty", { now: at(22, 42) }, { intent: { verb: "add", until: true, items: [{ name: "cs lab", start: "22:45", issue: { kind: "passed", at: "22:30", field: "end" } }] } }],
    ["re-run #6", "ok so reschedule tomorrow after my first class and put gym frist then whatevers left by priorty, im kinda tired tho", { now: at(22, 43) }, { intent: { verb: "replan", day: "tomorrow", anchor: { kind: "block", name: "first class" }, items: [{ name: "gym" }] } }],
    ["re-run #7", "reschedule tomorrow, put piano practice first", { now: at(22, 43) }, { intent: { verb: "replan", day: "tomorrow", anchor: { kind: "first-class" }, items: [{ name: "piano practice" }] } }],
    ["re-run #8", "resched my day, gim frist, nvrmind", { now: at(22, 44) }, { refused: "take-back", tookBack: true }],
    ["re-run #9a", "reschedule tomorrow after my first class, gym first", { now: at(22, 45) }, { intent: { verb: "replan", day: "tomorrow", items: [{ name: "gym" }] } }],
    ["re-run #9b", "dinner then gym", { now: at(22, 45), last: LAST_9A }, { intent: { verb: "reorder", day: "tomorrow", outside: ["dinner"], items: [{ name: "dinner" }, { name: "gym" }] } }],
    ["re-run #10: at 5 is 5 PM", "can u put a 45 min walk tomorrow at 5", { now: at(22, 46) }, { intent: { verb: "add", day: "tomorrow", items: [{ name: "walk", minutes: 45, start: "17:00" }] } }],
    // 2026-10-20 reschedule incident (16:16)
    ["incident sentence", "reschedule my day after my marketing class, but put gym as the first event after i get back home", { now: at(16, 16) }, { intent: { verb: "replan", anchor: { kind: "block", name: "marketing class" }, replan: { home: true }, items: [{ name: "gym" }] } }],
    ["incident fix list 1", "replan my evening, gym first", { now: at(16, 16) }, { intent: { verb: "replan", items: [{ name: "gym" }] } }],
    ["incident fix list 2", "after class do gym then resume", { now: at(16, 16) }, { intent: { verb: "replan", anchor: { kind: "block", name: "class" }, items: [{ name: "gym" }, { name: "resume" }] } }],
    ["incident fix list 3", "move everything after lab, gym first", { now: at(16, 16) }, { intent: { verb: "replan", anchor: { kind: "block", name: "lab" }, items: [{ name: "gym" }] } }],
    // 2026-10-19 CS Lab incident (21:54)
    ["cslab 20:54 answer", "yes, put cs lab until 10:30", { now: at(21, 54), ask: BLANK_ASK }, { intent: { verb: "add", until: true, items: [{ name: "cs lab", start: "21:55", end: "22:30", minutes: 35 }] } }],
    ["cslab bare yes", "yes", { now: at(21, 54), ask: BLANK_ASK }, { intent: { verb: "add", until: true, items: [{ name: "CS Lab", end: "22:30" }] } }],
    ["cslab bare yes, no offer", "yes", { now: at(21, 54) }, { refused: "unparsed" }],
    ["cslab spelled out", "put CS lab from now until ten thirty", { now: at(21, 54) }, { intent: { verb: "add", until: true, items: [{ name: "CS lab", end: "22:30" }] } }],
    ["cslab 21:04", "I'm fine. It's... I'm just annoyed. Can you please put CS lab from now until ten thirty?", { now: at(21, 54) }, { intent: { verb: "add", until: true, items: [{ name: "CS lab", end: "22:30" }] } }],
    ["cslab continuation", "Pissing Okay. Okay. Yes. Yes. Put CS for right now until ten thirty.", { now: at(21, 54) }, { intent: { verb: "add", until: true, items: [{ name: "CS", end: "22:30" }] } }],
    ["cslab end already past", "put cs lab until 9:30 pm", { now: at(21, 54) }, { intent: { verb: "add", items: [{ issue: { kind: "passed", at: "21:30" } }] } }],
    ["cslab another day", "put cs lab until ten thirty tomorrow", { now: at(21, 54) }, { refused: "unparsed" }],
    ["cslab from now, tomorrow", "put cs lab from now until ten thirty tomorrow", { now: at(21, 54) }, { intent: { verb: "add", day: "tomorrow", items: [{ issue: { kind: "from-now-not-today" } }] } }],
    ["cslab after midnight, until 1", "put cs lab from now until 1", { now: at(23, 30) }, { intent: { verb: "add", items: [{ start: "23:30" }] } }],
    ["cslab the 20:00 log (not a change)", "im not at the gym, im just doing cs lab right now, prob finish right before annika", { now: at(21, 0) }, { refused: "not-a-request" }],
    ["cslab the review question", "I'm can kill you. Orion, I'm going to die. I can't…", { now: at(21, 3) }, { refused: "not-a-request" }],
    ["cslab just leave it", "just leave it", { now: at(21, 4) }, { refused: "unparsed" }],
];
describe("every phrasing from the three audits", () => {
    it.each(AUDITS)("%s: %j", (_label, message, ctx, want) => {
        expect(read(message, ctx)).toMatchObject(want);
    });
});
// ---- earlier review rounds ----
const REPLAN_POSITIVES = [
    ["replan my evening, gym first", { order: ["gym"], home: false }],
    ["after class do gym then resume", { order: ["gym", "resume"], anchor: "class", home: false }],
    ["move everything after lab, gym first", { order: ["gym"], anchor: "lab", home: false }],
    ["reschedule my day, put gym first after I get home, then finish resume", { order: ["gym", "finish resume"], home: true }],
    ["Replan the rest of my day: gym first, then resume, then dinner", { order: ["gym", "resume", "dinner"], home: false }],
    ["Orion, can you reschedule my day after my marketing class, gym first after I get home?", { order: ["gym"], anchor: "marketing class", home: true }],
    ["when I get home do gym then resume", { order: ["gym", "resume"], home: true }],
    ["can u reschedule my day after marketing, gym first", { order: ["gym"], anchor: "marketing" }],
    ["reschedule my day, put gym first", { order: ["gym"] }],
    ["reschedule my day after marketing gym first", { order: ["gym"], anchor: "marketing" }],
    ["ok so please can you replan my evening, gym first", { order: ["gym"] }],
    ["can you reschedule my day after class, gym first?", { order: ["gym"], anchor: "class" }],
    ["resched my day gim first", { order: ["gym"] }],
    ["reschdule my evening, gim first", { order: ["gym"] }],
    ["can u rescheudle my evening gym first then resume", { order: ["gym", "resume"] }],
    ["replan my evening gym first", { order: ["gym"] }],
    ["pls reschedual my day gym frist", { order: ["gym"] }],
    ["reschedule the rest of my day, gym first then resume", { order: ["gym", "resume"] }],
    // a length he gives an item is kept with it (the follow-up the 9b reply suggests)
    ["reschedule tomorrow after my first class, do dinner for 30 min then gym", { order: ["dinner", "gym"], anchor: "first class", lengths: { dinner: 30 } }],
];
const REPLAN_NEGATIVES = [
    // day-replan.test.ts "leaves to the form"
    "gym first", "what should I do first after class?", "put gym at 6 after class, then resume", "reschedule my day", "after class I'll do gym", "wake me first thing tomorrow after class",
    // day-replan.test.ts "fires nothing"
    "should I do gym first after class", "what if I put gym first after class", "don't put gym first after my class", "I rescheduled my day, gym first",
    "do not reschedule my day, gym first is fine", "I was going to reschedule my day, gym first, but never mind", "should I do gym first after class?",
    "I'm thinking of rescheduling my day, gym first", "maybe replan my evening, gym first", "could I reschedule my day after class with gym first",
    "I wonder whether to replan my evening, gym first", "reschedule my day after class, gym first - just kidding", "wanna reschedule my day, gym first? jk",
    "never reschedule my day, gym first always", "no reschedule my day, gym first", "she said reschedule my day, gym first", "imagine i reschedule my day after class, gym first",
    "rescheduling my day after class, gym first, was a mistake yesterday", "reschedule my day, gym first lol", "reschedule my day after class, gym first. actually no",
    "reschedule my day after class, gym first, ugh no forget about it", "reschedule my day after class, gym first? or is that dumb", "reschedule my day? nah, gym first is fine as is",
    "put gym first after class, she told me", "reschedule my day after class, gym first, hmm", "reschedule my day after class, gym first idk", "he said reschedule my day after class, gym first",
    "nvm, reschedule my day, gym first", "did you reschedule my day, gym first?",
    // live-as-nick.test.ts typos that still fire nothing
    "resched my day gim first lol", "reschdule my day, gym first, nvm", "i resched my day gim first", "should i resched my day gim first", "resched my day? gym first",
    "she said resched my day, gym first", "resched my day, gim frist, nvrmind", "resched my day, gim frist lmaoo", "resched my day, gim frist, my coach sayd",
    "reschedule my day, gym first, i dunno", "reschedule my day, gym first or whatever, idc", "reschedule my day, gym first nevermnd", "reschedule my day, gym first, nvm",
    "reschedule my day, gym first, whatever",
    // the handoff's follow-up refusals (2026-10-20 late)
    "reschedule my day, gym first unless it rains", "reschedule my day, gym first if it's not raining", "reschedule my day, gym first, decide later", "reschedule my day, gym first kiddin",
    "reschedule my day, gym first jkjk", "reschedule my day, gym first i guess", "reschedule my day, gym first meh",
];
describe("review rounds: the replans that fire", () => {
    it.each(REPLAN_POSITIVES)("%j", (message, want) => {
        expect(read(message, { now: at(16, 16) })).toMatchObject({ intent: { verb: "replan", replan: want } });
    });
});
describe("review rounds: never an intent", () => {
    it.each(REPLAN_NEGATIVES)("%j is refused", (message) => {
        expect(read(message, { now: at(16, 16) })).toHaveProperty("refused");
    });
});
describe("follow-ups to the remembered request (live-as-nick.test.ts §3)", () => {
    it.each([
        ["actually do resume before gym", ["resume", "gym"]],
        ["put resume first, then gym", ["resume", "gym"]],
        ["ok do resume then gym", ["resume", "gym"]],
    ])("%j reorders it", (message, order) => {
        expect(read(message, { now: at(20, 57), last: LAST_TODAY })).toMatchObject({ intent: { verb: "reorder", replan: { order } } });
    });
    it.each(["dinner then gym", "ok dinner then gym", "nah dinner before gym", "actually do dinner before gym", "put dinner first, then gym"])("%j names something new: read as such, never a reorder", (message) => {
        expect(read(message, { now: at(20, 57), last: LAST_TODAY })).toMatchObject({ intent: { verb: "reorder", outside: ["dinner"] } });
    });
    it.each([["actually do resume before gym?", "question"], ["actually nah, resume before gym maybe", "doubt"], ["she said do resume before gym", "hearsay"]])("%j is not a reorder (%s)", (message, reason) => {
        expect(read(message, { now: at(20, 57), last: LAST_TODAY })).toMatchObject({ refused: reason });
    });
});
describe("adds, moves, extends and removes: one block, its clock resolved for the day", () => {
    it.each([
        ["can u put a 45 min walk tomorrow at 5", at(22, 46), { verb: "add", day: "tomorrow", items: [{ name: "walk", minutes: 45, start: "17:00" }] }],
        ["put a walk at 5", at(12), { verb: "add", day: "today", items: [{ name: "walk", start: "17:00" }] }],
        ["add a nap at 3", at(12), { verb: "add", items: [{ name: "nap", start: "15:00" }] }],
        ["add a nap at 3", at(16), { verb: "add", items: [{ name: "nap", issue: { kind: "passed", at: "15:00" } }] }],
        ["put gym at 9 tomorrow", at(15), { verb: "add", items: [{ name: "gym", issue: { kind: "ambiguous", choices: ["09:00", "21:00"] } }] }],
        ["put gym at 9 tomorrow morning", at(15), { verb: "add", items: [{ name: "gym", start: "09:00" }] }],
        ["put gym at 9 tonight", at(15), { verb: "add", day: "today", items: [{ name: "gym", start: "21:00" }] }],
        ["put gym at 9", at(15), { verb: "add", items: [{ name: "gym", start: "21:00" }] }],
        ["put gym at 9", at(7), { verb: "add", items: [{ name: "gym", start: "09:00" }] }],
        ["book a 30 min nap at 2:30pm", at(9), { verb: "add", items: [{ name: "nap", minutes: 30, start: "14:30" }] }],
        ["schedule reading for an hour at 17:00", at(9), { verb: "add", items: [{ name: "reading", minutes: 60, start: "17:00" }] }],
        ["put a 45 min walk tomorrow", at(15), { verb: "add", day: "tomorrow", items: [{ name: "walk", minutes: 45 }] }],
        ["move gym to 7", at(15), { verb: "move", items: [{ name: "gym", toSaid: "7" }] }], // read against the block (intent-run.ts)
        ["push dinner back 30 min", at(15), { verb: "move", items: [{ name: "dinner", by: 30 }] }],
        ["move reading 15 minutes earlier", at(15), { verb: "move", items: [{ name: "reading", by: -15 }] }],
        ["extend gym until 9", at(20), { verb: "extend", items: [{ name: "gym", endSaid: "9" }] }],
        ["extend the lab by 20 min", at(20), { verb: "extend", items: [{ name: "lab", minutes: 20 }] }],
        ["drop the walk tomorrow", at(15), { verb: "remove", day: "tomorrow", items: [{ name: "walk" }] }],
        ["cancel gym", at(15), { verb: "remove", items: [{ name: "gym" }] }],
    ])("%j at %s", (message, now, want) => {
        expect(read(message, { now })).toMatchObject({ intent: want });
    });
    it.each([
        ["remind me to call mom at 5", "unparsed"], // a reminder: reminder-flow.ts
        ["should i put gym at 5?", "question"],
        ["put gym at 5 lol", "take-back"],
        ["move lunch later", "unparsed"], // desk-invented-values: no time of his, the form asks
        ["move gym to 7 and push the resume back", "unparsed"], // two changes: the normal path
        ["put something small at 5", "unparsed"], // no name: the form asks what
        ["put gym friday at 5", "other-day"],
        ["add 45 mins of leetcode after my lab", "unparsed"], // an anchored add: the form's anchorFromMessage
        ["cancel that", "unparsed"], // undo's
        ["i go to the gym every morning, put it at 7 tomorrow", "unparsed"],
        ["put gym at 6 but only if i finish the essay", "not-a-request"],
    ])("%j is %s", (message, reason) => {
        expect(read(message, { now: at(12) })).toMatchObject({ refused: reason });
    });
    it("before 5 AM 'tomorrow' is not this layer's (the normal path asks which day)", () => {
        expect(read("put a walk tomorrow at 5", { now: at(0, 44) })).toMatchObject({ refused: "other-day" });
    });
});
describe("review of this layer (2026-10-20): sentences that must not write, or must write the right thing", () => {
    it.each([
        "Put CS lab until 10:30. Actually no, I'm too tired.",
        "Put CS lab until 10:30. Or is that too late?",
        "Put CS lab until 10:30. Actually make it 11.",
        "add gym at 6 thurs", "add gym at 6 fri", "put gym at 6 next month", "add lunch at 1 on the weekend", "add gym at 6 in two days", "put gym at 6 on the 25th",
        "put gym at 6 for now", "put gym at 6 just in case",
        "book a table at 7", "add a todo at 5", "put the lights on at 7", "put music on at 6",
    ])("%j is refused", (message) => {
        expect(read(message, { now: at(12) })).toHaveProperty("refused");
    });
    it("'morning' wins over the 1-6 PM rule", () => {
        expect(read("add a run tomorrow morning at 6", { now: at(15) })).toMatchObject({ intent: { verb: "add", day: "tomorrow", items: [{ name: "run", start: "06:00" }] } });
        expect(read("move gym to 5 tomorrow morning", { now: at(15) })).toMatchObject({ intent: { verb: "move", day: "tomorrow", items: [{ name: "gym", start: "05:00" }] } });
    });
    it("a follow-up that names another day is not a reorder of the remembered day", () => {
        expect(read("do gym before resume tomorrow", { now: at(20, 57), last: LAST_TODAY })).not.toMatchObject({ intent: { verb: "reorder" } });
        expect(read("gym before resume on friday", { now: at(20, 57), last: LAST_TODAY })).toHaveProperty("refused");
        expect(read("do resume before gym today", { now: at(20, 57), last: LAST_TODAY })).toMatchObject({ intent: { verb: "reorder" } });
    });
});
