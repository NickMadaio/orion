// w20 R3 (live gate #24 #27 #68): water logged by the bottle, calories read from the health log, through the real routing.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const SPOKEN = "";
const MON = (h, m = 0) => new Date(2026, 10, 2, h, m);
const DAY = { date: "2026-11-02", now: null, blocks: [
        { title: "CS2100 Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
    ] };
function route(decide, opts = {}) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "wave4h-"));
    for (const [name, text] of Object.entries(opts.files ?? {}))
        writeFileSync(join(dir, name), text);
    const writes = [];
    const sessionCalls = [];
    const flows = [];
    const sessionFlows = [];
    let clock = (opts.now ?? MON(13, 0)).getTime();
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon 13:00", now: () => new Date(clock),
        decideImpl: async (i) => decide(i.message), brainSearch: async () => "",
        scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "test" }; },
        readDayJson: async () => opts.day ?? DAY, readDeadlines: async () => ({ events: [], tasks: [] }),
        realityRun: async (_s, args) => { writes.push(args); return { stdout: args[0] === "add" ? `Booked ${args[1]} 21:00–22:00` : "ok", code: 0 }; },
        extractReminder: async (m) => ({ time: /\b6\b/.test(m) ? "18:00" : null, label: m.includes("alarm") ? "the army is coming" : "call my mom" }),
        listReminders: async () => [], });
    let n = 0;
    const turn = async (prompt, opt = {}) => {
        const ctx = { runId: `w-${n += 1}`, sessionKey: "agent:main:orion-chat-wave2" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        const tool = opt.command ? (await fire("before_tool_call", { toolName: "exec", params: { command: opt.command } }, ctx)).find(Boolean) : undefined;
        const messages = [{ role: "assistant", content: [{ type: "text", text: opt.reply ?? exact ?? "ok" }] }];
        const [fin] = (await fire("before_agent_finalize", { lastAssistantMessage: opt.reply ?? exact ?? "ok", messages }, ctx));
        return { exact, built, direct: direct?.reply?.text, tool, fin, final: JSON.stringify(messages) };
    };
    return { turn, writes, dir, read: (name) => JSON.parse(readFileSync(join(dir, name), "utf8")) };
}
const HEALTH = (extra = {}) => JSON.stringify({ schema: "orion.health.v3", updatedAt: "2026-11-01T00:00:00Z", supplements: [], supplementLog: {}, workouts: [],
    days: { "2026-11-02": { waterBottles: 3, calories: 0, supplementIDs: [], updatedAt: "" } }, ...extra });
const desk = () => ({ move: "answer", answer: "Sounds good. Did you finish your workout yet?" });
const FOOD = { "2026-11-02": [{ id: "a", title: "Big Mac", meal: "Lunch", calories: 770, protein: 36 }, { id: "b", title: "Chicken wrap", meal: "Dinner", calories: 430, protein: 31 }] };
describe("water by the bottle", () => {
    it.each([
        ["had a big bottle of water", 1], ["just finished a bottle", 1], ["drank 2 bottles of water", 2], ["had another bottle of water lol", 1], ["downed a couple bottles of water", 2],
    ])("%s logs %i bottle(s), never the worker's guess", async (msg, n) => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
        const v = await r.turn(msg);
        expect(v.exact).toMatch(new RegExp(`^Logged ${n} bottle${n === 1 ? "" : "s"}:`));
        expect(r.writes).toEqual([]);
    });
    it.each(["had a glass of water", "drank some water", "chugged a litre of water"])("%s asks how many bottles instead of guessing", async (msg) => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
        const v = await r.turn(msg);
        expect(v.exact).toMatch(/How many bottles/);
    });
});
describe("calories from the health log", () => {
    it.each(["how many calories have i had today", "hows my calories looking today", "whats my calorie count so far", "how many cals ive had", "calories so far today?"])("%s is answered from the file", async (msg) => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH({ nutritionLog: FOOD }) } });
        const v = await r.turn(msg);
        expect(v.exact).toBe("You've had 1200 kcal today, from Big Mac, Chicken wrap.");
    });
    it("says so when nothing is logged", async () => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
        expect((await r.turn("how many calories have i had today")).exact).toBe("Nothing's logged for food today, so that's 0 kcal.");
    });
    it("protein too, and the goal when there is one", async () => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH({ nutritionLog: FOOD, nutritionGoals: { calories: 2400 } }) } });
        expect((await r.turn("how much protein have i had today")).exact).toBe("You've had 67 g of protein today, from Big Mac, Chicken wrap.");
        expect((await r.turn("how many calories have i had today")).exact).toBe("You've had 1200 of 2400 kcal today, from Big Mac, Chicken wrap.");
    });
    it("calories in a food are not his day", async () => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH({ nutritionLog: FOOD }) } });
        expect((await r.turn("how many calories in a big mac")).exact).toBeUndefined();
    });
});
describe("a nutrition fact question is the model's, not a day summary (gate #51)", () => {
    it.each([
        "is it bad to eat rice after the gym or whats the deal with carbs at night",
        "is creatine worth it or is that hype",
        "does caffeine late in the day wreck your sleep",
    ])("%s gets the textbook prompt and no calendar", async (msg) => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
        const v = await r.turn(msg);
        expect(v.built?.systemPrompt).toMatch(/general-knowledge question/);
        expect(v.built?.systemPrompt).not.toMatch(/CS2100/);
        expect(v.direct).toBeUndefined();
    });
});
describe("dark slang gets the tease and nothing more (gate #52)", () => {
    it("answers directly with no model reply", async () => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
        const v = await r.turn("hate my life lol wifi is dead");
        expect(v.direct).toMatch(/wifi/);
        expect(v.direct).not.toMatch(/sorry|try again|in a bit/i);
    });
});
