// Wave 4 (gate run-1031202318 cluster 5), through the real routing: meal, gym history, bedtime, tired-with-sleep-data.
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
const HEALTH = (extra = {}) => JSON.stringify({ schema: "orion.health.v3", updatedAt: "2026-11-01T00:00:00Z", supplements: [], supplementLog: {}, workouts: [], ...extra });
const desk = () => ({ move: "answer", answer: "Sounds good. Did you finish your workout yet?" });
describe("health through the routing", () => {
    it("hea-log-meal: a meal is logged, never answered by the desk, never refused for being in the past", async () => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
        const v = await r.turn("had a big lunch, like pasta");
        expect(v.exact).toBe("Logged lunch at 1:00 PM: Pasta, big portion. That's 1 meal logged for today; I didn't guess calories.");
        const c = await r.turn("log lunch at 1pm: pasta, big portion");
        expect(c.exact).toMatch(/^Logged lunch at 1:00 PM: Pasta, big portion\. That's 2 meals/);
        expect(c.final).not.toMatch(/Exec failed|already over/);
        expect(r.writes).toEqual([]);
        expect(r.read("health-log.json").nutritionLog["2026-11-02"]).toHaveLength(2);
    });
    it("hea-gym-streak: answered from the real history, no weather", async () => {
        const workouts = ["2026-10-27", "2026-10-29", "2026-10-31", "2026-11-01"].map((day, i) => ({ id: String(i), day, startedAt: `${day}T18:00:00Z`, title: "", exercises: [], notes: "" }));
        const r = route(desk, { now: MON(20, 0), files: { "health-log.json": HEALTH({ workouts }) } });
        const v = await r.turn("have i been going to the gym");
        expect(v.exact).toMatch(/^Gym in the last 7 days: 4 of 7 days \(Tue, Thu, Sat, Sun\)\. Nothing logged for Wed, Fri\./);
        const c = await r.turn("how many gym days this week");
        expect(c.exact).toMatch(/^The week has only just started, so this is the last 7 days\. Gym in the last 7 days: 4 of 7/);
        expect(c.exact).not.toMatch(/weather|°C/i);
    });
    it("hea-bedtime-set: writes the existing bedtime preference and says what it did", async () => {
        const r = route(desk, { now: MON(20, 0), files: { "life-config.json": JSON.stringify({ gymMinutes: 90 }) } });
        const c = await r.turn("set my bedtime to 11:30 for the rest of the week");
        expect(r.read("life-config.json")).toEqual({ gymMinutes: 90, bedtime: "23:30" });
        expect(c.exact).toMatch(/^Bedtime is now 11:30 PM \(was 12:00 AM\)/);
        const v = await r.turn("i wanna sleep earlier this week");
        expect(r.read("life-config.json").bedtime).toBe("23:00");
        expect(v.exact).toMatch(/^Bedtime is now 11:00 PM \(was 11:30 PM\).*I picked 30 minutes earlier/);
    });
    it("hea-sleep-adjust: a lightened day opens with the real sleep numbers", async () => {
        const r = route(desk, { now: MON(8, 0), files: { "health-log.json": HEALTH({ days: { "2026-11-02": { sleepHours: 4.5, recovery: 31 } } }) } });
        const v = await r.turn("slept like garbage, fix my day");
        expect(v.exact).toMatch(/^Your health log has 4\.5 h of sleep and 31% recovery for last night\. Done: /);
        expect(v.exact).toMatch(/Classes untouched/);
        expect(r.writes.some((w) => w[0] === "drop" && /CS2100/.test(w[1] ?? ""))).toBe(false);
    });
    it("a question is not a health write", async () => {
        const r = route(desk, { now: MON(13, 0), files: { "health-log.json": HEALTH() } });
        await r.turn("what should i have for lunch");
        expect(r.read("health-log.json").nutritionLog).toBeUndefined();
    });
});
