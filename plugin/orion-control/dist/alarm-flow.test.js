// W18 wake: one morning's alarm through the routing hooks, against the real orion-sleepplan in a sandbox (eval-mode + a calendar in a
// tmp dir). Held-out Nick-style phrasings; no real paths. The phone link's status and the phone's receipt are written into the tmp HOME.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { dayLabel, runAlarmTurn, wakeDateArg } from "./alarm-flow.js";
import { registerLocalRouting } from "./local-routing.js";
const EVENING = new Date(2026, 10, 2, 21, 0); // Mon
const AFTERNOON = new Date(2026, 10, 3, 15, 0); // Tue
const SCRIPT = fileURLToPath(new URL("../../../scripts/orion-sleepplan", import.meta.url));
const dirs = [];
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
function sandbox(now, { link = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "alarmflow-"));
    dirs.push(dir);
    writeFileSync(join(dir, "eval-mode"), "");
    writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: now.toISOString(), events: [] }));
    if (link) {
        const status = join(dir, "Library/Application Support/ORION Link");
        mkdirSync(status, { recursive: true });
        writeFileSync(join(status, "status.json"), JSON.stringify({ writtenAt: new Date().toISOString() }));
    }
    const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
    for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"])
        delete env[k];
    const run = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env }, (e, stdout, stderr) => resolve({ stdout: `${stdout}${e ? stderr : ""}`, code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
    return { run, dir };
}
function harness(run, now) {
    const handlers = new Map();
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "alarmr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 21:00", now: () => now,
        decideImpl: async () => ({ move: "escalate", tier: "standard" }),
        rememberRun: async () => ({ stdout: "remembered", code: 0 }),
        sleepPlanRun: run,
    });
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    let n = 0;
    return async (prompt) => {
        const ctx = { runId: `a${n += 1}`, sessionKey: "agent:main:orion-chat-alarm" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        if (direct?.reply?.text)
            return `DRAFT: ${direct.reply.text}`;
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
    };
}
const plan = (dir) => JSON.parse(readFileSync(join(dir, "eval-wake-plan.json"), "utf8"));
const stored = (dir) => JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan;
describe("dates", () => {
    it("tomorrow is the coming morning, even after midnight; a bare time is its next occurrence", () => {
        expect(wakeDateArg("tomorrow", "07:00", EVENING)).toBe("2026-11-03");
        expect(wakeDateArg("tomorrow", "07:00", new Date(2026, 10, 3, 1, 10))).toBe("2026-11-03");
        expect(wakeDateArg(undefined, "06:45", EVENING)).toBe("2026-11-03");
        expect(wakeDateArg(undefined, "06:45", new Date(2026, 10, 3, 2, 0))).toBe("2026-11-03");
        expect(wakeDateArg("sat", "07:00", EVENING)).toBe("sat");
        expect(dayLabel("2026-11-03", EVENING)).toBe("tomorrow");
        expect(dayLabel("2026-11-07", EVENING)).toBe("Saturday");
    });
});
describe("through the routing hooks, against the real orion-sleepplan", () => {
    it("wake me up at 7 tomorrow: saved, the bedtime follows, and the phone line is honest about a dead link", async () => {
        const { run, dir } = sandbox(EVENING);
        const turn = harness(run, EVENING);
        expect(await turn("yo wake me up at 7 tmrw")).toBe("Alarm set for 7am tomorrow. Bedtime target 11pm. Saved, but the phone link isn't running on this Mac, so your phone gets it when the link is back.");
        expect(stored(dir).overrides).toEqual({ "2026-11-03": "07:00" });
        expect(plan(dir).alarms.map((a) => `${a.date} ${a.at}`)).toEqual(["2026-11-03 07:00"]);
        expect(plan(dir).bedtimes.find((b) => b.date === "2026-11-02").sleepBy).toBe("23:00");
    }, 30000);
    it("move my alarm to 6:45: the example reply, 'sent' while the link is up and no receipt; 'set on your phone' only on the phone's receipt", async () => {
        const { run, dir } = sandbox(EVENING, { link: true });
        const turn = harness(run, EVENING);
        expect(await turn("can u move my alarm to 645")).toBe("Alarm set for 6:45am tomorrow. Bedtime target 10:45pm. Sent to your phone.");
        const iso = plan(dir).alarms[0].iso;
        writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneAlarms: { at: new Date().toISOString(), fires: [iso], state: "Set for 06:45" } }));
        expect(await turn("what time is my alarm")).toBe("Next alarm 6:45am tomorrow. Bedtime target 10:45pm. It's set on your phone.");
    }, 30000);
    it("w18 audit2, 11-03 22:39: his spoken 'six thirty' moves the alarm, never a calendar failure line", async () => {
        const { run, dir } = sandbox(EVENING, { link: true });
        const turn = harness(run, EVENING);
        for (const said of ["try and scratch that. Can you push my wake time to six thirty?", "Alright. Can you instead push my wake time to six thirty instead of six?", "Push my wake up time to six AM."]) {
            const reply = await turn(said);
            expect(reply, said).toMatch(/^Alarm set for 6(?::30)?am tomorrow/);
            expect(reply, said).not.toMatch(/calendar|couldn't make that change|WORKER/);
        }
        expect(plan(dir).alarms[0].at).toBe("06:00");
    }, 30000);
    it("i want to start waking up at 7 on weekdays: saved at once for those days, no questions", async () => {
        const { run, dir } = sandbox(EVENING, { link: true });
        const turn = harness(run, EVENING);
        expect(await turn("i want to start waking up at 7 on weekdays")).toBe("Done, 7:00 alarm on Mon, Tue, Wed, Thu and Fri from now on. Next alarm 7:00 Tue, so bed by 11pm Mon. I'll nudge you 30 min before bed.");
        expect(stored(dir).byDay).toEqual({ mon: { wake: "07:00" }, tue: { wake: "07:00" }, wed: { wake: "07:00" }, thu: { wake: "07:00" }, fri: { wake: "07:00" } });
        expect(plan(dir).source).toBe("nick");
    }, 30000);
    it("no alarm saturday: that one date goes, the standing weekend alarm stays", async () => {
        const { run, dir } = sandbox(EVENING, { link: true });
        const turn = harness(run, EVENING);
        expect(await turn("set an alarm for 9am every weekend")).toMatch(/^Done, 9:00 alarm on Sat and Sun/);
        expect(await turn("no alarm saturday")).toBe("No alarm Saturday. Sent to your phone.");
        expect(stored(dir).overrides).toEqual({ "2026-11-07": "off" });
        expect(plan(dir).alarms.map((a) => a.date)).toEqual(["2026-11-08"]);
        expect(await turn("no alarms on weekends from now on")).toBe("No alarm on weekends from now on. Sent to your phone.");
        expect(stored(dir).byDay).toEqual({});
    }, 30000);
    it("push it back 20 min at night moves the next alarm, and again in the afternoon once an alarm was just discussed", async () => {
        const night = sandbox(EVENING, { link: true });
        const turn = harness(night.run, EVENING);
        await turn("wake me up at 6:45 tomorrow");
        expect(await turn("push it back 20 min")).toBe("Pushed your alarm back 20 min, now 7:05am tomorrow. Bedtime target 11:05pm. Sent to your phone.");
        expect(plan(night.dir).alarms[0].at).toBe("07:05");
        const day = sandbox(AFTERNOON, { link: true });
        const t2 = harness(day.run, AFTERNOON);
        expect(await t2("push it back 20 min")).not.toMatch(/alarm/i); // no alarm in play at 3pm: not ours
        await t2("whats my alarm");
        await t2("wake me at 8 tomorrow");
        expect(await t2("push it back 20 min")).toMatch(/^Pushed your alarm back 20 min, now 8:20am tomorrow/);
    }, 40000);
    it("nothing to move or read when no alarm is set", async () => {
        const { run, dir } = sandbox(EVENING, { link: true });
        const turn = harness(run, EVENING);
        expect(await turn("push my alarm back half an hour")).toBe("You don't have an alarm set for the next morning, so there's nothing to move. Tell me a time and I'll set one.");
        expect(await turn("what time is my alarm")).toBe("You don't have an alarm set right now. Tell me a time and I'll set one.");
        expect(() => readFileSync(join(dir, "eval-wake-plan.json"))).toThrow();
    }, 30000);
    it("a failing CLI never claims a change", async () => {
        const run = async () => ({ stdout: "boom", code: 1 });
        const out = await runAlarmTurn({ kind: "set", time: "07:00", day: "tomorrow" }, { run, now: EVENING });
        expect(out.flow).toEqual({ outcome: "say", kind: "plain", text: "I couldn't set that just now, so your alarm is as it was." });
    });
});
