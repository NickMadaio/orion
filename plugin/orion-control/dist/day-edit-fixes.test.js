// w20 fix-dayedit: the review's day-edit findings (H1 wake, H2 silent drop, H6 not-scheduling, M2 anyway, M3 gym, read failure, E11, E3)
// and 30 held-out messages in his style, each with the route it must take, so this class of misroute is caught next time.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readDayEdit } from "./day-edit.js";
import { runDayEdit } from "./day-edit-run.js";
import { readOverride, rememberAsk, resetDayEditMemory } from "./day-edit-memory.js";
import { readReality } from "./reality.js";
import { schedulingAsk } from "./route-gate.js";
import { readFoodTurn } from "./food-read.js";
import { readWorkoutTurn } from "./workout-read.js";
import { parseWake } from "./wake-flow.js";
import { readSleepTurn } from "./sleep-plan-read.js";
import { registerLocalRouting } from "./local-routing.js";
const NOW = new Date(2026, 10, 5, 19, 57); // Thu 5 Nov, 7:57 PM
const day = (blocks) => ({ date: "2026-11-05", now: "19:57", blocks });
const B = (title, start, end, kind = "study", fixed = false) => ({ title, start, end, kind, fixed });
const DAY = day([B("Lunch", "12:30", "13:20", "meal"), B("Gym", "20:00", "21:00", "gym")]);
const ops = (m) => (readDayEdit(m, NOW)?.parts ?? []).map((p) => p.op);
function fake(opts = {}) {
    const calls = [];
    const wakes = [];
    const foods = [];
    const run = async (script, args) => { calls.push([script, ...args]); return opts.reply?.(script, args) ?? { stdout: "Changed Thursday 2026-11-05:\n  done\nWritten to his calendar.", code: 0 }; };
    const readDay = async () => (typeof opts.day === "function" ? opts.day() : opts.day ?? DAY);
    const deps = { run, readDay, readDayOn: readDay, now: NOW, source: "chat", text: "", stateDir: opts.stateDir,
        ...(opts.wake ? { wake: async (a) => { wakes.push(a); return { stdout: "Sent to the phone", code: 0 }; } } : {}),
        ...(opts.food ? { food: async (t) => { foods.push(t); return "Logged chicken, about 400 calories."; } } : {}) };
    return { calls, wakes, foods, deps: deps };
}
const reply = (o) => { const f = o.flow; return f.reply ?? f.text ?? ""; };
beforeEach(() => resetDayEditMemory());
describe("H1: wake and alarm wording is never a day edit", () => {
    it.each(["Push my wake up time to six AM", "wake me at 6", "can you move my alarm to 6:30", "set an alarm for half 6", "get me up at 7"])("%s", (m) => {
        expect(readDayEdit(m, NOW)).toBeNull();
        const r = readReality(m, NOW)?.reality;
        expect(r?.kind === "edit" || r?.kind === "request").toBe(false);
    });
    it("push my wake up time to six AM reaches the alarm reader, set for 06:00", () => {
        expect(parseWake("Push my wake up time to six AM.", undefined, NOW)).toEqual({ kind: "set", time: "06:00" });
        expect(readSleepTurn("Push my wake up time to six AM.", { now: NOW })).toMatchObject({ kind: "alarm", req: { kind: "set", time: "06:00" } });
    });
    it("beside day edits the wake clause is its own part and runs through the alarm, never a block called wake me", async () => {
        expect(ops("put dinner at 8 and gym at 9 and wake me at 6")).toEqual(["add", "add", "wake"]);
        const { calls, wakes, deps } = fake({ wake: true });
        const out = await runDayEdit(readDayEdit("put dinner at 8 and gym at 9 and wake me at 6", NOW), deps);
        expect(wakes).toEqual([["06:00"]]);
        expect(calls.some((c) => c.join(" ").toLowerCase().includes("wake"))).toBe(false);
        expect(reply(out)).toContain("wake alarm");
        expect(reply(out)).toContain("6 AM");
    });
    it("push dinner to 8 and push my wake time to 6:30", () => expect(ops("push dinner to 8 and push my wake time to 6:30")).toEqual(["move", "wake"]));
    it("with no alarm wired the reply says the alarm was not set", async () => {
        const { deps } = fake();
        const out = await runDayEdit(readDayEdit("push gym to 9 and wake me at 6", NOW), deps);
        expect(reply(out)).toMatch(/couldn't set your wake alarm/);
    });
});
describe("H2: a clause is never dropped silently", () => {
    it("move gym to 9, bedtime to 11 does both", async () => {
        expect(ops("move gym to 9, bedtime to 11")).toEqual(["move", "bedtime"]);
        const readback = { evening: "2026-11-05", sleepBy: "23:00", nudgeAt: "22:30", wake: "07:00", wakeDate: "2026-11-06", alarmAsked: false, hours: 8, lockdownBelowHours: 6, tonightOnly: true, standing: "00:00" };
        const { calls, deps } = fake({ day: day([B("Gym", "21:30", "22:30", "gym")]), reply: (s) => (s === "orion-sleepplan" ? { stdout: JSON.stringify({ ok: true, readback }), code: 0 } : undefined) });
        const out = await runDayEdit(readDayEdit("move gym to 9, bedtime to 11", NOW), deps);
        expect(calls.map((c) => c[0] + " " + c[1])).toEqual(["orion-reschedule move", "orion-sleepplan bedtime"]);
        expect(reply(out)).toMatch(/moved Gym.*bedtime/);
    });
    it("i did gym 2-3 and ate at 4: gym logged 14:00-15:00, the meal handed to food, no block called 'gym and ate'", async () => {
        expect(ops("i did gym 2-3 and ate at 4")).toEqual(["log", "food"]);
        const { calls, foods, deps } = fake({ food: true });
        const out = await runDayEdit(readDayEdit("i did gym 2-3 and ate at 4", NOW), deps);
        expect(calls).toHaveLength(1);
        expect(calls[0].slice(0, 7)).toEqual(["orion-reschedule", "log", "Gym", "--from", "14:00", "--to", "15:00"]);
        expect(JSON.stringify(calls)).not.toMatch(/ate at/i);
        expect(foods).toHaveLength(1);
        expect(reply(out)).toContain("logged gym 2–3 PM");
        expect(reply(out)).toContain("Logged chicken");
    });
    it("a meal with no food route wired is said plainly, not claimed", async () => {
        const { deps } = fake();
        const out = await runDayEdit(readDayEdit("i did gym 2-3 and ate at 4", NOW), deps);
        expect(reply(out)).toContain("I logged gym 2–3 PM");
        expect(reply(out)).toMatch(/couldn't log what you ate/);
    });
    it("a clause with a time it cannot read makes the whole message not its own", () => {
        expect(readDayEdit("move gym to 9, and tell my mum i love her at 5", NOW)).toBeNull();
    });
});
describe("H6: device, clothing and list asks are not calendar blocks", () => {
    it.each(["put the heating on at 6", "put the kettle on at 6", "put on gym shorts at 6", "turn the oven on at 7", "add chicken at 7pm to my meals", "add milk to my list at 5"])("%s", (m) => {
        expect(schedulingAsk(m)).toBe(false);
        expect(readDayEdit(m, NOW)).toBeNull();
    });
    it("real calendar asks still are", () => {
        for (const m of ["put gym at 6", "put gym on my calendar at 6", "add marketing from 7-9:30pm", "put heating check on my schedule at 6"])
            expect(schedulingAsk(m)).toBe(true);
    });
    it("add chicken at 7pm to my meals goes to food", () => {
        expect(readFoodTurn("add chicken at 7pm to my meals", { now: NOW, mealsOn: true })).toMatchObject({ kind: "log" });
    });
});
describe("M2: anyway re-runs only what was refused", () => {
    it("only the failed part comes back, and it is used once", async () => {
        const { deps } = fake({ reply: (_s, a) => (a[1] === "Pottery" ? { stdout: "NOTHING WAS CHANGED: Pottery has already started", code: 1 } : undefined) });
        await runDayEdit(readDayEdit("add pottery at 6pm. add run at 10pm", NOW), deps);
        const o = readOverride("yeah ill go anyway, that's fine", NOW);
        expect(o?.parts).toHaveLength(1);
        expect(o?.parts[0]).toMatchObject({ name: "pottery" });
    });
    it("when everything worked there is nothing to replay", async () => {
        const { deps } = fake();
        await runDayEdit(readDayEdit("add pottery at 10pm. add run at 11pm", NOW), deps);
        expect(readOverride("do it anyway", NOW)).toBeNull();
    });
});
describe("M3: past-tense gym talk is still a workout or attended", () => {
    it.each(["i did gym earlier", "just got back from the gym", "went for a 3 mile run"])("%s is the workout route's", (m) => {
        expect(readDayEdit(m, NOW)).toBeNull();
        expect(readWorkoutTurn(m, { now: NOW })).toMatchObject({ kind: "describe" });
    });
    it("i was at the gym is the gym done", () => expect(readReality("i was at the gym", NOW)?.reality).toMatchObject({ kind: "done", what: "gym" }));
});
describe("a failed calendar read is not 'no block by that name'", () => {
    it("move gym to 9 with an unreadable calendar changes nothing and says why", async () => {
        const { calls, deps } = fake({ day: () => { throw new Error("read failed"); } });
        const out = await runDayEdit(readDayEdit("move gym to 9", NOW), deps);
        expect(calls).toEqual([]);
        expect(out.writes).toBe(0);
        expect(reply(out)).toMatch(/couldn't read your calendar/);
    });
    it("same for clear and for i didnt do", async () => {
        for (const m of ["clear the gym", "i didnt do gym, i was at the pub"]) {
            const { calls, deps } = fake({ day: () => { throw new Error("nope"); } });
            const out = await runDayEdit(readDayEdit(m, NOW), deps);
            expect(calls).toEqual([]);
            expect(reply(out)).toMatch(/couldn't read your calendar/);
        }
    });
});
describe("E3: six hours of sleep is planned, not only noted", () => {
    const stateWithAlarm = () => { const d = mkdtempSync(join(tmpdir(), "w20fd-")); writeFileSync(join(d, "wake-plan.json"), JSON.stringify({ alarms: [{ iso: new Date(2026, 10, 6, 5, 50).toISOString(), at: "05:50" }] })); return d; };
    const text = "Clear the gym I'm not going. I'm at a school event. Gym start at 10pm. Plan for 6 hours of sleep tonight as I napped and don't need all 8.";
    it("reads as drop, add, sleep hours", () => expect(ops(text)).toEqual(["drop", "add", "sleephours"]));
    it("bedtime is the alarm minus the hours, through the bedtime entry", async () => {
        const readback = { evening: "2026-11-05", sleepBy: "23:50", nudgeAt: "23:20", wake: "05:50", wakeDate: "2026-11-06", alarmAsked: false, hours: 6, lockdownBelowHours: 6, tonightOnly: true, standing: "00:00" };
        const { calls, deps } = fake({ stateDir: stateWithAlarm(), reply: (s) => (s === "orion-sleepplan" ? { stdout: JSON.stringify({ ok: true, readback }), code: 0 } : undefined) });
        const out = await runDayEdit(readDayEdit("i want six hours of sleep tonight", NOW), deps);
        expect(calls).toEqual([["orion-sleepplan", "bedtime", "23:50", "--tonight", "--json"]]);
        expect(reply(out)).toContain("11:50 PM");
    });
    it("with no alarm to count from it says so and changes nothing", async () => {
        const { calls, deps } = fake();
        const out = await runDayEdit(readDayEdit("i want six hours of sleep tonight", NOW), deps);
        expect(calls).toEqual([]);
        expect(reply(out)).toMatch(/couldn't plan 6 hours of sleep/);
    });
});
function route() {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "w20fd-"));
    writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    const calls = [];
    const wakes = [];
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Thu 19:57", now: () => NOW,
        decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "",
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), readDayJson: async () => DAY, readDay: async () => JSON.stringify(DAY),
        realityRun: async (s, a) => { calls.push([s, ...a]); return { stdout: "Changed Thursday\nWritten to his calendar.", code: 0 }; },
        wakeExec: async (a) => { wakes.push(a); return { stdout: "Sent to the phone", code: 0 }; },
        workoutRun: async () => ({ stdout: "{}", code: 0 }) });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `w20fd-${n += 1}`, sessionKey: `agent:main:orion-chat-fd-${n % 3}` };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return direct?.reply?.text ?? /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    };
    return { turn, calls, wakes };
}
describe("E11: undo, then the corrected ask", () => {
    it("'undo. i meant add those to the schedule' reads the last ask back as an edit, undoing first", () => {
        rememberAsk("add marketing from 7-9:30pm. then gym from 10-11", NOW);
        const r = readReality("Undo. I meant add those to the schedule", NOW)?.reality;
        expect(r).toMatchObject({ kind: "edit", undoFirst: true });
        expect(r.edit.parts.map((p) => p.op)).toEqual(["add", "add"]);
    });
    it("nothing to point at: not mine", () => expect(readReality("Undo. I meant add those to the schedule", NOW)).toBeNull());
    it("in the chat: the edit is undone, then written again as the schedule", async () => {
        const r = route();
        await r.turn("add marketing from 7-9:30pm. then gym from 10-11");
        const before = r.calls.length;
        const text = await r.turn("Undo. I meant add those to the schedule");
        const after = r.calls.slice(before).map((c) => c[1]);
        expect(after.slice(0, 2)).toEqual(["undo", "undo"]);
        expect(after.slice(2).length).toBe(2);
        expect(text).toMatch(/^Undone/);
    });
});
describe("chat route: wake beside day edits reaches orion-wake", () => {
    it("put dinner at 8 and wake me at 6", async () => {
        const r = route();
        const text = await r.turn("put dinner at 9 and wake me at 6");
        expect(r.wakes).toEqual([["06:00"]]);
        expect(r.calls.map((c) => c.join(" ")).join("|")).not.toMatch(/wake/i);
        expect(text).toMatch(/wake alarm/);
    });
});
// ---- 30 held-out messages: the route each must take ----
function routeOf(m) {
    const calendarAsk = schedulingAsk(m);
    const edit = readDayEdit(m, NOW);
    if (edit)
        return `edit:${edit.parts.map((p) => p.op).join(",")}`;
    if (!calendarAsk && readFoodTurn(m, { now: NOW, mealsOn: true }))
        return "food";
    if (readWorkoutTurn(m, { now: NOW }))
        return "workout";
    if (parseWake(m, undefined, NOW))
        return "wake";
    return "none";
}
const CASES = [
    ["put the oven on at 6", "none"],
    ["turn the heating on at 7", "none"],
    ["set the heating for 6 pls", "none"],
    ["put on my gym shoes at 6", "none"],
    ["add chicken and rice at 7pm to my food", "food"],
    ["add a banana at 3pm to my meals", "food"],
    ["put gym at 6", "edit:add"],
    ["put gym on my calendar at 6", "edit:add"],
    ["wake me up at 6", "wake"],
    ["move my alarm to 6:30", "wake"],
    ["push my wake up to 7", "wake"],
    ["set an alarm for half 6", "wake"],
    ["push gym to 9 and wake me at 7", "edit:move,wake"],
    ["add reading at 3 and set an alarm for 7", "edit:add,wake"],
    ["move gym to 8, bedtime to 11:30", "edit:move,bedtime"],
    ["push gym to 8 and bedtime to 11:30", "edit:move,bedtime"],
    ["put study at 5, sleep at 11", "edit:add,bedtime"],
    ["i did gym 3-4 and ate at 5", "edit:log,food"],
    ["ate at 2 and then i did gym 3-4", "edit:food,log"],
    ["just got back from the gym", "workout"],
    ["i did gym earlier", "workout"],
    ["went for a 3 mile run", "workout"],
    ["i want six hours of sleep tonight", "edit:sleephours"],
    ["move gym to 9, and tell my mum i love her at 5", "none"],
    ["wake me at 6 and put gym at 7", "edit:wake,add"],
    ["what time is my alarm", "wake"],
    ["put the heating on at 6 and gym at 7", "none"],
    ["add milk to my list at 5", "none"],
    ["i did gym 2-3 not 4", "edit:log"],
    ["set the kettle on at 6", "none"],
];
describe("held out: 30 messages and the route each takes", () => {
    it("is 30", () => expect(CASES).toHaveLength(30));
    it.each(CASES)("%s -> %s", (m, want) => expect(routeOf(m)).toBe(want));
});
