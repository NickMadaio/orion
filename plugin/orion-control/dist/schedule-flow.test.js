import { describe, expect, it } from "vitest";
import { FORM_PROMPT, blockList, compile, intentSchema, runScheduleFlow, setPlaces, spokenReply, summarize } from "./schedule-flow.js";
// His real Monday, 2026-10-12, at 13:06 (DS already happened).
const monday = {
    date: "2026-10-12", now: "13:06",
    blocks: [
        { title: "CS2100 Program Design & Implementation 1 — Lecture", start: "09:00", end: "10:30", fixed: true },
        { title: "CS1800 Discrete Structures — Lecture", start: "11:00", end: "12:30", fixed: true },
        { title: "CS2101 Lab for Program Design & Implementation 1", start: "15:30", end: "17:10", fixed: true },
        { title: "do cert courses", start: "17:50", end: "21:50", fixed: false },
    ],
};
describe("schedule flow", () => {
    it("numbers the whole day, marking fixed and already-happened blocks", () => {
        const list = blockList(monday);
        expect(list).toMatch(/^B1 09:00–10:30 CS2100 .* \(FIXED\) \(already happened\)$/m);
        expect(list).toMatch(/^B3 15:30–17:10 CS2101 .* \(FIXED\)$/m);
    });
    it("block references can only be today's real ids", () => {
        const schema = intentSchema(monday);
        expect(schema.properties.steps.items.properties.after.enum).toEqual(["B1", "B2", "B3", "B4"]);
    });
    it("'cert courses the entire time between DS and the lab' compiles to one exact move — start from now when DS is over, end 5 before the lab", () => {
        expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, monday)).toEqual({ args: ["move", "do cert courses", "--to", "13:10", "--until", "15:25"] });
        const morning = { ...monday, now: "08:00" };
        expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "12:35", "--until", "15:25"] });
        // "cert courses" names the block already there, so it moves rather than duplicating it.
        expect(compile({ do: "fill_between", what: "cert courses", after: "B2", before: "B3" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "12:35", "--until", "15:25"] });
        expect(compile({ do: "fill_between", what: "gym", after: "B2", before: "B3" }, morning)).toEqual({ args: ["add", "gym", "170", "--at", "12:35", "--before", "15:30"] });
    });
    it("refuses what it cannot compile instead of guessing, and says no when there is no room", () => {
        expect(compile({ do: "fill_between", what: "B4", after: "B9", before: "B3" }, monday)).toMatchObject({ error: expect.any(String) });
        expect(compile({ do: "drop", what: "B1" }, monday)).toMatchObject({ error: expect.stringMatching(/movable|does not move/) });
        const late = { ...monday, now: "15:20" };
        expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, late)).toMatchObject({ say: "cannot" });
    });
    it("titles with & are passed as one argv item (no shell), so they reach the scheduler intact", () => {
        expect(compile({ do: "swap", what: "B4", with: "B3" }, monday)).toEqual({ args: ["swap", "do cert courses", "CS2101 Lab for Program Design & Implementation 1"] });
    });
    it("the reply comes only from what the scheduler printed", () => {
        expect(summarize(["Changed Monday 2026-10-12:\n  do cert courses moved: 17:50 → 13:10–15:25\nWritten to his calendar."], []).reply).toBe("do cert courses moved: 17:50 → 13:10–15:25");
        expect(summarize(["NOTHING WAS CHANGED: do cert courses would run 12:35–08:55, which is not a real block"], []).changed).toBe(false);
    });
    it("a move from one block's end to another's start is treated as fill_between (buffers added)", () => {
        const morning = { ...monday, now: "08:00" };
        expect(compile({ do: "move", what: "B4", to: "12:30", until: "15:30" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "12:35", "--until", "15:25"] });
        expect(compile({ do: "move", what: "B4", to: "13:00", until: "14:00" }, morning)).toEqual({ args: ["move", "do cert courses", "--to", "13:00", "--until", "14:00"] });
    });
    it("adding something already on his day is refused (drop + add of the same block is a move)", () => {
        expect(compile({ do: "add", what: "cert courses", minutes: 240 }, monday)).toMatchObject({ error: expect.stringMatching(/move it/) });
    });
    // 2026-10-15 sweep q043: "add a todo to email prof…" became add "email prof…" 0 — a block with no length.
    it("an add shorter than 5 minutes is refused", () => {
        expect(compile({ do: "add", what: "email prof about office hours by thurs", minutes: 0 }, monday)).toMatchObject({ error: expect.stringMatching(/minutes/) });
        expect(compile({ do: "add", what: "stretch", minutes: 4 }, monday)).toMatchObject({ error: expect.any(String) });
        expect(compile({ do: "add", what: "stretch", minutes: 5 }, monday)).toEqual({ args: ["add", "stretch", "5"] });
    });
    it("runs the fixed sequence: read the day, one form, exact argv to the scheduler; falls back on anything it cannot compile", async () => {
        const calls = [];
        const exec = async (args) => { calls.push(args); return args[0] === "show" ? { stdout: JSON.stringify({ ...monday, now: "08:00" }), code: 0 } : { stdout: "Changed Monday:\n  do cert courses moved: 17:50 → 12:35–15:25\nWritten to his calendar.", code: 0 }; };
        const done = await runScheduleFlow({ message: "cert courses between DS and the lab", clock: "Mon 08:00", exec, ask: async () => ({ steps: [{ do: "fill_between", what: "B4", after: "B2", before: "B3" }] }) });
        expect(done).toMatchObject({ outcome: "done" });
        expect(calls[1]).toEqual(["move", "do cert courses", "--to", "12:35", "--until", "15:25"]);
        expect(await runScheduleFlow({ message: "x", clock: "Mon 08:00", exec, ask: async () => ({ steps: [{ do: "fill_between", what: "B4", after: "B9", before: "B3" }] }) })).toMatchObject({ outcome: "fallback" });
        expect(await runScheduleFlow({ message: "x", clock: "Mon 08:00", exec, ask: async () => ({ steps: [{ do: "cannot", text: "no room" }] }) })).toEqual({ outcome: "say", text: "no room", kind: "cannot" });
        expect(await runScheduleFlow({ message: "move it tomorrow", clock: "Mon 08:00", now: new Date(2026, 9, 12, 8, 0), exec, ask: async () => ({ steps: [{ do: "move", what: "B4", to: "18:00" }] }) })).toMatchObject({ outcome: "done" });
        expect(calls.at(-1)).toEqual(["move", "do cert courses", "--to", "18:00", "--date", "tomorrow"]);
    });
    it("rejects block ids that do not exist, anchors used as the thing to place, and moving a class", () => {
        const today = { ...monday, blocks: monday.blocks.slice(0, 3) }; // no cert courses block today
        expect(compile({ do: "fill_between", what: "B4", after: "B2", before: "B3" }, today)).toMatchObject({ error: expect.stringMatching(/not a block/) });
        expect(compile({ do: "fill_between", what: "B3", after: "B2", before: "B3" }, today)).toMatchObject({ error: expect.any(String) });
        expect(compile({ do: "move", what: "B3", to: "13:15", until: "15:25" }, today)).toMatchObject({ error: expect.stringMatching(/does not move/) });
        expect(compile({ do: "fill_between", what: "cert courses", after: "B2", before: "B3" }, { ...today, now: "13:14" })).toEqual({ args: ["add", "cert courses", "130", "--at", "13:15", "--before", "15:30"] });
    });
    it("a form that breaks a rule gets one correction round with the rule it broke", async () => {
        const exec = async (args) => (args[0] === "show" ? { stdout: JSON.stringify({ ...monday, now: "08:00" }), code: 0 } : { stdout: "Changed:\n  do cert courses moved: 17:50 → 12:35–15:25", code: 0 });
        const asked = [];
        const answers = [{ steps: [{ do: "move", what: "B3", to: "13:00" }] }, { steps: [{ do: "fill_between", what: "B4", after: "B2", before: "B3" }] }];
        const result = await runScheduleFlow({ message: "cert courses between DS and lab", clock: "Mon 08:00", exec, ask: async (_s, user) => { asked.push(user); return answers[asked.length - 1] ?? null; } });
        expect(asked[1]).toMatch(/broke a rule: .*does not move/);
        expect(result).toMatchObject({ outcome: "done" });
    });
    it("'after my lab I'm going to Spit, 15 min commute, then four things' — commute invisible, first thing at arrival", () => {
        const day = { ...monday, now: "13:30" };
        expect(compile({ do: "plan", after: "B3", where: "Spit", travel: 15, items: [{ title: "go over marketing presentation", minutes: 45 }, { title: "student oyster card", minutes: 15 }, { title: "research backpacking stuff" }, { title: "practice leetcode", minutes: 60 }] }, day))
            .toEqual({ args: ["day", "--plan", "go over marketing presentation, 45, 17:25", "--plan", "student oyster card, 15", "--plan", "research backpacking stuff, 45", "--plan", "practice leetcode, 60"] });
        // No commute stated: a known place's travel time is used; unknown → just his 5-minute buffer.
        setPlaces({ spitalfields: 15 });
        expect(compile({ do: "plan", after: "B3", where: "Chapter Spitalfields", items: [{ title: "leetcode", minutes: 60 }] }, day)).toEqual({ args: ["day", "--plan", "leetcode, 60, 17:25"] });
        expect(compile({ do: "plan", after: "B3", where: "somewhere new", items: [{ title: "leetcode", minutes: 60 }] }, day)).toEqual({ args: ["day", "--plan", "leetcode, 60, 17:15"] });
        expect(compile({ do: "plan", after: "B3", items: [] }, day)).toMatchObject({ error: expect.any(String) });
    });
    it("the spoken reply is built from the scheduler's lines, in order, with 12-hour times", () => {
        const out = "Changed Monday 2026-10-12:\n  rebuilt the remaining day\n  planned go over my marketing presentation: 17:15–18:00\n  planned practice leet code: 19:15–20:15";
        expect(spokenReply([out])).toBe("Done: go over my marketing presentation 5:15 PM–6:00 PM; practice leet code 7:15 PM–8:15 PM.");
        expect(spokenReply(["Changed:\n  do cert courses moved: 17:50 → 12:35–15:25"])).toBe("Done: do cert courses now 12:35 PM–3:25 PM.");
        expect(spokenReply(["NOTHING WAS CHANGED: moving it would break the day rules — overlaps Macro"])).toMatch(/^Not done: moving it would break/);
    });
    it("'clear my schedule after the lab' compiles to drop --after the lab", () => {
        expect(compile({ do: "clear_after", after: "B3" }, monday)).toEqual({ args: ["drop", "--after", "CS2101 Lab for Program Design & Implementation 1"] });
    });
    it("'push it back half an hour' is a by-shift computed by code; 'skip' on his own block drops it", () => {
        expect(compile({ do: "move", what: "B4", by: 30 }, monday)).toEqual({ args: ["move", "do cert courses", "--to", "18:20"] });
        expect(compile({ do: "skip", what: "B4" }, monday)).toEqual({ args: ["drop", "do cert courses"] });
        expect(compile({ do: "skip", what: "B3" }, monday)).toEqual({ args: ["skip", "CS2101 Lab for Program Design & Implementation 1"] });
    });
    // 2026-10-15, 12:12, in "finish resume": "I'm gonna start meal prepping in about thirty minutes… put [it]
    // from twelve forty five to one forty five and then push everything else to kinda follow that".
    const thursday = { date: "2026-10-15", now: "12:12", blocks: [
            { title: "CS1800 Discrete Structures — Lecture", start: "09:00", end: "10:30", fixed: true },
            { title: "finish resume", start: "11:20", end: "12:50", fixed: false },
            { title: "DS Lab", start: "12:55", end: "13:40", fixed: false },
            { title: "CS Lab", start: "13:45", end: "14:30", fixed: false },
            { title: "Review spending", start: "14:35", end: "15:20", fixed: false },
        ] };
    it("'meal prep from 12:45 to 1:45' is one add with a start and an end — code works out the minutes", () => {
        expect(compile({ do: "add", what: "meal prep", to: "12:45", until: "13:45" }, thursday)).toEqual({ args: ["add", "meal prep", "60", "--at", "12:45"] });
        expect(compile({ do: "add", what: "meal prep", to: "13:45", until: "12:45" }, thursday)).toMatchObject({ error: expect.any(String) });
    });
    it("the form is told the scheduler slides the rest, so it never moves the following blocks itself", () => {
        expect(FORM_PROMPT).toMatch(/meal prep.*"to":"12:45","until":"13:45"/);
        expect(FORM_PROMPT).toMatch(/never move the blocks after it yourself/i);
    });
    it("says the block he was in was cut short, and where the rest went", () => {
        const out = "Changed Thursday 2026-10-15:\n  rebuilt the remaining day\n  finish resume now ends at 12:35\n  moved DS Lab: 12:55 → 13:55\n  moved CS Lab: 13:45 → 14:50\n  moved Review spending: 14:35 → 15:45\n  planned meal prep: 12:45–13:45";
        expect(spokenReply([out])).toBe("Done: meal prep 12:45 PM–1:45 PM; finish resume ends at 12:35 PM; DS Lab now 1:55 PM; CS Lab now 2:50 PM; Review spending now 3:45 PM.");
        const many = ["a", "b", "c", "d"].map((t, i) => `  moved ${t}: 1${i}:00 → 1${i + 1}:00`).join("\n");
        expect(spokenReply([`Changed:\n  planned gym: 09:00–10:00\n${many}`])).toBe("Done: gym 9:00 AM–10:00 AM; 4 other blocks moved to follow it.");
    });
    it("a continuation first undoes what its cut-off first half changed — only while that is still the latest change", async () => {
        let top = "frag-1";
        const calls = [];
        const exec = async (args) => {
            calls.push(args);
            if (args[0] === "undo") {
                top = "older";
                return { stdout: "Undone: finish resume back to 11:20–12:50", code: 0 };
            }
            if (args[0] === "show")
                return { stdout: JSON.stringify(thursday), code: 0 };
            top = "new-1";
            return { stdout: "Changed:\n  planned meal prep: 12:45–13:45", code: 0 };
        };
        const ask = async () => ({ steps: [{ do: "add", what: "meal prep", to: "12:45", until: "13:45" }] });
        const done = await runScheduleFlow({ message: "meal prep from 12:45 to 1:45", clock: "Thu 12:13", exec, ask, undo: ["frag-1"], undoTop: () => top });
        expect(calls.map((c) => c[0])).toEqual(["undo", "show", "add"]);
        expect(done).toMatchObject({ outcome: "done", undone: 1, marks: ["new-1"] });
        // Something else changed his day in between: that is not ours to undo.
        calls.length = 0;
        top = "someone-else";
        await runScheduleFlow({ message: "meal prep from 12:45 to 1:45", clock: "Thu 12:13", exec, ask, undo: ["frag-1"], undoTop: () => top });
        expect(calls[0]?.[0]).toBe("show");
    });
    // Live sweep 2026-10-16 (q043, q051, q093, q022, q026, q020): a scheduler that changed NOTHING came back
    // as outcome "done" ("You already made this change"), and its raw lines were spoken word for word —
    // usage text, "Blocks today: … 09:00–10:30", "Do not tell him anything was added", block ids.
    it("a scheduler failure that changed nothing is a 'say', not 'done', in short spoken words", async () => {
        const exec = async (args) => (args[0] === "show" ? { stdout: JSON.stringify(thursday), code: 0 }
            : { stdout: "NOTHING WAS BOOKED: focus at 12:55 is already over today (Thursday 2026-10-15). If he meant another day, run again with --date YYYY-MM-DD.\nNOTHING WAS BOOKED on Thursday (2026-10-15). Do not tell him anything was added or moved.", code: 1 });
        const result = await runScheduleFlow({ message: "focus at 12:55", clock: "Thu 15:00", exec, ask: async () => ({ steps: [{ do: "add", what: "focus", minutes: 50, to: "12:55" }] }) });
        expect(result).toMatchObject({ outcome: "say", kind: "plain", text: "Not done: focus at 12:55 PM has already ended today." });
    });
    it("failure lines are spoken without usage text, block dumps, operator notes or 24-hour times", () => {
        expect(spokenReply(['usage: orion-reschedule add "<title>" <minutes> [--at HH:MM | --after "<event>"] [--fixed] [--before HH:MM]'])).toBe("Not done: I couldn't make that change.");
        expect(spokenReply(["NOTHING WAS BOOKED on Thursday (2026-10-15). Do not tell him anything was added or moved."])).toBe("Not done: nothing could be booked.");
        expect(spokenReply(['NOTHING WAS CHANGED: no block called "gym" on Thursday. Blocks today: CS1800 Discrete Structures 09:00–10:30, finish resume 11:20–12:50.'])).toBe("Not done: there's no block called gym.");
        expect(spokenReply(["NOTHING WAS CHANGED: moving it would break the day rules — CS2101 Lab (15:48–17:00) overlaps grind leetcode (16:15–17:45). Tell him what clashes and ask which to move; do not retry the same call."]))
            .toBe("Not done: moving it would break the day rules — CS2101 Lab (3:48 PM–5:00 PM) overlaps grind leetcode (4:15 PM–5:45 PM).");
        expect(spokenReply(["  NOT BOOKED: macro (45 min) did not fit on Thursday — ask whether to drop it or put it on another day (--date YYYY-MM-DD)"])).toBe("Not done: macro didn't fit.");
        expect(summarize(['NOTHING WAS CHANGED: no block called "gym" on Thursday. Blocks today: finish resume 11:20–12:50.'], []).reply).toBe("Not done: there's no block called gym.");
    });
    it("the form's own sentences name blocks by title, never by id", () => {
        expect(compile({ do: "cannot", text: "Cannot swap B1 (a FIXED class) with DS Lab (B3)." }, thursday)).toEqual({ say: "cannot", text: "Cannot swap CS1800 Discrete Structures — Lecture (a fixed class) with DS Lab." });
    });
    it("a vitamin in the form's sentence is not a block id (review 2026-10-16: 'B12' would become block 12)", () => {
        expect(compile({ do: "answer", text: "Take your B1 vitamin with lunch, then B2 is next." }, thursday)).toEqual({ say: "answer", text: `Take your B1 vitamin with lunch, then ${thursday.blocks[1].title} is next.` });
        expect(compile({ do: "answer", text: "Have the B12 supplement after B1." }, thursday)).toEqual({ say: "answer", text: `Have the B12 supplement after ${thursday.blocks[0].title}.` });
    });
    it("a change made for tomorrow says so (q020: 'Done: resume work 5:50 PM–6:35 PM.' with no day)", async () => {
        const exec = async (args) => (args[0] === "show" ? { stdout: JSON.stringify(thursday), code: 0 } : { stdout: "Changed Friday:\n  planned resume work: 17:50–18:35", code: 0 });
        const result = await runScheduleFlow({ message: "resume work tomorrow at 5:50", clock: "Thu 12:00", now: new Date(2026, 9, 15, 12, 0), exec, ask: async () => ({ steps: [{ do: "add", what: "resume work", minutes: 45, to: "17:50" }] }) });
        expect(result).toMatchObject({ outcome: "done", reply: "Done for tomorrow: resume work 5:50 PM–6:35 PM." });
    });
});
