// Gate run-1031224700, wave 5 "writes": the plugin half. Exact messages from results.jsonl, plus held-out paraphrases in Nick's
// style that appear nowhere in scripts/eval/gate/scenarios/.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { compile } from "./schedule-flow.js";
import { spokenReply } from "./schedule-reply.js";
import { asksToShiftAfter, namesOwnEvent, newStartFor, overrunIsMove } from "./own-event-writes.js";
import { isSessionStart, parseSessionRequest } from "./session-flow.js";
import { checkWork } from "./work-check.js";
import { GENERAL_INSTRUCTIONS } from "./job-instructions.js";
// The gate sandbox's titles are bare course codes; Nick's live calendar has the long titles. Both must work.
const MKTG = { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" };
const day = (now, extra = []) => ({ date: "2026-11-02", now, blocks: [
        MKTG,
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
        ...extra,
    ].sort((a, b) => a.start.localeCompare(b.start)) });
const at = (hm) => { const [h, m] = hm.split(":").map(Number); return new Date(2026, 10, 2, h, m); };
function route(opts) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "w5write-"));
    const calls = [];
    const sessions = [];
    const d = opts.day ?? day(opts.now);
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => `Mon ${opts.now}`, now: () => at(opts.now),
        decideImpl: async () => opts.decide ?? { move: "escalate" }, brainSearch: async () => "",
        readDayJson: async () => d, readDay: async () => JSON.stringify(d), readDeadlines: async () => ({ events: [], tasks: [] }),
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
        sessionFlow: async (m) => { sessions.push(m); return opts.sessionFlow ? opts.sessionFlow(m) : { outcome: "done", calls: ["exec orion-session start econ --json"], outputs: ["{}"], reply: "Focus session started on econ, until 10:50 AM." }; },
        realityRun: async (script, args) => { calls.push([script, ...args]); return { stdout: opts.out?.(script, args) ?? (script === "orion-declare" ? '{"id":"fact-abcd1234"}' : "Changed Monday 2026-11-02:\n  done"), code: 0 }; },
    });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `w5w-${n += 1}`, sessionKey: "agent:main:orion-chat-w5write" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        return { exact: direct?.reply?.text ?? exact };
    };
    return { turn, calls, sessions, writes: () => calls.filter((c) => c[0] === "orion-reschedule") };
}
describe("sch-move-fixed-named: a class he names moves to the time he says", () => {
    it("v 'marketing is moved to 2pm today thx': the form's move of the named class is compiled, not refused", () => {
        expect(compile({ do: "move", what: "B1", to: "14:00" }, day("10:00"), "marketing is moved to 2pm today thx")).toEqual({ args: ["move", "MKTG2201", "--to", "14:00"] });
    });
    it("a class he did NOT name is still never moved by the form", () => {
        expect(compile({ do: "move", what: "B1", to: "14:00" }, day("10:00"), "move my stuff to 2pm")).toHaveProperty("error");
        // The class as an anchor is not the class being moved, even if the form picks it.
        expect(compile({ do: "move", what: "B1", to: "16:00" }, day("10:00"), "move gym to 4 after marketing")).toHaveProperty("error");
        expect(compile({ do: "move", what: "B1", to: "16:00" }, day("10:00"), "move marketing pls")).toHaveProperty("error");
    });
    it("c 'move my MKTG2201 class today from 1:30 to 2pm, its running late': the form's overrun is the move he asked for", () => {
        expect(compile({ do: "overrun", what: "B1", minutes: 30 }, day("10:00"), "move my MKTG2201 class today from 1:30 to 2pm, its running late")).toEqual({ args: ["move", "MKTG2201", "--to", "14:00"] });
    });
    it.each([
        ["prof pushed marketing to 3 today", "15:00"],
        ["mktg got moved to 2:15 fyi", "14:15"],
        ["heads up marketing's at 2 instead today", "14:00"],
    ])("held-out: %s", (m, to) => {
        expect(namesOwnEvent(m, MKTG)).toBe(true);
        expect(newStartFor(m, MKTG)).toBe(to);
        expect(overrunIsMove(m, MKTG)).toEqual(["move", "MKTG2201", "--to", to]);
    });
    it("the long live title is named the same way, and a different class is not", () => {
        const live = { ...MKTG, title: "MKTG2201 Introduction to Marketing — Lecture" };
        expect(namesOwnEvent("marketing is moved to 2pm today thx", live)).toBe(true);
        expect(namesOwnEvent("econ got moved to 3", MKTG)).toBe(false);
        expect(namesOwnEvent("i was making dinner", MKTG)).toBe(false);
    });
    it("the scheduler's line is said back as done", () => {
        expect(spokenReply(["Changed Monday 2026-11-02:\n  MKTG2201 moved: 13:30 → 14:00–16:00\nWritten to his calendar (this day only). \"orion-reschedule undo\" puts it back."])).toBe("Done: MKTG2201 now 2:00 PM–4:00 PM.");
    });
});
describe("rea-class-late: lost time after a class", () => {
    it("c 'shift my stuff after it by 30': the overrun carries --shift", () => {
        expect(compile({ do: "overrun", what: "B1", minutes: 30 }, day("15:20"), "marketing is running 30 min over, shift my stuff after it by 30")).toEqual({ args: ["overrun", "30", "--what", "MKTG2201", "--shift"] });
    });
    it("a plain overrun stays an overrun (the cascade only moves what no longer fits)", () => {
        expect(compile({ do: "overrun", what: "B1", minutes: 20 }, day("15:20"), "marketing is going 20 min over")).toEqual({ args: ["overrun", "20", "--what", "MKTG2201"] });
    });
    it.each(["cs lab is going 20 min over, push everything after it back 20", "econ's running 15 mins long, bump the rest of my day by 15", "discrete is running 45 minutes over so slide my stuff after by 45 pls"])("held-out shift ask: %s", (m) => {
        expect(asksToShiftAfter(m)).toBe(true);
    });
    it.each(["marketing is running over lol", "dont push anything, class is just running 10 over", "push gym to 6"])("not a shift ask: %s", (m) => expect(asksToShiftAfter(m)).toBe(false));
    it("the reality path passes --shift and says what moved", async () => {
        const r = route({ now: "15:20", day: day("15:20", []).blocks.length ? { ...day("15:20"), blocks: day("15:20").blocks.map((b) => (b.title === "MKTG2201" ? { ...b, title: "MKTG2201 Introduction to Marketing" } : b)) } : day("15:20"),
            out: () => "Changed Monday 2026-11-02:\n  MKTG2201 runs 30 min over (until 16:00); what comes after it moved 30 min later:\n  moved Gym: 17:00 → 17:30\n  moved Side project: 19:30 → 20:00\nWritten to his calendar." });
        const t = await r.turn("marketing is running 30 min over, shift my stuff after it by 30");
        expect(r.writes()).toEqual([["orion-reschedule", "overrun", "30", "--what", "MKTG2201", "--shift"]]);
        expect(t.exact).toMatch(/Gym: 5:00 PM → 5:30 PM/);
        expect(t.exact).toMatch(/Side project: 7:30 PM → 8:00 PM/);
    });
    it("v: when nothing has to move, ORION says so with the reason, never that it pushed anything", async () => {
        const live = { ...day("15:20"), blocks: day("15:20").blocks.map((b) => (b.title === "MKTG2201" ? { ...b, title: "MKTG2201 Introduction to Marketing" } : b)) };
        const r = route({ now: "15:20", day: live, out: () => "Nothing needed to move: Gym 17:00 still fits after MKTG2201 Introduction to Marketing running over (clear by 16:30)." });
        const t = await r.turn("marketing is running over lol");
        expect(r.writes()[0]?.slice(0, 2)).toEqual(["orion-reschedule", "overrun"]);
        expect(t.exact).toMatch(/Nothing has to move/);
        expect(t.exact).toMatch(/Gym at 5:00 PM still fits/);
        expect(t.exact).not.toMatch(/pushed|couldn't/i);
    });
    it.each(["marketing is running over lol", "mktg is going long ugh", "marketing's dragging over"])("v with the sandbox's bare code title: %s reaches the overrun", async (m) => {
        const r = route({ now: "15:20", out: () => "Nothing needed to move: Gym 17:00 still fits after MKTG2201 running over (clear by 16:30)." });
        const t = await r.turn(m);
        expect(r.writes()).toEqual([["orion-reschedule", "overrun", "15", "--what", "MKTG2201"]]);
        expect(t.exact).toMatch(/my guess is 15 minutes/);
    });
});
describe("rea-spontaneous-nap-v: a nap with no times never lands on his class", () => {
    it("'took a nap lol' at 3:30 PM right after class: the guess goes before the class and says so", async () => {
        const r = route({ now: "15:30", out: () => "Changed Monday 2026-11-02:\n  Logged Nap 12:45–13:30." });
        const t = await r.turn("took a nap lol");
        expect(r.writes()).toEqual([["orion-reschedule", "log", "Nap", "--from", "12:45", "--to", "13:30"]]);
        expect(t.exact).toMatch(/MKTG2201 until 3:30 PM/);
        expect(t.exact).toMatch(/tell me/i);
    });
    it.each(["just had a nap haha", "ok i napped", "fell asleep oops"])("held-out: %s", async (m) => {
        const r = route({ now: "15:30", out: () => "Changed Monday 2026-11-02:\n  Logged Nap 12:45–13:30." });
        await r.turn(m);
        expect(r.writes()[0]).toEqual(["orion-reschedule", "log", "Nap", "--from", "12:45", "--to", "13:30"]);
    });
    it("with free time before now, the nap still ends now", async () => {
        const r = route({ now: "17:00", day: day("17:00").blocks ? { ...day("17:00"), blocks: day("17:00").blocks.filter((b) => b.title !== "Gym") } : day("17:00") });
        await r.turn("took a nap lol");
        expect(r.writes()[0]).toEqual(["orion-reschedule", "log", "Nap", "--from", "16:15", "--to", "now"]);
    });
});
describe("foc-start-v: a casual 'let's work on X' starts a focus session in code", () => {
    it.each([
        ["ok lets work on econ", "econ"],
        ["aight gonna knock out some macro rn", "macro"],
        ["ok time to grind cs", "cs"],
        ["lemme get on the essay", "the essay"],
        ["right lets crack on with the problem set", "the problem set"],
    ])("%s", (m, task) => {
        expect(isSessionStart(m)).toBe(true);
        expect(parseSessionRequest(m)?.task).toBe(task);
    });
    it.each(["lets work on econ tomorrow", "i need to work on econ at some point", "what should i work on", "worked on econ earlier", "lets do lunch", "lets do it", "gonna do the dishes", "ok lets hit the gym", "gonna work on econ later tonight", "ok lets work on econ at 4"])("not a start now: %s", (m) => {
        expect(isSessionStart(m)).toBe(false);
    });
    it("the exact gate turn takes the code path even when the desk picked app_open", async () => {
        const r = route({ now: "10:00", decide: { move: "tool", tool: "app_open", args: { application: "Econ" }, say: "Opening Econ on your Mac." } });
        const t = await r.turn("ok lets work on econ");
        expect(r.sessions).toEqual(["ok lets work on econ"]);
        expect(t.exact ?? "").not.toMatch(/tool|available|retry/i);
    });
});
describe("no tool-availability chatter reaches Nick", () => {
    it("a reply about an unavailable tool is a finding (revised before he sees it)", () => {
        const reply = "I can't use the tool \"orion-session\" here because it isn't available. I need to stop retrying it and answer without that tool.";
        expect(checkWork({ reply, turnResults: [], finished: true })).toContain("talks about its tools");
        expect(checkWork({ reply: "Focus session started on econ until 10:50 AM.", turnResults: [], finished: true, provided: true })).not.toContain("talks about its tools");
    });
    it("the worker is told scripts run through exec, never as tools of their own", () => {
        expect(GENERAL_INSTRUCTIONS).toMatch(/not tools of their own/);
    });
});
