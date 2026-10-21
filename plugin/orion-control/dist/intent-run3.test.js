// Live run 3 (docs/audits/2026-10-20-live-as-nick.md, "Run 3", 2026-10-21 00:11-00:19): the wrong write ("tonight at 7" -> 1:20 PM), the new
// item that was never said to be new, the leaked "Exec failed" line; and the coordinator's hedges. Fixtures only: stub scheduler, no model.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pushAllMinutes, readIntent } from "./calendar-intent.js";
import { honestLine, registerLocalRouting } from "./local-routing.js";
import { runScheduleFlow } from "./schedule-flow.js";
import { addedNotes, spokenReply } from "./schedule-reply.js";
import { commandArgs, statedStarts, timeMismatch, writesIn } from "./time-backstop.js";
const at = (h, m = 0) => new Date(2030, 9, 21, h, m);
// 10-21: two classes, nothing else.
const DAY = { date: "2030-10-21", now: "00:18", plan: { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [
        { title: "CS1802 Seminar — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "CS2100 Program Design — Lecture", start: "11:00", end: "12:30", fixed: true, kind: "class" }
    ] };
describe("1a. the intent layer reads block / set aside / pencil in, 'for N hrs' and 'tonight / this afternoon at T'", () => {
    it.each([
        ["can u block 2 hrs for econ homework tonight at 7", at(0, 18), { name: "econ homework", minutes: 120, start: "19:00" }],
        ["can u block 2 hrs for econ homework tonight at 7", at(15), { name: "econ homework", minutes: 120, start: "19:00" }],
        ["block out an hour for reading this evening at 8", at(15), { name: "reading", minutes: 60, start: "20:00" }],
        ["set aside an hour for reading this afternoon at 3", at(9), { name: "reading", minutes: 60, start: "15:00" }],
        ["pencil in laundry at 4pm", at(9), { name: "laundry", start: "16:00" }],
        ["schedule 30 min for a call at 2pm", at(9), { name: "call", minutes: 30, start: "14:00" }],
        ["book 45 min for a run this evening at 6", at(9), { name: "run", minutes: 45, start: "18:00" }],
        ["block 2 hours for econ homework tomorrow at 7pm", at(15), { name: "econ homework", minutes: 120, start: "19:00" }],
    ])("%j at %s", (m, now, item) => {
        expect(readIntent(m, { now })).toMatchObject({ intent: { verb: "add", items: [item] } });
    });
    it("through the flow: one add at 19:00, 120 minutes, the form never asked", async () => {
        const writes = [];
        const r = await runScheduleFlow({ message: "can u block 2 hrs for econ homework tonight at 7", clock: "x", now: at(0, 18), ask: async () => { throw new Error("no form"); },
            exec: async (a) => { if (a[0] !== "show")
                writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(DAY) : "Changed:\n  planned econ homework: 19:00–21:00", code: 0 }; } });
        expect(writes).toEqual([["add", "econ homework", "120", "--at", "19:00"]]);
        expect(r.outcome).toBe("done");
        expect(spokenReply(r.outputs)).toBe("Done: econ homework 7:00 PM–9:00 PM.");
    });
});
describe("1b. the backstop: a time he said is the start every write uses, or nothing runs", () => {
    const ctx = { day: "today", now: 15 * 60 };
    it.each([
        ["block 2 hrs for econ homework tonight at 7", [["add", "econ homework", "120"]], "mismatch"],
        ["block 2 hrs for econ homework tonight at 7", [["add", "econ homework", "120", "--at", "19:00"]], "ok"],
        ["block 2 hrs for econ homework tonight at 7", [["add", "econ homework", "120", "--at", "07:00"]], "mismatch"],
        ["move gym to 7", [["move", "Gym", "--to", "19:00"]], "ok"],
        ["move gym to 7", [["move", "Gym", "--to", "07:00"]], "mismatch"],
        ["move gym to 7 and push the resume back", [["move", "Gym", "--to", "19:00"], ["move", "resume", "--to", "21:00"]], "ok"],
        ["put piano from 5 to 6", [["add", "piano", "60", "--at", "17:00"]], "ok"],
        ["gym at 1:20 after class", [["day", "--plan", "Gym, 90, 13:20"]], "ok"],
        ["gym at 6 after class", [["add", "Gym", "90", "--after", "CS2100"]], "mismatch"],
        ["extend gym until 9", [["extend", "Gym", "--until", "21:00"]], "ok"],
        ["push everything 30 min", [["late", "30"]], "ok"],
        ["add reading after dinner", [["add", "reading", "30", "--after", "Dinner"]], "ok"],
        ["put a walk at 9 tomorrow", [["add", "walk", "30", "--at", "21:00"]], "ok"],
    ])("%j with %j: %s", (m, argvs, want) => {
        const day = /tomorrow/.test(m) ? { day: "tomorrow", now: null } : ctx;
        expect(timeMismatch(m, argvs, day) ? "mismatch" : "ok").toBe(want);
    });
    it("says what he said and what it would have done", () => {
        expect(timeMismatch("block 2 hrs for econ homework tonight at 7", [["add", "econ homework", "120"]], ctx)).toBe("You said 7:00 PM, but that change would have put econ homework at a time of its own, so I haven't changed anything. Say it again with the time, like \"put econ homework at 7 PM\".");
    });
    it("statedStarts follows the evening and AM/PM rules", () => {
        expect(statedStarts("tonight at 7", ctx)).toEqual([[1140]]);
        expect(statedStarts("at 9 tomorrow", { day: "tomorrow", now: null })).toEqual([[540, 1260]]);
        expect(statedStarts("from 5 to 7", ctx)).toEqual([[1020]]);
    });
    it("the form path: a form add that dropped 'tonight at 7' is refused, nothing written", async () => {
        const writes = [];
        const steps = [{ do: "add", what: "econ homework", minutes: 120 }];
        const r = await runScheduleFlow({ message: "can u block 2 hrs for econ homework tonight at 7, after dinner", clock: "x", now: at(15), ask: async () => ({ steps }),
            exec: async (a) => { if (a[0] !== "show")
                writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify({ ...DAY, now: "15:00" }) : "Changed:\n  planned econ homework: 13:20–15:20", code: 0 }; } });
        expect(writes.filter((w) => !w.includes("--dry-run"))).toEqual([]);
        expect(r).toMatchObject({ outcome: "say", kind: "ask", text: expect.stringMatching(/^You said 7:00 PM, but that change would have put econ homework at a time of its own/) });
    });
    it("the worker's own exec is blocked with the same reason", async () => {
        const handlers = new Map();
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r3-")), "r.jsonl"),
            brainSearch: async () => "", clock: () => "Wed 15:00", now: () => at(15), decideImpl: async () => ({ move: "escalate" }), scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }) });
        const c = { runId: "w", sessionKey: "agent:main:orion-chat-r3" };
        const msg = "can u block 2 hrs for econ homework tonight at 7, after dinner";
        for (const f of handlers.get("before_model_resolve") ?? [])
            await f({ prompt: msg }, c);
        const results = await Promise.all((handlers.get("before_tool_call") ?? []).map((f) => f({ toolName: "exec", params: { command: "/x/scripts/orion-reschedule add \"econ homework\" 120" } }, c)));
        expect(results.find((r) => r && r.block)).toMatchObject({ block: true, blockReason: expect.stringContaining("You said 7:00 PM") });
        const ok = await Promise.all((handlers.get("before_tool_call") ?? []).map((f) => f({ toolName: "exec", params: { command: "/x/scripts/orion-reschedule add \"econ homework\" 120 --at 19:00" } }, c)));
        expect(ok.some((r) => r && String(r.blockReason ?? "").includes("time check"))).toBe(false);
        expect(commandArgs('a "b c" d')).toEqual(["a", "b c", "d"]);
    });
});
describe("2. a new item a plan added is said to be new, with its length, why, and where it went", () => {
    const out = ["Changed Wednesday 2030-10-21:\n  planned piano practice: 13:20–14:20\nWritten to his calendar."];
    it("'piano practice first after class' (the form's day --plan at 10:35)", () => {
        expect(addedNotes(DAY, out, [["day", "--plan", "piano practice, 60, 10:35"]], "piano practice first after class")).toBe("Piano practice wasn't on your day, so I added an hour at 1:20 PM. You didn't say how long, so that's a default length; tell me if it should be different. It couldn't go at 10:35 AM, so that's the first free time after it.");
    });
    it("a length he said is not called a default; a block already on his day gets no note", () => {
        expect(addedNotes(DAY, out, [["day", "--plan", "piano practice, 60, 13:20"]], "piano practice for an hour first after class")).toBe("Piano practice wasn't on your day, so I added an hour at 1:20 PM.");
        expect(addedNotes({ ...DAY, blocks: [...DAY.blocks, { title: "piano practice", start: "18:00", end: "19:00", fixed: false }] }, out, [["day", "--plan", "piano practice, 60, 13:20"]], "x")).toBe("");
    });
    it("through the flow, the reply carries it", async () => {
        const r = await runScheduleFlow({ message: "piano practice first after class", clock: "x", now: at(0, 18), ask: async () => ({ steps: [{ do: "plan", after: "B1", items: [{ title: "piano practice", minutes: 60 }] }] }),
            exec: async (a) => ({ stdout: a[0] === "show" ? JSON.stringify(DAY) : out[0], code: 0 }) });
        expect(r).toMatchObject({ outcome: "done", reply: expect.stringMatching(/^Done: piano practice 1:20 PM–2:20 PM\. Piano practice wasn't on your day, so I added an hour at 1:20 PM\. You didn't say how long/) });
    });
});
describe("3. 'push everything N min' is the late flow, in code; an honest line names the failure in the host's own terms", () => {
    it.each([
        ["ok and push everything 30 min", 30], ["push everything back an hour", 60], ["push the rest of my day 15 minutes", 15], ["can you push everything back by 45 mins", 45],
        ["push it all half an hour", 30], ["push everything 30 min tomorrow", null], ["push everything 30 min?", null], ["push everything 30 min lol", null], ["push everything 3 min", null],
        ["push everything 30 min prolly", null],
    ])("%j -> %s", (m, n) => { expect(pushAllMinutes(m)).toBe(n); });
    it("through the hooks: the desk is not asked and the schedule flow carries it (not the worker, not `late`)", async () => {
        const handlers = new Map();
        let desk = 0;
        const late = [];
        const sched = [];
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r3-")), "r.jsonl"),
            brainSearch: async () => "", clock: () => "Wed 15:00", now: () => at(15), decideImpl: async () => { desk += 1; return { move: "escalate" }; },
            scheduleFlow: async (m) => { sched.push(m); return { outcome: "done", calls: ["exec orion-reschedule day --plan x"], outputs: ["Changed:\n  Gym moved: 18:00 → 18:30–20:00"], reply: "Done: Gym now 6:30 PM–8:00 PM." }; },
            lateFlow: async (n) => { late.push(n); return { outcome: "say", kind: "plain", text: "x" }; } });
        const c = { runId: "p", sessionKey: "agent:main:orion-chat-r3p" };
        for (const f of handlers.get("before_model_resolve") ?? [])
            await f({ prompt: "ok and push everything 30 min" }, c);
        for (const f of handlers.get("before_prompt_build") ?? [])
            await f({ prompt: "x", messages: [] }, c);
        expect({ desk, late, sched }).toEqual({ desk: 0, late: [], sched: ["ok and push everything 30 min"] });
    });
    it("in code: every block of his still ahead slides N, with its own length; classes and blocks under way stay", async () => {
        const day = { ...DAY, now: "15:00", blocks: [...DAY.blocks, { title: "walk", start: "14:30", end: "15:15", fixed: false }, { title: "Gym", start: "18:00", end: "19:30", fixed: false, kind: "gym" }, { title: "reading", start: "20:00", end: "20:30", fixed: false }] };
        const writes = [];
        const r = await runScheduleFlow({ message: "ok and push everything 30 min", clock: "x", now: at(15), ask: async () => { throw new Error("no form"); },
            exec: async (a) => { if (a[0] !== "show")
                writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : "Changed:\n  Gym moved: 18:00 → 18:30–20:00", code: 0 }; } });
        expect(writes).toEqual([["day", "--plan", "Gym, 90, 18:30", "--plan", "reading, 30, 20:30"]]);
        expect(r.outcome).toBe("done");
    });
    it("with nothing of his ahead it says so, and why", async () => {
        const r = await runScheduleFlow({ message: "push everything 30 min", clock: "x", now: at(15), ask: async () => { throw new Error("no form"); },
            exec: async (a) => ({ stdout: JSON.stringify({ ...DAY, now: "08:00" }), code: 0 }) });
        expect(r).toMatchObject({ outcome: "say", text: "There's nothing of yours left on your day to push (only classes and plans with fixed times are ahead, and those don't move), so nothing changed." });
    });
    it("the plugin's own failure lines are ones the host counts as acknowledging a failed write (so it appends no 'Exec failed')", () => {
        // OpenClaw payloads: MUTATING_FAILURE_INABILITY_PATTERN, with its action words.
        const ACTION = "(?:write|edit|update|save|create|delete|remove|modify|change|apply|patch|move|rename|send|reply|message|run|execute|execution|command|script|shell|bash|exec|tool|action|operation)";
        const ack = new RegExp(`\\b(?:couldn't|could not|can't|cannot|unable to|am unable to|wasn't able to|was not able to|were unable to)\\b.{0,100}\\b${ACTION}\\b`, "u");
        for (const line of [honestLine(true), "I couldn't move anything, so nothing was moved — what's left today is classes.", "I couldn't make that change, so nothing on your calendar was changed."])
            expect(ack.test(line.toLowerCase()), line).toBe(true);
    });
});
describe("hedges and follow-ups (coordinator, 2026-10-21)", () => {
    const last = { order: ["gym", "resume"], home: false, explicit: true };
    it.each(["reschedule my day, gym first prolly", "reschedule my day, gym first i suppose", "i suppose reschedule my day, gym first", "put a walk at 5 prolly"])("%j is doubt", (m) => {
        expect(readIntent(m, { now: at(12) })).toMatchObject({ refused: "doubt" });
    });
    it.each(["i think resume then gym", "i think resume before gym", "prolly resume then gym", "i suppose resume then gym"])("%j is not a follow-up", (m) => {
        expect(readIntent(m, { now: at(20), last })).not.toHaveProperty("intent");
    });
});
describe("review of 1c5e0ac: the backstop counts only the item's own start, and every way a writer can be called", () => {
    const ctx = { day: "today", now: 10 * 60 };
    it.each([
        // moves: "to" is the new start, "from" is where it is now
        ["move gym from 7 to 8", [["move", "Gym", "--to", "20:00"]], "ok"],
        ["move gym from 7 to 8", [["move", "Gym", "--to", "19:00"]], "mismatch"],
        ["push gym from 6 to 7:30", [["move", "Gym", "--to", "19:30"]], "ok"],
        ["shift reading from 3pm to 4pm", [["move", "reading", "--to", "16:00"]], "ok"],
        // times that describe something else are not stated for the item
        ["put gym after class, my class ends at 5", [["add", "Gym", "90", "--after", "MKTG"]], "ok"],
        ["put gym after my class at 3", [["add", "Gym", "90", "--after", "MKTG"]], "ok"],
        ["I'll be home at 6, put gym after that", [["add", "Gym", "90"]], "ok"],
        ["im at 5 percent, put gym in later", [["add", "Gym", "90"]], "ok"],
        ["reading before my lecture at 2", [["add", "reading", "30", "--before", "14:00"]], "ok"],
        ["put dinner when I get back at 7", [["add", "dinner", "45"]], "ok"],
        ["add reading until my meeting at 4", [["add", "reading", "30"]], "ok"],
        ["my lab finishes at 4 so put gym at 6", [["add", "Gym", "90", "--at", "18:00"]], "ok"],
        ["my lab finishes at 4 so put gym at 6", [["add", "Gym", "90"]], "mismatch"],
        // the item's own time still counts
        ["put gym at 6, my class ends at 5", [["add", "Gym", "90"]], "mismatch"],
        ["block 2 hrs for econ homework tonight at 7", [["add", "econ homework", "120"]], "mismatch"],
    ])("%j with %j: %s", (m, argvs, want) => {
        expect(timeMismatch(m, argvs, ctx) ? "mismatch" : "ok").toBe(want);
    });
    it.each([
        [`bash -c 'orion-reschedule add "econ homework" 120 --at 13:20'`, [["add", "econ homework", "120", "--at", "13:20"]]],
        [`sh -c "/x/scripts/orion-reschedule add \\"econ homework\\" 120"`, [["add", "econ homework", "120"]]],
        [`bash -lc "cd /x && ./scripts/orion-reschedule move Gym --to 19:00"`, [["move", "Gym", "--to", "19:00"]]],
        [`/x/scripts/orion-reschedule day --plan "Gym, 90, 13:20"`, [["day", "--plan", "Gym, 90, 13:20"]]],
        [`/x/scripts/orion-agenda-change add "econ" 2030-10-21T13:20 120`, [["add", "econ", "120", "--at", "13:20"]]],
        [`/x/scripts/orion-plan-study "two sessions" --book`, [["add", "two sessions", "60"]]],
        [`orion-agenda today`, []],
        [`/x/scripts/orion-reschedule show --json`, [["show", "--json"]]],
    ])("writesIn %j", (command, want) => { expect(writesIn(command)).toEqual(want); });
    it.each([
        `bash -c 'orion-reschedule add "econ homework" 120 --at 13:20'`,
        `bash -lc "/home/x/ORION/scripts/orion-reschedule add 'econ homework' 120"`,
        `cd /x; orion-agenda-change add "econ homework" 2030-10-21T13:20 120`,
    ])("the worker's wrapped exec %j is blocked when it would not start at 7 PM", async (command) => {
        const handlers = new Map();
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r3b-")), "r.jsonl"),
            brainSearch: async () => "", clock: () => "Wed 15:00", now: () => at(15), decideImpl: async () => ({ move: "escalate" }), scheduleFlow: async () => ({ outcome: "fallback", reason: "x" }) });
        const c = { runId: "wb", sessionKey: "agent:main:orion-chat-r3b" };
        for (const f of handlers.get("before_model_resolve") ?? [])
            await f({ prompt: "can u block 2 hrs for econ homework tonight at 7, after dinner" }, c);
        const results = await Promise.all((handlers.get("before_tool_call") ?? []).map((f) => f({ toolName: "exec", params: { command } }, c)));
        expect(results.find((r) => r && String(r.blockReason ?? "").includes("time check"))).toMatchObject({ block: true });
    });
});
