// W10-B review 3 (gate run-1102024210, hea-bedtime-set-v): "i wanna sleep earlier this week" started the wake interview ("Roughly what
// time do you want to get up?"). Sleep only, with nothing about waking, is a bedtime change said and saved in one reply; waking (alone or
// with sleep) is still the interview. Held-out phrasings (none appear in scripts/eval/gate/scenarios/). No real paths.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readBedShift, readHabit, readSleepTurn } from "./sleep-plan-read.js";
import { runSleepTurn } from "./sleep-plan-flow.js";
import { registerLocalRouting } from "./local-routing.js";
const EVENING = new Date(2026, 10, 2, 20, 0);
describe("sleep only is a bedtime change; waking is the interview", () => {
    it.each([
        ["tryna get to bed earlier for the rest of the week", undefined],
        ["gonna start going to bed earlier this semester", undefined],
        ["ok so from now on i wanna be sleeping earlier", undefined],
        ["need to start crashing earlier, like 11", "23:00"],
        ["earlier bedtime from now on pls", undefined],
        ["i should be sleeping earlier, around 10:30", "22:30"],
    ])("'%s' → bedtime %s", (said, time) => {
        expect(readHabit(said)).toBeUndefined();
        expect(readBedShift(said)).toEqual(time ? { time } : {});
        expect(readSleepTurn(said, { now: EVENING })).toEqual({ kind: "bedtime", ...(time ? { time } : {}) });
    });
    it.each(["going to bed earlier tonight", "set my bedtime to 11:30 for the rest of the week", "should i go to bed earlier?", "i dont wanna sleep earlier", "i went to bed early"])("not a bedtime shift: '%s'", (said) => {
        expect(readBedShift(said)).toBeUndefined();
    });
    it.each(["wanna start sleeping earlier and getting up earlier", "trying to be up earlier from now on"])("waking is still the interview: '%s'", (said) => {
        expect(readSleepTurn(said, { now: EVENING })?.kind).toBe("interview");
    });
});
describe("the bedtime reply, from the CLI's answer", () => {
    const out = (o) => async () => ({ stdout: JSON.stringify({ ok: true, calendar: "ok", plan: {}, ...o }), code: 0 });
    const DAY = { date: "2026-11-03", weekday: "tue", wake: "09:00", reason: "usual", firstClass: null, evening: "2026-11-02", sleepBy: "23:30", nudgeAt: "23:00", lockdownAt: "03:00", exception: null };
    it("no time named: 30 min earlier, said as an assumption; the nudge; the wake-up and the hours", async () => {
        const calls = [];
        const run = async (a) => { calls.push(a); return out({ bedtime: "23:30", was: "00:00", days: [DAY] })(); };
        const r = await runSleepTurn({ kind: "bedtime" }, { run });
        expect(calls).toEqual([["bedtime", "earlier", "--json"]]);
        expect(r.flow).toMatchObject({ outcome: "done", reply: "Bedtime's now 11:30pm (was midnight) and stays that way till you change it; I'll nudge you at 11pm. Your 9:00 wake-up Tue doesn't move, so that's 9½h of sleep. I went 30 minutes earlier since you didn't name a time; say one if you want another." });
    });
    it("a time he named is passed through; a failure claims nothing", async () => {
        const calls = [];
        await runSleepTurn({ kind: "bedtime", time: "23:00" }, { run: async (a) => { calls.push(a); return out({ bedtime: "23:00", was: "00:00", days: [{ ...DAY, sleepBy: "23:00", nudgeAt: "22:30" }] })(); } });
        expect(calls[0]).toEqual(["bedtime", "23:00", "--json"]);
        const bad = await runSleepTurn({ kind: "bedtime" }, { run: async () => ({ stdout: "NOTHING WAS SAVED", code: 2 }) });
        expect(bad.flow).toMatchObject({ outcome: "say", text: "I couldn't change your bedtime just now, so it's as it was." });
    });
});
// Through the hooks against the real orion-sleepplan in a sandbox, with a state dir so the health reader sees the phrase too.
const SCRIPT = fileURLToPath(new URL("../../../scripts/orion-sleepplan", import.meta.url));
const dirs = [];
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
function sandbox() {
    const dir = mkdtempSync(join(tmpdir(), "sleeprev3-"));
    dirs.push(dir);
    writeFileSync(join(dir, "eval-mode"), "");
    writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: EVENING.toISOString(), events: [] }));
    const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
    for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"])
        delete env[k];
    const run = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env }, (e, stdout, stderr) => resolve({ stdout: `${stdout}${e ? stderr : ""}`, code: e ? 1 : 0 })));
    return { run, dir };
}
function harness(run, stateDir) {
    const handlers = new Map();
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "sleeprev3r-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 20:00", now: () => EVENING,
        stateDir, decideImpl: async () => ({ move: "escalate", tier: "standard" }), sleepPlanRun: run,
    });
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    let n = 0;
    return async (prompt) => {
        const ctx = { runId: `b${n += 1}`, sessionKey: "agent:main:orion-chat-rev3" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        if (direct?.reply?.text)
            return `DRAFT: ${direct.reply.text}`;
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
    };
}
describe("through the hooks", () => {
    it("'tryna get to bed earlier for the rest of the week': one reply, saved to the eval config, never the wake interview", async () => {
        const { run, dir } = sandbox();
        const turn = harness(run, dir);
        const reply = await turn("tryna get to bed earlier for the rest of the week");
        expect(reply).toBe("Bedtime's now 11:30pm (was midnight) and stays that way till you change it; I'll nudge you at 11pm. Your 9:00 wake-up Tue doesn't move, so that's 9½h of sleep. I went 30 minutes earlier since you didn't name a time; say one if you want another.");
        expect(JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).bedtime).toBe("23:30");
        expect(() => readFileSync(join(dir, "life-config.json"))).toThrow();
    }, 30000);
});
