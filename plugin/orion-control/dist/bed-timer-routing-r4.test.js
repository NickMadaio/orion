// w20 round 4 (live gate 2): bedtime phrasings, timers and "another one" reminders through the real routing hooks, in his words.
process.env.TZ = "Europe/London";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const NOW = new Date(2026, 10, 5, 2, 30);
function setup(decision = { move: "escalate", tier: "quick" }, extra = {}) {
    const sleepCalls = [];
    const wakeCalls = [];
    const timers = [];
    const store = [];
    const sleepPlanRun = async (args) => {
        sleepCalls.push(args);
        const time = args[1] ?? "00:00";
        return { code: 0, stdout: JSON.stringify({ ok: true, readback: { evening: "2026-11-04", sleepBy: args[1] === "reset" ? "22:30" : time, nudgeAt: "22:00", wake: "06:30", wakeDate: "2026-11-05", alarmAsked: true, hours: 7, lockdownBelowHours: 6, tonightOnly: args.includes("--tonight"), standing: "00:00" } }) };
    };
    const handlers = new Map();
    const dir = mkdtempSync(join(tmpdir(), "bt4-"));
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(dir, "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 02:30", now: () => NOW, stateDir: dir,
        decideImpl: async () => decision, sleepPlanRun, ...extra,
        wakeExec: async (args) => { wakeCalls.push(args); return { stdout: "Cleared.", code: 0 }; },
        extractReminder: async (m) => (/water/.test(m) ? { time: null, label: "drink water" } : { time: "15:00", label: "ring the dentist" }),
        listReminders: async () => [...store],
        removeReminders: async (ids) => { for (const id of ids) {
            const i = store.findIndex((r) => r.id === id);
            if (i >= 0)
                store.splice(i, 1);
        } },
        ledgerRun: async () => ({ stdout: "", code: 0 }),
        addTimer: async (seconds, label) => { timers.push({ seconds, label }); const r = { id: `t${timers.length}`, kind: "timer", label, dueAt: NOW.getTime() + seconds * 1000, createdAt: NOW.getTime() }; store.push(r); return r; },
    });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `r${(n += 1)}`, sessionKey: "agent:main:orion-chat-bt4" };
        for (const fn of handlers.get("before_model_resolve") ?? [])
            await fn({ prompt }, ctx);
        for (const fn of handlers.get("before_agent_reply") ?? []) {
            const o = (await fn({ prompt }, ctx));
            if (o?.reply?.text)
                return o.reply.text;
        }
        let out = "";
        for (const fn of handlers.get("before_prompt_build") ?? []) {
            const o = (await fn({ prompt, messages: [] }, ctx));
            out += `${o?.systemPrompt ?? ""}\n${o?.appendContext ?? ""}`;
        }
        return out;
    };
    // The worker's one orion_task_run call, as the host reports it, then the turn finishing: that is what makes a reminder "the one just set".
    const workerCalled = async (runId, args) => {
        const ctx = { runId, sessionKey: "agent:main:orion-chat-bt4" };
        for (const fn of handlers.get("after_tool_call") ?? [])
            await fn({ toolName: "tool_call", params: { id: "openclaw:orion-control:orion_task_run", args }, result: "scheduled" }, ctx);
        for (const fn of handlers.get("before_agent_finalize") ?? [])
            await fn({ sessionId: "s", lastAssistantMessage: "ok" }, ctx);
    };
    return { turn, sleepCalls, wakeCalls, timers, store, workerCalled };
}
describe("bedtime phrasings reach the one bedtime writer, never the wake tool or the scheduler", () => {
    it.each([
        ["clear my bedtime back to normal", ["bedtime", "reset", "--json"]],
        ["clear bedtime", ["bedtime", "reset", "--json"]],
        ["stop using a fixed bedtime, go back to working it out from my alarm", ["bedtime", "reset", "--json"]],
        ["go back to working it out from my alarm", ["bedtime", "reset", "--json"]],
        ["bedtime tonight is midnight", ["bedtime", "00:00", "--tonight", "--json"]],
        ["im heading to bed at ten to twelve", ["bedtime", "23:50", "--tonight", "--json"]],
        ["can we make bedtime twenty past 11 tonight only", ["bedtime", "23:20", "--tonight", "--json"]],
    ])("%s", async (said, args) => {
        const h = setup();
        const reply = await h.turn(said);
        expect(h.sleepCalls[0]).toEqual(args);
        expect(h.wakeCalls).toEqual([]);
        expect(reply).not.toMatch(/alarm is back to automatic|calendar is exactly|can't see it on today's plan/);
    }, 30000);
    it("the reply is only the read-back", async () => {
        const h = setup();
        const reply = await h.turn("im heading to bed at ten to twelve");
        expect(reply).toContain("Bedtime 11:50pm tonight");
    }, 30000);
});
describe("a timer is set by code and read back", () => {
    it.each([
        ["set a 10 min timer", 600, /Timer set: 10 minutes, it rings at 2:40 AM/],
        ["start a 10 min timer for the pasta", 600, /Timer set: 10 minutes for the pasta, it rings at 2:40 AM/],
        ["put a 25 minute timer on for my laundry pls", 1500, /25 minutes for my laundry|25 minutes for the laundry/],
    ])("%s", async (said, seconds, re) => {
        const h = setup();
        const reply = await h.turn(said);
        expect(h.timers[0]?.seconds).toBe(seconds);
        expect(reply).toMatch(re);
    }, 30000);
});
describe("another reminder, and cancelling by description", () => {
    it("'and another in 15 mins to drink water' after a reminder is a second reminder, not a calendar block", async () => {
        const h = setup();
        const first = await h.turn("remind me to ring the dentist at 3pm");
        expect(first).toMatch(/"action":"alarm_set"/);
        await h.workerCalled("r1", { steps: [{ action: "alarm_set", at: "2026-11-05T15:00", label: "ring the dentist" }] });
        const second = await h.turn("and another in 15 mins to drink water");
        expect(second).toMatch(/"action":"alarm_set"/);
        expect(second).toMatch(/drink water/);
        expect(second).not.toMatch(/orion-reschedule/);
    }, 30000);
    it("'ditch the water reminder as well' cancels the one called water", async () => {
        const h = setup();
        h.store.push({ id: "a1", label: "drink water", dueAt: NOW.getTime() + 900_000 }, { id: "a2", label: "ring the dentist", dueAt: NOW.getTime() + 3_600_000 });
        const reply = await h.turn("ditch the water reminder as well");
        expect(reply).toMatch(/Cancelled the reminder: drink water/);
        expect(h.store.map((r) => r.id)).toEqual(["a2"]);
    }, 30000);
    it("asks which when two match", async () => {
        const h = setup();
        h.store.push({ id: "a1", label: "drink water", dueAt: NOW.getTime() + 900_000 }, { id: "a2", label: "water the plants", dueAt: NOW.getTime() + 3_600_000 });
        const reply = await h.turn("ditch the water reminder");
        expect(reply).toMatch(/Which one\?/);
        expect(h.store).toHaveLength(2);
    }, 30000);
});
describe("review fixes: a timer is only an order, and the rest of the message is not dropped", () => {
    it.each(["dont set a 10 min timer", "should i set a 10 min timer?", "can you set a 5 min timer? or is that too short lol"])("%s sets nothing", async (said) => {
        const h = setup();
        await h.turn(said);
        expect(h.timers).toEqual([]);
    }, 30000);
    it("'make it a 10 min timer instead' with no timer before it sets nothing", async () => {
        const h = setup();
        await h.turn("make it a 10 min timer instead");
        expect(h.timers).toEqual([]);
    }, 30000);
    it("'make it a 15 min timer instead' after a timer replaces it", async () => {
        const h = setup();
        await h.turn("set a 10 min timer for the pasta");
        const reply = await h.turn("make it a 15 min timer instead");
        expect(h.timers.map((t) => t.seconds)).toEqual([600, 900]);
        expect(h.store.filter((r) => r.kind === "timer")).toHaveLength(1);
        expect(reply).toMatch(/Swapped the old timer\. Timer set: 15 minutes/);
    }, 30000);
    it.each([
        "set a 10 min timer and move my gym to 6",
        "move my gym to 6 and set a 10 min timer",
        "move gym to 6 then start a 10 min timer",
        "put my gym at 6, and set a 10 min timer pls",
    ])("%s: code sets the timer, the scheduler gets only the gym clause, one reply says both", async (said) => {
        const seen = [];
        const h = setup(undefined, { scheduleFlow: async (m) => { seen.push(m); return { outcome: "done", calls: ['exec orion-reschedule move "gym" --to 18:00'], outputs: ["Changed: moved gym"], reply: "Moved gym to 6:00 PM." }; } });
        const reply = await h.turn(said);
        expect(h.timers.map((t) => t.seconds)).toEqual([600]);
        expect(seen.length).toBeGreaterThan(0);
        for (const m of seen) {
            expect(m).toMatch(/gym/);
            expect(m).not.toMatch(/timer/);
        }
        expect(reply).toContain("Timer set: 10 minutes, it rings at 2:40 AM. Moved gym to 6:00 PM.");
    }, 30000);
    it("with no scheduler flow the worker is told what code did and the other clause", async () => {
        const h = setup();
        const prompt = await h.turn("set a 10 min timer and add a 30 min walk to my calendar");
        expect(h.timers.map((t) => t.seconds)).toEqual([600]);
        expect(prompt).toMatch(/Timer set: 10 minutes/);
        expect(prompt).toMatch(/add a 30 min walk to my calendar/);
    }, 30000);
});
