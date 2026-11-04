// The 2026-10-31 gate run (evals/gate/run-1031133008): the calendar side of the chat route, with each item's exact message and paraphrases
// in Nick's style. Clusters 2 (natural defaults), 3 (reality statements), 8 (read-only questions), 10 (time and label parsing) + regressions.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWipe, readGymSkip } from "./anchor-guards.js";
import { readDayRequest } from "./day-requests.js";
import { asksDayRead, asksHabit, habitAnswer } from "./day-questions.js";
import { registerLocalRouting } from "./local-routing.js";
import { readReality } from "./reality.js";
import { leaveAsReminder, planReminder } from "./reminder-flow.js";
import { parseWake } from "./wake-flow.js";
import { attachBareTimes, cleanAddTitle, compile, repairStarts, runScheduleFlow } from "./schedule-flow.js";
import { parseCalendarIntent, pushAllMinutes } from "./calendar-intent.js";
import { planIntent, runsFirst } from "./intent-run.js";
const MKTG = { title: "MKTG2201 Introduction to Marketing — Lecture", start: "13:30", end: "15:30", fixed: true, kind: "class" };
const dayAt = (now, extra = []) => ({ date: "2026-11-02", now, blocks: [
        MKTG,
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
        ...extra,
    ].sort((a, b) => a.start.localeCompare(b.start)) });
const at = (hm) => { const [h, m] = hm.split(":").map(Number); return new Date(2026, 10, 2, h, m); }; // Monday 2 Nov 2026
function route(opts) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "gate31-"));
    const calls = [];
    const flows = [];
    const day = opts.day ?? dayAt(opts.now);
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => `Mon ${opts.now}`, now: () => at(opts.now),
        decideImpl: async () => opts.decide ?? { move: "escalate" }, brainSearch: async () => "",
        readDayJson: async (a) => (a.includes("tomorrow") ? opts.tomorrow ?? { date: "2026-11-03", now: null, blocks: [] } : day),
        readDay: async () => JSON.stringify(day),
        scheduleFlow: async (m) => { flows.push(m); return opts.flow ? opts.flow(m) : { outcome: "fallback", reason: "test" }; },
        realityRun: async (script, args) => { calls.push([script, ...args]); return { stdout: opts.out?.(script, args) ?? (script === "orion-declare" ? '{"id":"fact-abcd1234"}' : "Changed Monday 2026-11-02:\n  done"), code: opts.code?.(script, args) ?? 0 }; },
        ...(opts.stateDir ? { stateDir: opts.stateDir } : {}) });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `g31-${n += 1}`, sessionKey: "agent:main:orion-chat-gate31" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        return { exact, built };
    };
    return { turn, calls, flows, writes: () => calls.filter((c) => c[0] === "orion-reschedule" || c[0] === "orion-tasks") };
}
describe("cluster 2: a natural default is acted on and said back, never 'What time or how long do you mean?'", () => {
    it("sch-add-deadline-v 'i have a marketing quiz thursday i should prob study for it': a to-do due Thursday with two 1-hour sessions", async () => {
        const r = route({ now: "10:00", out: (s) => (s === "orion-tasks" ? 'Added "Study for marketing quiz" to Orion, due 2026-11-05.\nStudy for marketing quiz: 2026-11-03 60 min, 2026-11-04 60 min (due 2026-11-05)\n2026-11-03:\n  Changed Tuesday' : undefined) });
        const t = await r.turn("i have a marketing quiz thursday i should prob study for it");
        expect(r.writes()).toEqual([["orion-tasks", "add", "Study for marketing quiz", "--due", "thursday", "--spread", "2 60-minute blocks"]]);
        expect(t.exact).toMatch(/^Done: 2 study sessions before it: Tuesday \(60 min\) and Wednesday \(60 min\)\. I didn't know the time of the marketing quiz, so it's a to-do due Thursday/);
        expect(t.exact).not.toMatch(/What time or how long/);
        expect(r.flows).toEqual([]);
    });
    it.each([
        ["got a stats exam friday, need to revise for it", { title: "Stats exam", day: "friday", book: true }],
        ["theres an econ midterm next tuesday i gotta study for", { title: "Econ midterm", day: "tuesday", book: true }],
        ["i have a cs quiz tmrw", { title: "Cs quiz", day: "tomorrow", book: false }],
    ])("paraphrase: %s", (m, want) => expect(readDayRequest(m, at("10:00"))).toMatchObject({ kind: "deadline", ...want }));
    it("sch-add-deadline-c 'add marketing quiz thursday at 2pm and book two 1 hour study blocks for it before then': the quiz event and the sessions", async () => {
        const r = route({ now: "10:00", out: (s) => (s === "orion-tasks" ? 'Added "Study for marketing quiz" to Orion, due 2026-11-05.\nStudy for marketing quiz: 2026-11-03 60 min, 2026-11-04 60 min (due 2026-11-05)' : "Changed Thursday 2026-11-05:\n  added Marketing quiz 14:00–15:00") });
        const t = await r.turn("add marketing quiz thursday at 2pm and book two 1 hour study blocks for it before then");
        expect(r.writes()).toEqual([["orion-reschedule", "add", "Marketing quiz", "60", "--at", "14:00", "--fixed", "--date", "thursday"], ["orion-tasks", "add", "Study for marketing quiz", "--due", "thursday", "--spread", "2 60-minute blocks"]]);
        expect(t.exact).toMatch(/^Done: Marketing quiz is on Thursday at 2:00 PM\. 2 study sessions before it: Tuesday \(60 min\) and Wednesday \(60 min\)\./);
    });
    it("sch-gym-moved-later-v 'can we do gym later, like after dinner': gym goes to 8 PM, 90 minutes, and the assumption is said", async () => {
        const r = route({ now: "10:00", out: () => "Changed Monday 2026-11-02:\n  moved Gym: 17:00 → 20:00" });
        const t = await r.turn("can we do gym later, like after dinner");
        expect(r.writes()).toEqual([["orion-reschedule", "move", "Gym", "--to", "20:00"]]);
        expect(t.exact).toBe("Done: Gym moved to 8:00 PM–9:30 PM (I took after dinner as 8:00 PM; say a time if you meant another), still 90 minutes. Say \"undo\" to put it back.");
    });
    it("with a dinner on the day, 'after dinner' means after that dinner", async () => {
        const r = route({ now: "10:00", day: dayAt("10:00", [{ title: "dinner with Annika", start: "19:00", end: "21:00", fixed: true }]), out: () => "Changed:\n  moved Gym: 17:00 → 21:05" });
        await r.turn("push gym to after dinner");
        expect(r.writes()).toEqual([["orion-reschedule", "move", "Gym", "--after", "dinner with Annika"]]);
    });
    it.each([
        ["can we do gym later, like after dinner?", "after dinner"],
        ["lets do gym tonight instead", "tonight"],
        ["move my side project to after gym", "after gym"],
        ["i wanna do gym after marketing", "after marketing"],
    ])("paraphrase: %s", (m, when) => expect(readDayRequest(m, at("10:00"))).toMatchObject({ kind: "vague-move", when }));
    it("'later' alone asks one question, with the options, and writes nothing", async () => {
        const r = route({ now: "10:00" });
        const t = await r.turn("can we do gym later");
        expect(r.writes()).toEqual([]);
        expect(t.exact).toBe("Later to when? I can put Gym after dinner, around 8:00 PM, or tell me a time. Nothing's changed yet.");
    });
    it("loop-gym-ladder-ignored-c 'ill do gym tmrw morning': gym is booked tomorrow at 9 AM; today's, already over, is a slip", async () => {
        expect(readGymSkip("ill do gym tmrw morning")).toEqual({ kind: "tomorrow", at: "09:00", assumed: "morning", deferred: true });
        expect(readGymSkip("ok ill hit the gym tomorrow at 7am")).toEqual({ kind: "tomorrow", at: "07:00", deferred: true });
        const r = route({ now: "19:30", out: () => "Changed Tuesday 2026-11-03:\n  added Gym 09:00–10:30" });
        const t = await r.turn("ill do gym tmrw morning");
        expect(r.writes()).toEqual([["orion-reschedule", "add", "Gym", "90", "--at", "09:00", "--date", "tomorrow"]]);
        expect(t.exact).toBe("Booked: gym tomorrow at 9:00 AM, 90 minutes (I took morning as 9:00 AM). Today's 5:00 PM gym slipped; I'll come back to you when tomorrow's starts. Say \"undo\" to take it back.");
    });
    it.each(["not feeling it, ill do gym tmrw morning", "nah ill hit the gym tomorrow", "meh ill go to the gym tomorrow evening"])("REV2 8: %s at 8 AM, today's gym ahead: pushback and a question, nothing written", async (m) => {
        const r = route({ now: "08:00" });
        const t = await r.turn(m);
        expect(r.writes()).toEqual([]);
        expect(t.exact).toMatch(/^Today's gym is still on at 5:00 PM, and tomorrow has its own\. Keep today's .*30 minutes instead of 90.*Nothing's changed yet\.$/);
    });
    it("rea-task-twice-c 'econ problem set needs another hour, push whatever is after it': the block runs an hour longer", async () => {
        const day = dayAt("18:50", [{ title: "Econ problem set", start: "18:30", end: "19:30", fixed: false, kind: "study" }]);
        const r = route({ now: "18:50", day: { ...day, blocks: day.blocks.filter((b) => b.title !== "Gym") }, out: () => "Changed Monday:\n  moved side project: 19:30 → 20:30" });
        const t = await r.turn("econ problem set needs another hour, push whatever is after it");
        expect(r.writes()).toEqual([["orion-reschedule", "extend", "Econ problem set", "60"]]);
        expect(t.exact).toBe("Okay, Econ problem set now runs until 8:30 PM, and what's after it moved: moved side project: 7:30 PM → 8:30 PM. Say \"undo\" to put it back.");
    });
    it("rea-task-twice-v 'this econ set is taking forever': a stated 45-minute guess", async () => {
        const r = route({ now: "18:50", day: dayAt("18:50", [{ title: "Econ problem set", start: "18:30", end: "19:30", fixed: false, kind: "study" }]), out: () => "Changed Monday:\n  moved side project: 19:30 → 20:15" });
        const t = await r.turn("this econ set is taking forever");
        expect(r.writes()).toEqual([["orion-reschedule", "extend", "Econ problem set", "45"]]);
        expect(t.exact).toMatch(/now runs until 8:15 PM \(my guess is 45 minutes more; tell me if it needs longer\)/);
    });
    it.each(["the essay is taking way longer than i thought", "i need another hour on the essay", "essay needs 30 more min"])("paraphrase: %s", (m) => {
        expect(readReality(m, at("18:00"))?.reality).toMatchObject({ kind: "overrun", what: expect.stringMatching(/essay/) });
    });
    it("rea-meal-prep-c 'im meal prepping for like 40 min then ill do gym': gym starts when he is done", async () => {
        const r = route({ now: "19:45", day: dayAt("19:45", []).blocks ? { date: "2026-11-02", now: "19:45", blocks: [{ title: "Gym", start: "19:35", end: "21:05", fixed: false, kind: "gym" }] } : undefined, out: () => "Changed:\n  moved Gym: 19:35 → 20:25" });
        const t = await r.turn("im meal prepping for like 40 min then ill do gym");
        expect(r.writes()).toEqual([["orion-reschedule", "move", "Gym", "--to", "20:25"]]);
        expect(t.exact).toBe("Okay, meal prepping first. Gym now starts at 8:25 PM (8:25 PM–9:55 PM), so that's when I'll come back to you about it. Say \"undo\" to put it back.");
    });
});
describe("cluster 3: what happened is logged first, against the real day, then the rest moves", () => {
    it("rea-took-longer-gym-v 'just got back from the gym': gym logged as done, ending now, the assumption said", async () => {
        const r = route({ now: "19:00", out: () => "Changed Monday 2026-11-02:\n  logged Gym 17:00–19:00 (replaced Gym)\n  moved side project: 19:30 → 19:35" });
        const t = await r.turn("just got back from the gym");
        // From the planned start, so the log covers the planned block whole (a 17:30 start left a 17:00–17:30 sliver of the plan, demo 2026-10-31).
        expect(r.writes()).toEqual([["orion-reschedule", "log", "Gym", "--from", "17:00", "--to", "now", "--instead", "Gym"]]);
        expect(t.exact).toBe("Nice, Gym done: 5:00 PM–7:00 PM (I assumed it started at 5:00 PM as planned and ended just now; tell me the times if not). The rest of today moved: moved side project: 7:30 PM → 7:35 PM. Say \"undo\" to put it back.");
    });
    it("rea-took-longer-gym-c 'gym done, was 5:30 to 7, plan my evening': his times, then the evening", async () => {
        const r = route({ now: "19:00", out: (_s, a) => (a[0] === "fill" ? "Changed Monday:\n  added Dinner 19:05–19:50" : "Changed Monday:\n  logged Gym 17:30–19:00") });
        const t = await r.turn("gym done, was 5:30 to 7, plan my evening");
        expect(r.writes()).toEqual([["orion-reschedule", "log", "Gym", "--from", "17:30", "--to", "now", "--instead", "Gym"], ["orion-reschedule", "fill"]]);
        expect(t.exact).toMatch(/^Nice, Gym done: 5:30 PM–7:00 PM\. From now: added Dinner 7:05 PM–7:50 PM\./);
        expect(t.exact).not.toMatch(/removed|Exec failed/);
    });
    it.each(["finished the gym", "done with gym lol", "gym's done", "back from the gym finally", "i was at the gym"])("paraphrase: %s", (m) => {
        expect(readReality(m, at("19:00"))?.reality).toMatchObject({ kind: "done", what: "gym" });
    });
    it("rea-spontaneous-nap-v 'took a nap lol': the nap is logged with a stated guess and the day moves", async () => {
        const r = route({ now: "14:00", day: { date: "2026-11-02", now: "14:00", blocks: [{ title: "Study", start: "13:00", end: "14:30", fixed: false, kind: "study" }, { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }] }, out: () => "Changed:\n  logged Nap 13:15–14:00 (replaced Study)\n  re-entered Study: 14:05–14:35" });
        const t = await r.turn("took a nap lol");
        expect(r.writes()).toEqual([["orion-reschedule", "log", "Nap", "--from", "13:15", "--to", "now"]]);
        expect(t.exact).toBe("Logged your nap: 1:15 PM–2:00 PM (I assumed about 45 minutes, ending now; tell me if it was longer). The rest of today moved: re-entered Study: 2:05 PM–2:35 PM. Say \"undo\" to put it back.");
    });
    it("rea-spontaneous-nap-c 'i slept from 2 to 3:30pm, redo the rest of the day from now': his times, then the rest of the day", async () => {
        const r = route({ now: "15:35", out: (_s, a) => (a[0] === "fill" ? "Nothing to add: the day already has what it needs, and the rest stays free." : "Changed:\n  logged Nap 14:00–15:30") });
        const t = await r.turn("i slept from 2 to 3:30pm, redo the rest of the day from now");
        expect(r.writes()).toEqual([["orion-reschedule", "log", "Nap", "--from", "14:00", "--to", "15:30"], ["orion-reschedule", "fill"]]);
        expect(t.exact).toMatch(/^Logged your nap: 2:00 PM–3:30 PM\. The rest of the day already has what it needs\./);
    });
    it.each(["just had a quick nap", "fell asleep for a bit oops", "napped"])("paraphrase: %s", (m) => expect(readReality(m)?.reality).toMatchObject({ kind: "done", what: "nap" }));
    it("before 5 AM, last night's gym is found on yesterday's calendar and noted", async () => {
        const handlers = { read: [] };
        const r = route({ now: "01:30", day: { date: "2026-11-02", now: "01:30", blocks: [] } });
        await r.turn("gym done");
        // today's day has no gym and yesterday's read is the stub's today-day (no gym either): honest log of what he said
        expect(handlers.read).toEqual([]);
        expect(r.writes()[0]?.slice(0, 3)).toEqual(["orion-reschedule", "log", "Gym"]);
    });
    it("rea-class-actually-here-v 'i was literally in marketing': the missed mark comes off, apology, no excuse", async () => {
        const r = route({ now: "16:00", out: (s, a) => (s === "orion-declare" && a[0] === "list" ? JSON.stringify([{ id: "fact-miss0001", kind: "skip", title: MKTG.title, text: "didn't happen" }]) : s === "orion-declare" ? '{"id":"fact-note0001"}' : "") });
        const t = await r.turn("i was literally in marketing");
        expect(r.calls).toEqual([["orion-declare", "list"], ["orion-declare", "remove", "--id", "fact-miss0001"], expect.arrayContaining(["orion-declare", "add", "--kind", "note", "--title", MKTG.title])]);
        expect(t.exact).toBe("Sorry, my mistake. MKTG2201 counts as attended today; I took back the missed mark.");
    });
    it("rea-class-actually-here-c 'you said i missed marketing but i was there, fix it'", async () => {
        expect(readReality("you said i missed marketing but i was there, fix it")?.reality).toEqual({ kind: "attended", what: "marketing" });
        expect(readReality("i did go to marketing tho")?.reality).toMatchObject({ kind: "attended", what: "marketing" });
        expect(readReality("im at the library")).toMatchObject({ reality: { kind: "place" } });
    });
    it("rea-sick-c 'im sick, cancel gym and side project today, im still going to econ': both off, rest in, econ untouched", async () => {
        const r = route({ now: "08:00", out: (_s, a) => (a[0] === "add" ? "Changed Monday:\n  added Rest 17:00–18:00" : "Changed Monday:\n  dropped") });
        const t = await r.turn("im sick, cancel gym and side project today, im still going to econ");
        expect(r.writes()).toEqual([["orion-reschedule", "drop", "Gym"], ["orion-reschedule", "drop", "side project"], ["orion-reschedule", "add", "Rest", "60"]]);
        expect(t.exact).toBe("Feel better. Done — took Gym (5:00 PM) off, took side project (7:30 PM) off and put an hour of rest in (5:00 PM–6:00 PM). Econ stays on. Say \"undo\" to revert.");
    });
    it("rea-exhausted-c 'add a 30 min nap at 4 today and cut side project tonight im wrecked'", async () => {
        const r = route({ now: "13:00", out: (_s, a) => (a[0] === "add" ? "Changed Monday:\n  added nap 16:00–16:30" : "Changed Monday:\n  dropped side project") });
        const t = await r.turn("add a 30 min nap at 4 today and cut side project tonight im wrecked");
        expect(r.writes()).toEqual([["orion-reschedule", "add", "Nap", "30", "--at", "16:00", "--length-explicit"], ["orion-reschedule", "drop", "side project"]]);
        // REV2 7: wrecked is tired, not ill (no "Feel better." and no rest block added).
        expect(t.exact).toBe("Done — nap 4:00 PM–4:30 PM and took side project (7:30 PM) off. Say \"undo\" to revert.");
    });
    it("hea-sleep-adjust-c 'only slept 4 and a half hours, add a nap after class and cut side project': the nap after class, the side project off", async () => {
        expect(readDayRequest("only slept 4 and a half hours, add a nap after class and cut side project", at("10:00"))).toMatchObject({ kind: "clauses", clauses: [{ verb: "add", name: "nap", after: "class" }, { verb: "remove", names: ["side project"] }] });
        const r = route({ now: "10:00", out: (_s, a) => (a[0] === "add" ? "Changed Monday:\n  added nap 15:35–16:05" : "Changed Monday:\n  dropped side project") });
        const t = await r.turn("only slept 4 and a half hours, add a nap after class and cut side project");
        expect(r.writes()).toEqual([["orion-reschedule", "add", "Nap", "30", "--after", MKTG.title], ["orion-reschedule", "drop", "side project"]]);
        expect(t.exact).toMatch(/^Done — nap 3:35 PM–4:05 PM and took side project \(7:30 PM\) off\./);
    });
    it("without a health reason, dropping gym in a combination is the gym guard's, never a silent drop", () => {
        expect(readDayRequest("cancel gym and side project today", at("10:00"))).toBeNull();
        expect(readGymSkip("cancel gym and side project today")).toBeNull();
        expect(readDayRequest("drop side project and reading tonight", at("10:00"))).toMatchObject({ kind: "clauses", clauses: [{ verb: "remove", names: ["side project", "reading"] }] });
    });
    it("rea-friends-invite-c 'going to get food with annika from 5 to 7, move gym to after': the plan with her, then gym after it", async () => {
        const r = route({ now: "16:30", out: (_s, a) => (a[0] === "add" ? "Changed Monday:\n  added food with annika 17:00–19:00" : "Changed Monday:\n  moved Gym: 17:00 → 19:05") });
        const t = await r.turn("going to get food with annika from 5 to 7, move gym to after");
        expect(r.writes()).toEqual([["orion-reschedule", "add", "Food with annika", "120", "--at", "17:00", "--fixed", "--length-explicit"], ["orion-reschedule", "move", "Gym", "--after", "food with annika"]]);
        expect(t.exact).toMatch(/^Done — food with annika 5:00 PM–7:00 PM and Gym moved to 7:05 PM/);
    });
    it("rea-didnt-go-class-c 'i skipped marketing, put 1 hour of catch up on it tomorrow evening': the skip noted, the catch-up booked", async () => {
        const r = route({ now: "15:45", out: (s) => (s === "orion-declare" ? '{"id":"fact-skip0001"}' : "Changed Tuesday:\n  added MKTG2201 catch-up 19:00–20:00") });
        const t = await r.turn("i skipped marketing, put 1 hour of catch up on it tomorrow evening");
        expect(r.calls[0]).toEqual(expect.arrayContaining(["orion-declare", "add", "--kind", "skip", "--title", MKTG.title]));
        expect(r.writes()).toEqual([["orion-reschedule", "add", "MKTG2201 catch-up", "60", "--at", "19:00", "--date", "tomorrow", "--length-explicit"]]);
        expect(t.exact).toBe("Noted you skipped MKTG2201. Booked MKTG2201 catch-up tomorrow 7:00 PM–8:00 PM, 60 minutes (I took evening as 7:00 PM). Say \"undo\" to put it back.");
    });
    it("rea-work-on-it-tomorrow-c 'move finish resume to tomorrow at 10am, 45 min': booked tomorrow first, today's off after", async () => {
        const r = route({ now: "21:00", day: dayAt("21:00", [{ title: "finish resume", start: "21:30", end: "22:15", fixed: false, kind: "other" }]), out: (_s, a) => (a[0] === "add" ? "Changed Tuesday:\n  added finish resume 10:00–10:45" : "Changed Monday:\n  dropped finish resume") });
        const t = await r.turn("move finish resume to tomorrow at 10am, 45 min");
        expect(r.writes()).toEqual([["orion-reschedule", "add", "finish resume", "45", "--at", "10:00", "--date", "tomorrow", "--length-explicit"], ["orion-reschedule", "drop", "finish resume"]]);
        expect(t.exact).toBe("Done: Finish resume is on tomorrow, 10:00 AM–10:45 AM, 45 minutes and off today (it was 9:30 PM). Say \"undo\" to put it back.");
    });
    it.each(["ill do the resume tomorrow", "im gonna finish my essay tmrw morning", "push reading to tomorrow"])("paraphrase: %s", (m) => expect(readDayRequest(m, at("21:00"))).toMatchObject({ kind: "to-tomorrow" }));
    it("'tomorrow' before 5 AM is not read here (the normal path asks which day)", () => expect(readDayRequest("ill do the resume tomorrow", at("01:00"))).toBeNull());
    it("sch-no-class-c 'i dont have marketing or macro today, both are cancelled, use the time' with neither on the day: said, not 'only 10 minutes between'", async () => {
        const r = route({ now: "10:00", day: { date: "2026-11-02", now: "10:00", blocks: [{ title: "finish resume", start: "11:00", end: "12:00", fixed: false }] } });
        const t = await r.turn("i dont have marketing or macro today, both are cancelled, use the time");
        expect(r.writes()).toEqual([]);
        expect(t.exact).toBe("Marketing and Macro aren't on today's calendar, so there was nothing to cancel and nothing changed.");
    });
});
describe("cluster 8: a read-only question is answered, never 'I couldn't make that change'", () => {
    it("sch-whats-today-c 'list everything on my calendar today with times' goes to the day read, not the change flow", async () => {
        expect(asksDayRead("list everything on my calendar today with times")).toBe(true);
        expect(asksDayRead("show me my schedule for tomorrow")).toBe(true);
        expect(asksDayRead("read me my day")).toBe(true);
        expect(asksDayRead("show me how to move gym")).toBe(false);
        const r = route({ now: "10:00" });
        const t = await r.turn("list everything on my calendar today with times");
        expect(r.flows).toEqual([]);
        expect(t.built?.systemPrompt).toMatch(/Answer his question from this list only/);
        expect(t.built?.systemPrompt).toMatch(/MKTG2201/);
    });
    it("hea-gym-streak-v 'have i been going to the gym': answered from what was tracked, read-only", async () => {
        expect(asksHabit("have i been going to the gym")).toBe("gym");
        expect(asksHabit("how many times did i go to the gym this week")).toBe("gym");
        expect(asksHabit("have i actually been studying")).toBe("study");
        const dir = mkdtempSync(join(tmpdir(), "gate31-hist-"));
        const row = (d, happened) => JSON.stringify({ at: new Date(2026, 9, d, 18).toISOString(), what: "Gym", kind: "gym", plannedStart: 1020, actualStart: happened ? 1025 : null });
        writeFileSync(join(dir, "life-history.jsonl"), [row(27, true), row(28, false), row(29, true), row(30, true), row(31, false), row(20, true)].join("\n"));
        expect(habitAnswer("gym", dir, at("20:00"))).toBe("In the last 7 days gym happened on 3 of the 5 days it was planned (Tue, Thu, Fri); it didn't on Wed, Sat.");
        const r = route({ now: "20:00", stateDir: dir, decide: { move: "tool", tool: "agenda", args: { day: "today" } } });
        const t = await r.turn("have i been going to the gym");
        expect(t.exact).toMatch(/^Gym in the last 7 days: 3 of 7 days \(Tue, Thu, Fri\)/); // wave 4: health-log.ts answers it (union of workouts, plan history, logged)
        expect(r.flows).toEqual([]);
    });
    it("nothing tracked is said honestly", () => expect(habitAnswer("gym", mkdtempSync(join(tmpdir(), "gate31-none-")), at("20:00"))).toMatch(/^I don't have gym tracked for the last week/));
});
describe("cluster 10: days, times, alarms and labels", () => {
    it("cha-phone-call-c 'orion remind me to call my mom on sunday at 6': Sunday 6 PM, not Saturday", async () => {
        const sat = new Date(2026, 9, 31, 13, 30);
        const plan = await planReminder({ message: "orion remind me to call my mom on sunday at 6", now: sat, extract: async () => ({ time: "18:00", label: "call my mom" }), list: async () => [] });
        expect(plan).toMatchObject({ kind: "call", at: "2026-11-01T18:00", reply: "I'll remind you Sunday at 6:00 PM to call my mom." });
        const next = await planReminder({ message: "remind me to pay rent next monday at 9am", now: at("10:00"), extract: async () => ({ time: "09:00", label: "pay rent" }), list: async () => [] });
        expect(next).toMatchObject({ at: "2026-11-09T09:00" });
    });
    it("loop-leave-nudge-c 'ill leave at 1:05 for marketing': a leave reminder at 1:05 PM, today", async () => {
        expect(leaveAsReminder("ill leave at 1:05 for marketing")).toBe("remind me to leave for marketing at 1:05");
        expect(leaveAsReminder("im leaving at 6 for the gym")).toBe("remind me to leave for gym at 6");
        expect(leaveAsReminder("i'll leave whenever")).toBeUndefined();
        const plan = await planReminder({ message: leaveAsReminder("ill leave at 1:05 for marketing"), now: at("12:47"), extract: async () => ({ time: "01:05", label: "leave for marketing" }), list: async () => [] });
        expect(plan).toMatchObject({ kind: "call", at: "2026-11-02T13:05", reply: "I'll remind you at 1:05 PM to leave for marketing." });
        const direct = await planReminder({ message: "remind me to leave at 1:05", now: at("12:47"), extract: async () => ({ time: "01:05", label: "leave" }), list: async () => [] });
        expect(direct).toMatchObject({ at: "2026-11-02T13:05" });
    });
    it("loop-leave-nudge-c on the route: the reminder call is made, never a bare 'Got it'", async () => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const dir = mkdtempSync(join(tmpdir(), "gate31-leave-"));
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => "Mon 12:47", now: () => at("12:47"),
            decideImpl: async () => ({ move: "escalate", tier: "quick" }), brainSearch: async () => "", extractReminder: async (m) => ({ time: "13:05", label: /marketing/.test(m) ? "leave for marketing" : "leave" }), listReminders: async () => [] });
        const ctx = { runId: "leave-1", sessionKey: "agent:main:orion-chat-leave" };
        for (const fn of handlers.get("before_model_resolve") ?? [])
            await fn({ prompt: "ill leave at 1:05 for marketing" }, ctx);
        let built;
        for (const fn of handlers.get("before_prompt_build") ?? [])
            built = (await fn({ prompt: "ill leave at 1:05 for marketing", messages: [] }, ctx));
        expect(built?.systemPrompt).toMatch(/alarm_set/);
        expect(built?.systemPrompt).toMatch(/2026-11-02T13:05/);
        expect(built?.systemPrompt).toMatch(/I'll remind you at 1:05 PM to leave for marketing\./);
    });
    it("sch-alarm-push-c 'move tomorrow morning alarm from 8 to 9am' is the wake alarm, set to 9:00, never a reminder", () => {
        expect(parseWake("move tomorrow morning alarm from 8 to 9am", { move: "escalate" }, at("22:00"))).toEqual({ kind: "set", time: "09:00" });
        expect(parseWake("push tmrw alarm to 10am", undefined, at("22:00"))).toEqual({ kind: "set", time: "10:00" });
    });
    it("labels never keep his verb: 'book' and 'of youtube editing'", () => {
        expect(cleanAddTitle("book")).toBe("something");
        expect(cleanAddTitle("of youtube editing")).toBe("youtube editing");
        expect(cleanAddTitle("book club")).toBe("book club");
        expect(cleanAddTitle("Study for CS Midterm")).toBe("Study for CS Midterm");
        const day = dayAt("15:50");
        expect(compile({ do: "add", what: "book", minutes: 60 }, { ...day, now: null, date: "2026-11-03" }, "yes book 1 hour tomorrow after gym")).toMatchObject({ say: "ask", text: "What should I put after Gym?" });
    });
    it("loop-morning-brief-c 'do the oyster card first thing, 9am, resume at 4': the oyster card at 9:00, not 6:37 PM", () => {
        expect(attachBareTimes("do the oyster card first thing, 9am, resume at 4")).toBe("do the oyster card first thing at 9am, resume at 4");
        expect(repairStarts("do the oyster card first thing at 9am, resume at 4", [["add", "oyster card", "30"], ["move", "Study for CS Midterm", "--to", "16:00"]], { day: "today", now: 8 * 60 }))
            .toEqual([["add", "oyster card", "30", "--at", "09:00"], ["move", "Study for CS Midterm", "--to", "16:00"]]);
    });
    it("loop-calendar-question-reply-c 'moved to 8pm tonight': the block he is in now moves (Study), never Gym", async () => {
        const r = route({ now: "14:30", day: dayAt("14:30", [{ title: "Study for CS Midterm", start: "14:00", end: "15:00", fixed: false, kind: "study" }]).blocks.length ? { date: "2026-11-02", now: "14:30", blocks: [{ title: "Study for CS Midterm", start: "14:00", end: "15:00", fixed: false, kind: "study" }, { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }] } : undefined, out: () => "Changed:\n  moved Study for CS Midterm: 14:00 → 20:00" });
        const t = await r.turn("moved to 8pm tonight");
        expect(r.writes()).toEqual([["orion-reschedule", "move", "Study for CS Midterm", "--to", "20:00"]]);
        expect(t.exact).toMatch(/^Done: Study for CS Midterm is now 8:00 PM–9:00 PM \(I took "it" to be Study for CS Midterm, the block you're in now/);
    });
    it("sch-before-class-v 'before my class' with no class left: a plain no, never a block at 6:37 PM", () => {
        const sat = { date: "2026-10-31", now: "13:30", blocks: [{ title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }] };
        expect(compile({ do: "add", what: "quick study", minutes: 30 }, sat, "can you throw in something before my class, like a quick study thing")).toEqual({ say: "cannot", text: "There's no class left to put it before today." });
    });
});
describe("regressions: push everything", () => {
    it.each([
        ["push everything back like an hour", 60], // sch-fixed-plan-protect-v
        ["push all your blocks back an hour but leave classes and dinner where they are", 60], // sch-fixed-plan-protect-c
        ["move all my stuff back about 30 min", 30],
        ["push my blocks an hour later, keep classes", 60],
    ])("%s → every block of his ahead, by %i minutes", (m, by) => {
        expect(pushAllMinutes(m)).toBe(by);
        expect(runsFirst(parseCalendarIntent(m, { now: at("10:00") }))).toBe(true);
    });
    it("classes and a plan with a person stay; his blocks move in one day --plan", () => {
        const day = dayAt("10:00", [{ title: "dinner with Annika", start: "19:00", end: "21:00", fixed: true }]);
        const plan = planIntent(parseCalendarIntent("push all your blocks back an hour but leave classes and dinner where they are", { now: at("10:00") }), day, { message: "" });
        expect(plan).toMatchObject({ kind: "run", argv: ["day", "--plan", "Gym, 90, 18:00", "--plan", "side project, 60, 20:30"] });
    });
    it("not a push: 'dont push everything back an hour'", () => expect(pushAllMinutes("dont push everything back an hour")).toBeNull());
});
describe("regressions", () => {
    it("saf-wipe-calendar-c 'clear all my ORION blocks this week but leave classes and anything with people': only ORION's blocks, day by day", async () => {
        expect(isWipe("clear all my ORION blocks this week but leave classes and anything with people")).toBe(false);
        expect(isWipe("just wipe my week and start over")).toBe(true);
        const r = route({ now: "10:00", out: () => "Changed Monday:\n  cleared 2 prior schedule blocks: Gym, side project\nWritten to his calendar." });
        const t = await r.turn("clear all my ORION blocks this week but leave classes and anything with people");
        expect(r.writes().map((c) => c.slice(1))).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"].map((d) => ["clear", "--date", d]));
        expect(t.exact).toMatch(/^Cleared my own blocks for today through Sunday: today \(2\), Tuesday \(2\)/);
        expect(t.exact).toMatch(/Classes and plans with people are untouched\./);
    });
    it.each(["wipe your blocks for today, keep my classes", "clear the orion stuff tomorrow"])("paraphrase: %s", (m) => expect(readDayRequest(m, at("10:00"))).toMatchObject({ kind: "clear-owned" }));
    it("sch-gym-moved-later-c 'move gym to 8:30pm today' still goes to the code-run move (the fit check is the scheduler's)", async () => {
        const r = route({ now: "10:00", flow: () => ({ outcome: "done", calls: ["exec orion-reschedule move Gym --to 20:30"], outputs: ["Changed:\n  moved Gym: 17:00 → 20:30"], reply: "Done: Gym is now 8:30 PM–10:00 PM." }) });
        const t = await r.turn("move gym to 8:30pm today");
        expect(r.flows).toEqual(["move gym to 8:30pm today"]);
        expect(t.exact).toBe("Done: Gym is now 8:30 PM–10:00 PM.");
    });
});
describe("schedule flow: the form's misreads are typed declines or offers, never blamed on him", () => {
    const day = dayAt("10:00");
    const flow = (message, steps) => {
        const writes = [];
        return runScheduleFlow({ message, clock: "Mon 10:00", now: at("10:00"), exec: async (a) => { if (a[0] === "show")
                return { stdout: JSON.stringify(day), code: 0 }; writes.push(a); return { stdout: "Changed:\n  moved", code: 0 }; }, ask: async () => ({ steps: steps }) }).then((r) => ({ r, writes }));
    };
    it("a time the form chose when he gave none becomes one offer he can say yes to (nothing written)", async () => {
        const { r, writes } = await flow("can we shift the side project around a bit", [{ do: "move", what: "B3", to: "21:00" }]);
        expect(writes).toEqual([]);
        expect(r).toMatchObject({ outcome: "say", kind: "ask", text: "You didn't give a time, so here's my pick: move side project to 9:00 PM. Go ahead? I haven't changed anything yet.", pending: { kind: "push", argvs: [["move", "side project", "--to", "21:00", "--date", "2026-11-02"]] } });
    });
    it("a drop of a block he never named is declined, not 'there's no such block'", async () => {
        const { r, writes } = await flow("ugh this day is a mess", [{ do: "drop", what: "B3" }]);
        expect(writes).toEqual([]);
        expect(r).toMatchObject({ outcome: "fallback", reason: expect.stringMatching(/^declined: /) });
    });
});
