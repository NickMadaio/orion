// W10-B (2026-11-02): the sleep-plan interview and the night exceptions. Reader, flow over a fake CLI, the real orion-sleepplan in a
// sandbox, and the routing hooks. Phrasings are Nick-style and held out (none appear in scripts/eval/gate/scenarios/). No real paths.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readException, readHabit, readSleepTurn, slotsOf } from "./sleep-plan-read.js";
import { draftArgs, runSleepTurn, SleepPlanPending, weekLine } from "./sleep-plan-flow.js";
import { registerLocalRouting } from "./local-routing.js";
const EVENING = new Date(2026, 10, 2, 21, 0);
const NOON = new Date(2026, 10, 2, 12, 0);
describe("habit statements start the interview (vague and clear)", () => {
    it.each([
        "im going to start waking up earlier and going to bed earlier",
        "trying to be up earlier from now on",
        "i wanna start getting up early for the gym",
        "i need to fix my sleep schedule",
        "can you help me sort out my sleep routine",
        "i want to become a morning person",
        "wanna shift to earlier wake ups",
        "i should start waking up early on weekdays",
        "wake me at 6 every weekday",
        "i wanna get up at 6:30 on gym days",
    ])("'%s'", (said) => { expect(readHabit(said)).toBeDefined(); });
    it.each([
        "wake me up at 7",
        "im going to bed earlier tonight",
        "i woke up late",
        "ill go to bed later",
        "i dont want to wake up earlier",
        "what time should i wake up?",
        "i like waking up early",
        "going to bed now",
        "add study at 6am tomorrow",
    ])("not '%s'", (said) => { expect(readHabit(said)).toBeUndefined(); });
    it("a one-shot carries every slot, and class times or 'the normal 9' are not wake days", () => {
        expect(slotsOf("6am mon wed thu, otherwise 9, 3h before class")).toEqual({ wake: "06:00", days: ["mon", "wed", "thu"], rest: "09:00", lead: 180 });
        expect(slotsOf("up at 6 only mon/wed/thu. at least 3 hours before a class. tue and fri my class is 1:30pm so normal 9am"))
            .toEqual({ wake: "06:00", days: ["mon", "wed", "thu"], rest: "09:00", lead: 180 });
        expect(slotsOf("6:30ish every day, like 2 and a half hrs before my first lecture")).toEqual({ wake: "06:30", days: ["all"], lead: 150 });
        expect(slotsOf("just gym days")).toEqual({ days: ["gym"] });
        expect(slotsOf("weekdays")).toEqual({ days: ["weekdays"] });
    });
    // W10-B review (live gate): the last time in a message became every day's wake; long and plural day names; one-shots missed.
    it("long, plural and abbreviated day names; a time said for other days never replaces the main one", () => {
        expect(slotsOf("Only on Tuesdays, Saturdays and Sundays. I want at least 2 hours before any class, and on Monday and Friday my lab is at 2pm so I'll get up at 10am as usual"))
            .toEqual({ days: ["tue", "sat", "sun"], rest: "10:00", lead: 120 });
        expect(slotsOf("thurs n fri n sat")).toEqual({ days: ["thu", "fri", "sat"] });
        expect(slotsOf("weds and mondays")).toEqual({ days: ["wed", "mon"] });
        expect(slotsOf("7am on tuesday and thursday and 8:30am on the other days")).toEqual({ wake: "07:00", days: ["tue", "thu"], rest: "08:30" });
        expect(slotsOf("up at 5:45 tue thu, 7 on sat")).toMatchObject({ wake: "05:45", days: ["tue", "thu"] });
        expect(slotsOf("6am mon fri, 8am wed")).toEqual({ wake: "06:00", days: ["mon", "fri"], also: [{ days: ["wed"], wake: "08:00" }] });
        expect(slotsOf("going forward 6:30 weekdays, rest of the week 10. 7 hours of sleep")).toEqual({ wake: "06:30", days: ["weekdays"], rest: "10:00", sleep: 7 });
    });
    it.each([
        ["going forward i'm up at 5:30 tue and thu for lifting, 9 otherwise. min 2h before class", { wake: "05:30", days: ["tue", "thu"], rest: "09:00" }],
        ["Please make my wake-up time 7am on Tuesdays and Thursdays and 10am the rest of the week, always 2 hours before the first lecture at least.", { wake: "07:00", days: ["tue", "thu"], rest: "10:00", lead: 120 }],
        ["every weekday i wanna be up by 7:15", { wake: "07:15", days: ["weekdays"] }],
    ])("a standing wake time is caught whole: '%s'", (said, slots) => {
        expect(readHabit(said)).toMatchObject(slots);
    });
    it("a standing alarm named with its days is direct; a one-off or a question is not caught", () => {
        expect(readHabit("set an alarm for 7 every tuesday and thursday")).toMatchObject({ wake: "07:00", days: ["tue", "thu"], direct: true });
        expect(readHabit("set an alarm for 7 tomorrow")).toBeUndefined();
        expect(readHabit("can i get up at 7 on tuesday?")).toBeUndefined();
    });
});
describe("answers inside the interview", () => {
    const held = (step, draft = {}) => ({ held: { step, draft }, now: EVENING });
    it("a rough time, which days, how long before class", () => {
        expect(readSleepTurn("prob 6", held("wake"))).toEqual({ kind: "interview", draft: { wake: "06:00" } });
        expect(readSleepTurn("like 7:30am", held("wake"))).toEqual({ kind: "interview", draft: { wake: "07:30" } });
        expect(readSleepTurn("only mon wed thu", held("days", { wake: "06:00" }))).toEqual({ kind: "interview", draft: { wake: "06:00", days: ["mon", "wed", "thu"] } });
        expect(readSleepTurn("every day tbh", held("days", { wake: "06:00" }))).toMatchObject({ draft: { days: ["all"] } });
        expect(readSleepTurn("3 hours", held("lead", { wake: "06:00", days: ["all"] }))).toMatchObject({ draft: { lead: 180 } });
        expect(readSleepTurn("like 2", held("lead", { wake: "06:00", days: ["all"] }))).toMatchObject({ draft: { lead: 120 } });
        expect(readSleepTurn("nah doesnt matter", held("lead", { wake: "06:00", days: ["all"] }))).toMatchObject({ draft: { lead: null } });
    });
    it("yes saves, no declines, a change re-previews, an unrelated turn drops it", () => {
        const d = { wake: "06:00", days: ["mon"], lead: 180 };
        expect(readSleepTurn("yep sounds right", held("confirm", d))).toEqual({ kind: "confirm", draft: d });
        expect(readSleepTurn("nah", held("confirm", d))).toEqual({ kind: "decline" });
        expect(readSleepTurn("make it 6:30am", held("confirm", d))).toEqual({ kind: "interview", draft: { ...d, wake: "06:30" } });
        expect(readSleepTurn("whats the weather like", held("confirm", d))).toBeUndefined();
        expect(readSleepTurn("hmm", held("wake"))).toEqual({ kind: "interview", draft: {}, reask: "wake" });
        expect(readSleepTurn("hmm", { held: { step: "wake", draft: {}, reasked: true }, now: EVENING })).toBeUndefined();
        expect(readSleepTurn("nvm", held("days", { wake: "06:00" }))).toEqual({ kind: "decline" });
    });
});
describe("exceptions by talk", () => {
    it.each([
        ["im out with friends tonight", "friends", undefined],
        ["doing coursework till 1", "schoolwork", "01:00"],
        ["gonna be at the pub late w the boys", "bar", undefined],
        ["heads up im at a party rn prob till 2am", "party", "02:00"],
        ["got an essay due tmrw morning so im up till 3 grinding it", "schoolwork", "03:00"],
    ])("'%s' → %s", (said, reason, until) => {
        expect(readException(said, EVENING)).toEqual({ kind: "except", reason, ...(until ? { until } : {}) });
    });
    it.each(["playing games till 2", "im gonna be on valorant late tonight", "staying up scrolling tiktok rn"])("'%s' is not a reason", (said) => {
        expect(readException(said, EVENING)?.kind).toBe("noexcept");
    });
    it("not in the daytime without 'tonight', not for tomorrow, not a request", () => {
        expect(readException("doing coursework till 1", NOON)).toBeUndefined();
        expect(readException("im out with friends tomorrow night", EVENING)).toBeUndefined();
        expect(readException("add coursework till 1", EVENING)).toBeUndefined();
    });
});
// A fake orion-sleepplan answering like the real one (days for Mon 11-02 evening).
const DAYS = [
    { date: "2026-11-03", weekday: "tue", wake: "09:00", reason: "usual", firstClass: { title: "MKTG2201", at: "13:30" }, evening: "2026-11-02", sleepBy: "00:00", lockdownAt: "03:00", exception: null },
    { date: "2026-11-04", weekday: "wed", wake: "06:00", reason: "plan", firstClass: { title: "CS1800", at: "09:00" }, evening: "2026-11-03", sleepBy: "22:00", lockdownAt: "00:00", exception: null },
    { date: "2026-11-05", weekday: "thu", wake: "06:00", reason: "plan", firstClass: { title: "CS2100", at: "10:00" }, evening: "2026-11-04", sleepBy: "22:00", lockdownAt: "00:00", exception: null },
    { date: "2026-11-06", weekday: "fri", wake: "09:00", reason: "usual", firstClass: { title: "MKTG2201", at: "13:30" }, evening: "2026-11-05", sleepBy: "00:00", lockdownAt: "03:00", exception: null },
    { date: "2026-11-07", weekday: "sat", wake: "09:00", reason: "usual", firstClass: null, evening: "2026-11-06", sleepBy: "00:00", lockdownAt: "03:00", exception: null },
    { date: "2026-11-08", weekday: "sun", wake: "09:00", reason: "usual", firstClass: null, evening: "2026-11-07", sleepBy: "00:00", lockdownAt: "03:00", exception: null },
    { date: "2026-11-09", weekday: "mon", wake: "06:00", reason: "plan", firstClass: { title: "CS1800", at: "09:00" }, evening: "2026-11-08", sleepBy: "22:00", lockdownAt: "00:00", exception: null },
];
// The same week with an early Friday class on a day he gave no time for: only then is the lead worth asking.
const EARLY_FRI = DAYS.map((d) => (d.weekday === "fri" ? { ...d, firstClass: { title: "ECON1115", at: "10:00" } } : d));
function fakeCli(o = {}) {
    const calls = [];
    const run = async (args) => {
        calls.push(args);
        if (o.error)
            return { stdout: JSON.stringify({ ok: false, error: o.error }), code: 2 };
        if (o.code)
            return { stdout: "NOTHING WAS SAVED: no", code: o.code };
        return { stdout: JSON.stringify({ ok: true, calendar: "ok", plan: { nudgeBeforeMin: 30, byDay: { mon: { wake: "06:00" }, wed: { wake: "06:00" }, thu: { wake: "06:00" } }, firstClassLeadMin: 180, ...o.plan }, days: o.days ?? DAYS }), code: 0 };
    };
    return { run, calls };
}
describe("the flow, multi-turn and one-shot", () => {
    it("asks wake, then days; the lead only when an untimed day has an early class; previews and saves on yes", async () => {
        const cli = fakeCli({ days: EARLY_FRI });
        const step = async (turn) => runSleepTurn(turn, { run: cli.run });
        const a = await step({ kind: "interview", draft: {} });
        expect(a.flow).toMatchObject({ outcome: "say", kind: "ask", text: "Love that. Roughly what time do you want to get up?" });
        const b = await step(readSleepTurn("6am for the gym", { held: a.pending, now: EVENING }));
        expect(b.flow).toMatchObject({ text: "Got it, 6:00. Every day, or just some days?" });
        expect(cli.calls).toEqual([]);
        const c = await step(readSleepTurn("only mon wed thu", { held: b.pending, now: EVENING }));
        expect(cli.calls[0]).toEqual(["plan", "--json", "--days", "mon,wed,thu", "--wake", "06:00", "--only", "--gym"]); // "6am for the gym": these are his gym days
        expect(c.flow).toMatchObject({ text: "And how long before a class do you want to be up?" });
        const d = await step(readSleepTurn("at least 3 hours", { held: c.pending, now: EVENING }));
        expect(cli.calls[1]).toEqual(["plan", "--json", "--days", "mon,wed,thu", "--wake", "06:00", "--only", "--lead", "180", "--gym"]);
        expect(d.flow).toMatchObject({ kind: "ask", text: "Mon 6:00 (class 9:00), Tue 9:00 (class 1:30), Wed 6:00 (class 9:00), Thu 6:00 (class 10:00), Fri 9:00 (class 10:00), weekend 9:00 — bed by 10pm the night before 6:00 days. Sound right?" });
        const e = await step(readSleepTurn("yeah perfect", { held: d.pending, now: EVENING }));
        expect(cli.calls[2]).toEqual(["set", "--days", "mon,wed,thu", "--wake", "06:00", "--only", "--lead", "180", "--gym", "--json"]);
        // The next alarm that really rings (Tue 9:00 is not his alarm): Wed 6:00, bed 10pm Tue.
        expect(e.flow).toMatchObject({ outcome: "done", reply: "Done, that's your plan now. Next alarm 6:00 Wed, so bed by 10pm Tue. I'll nudge you 30 min before bed." });
        expect(e.pending).toBeUndefined();
    });
    it("a wave-off to the lead question ('yeah') takes the 3 hours and moves on, no loop", async () => {
        const cli = fakeCli({ days: EARLY_FRI });
        const held = { step: "lead", draft: { wake: "06:00", days: ["mon", "wed", "thu"] } };
        const turn = readSleepTurn("yeah", { held, now: EVENING });
        expect(turn).toEqual({ kind: "interview", draft: { ...held.draft, lead: 180 } });
        expect((await runSleepTurn(turn, { run: cli.run })).pending?.step).toBe("confirm");
    });
    it("other days given their own time: straight to the summary, no lead question", async () => {
        const cli = fakeCli({ days: EARLY_FRI });
        const held = { step: "days", draft: { wake: "06:00" } };
        const turn = readSleepTurn("only mon wed thurs tho. tues n fri my class is at 1:30 so ill just get up at 9 like normal", { held, now: EVENING });
        expect(turn).toEqual({ kind: "interview", draft: { wake: "06:00", days: ["mon", "wed", "thu"], rest: "09:00" } });
        const out = await runSleepTurn(turn, { run: cli.run });
        expect(cli.calls[0]).toEqual(["plan", "--json", "--days", "mon,wed,thu", "--wake", "06:00", "--only", "--rest", "09:00"]);
        expect(out.pending?.step).toBe("confirm");
    });
    it("an alarm asked for outright with days is saved at once, in one line, without --only", async () => {
        const turn = readSleepTurn("pls set a 6:15am wake up alarm every mon, wed and thurs", { now: EVENING });
        expect(turn).toEqual({ kind: "interview", draft: { wake: "06:15", days: ["mon", "wed", "thu"], direct: true } });
        const cli = fakeCli({ plan: { byDay: { mon: { wake: "06:15" }, wed: { wake: "06:15" }, thu: { wake: "06:15" } } } });
        const out = await runSleepTurn(turn, { run: cli.run });
        expect(cli.calls).toEqual([["set", "--days", "mon,wed,thu", "--wake", "06:15", "--json"]]);
        expect(out.flow).toMatchObject({ outcome: "done" });
        expect(out.flow.reply).toMatch(/^Done, 6:15 alarm on Mon, Wed and Thu from now on\. Next alarm 6:00 Wed/);
    });
    it("gym days nobody can name: ORION asks which days, keeping the time", async () => {
        const turn = readSleepTurn("wake me up at 6 on gym days", { now: EVENING });
        expect(turn).toMatchObject({ kind: "interview", draft: { wake: "06:00", days: ["gym"], direct: true } });
        const out = await runSleepTurn(turn, { run: fakeCli({ error: "gym days unknown: no Gym block this week and no gym days set" }).run });
        expect(out.flow).toMatchObject({ kind: "ask", text: "Which days are gym days?" });
        expect(out.pending).toEqual({ step: "days", draft: { wake: "06:00", direct: true } });
        expect(readSleepTurn("mon wed n thu", { held: out.pending, now: EVENING })).toMatchObject({ draft: { wake: "06:00", days: ["mon", "wed", "thu"], direct: true } });
    });
    it("one message with everything skips straight to the preview", async () => {
        const cli = fakeCli();
        const turn = readSleepTurn("gonna start getting up earlier: 6am mon wed thu, otherwise 9, 3h before class", { now: EVENING });
        const out = await runSleepTurn(turn, { run: cli.run });
        expect(cli.calls[0]).toEqual(["plan", "--json", "--days", "mon,wed,thu", "--wake", "06:00", "--only", "--rest", "09:00", "--lead", "180"]);
        expect(out.pending?.step).toBe("confirm");
    });
    it("a save that fails says nothing changed; no is no", async () => {
        const out = await runSleepTurn({ kind: "confirm", draft: { wake: "06:00", days: ["mon"], lead: 180 } }, { run: fakeCli({ code: 2 }).run });
        expect(out.flow).toMatchObject({ outcome: "say", text: "I couldn't save that just now, so your sleep plan hasn't changed." });
        expect((await runSleepTurn({ kind: "decline" }, { run: fakeCli().run })).flow).toMatchObject({ text: "Okay, I left your sleep plan as it was." });
    });
    it("exceptions: kept from the CLI's answer; gaming is told the lockdown time, lightly", async () => {
        const cli = fakeCli();
        const yes = await runSleepTurn({ kind: "except", reason: "schoolwork", until: "01:00" }, { run: cli.run });
        expect(cli.calls[0]).toEqual(["except", "--date", "tonight", "--reason", "schoolwork", "--until", "01:00", "--json"]);
        expect(yes.flow).toMatchObject({ outcome: "done", reply: "Got it, no lockdown tonight till 1am. Good luck with it. Your alarm's still 9:00, so pace yourself." });
        const no = await runSleepTurn({ kind: "noexcept", activity: "Gaming" }, { run: cli.run });
        expect(cli.calls[1]).toEqual(["plan", "--json"]);
        expect(no.flow).toMatchObject({ text: "Gaming doesn't get you a pass, so the lockdown still kicks in at 3am. Friends or schoolwork, I'd let it slide." });
        const blank = await runSleepTurn({ kind: "except", reason: "friends" }, { run: fakeCli({ plan: { byDay: {}, firstClassLeadMin: null } }).run });
        expect(blank.flow).toMatchObject({ reply: "Got it, no lockdown tonight. Have fun." });
    });
    it("draft arguments and the week line", () => {
        expect(draftArgs({ wake: "06:00", days: ["gym"], lead: null })).toEqual(["--days", "gym", "--wake", "06:00", "--only", "--lead", "off"]);
        expect(weekLine(DAYS.slice(0, 2))).toBe("Tue 9:00 (class 1:30), Wed 6:00 (class 9:00) — bed by 10pm the night before 6:00 days.");
    });
    it("the pending interview expires and is taken once", () => {
        const p = new SleepPlanPending();
        p.set("k", { step: "wake", draft: {} }, 0);
        expect(p.take("k", SleepPlanPending.TTL_MS + 1)).toBeUndefined();
        p.set("k", { step: "wake", draft: {} }, 0);
        expect(p.take("k", 1000)).toEqual({ step: "wake", draft: {} });
        expect(p.take("k", 1000)).toBeUndefined();
    });
});
// The real scripts/orion-sleepplan in a sandbox (eval-mode + eval-calendar.json in a tmp ORION_CONTROLLED_DIR).
const SCRIPT = fileURLToPath(new URL("../../../scripts/orion-sleepplan", import.meta.url));
const dirs = [];
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
function sandboxRun(extra = [], now = EVENING) {
    const dir = mkdtempSync(join(tmpdir(), "sleepflow-"));
    dirs.push(dir);
    writeFileSync(join(dir, "eval-mode"), "");
    const ev = (d, h, m, dur, title) => { const s = new Date(2026, 10, d, h, m); return { identifier: `${title}-${d}`, title, allDay: "false", start: s.toISOString(), end: new Date(s.getTime() + dur * 60000).toISOString() }; };
    writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: now.toISOString(), events: [ev(3, 13, 30, 95, "MKTG2201 Lecture"), ev(4, 9, 0, 100, "CS1800 Lecture"), ev(5, 10, 0, 60, "CS2100 Lab"), ev(6, 13, 30, 95, "MKTG2201 Lecture"), ...extra.map((e) => ev(...e))] }));
    const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
    for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"])
        delete env[k];
    const run = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env }, (e, stdout, stderr) => resolve({ stdout: `${stdout}${e ? stderr : ""}`, code: e ? 1 : 0 })));
    return { run, dir };
}
const checkins = [];
function harness(run, now = EVENING, stateDir) {
    const handlers = new Map();
    const remembered = [];
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "sleepr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 21:00", now: () => now, ...(stateDir ? { stateDir } : {}),
        decideImpl: async () => ({ move: "escalate", tier: "standard" }),
        rememberRun: async (args) => { remembered.push(args); return { stdout: "remembered", code: 0 }; },
        sleepPlanRun: run,
        checkinRun: async (args) => { checkins.push(args); return { stdout: "ok ci-abc123", code: 0 }; },
    });
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `s${n += 1}`, sessionKey: "agent:main:orion-chat-sleep" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        if (direct?.reply?.text)
            return `DRAFT: ${direct.reply.text}`;
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
    };
    return { turn, remembered };
}
describe("through the routing hooks, against the real orion-sleepplan in a sandbox", () => {
    const savedPlan = (dir) => JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan;
    const SIX_MWT = { mon: { wake: "06:00" }, wed: { wake: "06:00" }, thu: { wake: "06:00" } };
    it("the clear interview: other days' times and the class rule in one long answer → the right week, saved only on his yes", async () => {
        const { run, dir } = sandboxRun();
        const h = harness(run);
        expect(await h.turn("im going to start waking up earlier and going to bed earlier")).toBe("Love that. Roughly what time do you want to get up?");
        expect(await h.turn("6am, for the gym")).toBe("Got it, 6:00. Every day, or just some days?");
        const preview = await h.turn("Just Mondays, Wednesdays and Thursdays. At least three hours before any class please, and Tuesdays and Fridays my lecture starts at 1:30pm so I'll be up at 9am like normal.");
        expect(preview).toBe("Mon 6:00, Tue 9:00 (class 1:30), Wed 6:00 (class 9:00), Thu 6:00 (class 10:00), Fri 9:00 (class 1:30), weekend 9:00 — bed by 10pm the night before 6:00 days. Sound right?");
        expect(() => readFileSync(join(dir, "eval-life-config.json"))).toThrow();
        expect(await h.turn("yep")).toBe("Done, that's your plan now. Next alarm 9:00 Tue, so bed by midnight Mon. I'll nudge you 30 min before bed.");
        expect(savedPlan(dir)).toMatchObject({ byDay: { ...SIX_MWT, tue: { wake: "09:00" }, fri: { wake: "09:00" } }, firstClassLeadMin: 180 });
        const plan = JSON.parse(readFileSync(join(dir, "eval-wake-plan.json"), "utf8"));
        expect(plan.source).toBe("nick");
        expect(plan.alarms.slice(0, 3).map((a) => `${a.date} ${a.at}`)).toEqual(["2026-11-03 09:00", "2026-11-04 06:00", "2026-11-05 06:00"]);
        expect(h.remembered).toEqual([]);
    }, 30000);
    it("the vague interview: other days 'like normal' skips the lead question and goes to the summary", async () => {
        const { run, dir } = sandboxRun();
        const h = harness(run);
        expect(await h.turn("ngl i gotta start getting up earlier")).toBe("Love that. Roughly what time do you want to get up?");
        expect(await h.turn("like 6 i guess")).toBe("Got it, 6:00. Every day, or just some days?");
        expect(await h.turn("just mon weds n thurs. tues/fri i dont have class till 1:30 so 9 like usual")).toMatch(/^Mon 6:00, Tue 9:00 \(class 1:30\), Wed 6:00.* Sound right\?$/);
        expect(await h.turn("ya")).toMatch(/^Done, that's your plan now\. Next alarm 9:00 Tue/);
        expect(savedPlan(dir).byDay).toMatchObject(SIX_MWT);
    }, 30000);
    it.each([
        "from now on im up at 6 mon wed and thurs for lifting, other days 9, and always 3h before class",
        "Make my wake time 6am on Monday, Wednesday and Thursday and 9am the rest of the week, and keep me up at least 3 hours before the first class. Plan on 8 hours of sleep.",
    ])("a one-shot standing wake time goes straight to the summary, then saves on yes: '%s'", async (said) => {
        const { run, dir } = sandboxRun();
        const h = harness(run);
        expect(await h.turn(said)).toMatch(/^Mon 6:00, Tue 9:00 \(class 1:30\), Wed 6:00 \(class 9:00\), Thu 6:00 \(class 10:00\), Fri 9:00.* Sound right\?$/);
        expect(await h.turn("yes that's right")).toMatch(/^Done, that's your plan now\. Next alarm 9:00 Tue, so bed by midnight Mon\./);
        expect(savedPlan(dir)).toMatchObject({ byDay: SIX_MWT, firstClassLeadMin: 180 });
    }, 30000);
    it("a repeating alarm with days is set directly; gym days come from Gym blocks, or ORION asks", async () => {
        const { run, dir } = sandboxRun([[3, 17, 0, 90, "Gym"], [5, 18, 0, 90, "Gym"]]);
        const h = harness(run);
        expect(await h.turn("set me a 6:45am wake up alarm on gym days")).toMatch(/^Done, 6:45 alarm on Tue and Thu from now on\./);
        expect(savedPlan(dir).byDay).toEqual({ tue: { wake: "06:45" }, thu: { wake: "06:45" } });
        const blank = sandboxRun();
        const g = harness(blank.run, EVENING, blank.dir); // with a state dir the health reader also sees "gym" here: the wake statement still wins
        expect(await g.turn("wake me up at 6 on gym days")).toBe("Which days are gym days?");
        expect(await g.turn("mon wed and fri")).toMatch(/^Done, 6:00 alarm on Mon, Wed and Fri from now on\./);
        expect(savedPlan(blank.dir).byDay).toEqual({ mon: { wake: "06:00" }, wed: { wake: "06:00" }, fri: { wake: "06:00" } });
    }, 30000);
    it("an unrelated turn clears the pending question; the next bare time is not an answer", async () => {
        const { run } = sandboxRun();
        const h = harness(run);
        expect(await h.turn("need to fix my sleep schedule fr")).toBe("Love that. Roughly what time do you want to get up?");
        expect(await h.turn("whats on my calendar tmrw")).toMatch(/^WORKER|^DRAFT/);
        expect(await h.turn("6am")).not.toMatch(/Every day, or just some days/);
    }, 30000);
    it("talking his way out of tonight's lockdown: friends yes, gaming no", async () => {
        const { run, dir } = sandboxRun();
        const h = harness(run);
        expect(await h.turn("heads up im out w friends tonight")).toBe("Got it, no lockdown tonight. Have fun.");
        expect(JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan.exceptions).toEqual([{ date: "2026-11-02", reason: "friends", until: null }]);
        expect(await h.turn("gonna be gaming till 2")).toBe("Gaming doesn't get you a pass, so the lockdown still kicks in at 3am. Friends or schoolwork, I'd let it slide.");
    }, 30000);
});
