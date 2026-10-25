// 2026-10-25 day-plan incident (docs/audits/2026-10-25-day-plan-false-positive.md). The UK clocks went back at 02:00; at 13:05 GMT Nick wrote
// "only doing two things today. Study for CS Midterm from now until 6pm. then i go back home. once im home i work on marketing presentation
// until 12 am." The worker wrote `resize "Study for CS Midterm" 300` (14:00–19:00) and `move "AE1 Marketing Presentation" --to 24:00`
// (refused), the other blocks cascaded into the evening, and the reply said "Done".
// Fixtures only: his day as `show --json` gave it (undo journal), a stub scheduler that records writes, no model (the form throws).
// Nothing here reads or writes his calendar or ~/.openclaw.
process.env.TZ = "Europe/London";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { readIntent } from "./calendar-intent.js";
import { parseDayPlan, planDayPlan, dayPlanReply } from "./day-plan.js";
import { parseClock, resolveEnd } from "./intent-time.js";
import { runScheduleFlow } from "./schedule-flow.js";
import { endMismatch, statedEnds, timeMismatch, writtenEnds } from "./time-backstop.js";
const SENTENCE = "only doing two things today. Study for CS Midterm from now until 6pm. then i go back home. once im home i work on marketing presentation until 12 am.";
const VARIANTS = [
    "im only doing two things today: study till 6 then head home and do marketing till midnight",
    "only 2 things today: cs midterm til 6, then marketing at home till 12",
    "Only doing 2 things today, study for cs midterm from now till 6pm, then go home and work on marketing presentation till midnight",
];
const PLAN = ["day", "--plan", "Study for CS Midterm, 295, 13:05", "--plan", "AE1 Marketing Presentation, 315, 18:45", "--only"];
const b = (title, start, end, kind = "study", fixed = false) => ({ title, start, end, fixed, kind });
// His day before the change (reschedule-undo.json, 2026-10-25T13:05:37Z), GMT.
const before = (date, extra = []) => ({
    date, now: "13:05", plan: { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] },
    blocks: [
        b("practice leetcode", "10:30", "11:30"), b("finish resume", "11:35", "13:05", "other"), b("AE1 Marketing Presentation", "13:10", "13:55"),
        b("Study for CS Midterm", "14:00", "15:00"), b("Go over Orion learning plan", "15:05", "16:05", "side_project"), b("DS Lab 05", "16:10", "16:55"),
        b("Gym", "17:00", "18:30", "gym"), ...extra,
    ].sort((x, y) => x.start.localeCompare(y.start)),
});
// What the scheduler leaves after `day --plan … --only` (tests/reschedule-day-only.test.mjs proves the script side).
const after = (d) => ({ ...d, blocks: [
        ...d.blocks.filter((x) => x.fixed || x.end <= "13:05"),
        b("Study for CS Midterm", "13:05", "18:00"), b("AE1 Marketing Presentation", "18:45", "00:00"),
    ].sort((x, y) => x.start.localeCompare(y.start)) });
const OUT = "Changed Sunday 2026-10-25:\n  cleared 6 prior schedule blocks: AE1 Marketing Presentation, Study for CS Midterm, Go over Orion learning plan, DS Lab 05, Gym\n  DROPPED (he said only what he named today): Go over Orion learning plan, DS Lab 05, Gym\n  planned Study for CS Midterm: 13:05–18:00\n  planned AE1 Marketing Presentation: 18:45–00:00\nWritten to his calendar. \"orion-reschedule undo\" puts it back.";
const DAYS = [
    ["DST day 2026-10-25 (clocks went back at 02:00)", new Date(2026, 9, 25, 13, 5), "2026-10-25"],
    ["an ordinary Sunday 2026-10-18", new Date(2026, 9, 18, 13, 5), "2026-10-18"],
];
async function flow(message, opts) {
    const writes = [];
    let wrote = false;
    let asked = 0;
    let top = 0;
    const result = await runScheduleFlow({ message, clock: "Sun 13:05", now: opts.now, undoTop: () => `t${top}`,
        ask: async () => { asked += 1; if (!opts.steps)
            throw new Error("the form must not be asked"); return { steps: opts.steps }; },
        exec: async (a) => {
            if (a[0] === "show")
                return { stdout: JSON.stringify(wrote ? opts.afterDay ?? after(opts.day) : opts.day), code: 0 };
            writes.push(a);
            const out = typeof opts.out === "string" ? opts.out : OUT;
            if (!/^usage|NOTHING/.test(out)) {
                wrote = true;
                top += 1;
            }
            return { stdout: out, code: /^usage|NOTHING/.test(out) ? 1 : 0 };
        } });
    return { result, writes, asked };
}
describe("1. his whole-day plan is read by code (intent-time + day-plan), never the worker", () => {
    it("the exact sentence: two things, his ends, home in between", () => {
        expect(parseDayPlan(SENTENCE)).toEqual({ items: [
                { name: "Study for CS Midterm", endSaid: "6pm", fromSaid: "now", home: false },
                { name: "marketing presentation", endSaid: "12 am", home: true },
            ] });
        expect(readIntent(SENTENCE, { now: DAYS[0][1] })).toMatchObject({ intent: { verb: "dayplan", day: "today" } });
    });
    it.each(VARIANTS)("variant in his style: %j", (m) => {
        const read = parseDayPlan(m);
        expect(read?.items).toHaveLength(2);
        expect(read?.items[1]).toMatchObject({ home: true });
    });
    for (const [label, now, date] of DAYS) {
        describe(label, () => {
            it("one scheduler call: Study now–18:00, the trip home (45 min), Marketing 18:45–midnight, the rest of ORION's day off", async () => {
                const { writes, asked } = await flow(SENTENCE, { now, day: before(date) });
                expect(asked).toBe(0);
                expect(writes).toEqual([PLAN]);
            });
            it.each(VARIANTS)("%j writes the same plan", async (m) => {
                const { writes } = await flow(m, { now, day: before(date) });
                expect(writes).toEqual([PLAN]);
            });
            it("the reply is code's, read back from his calendar: what is on, what came off, and that gym is skipped (one line, no question)", async () => {
                const { result } = await flow(SENTENCE, { now, day: before(date) });
                expect(result).toMatchObject({ outcome: "done", reply: "Done: Study for CS Midterm 1:05–6:00 PM, then home, then AE1 Marketing Presentation 6:45 PM–12:00 AM. I took Go over Orion learning plan, DS Lab 05 off the rest of today. Gym is skipped today, since you said only these two things." });
            });
        });
    }
    it("a calendar that does not read back as he asked is never 'Done': what he asked, what is there, and undo", async () => {
        const wrong = { ...before("2026-10-25"), blocks: before("2026-10-25").blocks.filter((x) => !["Go over Orion learning plan", "DS Lab 05", "Gym"].includes(x.title))
                .map((x) => (x.title === "Study for CS Midterm" ? { ...x, end: "19:00" } : x)) };
        const { result } = await flow(SENTENCE, { now: DAYS[0][1], day: before("2026-10-25"), afterDay: wrong });
        const reply = result.reply;
        expect(reply).not.toMatch(/\bDone\b/);
        expect(reply).toBe("Not done as you asked: you asked for Study for CS Midterm 1:05–6:00 PM, but your calendar has Study for CS Midterm 2:00–7:00 PM; you asked for AE1 Marketing Presentation 6:45 PM–12:00 AM, but your calendar has AE1 Marketing Presentation 1:10–1:55 PM. Say \"undo\" to put your day back.");
    });
    it("a refused write is said as refused, nothing claimed", async () => {
        const { result } = await flow(SENTENCE, { now: DAYS[0][1], day: before("2026-10-25"), out: "NOTHING WAS CHANGED: must-haves could not fit: Study for CS Midterm." });
        expect(result.outcome).toBe("say");
        expect(JSON.stringify(result)).not.toMatch(/Done/);
    });
});
describe("1b. negatives: a question, a hedge, a take-back, hearsay, a past report or another day never triggers it", () => {
    it.each([
        "only doing two things today. study till 6 then marketing till 12am?",
        "should i only do study till 6 then marketing till midnight",
        "maybe only study till 6 then marketing till midnight",
        "i might just study till 6 then do marketing till midnight",
        "only study till 6 then marketing till midnight idk",
        "only study till 6 then marketing till midnight, or whatever",
        "only study till 6 then marketing till midnight jk",
        "only study till 6 then marketing till midnight nvm",
        "my mom said only study till 6 then marketing till midnight",
        "i only did study till 6 then marketing till midnight",
        "only study till 6 tomorrow then marketing till midnight",
        "what if i only study till 6 then marketing till midnight",
        "don't only study till 6 then marketing till midnight",
        "just put cs lab until 10:30", // one add: the "put X until T" shape, not a whole-day plan
        "study till 6 then marketing till midnight", // no "only/just": not a statement about the WHOLE day
        // review of this fix: a bare "just" is not "only these today" (it would clear the rest of his day)
        "I'm just gonna study until 5 then do laundry until 7",
        "studying until 5, then just reading until 7",
        "just study until 5 and essay until 7",
    ])("%j", async (m) => {
        expect(parseDayPlan(m)).toBeUndefined();
        const read = readIntent(m, { now: DAYS[0][1] });
        expect("intent" in read && read.intent.verb === "dayplan").toBe(false);
    });
    it("a question writes nothing", async () => {
        const { writes } = await flow("only doing two things today. study till 6 then marketing till 12am?", { now: DAYS[0][1], day: before("2026-10-25"), steps: [] });
        expect(writes).toEqual([]);
    });
});
describe("2. the stated-time backstop checks ENDS on every write path, resize included", () => {
    const day = before("2026-10-25");
    const WORKER = [["resize", "Study for CS Midterm", "300"], ["move", "AE1 Marketing Presentation", "--to", "24:00"]];
    it("root cause: 'until 6pm' is an end, and the old check read starts only (and never resize)", () => {
        expect(statedEnds(SENTENCE).map((e) => e.options)).toEqual([[1080], [1440]]);
        expect(writtenEnds(WORKER[0], day)).toEqual([{ title: "Study for CS Midterm", end: 1140 }]);
    });
    it("the worker's incident writes are refused before anything runs", () => {
        expect(timeMismatch(SENTENCE, WORKER, { day: "today", now: 785, blocks: day })).toBe("You said Study for CS Midterm until 6:00 PM, but the change I worked out would have ended it at 7:00 PM, so I haven't changed anything. Say it again and I'll end it at 6:00 PM.");
    });
    it("per write too (the worker's own exec is checked one command at a time)", () => {
        expect(endMismatch(SENTENCE, [WORKER[0]], day)).toMatch(/7:00 PM/);
        expect(endMismatch(SENTENCE, [["day", "--plan", "AE1 Marketing Presentation, 315, 18:45"]], day)).toBeUndefined();
    });
    it("the right plan passes", () => {
        expect(timeMismatch(SENTENCE, [PLAN], { day: "today", now: 785, blocks: day })).toBeUndefined();
    });
    it("through the form path (no 'only', so the worker fills the form): nothing is written", async () => {
        const steps = [{ do: "resize", what: "B4", minutes: 300 }, { do: "move", what: "B3", to: "24:00" }];
        const { result, writes } = await flow("Study for CS Midterm from now until 6pm then marketing presentation until 12 am", { now: DAYS[0][1], day, steps });
        expect(writes).toEqual([]);
        expect(result).toMatchObject({ outcome: "say", kind: "ask" });
        expect(result.text).toMatch(/^You said Study for CS Midterm until 6:00 PM/);
    });
    it.each([
        ["my class runs until 5, add gym at 6", ["add", "Gym", "90", "--at", "18:00"]],
        ["I have lab until 4, then add lab report", ["add", "Lab report", "60", "--at", "16:05"]],
        ["I'm in class till 5, put reading after", ["add", "Reading", "30", "--at", "17:05"]],
    ])("an end of something else he is busy with is not the written block's: %j", (m, argv) => {
        expect(endMismatch(m, [argv], day)).toBeUndefined();
    });
    it("a block that ends at midnight (show prints 00:00) has its real length", () => {
        expect(writtenEnds(["move", "Late", "--to", "22:00"], { ...day, blocks: [b("Late", "23:00", "00:00")] })).toEqual([{ title: "Late", end: 1380 }]);
    });
});
describe("3. 'until 12 am' / 'till midnight' is the end of today, never a booking across midnight", () => {
    it.each(["12 am", "12am", "midnight", "00:00"])("%j ends at 24:00 from 18:45", (t) => {
        expect(resolveEnd(parseClock(t), 18 * 60 + 45, { day: "today", now: 785 })).toEqual({ at: 1440 });
    });
    it("a bare 'till 12' from the afternoon is midnight too", () => {
        expect(resolveEnd(parseClock("12"), 18 * 60 + 45, { day: "today", now: 785 })).toEqual({ at: 1440 });
    });
    it("but 'till 12:45' at 12:10 is 12:45 PM (noon is not behind the start)", () => {
        expect(resolveEnd(parseClock("12:45"), 12 * 60 + 10, { day: "today", now: 730 })).toEqual({ at: 765 });
    });
    it("'put cs lab from now until 12am' at 23:00 books until midnight", async () => {
        const day = { date: "2026-10-25", now: "23:00", blocks: [] };
        const writes = [];
        await runScheduleFlow({ message: "put cs lab from now until 12am", clock: "x", now: new Date(2026, 9, 25, 23, 0), ask: async () => null,
            exec: async (a) => { if (a[0] !== "show")
                writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : "Changed:", code: 0 }; } });
        expect(writes).toEqual([["add", "cs lab", "60", "--at", "23:00"]]);
    });
    it("the start of the second thing is the end of the first + his trip home (life-config commuteMinutes 45)", () => {
        const plan = planDayPlan(parseDayPlan(SENTENCE), before("2026-10-25"));
        expect(plan.items.map((i) => [i.title, i.start, i.end])).toEqual([["Study for CS Midterm", 785, 1080], ["AE1 Marketing Presentation", 1125, 1440]]);
    });
});
describe("4. a turn with a failed or partial write never says 'Done'", () => {
    it("the incident's own shape (resize wrote, the move failed) is said as partial, from his calendar", async () => {
        // A message the backstop has nothing to check against, so the two writes run and the second fails.
        const steps = [{ do: "resize", what: "B4", minutes: 300 }, { do: "move", what: "B3", to: "13:10" }];
        const writes = [];
        let top = 0;
        let wrote = false;
        const day = before("2026-10-25");
        const result = await runScheduleFlow({ message: "make study for cs midterm 300 minutes and move marketing presentation to 1:10pm", clock: "Sun 13:05", now: DAYS[0][1],
            undoTop: () => `t${top}`, ask: async () => ({ steps }),
            exec: async (a) => {
                if (a[0] === "show")
                    return { stdout: JSON.stringify(wrote ? { ...day, blocks: day.blocks.map((x) => (x.title === "Study for CS Midterm" ? { ...x, end: "19:00" } : x)) } : day), code: 0 };
                writes.push(a);
                if (a[0] === "resize") {
                    wrote = true;
                    top += 1;
                    return { stdout: "Changed Sunday 2026-10-25:\n  Study for CS Midterm is now 300 min: 14:00–19:00\n  moved Go over Orion learning plan: 15:05 → 19:05", code: 0 };
                }
                return { stdout: "usage: orion-reschedule move \"<title>\" --to HH:MM", code: 2 };
            } });
        expect(writes.map((w) => w[0])).toEqual(["resize", "move"]);
        const reply = result.reply;
        expect(reply).not.toMatch(/\bDone\b/);
        expect(reply).toBe("Only part of that went through, so it isn't done as you asked. What changed on your calendar: Study for CS Midterm moved from 2:00 PM–3:00 PM to 2:00 PM–7:00 PM. Not done: I couldn't make that change. Say \"undo\" to put it back.");
    });
});
describe("5. ownership: only ORION's blocks come off; a class or a plan with people never moves", () => {
    const now = DAYS[0][1];
    it("his own events, classes and plans with people are not cleared or listed", async () => {
        const extra = [b("CS2100 Lecture", "08:00", "09:00", "class", true), { ...b("Dentist", "09:30", "10:00", "other", true), nameable: true }, b("Dinner with Sam", "07:00", "07:30", "social", true)];
        const plan = planDayPlan(parseDayPlan(SENTENCE), before("2026-10-25", extra));
        expect(plan.cleared.map((x) => x.title)).toEqual(["Go over Orion learning plan", "DS Lab 05", "Gym"]);
    });
    it("a plan with people ORION booked itself (it reads fixed:false) never comes off, and is in the way like any other", async () => {
        const dinner = b("Dinner with Maya", "20:00", "21:00", "meal");
        const plan = planDayPlan(parseDayPlan("only doing two things today: study till 6 then marketing till 7:30pm"), before("2026-10-25", [dinner]));
        expect(plan.cleared.map((x) => x.title)).not.toContain("Dinner with Maya");
        const { writes, result } = await flow(SENTENCE, { now, day: before("2026-10-25", [dinner]) });
        expect(writes).toEqual([]);
        expect(result).toMatchObject({ outcome: "say", text: "Dinner with Maya is 8:00–9:00 PM, so AE1 Marketing Presentation can't run 6:45 PM–12:00 AM. I haven't changed anything." });
    });
    it("a class in the way of what he asked: nothing is written, he is told", async () => {
        const day = before("2026-10-25", [b("CS2100 Lecture", "15:00", "16:00", "class", true)]);
        const { result, writes } = await flow(SENTENCE, { now, day });
        expect(writes).toEqual([]);
        expect(result).toMatchObject({ outcome: "say", text: "CS2100 Lecture is 3:00–4:00 PM, so Study for CS Midterm can't run 1:05–6:00 PM. I haven't changed anything." });
    });
    it("naming a class as one of the things: it doesn't move", async () => {
        const day = before("2026-10-25", [b("Marketing Lecture", "19:00", "20:00", "class", true)]);
        const { result, writes } = await flow("only two things today: cs midterm til 6, then marketing lecture till midnight", { now, day });
        expect(writes).toEqual([]);
        expect(JSON.stringify(result)).toMatch(/class or a plan with people/);
    });
    it("gym he names himself stays, and nothing says it was skipped", () => {
        const plan = planDayPlan(parseDayPlan("only doing two things today: study till 6 then gym till 8pm"), before("2026-10-25"));
        expect(plan.anchorsCleared).toEqual([]);
        expect(dayPlanReply({ ...before("2026-10-25"), blocks: [b("Study for CS Midterm", "13:05", "18:00"), b("Gym", "18:05", "20:00", "gym")] }, plan)).not.toMatch(/skipped/);
    });
});
describe("routing: the incident turn (typed, with ORION's outreach line in front) is code's, and its reply is the flow's own line", () => {
    // The prompt as the session transcript has it (13b97188, 2026-10-25T13:05:38Z).
    const PROMPT = `[ORION context: you messaged him first, 1 min ago: "Session done. Next: AE1 Marketing Presentation at 1:10 PM.". This message MAY be his answer.]\n[Orion app context — factual state supplied by the native app]\nFocus session: inactive.\n\nUser message:\n${SENTENCE}`;
    it.each([
        ["the plan went through", { outcome: "done", calls: ["exec orion-reschedule day …"], outputs: [OUT], reply: "Done: Study for CS Midterm 1:05–6:00 PM, then home, then AE1 Marketing Presentation 6:45 PM–12:00 AM." }],
        ["only part went through", { outcome: "done", partial: true, calls: ["a", "b"], outputs: ["Changed:", "usage: x"], reply: "Only part of that went through, so it isn't done as you asked. Say \"undo\" to put it back." }],
    ])("%s: the desk is never asked, and the worker's own words are replaced by the flow's", async (_label, flowResult) => {
        const handlers = new Map();
        let desk = 0;
        const flows = [];
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "dayplan-")), "r.jsonl"),
            brainSearch: async () => "", clock: () => "Sun 13:05", now: () => DAYS[0][1], decideImpl: async () => { desk += 1; return { move: "escalate" }; },
            scheduleFlow: async (m) => { flows.push(m); return flowResult; } });
        const c = { runId: "r1", sessionKey: "agent:main:orion-chat-dayplan" };
        for (const f of handlers.get("before_model_resolve") ?? [])
            await f({ prompt: PROMPT }, c);
        for (const f of handlers.get("before_prompt_build") ?? [])
            await f({ prompt: PROMPT, messages: [] }, c);
        let finalized;
        for (const f of handlers.get("before_agent_finalize") ?? [])
            finalized = (await f({ sessionId: "s", lastAssistantMessage: "Done: Study for CS Midterm is now 300 minutes. Not done: I couldn't make that change.", model: "m", messages: [] }, c)) ?? finalized;
        expect(desk).toBe(0);
        expect(flows).toEqual([SENTENCE]);
        expect(JSON.stringify(finalized)).toContain(JSON.stringify(flowResult.reply).slice(1, 60));
    });
});
// ---- independent review of the branch (2026-10-25): each phrase exactly as the review gave it ----
describe("review CRITICAL 1: only HIS explicit whole-day plan clears anything; nothing odd is booked", () => {
    const now = DAYS[0][1];
    it.each([
        "my friend is only doing two things today. study from now until 6pm. then home, marketing until 12 am",
        "he is only doing two things today. study from now until 6pm. then home, marketing until 12 am",
        "she's only doing study until 6pm then marketing until 12 am",
        "only study until 6, then marketing until midnight",
        "only study until 6 then gym till 8",
        "the lab only runs until 4 and then section until 6",
        "only doing two things today. not study until 6pm. then marketing until 12 am",
        "I'd only be doing two things today: study until 6pm then marketing until 12 am",
        "just gonna study till 6 then head home and do marketing till midnight",
    ])("%j: not a whole-day plan, nothing written by code", async (m) => {
        expect(parseDayPlan(m)).toBeUndefined();
        const read = readIntent(m, { now });
        expect("intent" in read && read.intent.verb === "dayplan").toBe(false);
        // Whatever else reads it, nothing is cleared (no --only) and nothing is titled after a pronoun, "not" or "only".
        const { writes } = await flow(m, { now, day: before("2026-10-25"), steps: [] });
        expect(writes.flat().join(" ")).not.toMatch(/--only/);
        expect(writes.map((w) => w[1] ?? "").join("|")).not.toMatch(/^(?:she'?s|he|i'?d|not|only)\b|\|(?:she'?s|he|i'?d|not|only)\b/i);
    });
    it.each([
        "im only doing two things today: study till 6 then marketing till midnight",
        "just these two today: study till 6, then marketing till midnight",
        "study till 6, then marketing till midnight. thats it for today",
    ])("%j: his explicit whole-day phrasing is still read", (m) => {
        expect(parseDayPlan(m)?.items).toHaveLength(2);
    });
});
describe("review HIGH 2: the worker's own exec of the incident write is refused (the day is read first)", () => {
    const PROMPT = `User message:\n${SENTENCE}`;
    async function workerExec(command, readDayJson) {
        const handlers = new Map();
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "dayplan-exec-")), "r.jsonl"),
            brainSearch: async () => "", clock: () => "Sun 13:05", now: () => DAYS[0][1], decideImpl: async () => ({ move: "escalate" }),
            // The flow falls back, as it did live (the worker then wrote the change itself).
            scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), ...(readDayJson ? { readDayJson } : {}) });
        const c = { runId: "w1", sessionKey: "agent:main:orion-chat-exec" };
        for (const f of handlers.get("before_model_resolve") ?? [])
            await f({ prompt: PROMPT }, c);
        for (const f of handlers.get("before_prompt_build") ?? [])
            await f({ prompt: PROMPT, messages: [] }, c);
        const results = [];
        for (const f of handlers.get("before_tool_call") ?? [])
            results.push(await f({ toolName: "exec", params: { command } }, c));
        return results.find((r) => r && r.block);
    }
    // The incident's exact write, as the worker's exec line would carry it.
    const RESIZE = '~/Desktop/ORION/scripts/orion-reschedule resize "Study for CS Midterm" 300';
    it("with his day read: blocked, and the reason names 7:00 PM against his 6:00 PM", async () => {
        const r = await workerExec(RESIZE, async () => before("2026-10-25"));
        expect(r?.block).toBe(true);
        expect(r?.blockReason).toMatch(/You said Study for CS Midterm until 6:00 PM, but the change I worked out would have ended it at 7:00 PM/);
    });
    it("without a day to read: the end cannot be worked out, so it is blocked too", async () => {
        const r = await workerExec(RESIZE);
        expect(r?.block).toBe(true);
        expect(r?.blockReason).toMatch(/couldn't work out when the change would end it/);
    });
    it("the right write is not blocked", async () => {
        const r = await workerExec(`orion-reschedule day --plan "Study for CS Midterm, 295, 13:05" --plan "AE1 Marketing Presentation, 315, 18:45" --only`, async () => before("2026-10-25"));
        expect(r).toBeUndefined();
    });
});
describe("review MEDIUM 6: a single call that only partly fits never opens with 'Done'", () => {
    it("not-done first, then what changed", async () => {
        const { spokenReply } = await import("./schedule-reply.js");
        const out = "Changed Sunday 2026-10-25:\n  planned Study: 13:05–14:05\n  NOT BOOKED: Laundry (60 min) did not fit on Sunday — ask whether to drop it or put it on another day (--date YYYY-MM-DD)";
        expect(spokenReply([out])).toBe("Partly done. Not done: Laundry didn't fit. What did change: Study 1:05 PM–2:05 PM.");
    });
});
describe("review MEDIUM 7: the end check matches the block exactly, not a shared word", () => {
    const day = { date: "2026-10-25", now: "13:05", blocks: [b("Study", "14:00", "15:00"), b("Study Lab", "16:00", "17:00")] };
    it("'make study go until 6 and move study lab to 7' does not hold the Study Lab move to 6", () => {
        expect(timeMismatch("make study go until 6 and move study lab to 7", [["move", "Study Lab", "--to", "19:00"]], { day: "today", now: 785, blocks: day })).toBeUndefined();
    });
    it("…but the Study write it names is still checked", () => {
        expect(endMismatch("make study go until 6 and move study lab to 7", [["resize", "Study", "300"]], day)).toMatch(/until 6:00 AM or 6:00 PM/);
        expect(endMismatch("make study go until 6 and move study lab to 7", [["resize", "Study", "240"]], day)).toBeUndefined();
    });
});
describe("review LOW 8: a named block already under way keeps its start", () => {
    it("Study 12:00–13:30, under way at 13:05: planned 12:00–18:00, not restarted at 13:05", () => {
        const d = { ...before("2026-10-25"), blocks: [b("Study for CS Midterm", "12:00", "13:30"), b("AE1 Marketing Presentation", "14:00", "15:00")] };
        const plan = planDayPlan(parseDayPlan(SENTENCE), d);
        expect(plan.args).toEqual(["day", "--plan", "Study for CS Midterm, 360, 12:00", "--plan", "AE1 Marketing Presentation, 315, 18:45", "--only"]);
    });
});
describe("review LOW 9: the clause an end belongs to starts after the whole boundary word", () => {
    it("'… then marketing until midnight' is 'marketing', not 'hen marketing'", () => {
        expect(statedEnds("study till 6 then marketing until midnight").map((e) => e.words)).toEqual([["study"], ["marketing"]]);
    });
});
describe("review LOW 10: a single block over 12 hours is asked about, never booked", () => {
    it("'study from now until 12 am' at 09:05: the form's add of 895 minutes is not run", async () => {
        const d = { date: "2026-10-25", now: "09:05", blocks: [] };
        const writes = [];
        const r = await runScheduleFlow({ message: "study from now until 12 am", clock: "Sun 09:05", now: new Date(2026, 9, 25, 9, 5), ask: async () => ({ steps: [{ do: "add", what: "study", to: "09:05", until: "24:00" }] }),
            exec: async (a) => { if (a[0] !== "show")
                writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(d) : "Changed:", code: 0 }; } });
        expect(writes).toEqual([]);
        expect(JSON.stringify(r)).toMatch(/over 12 hours\. Is that right\?/);
    });
});
describe("review LOW 11: 'Done' only when every cleared block is gone, every plan exact and nothing else moved", () => {
    const plan = () => planDayPlan(parseDayPlan(SENTENCE), before("2026-10-25"));
    it("a cleared block still on: not Done", () => {
        const a = after(before("2026-10-25"));
        const still = { ...a, blocks: [...a.blocks, b("Gym", "17:00", "18:30", "gym")] };
        expect(dayPlanReply(still, plan(), undefined, before("2026-10-25"))).toMatch(/^Not done as you asked: Gym should have come off but is still on/);
    });
    it("another block moved: not Done", () => {
        const a = after(before("2026-10-25"));
        const moved = { ...a, blocks: a.blocks.map((x) => (x.title === "finish resume" ? { ...x, start: "11:40", end: "13:10" } : x)) };
        expect(dayPlanReply(moved, plan(), undefined, before("2026-10-25"))).toMatch(/^Not done as you asked: .*finish resume moved from 11:35 AM–1:05 PM to 11:40 AM–1:10 PM, which you didn't ask for/);
    });
    it("all three hold: Done", () => {
        expect(dayPlanReply(after(before("2026-10-25")), plan(), undefined, before("2026-10-25"))).toMatch(/^Done: /);
    });
});
