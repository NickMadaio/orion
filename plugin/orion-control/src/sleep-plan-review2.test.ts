// W10-B review 2 (live gate run-1102020539): a casual "ye" to the summary went to the model and nothing was saved; a late-night "one more
// game" / "another hour" got a curt bedtime-stall reply or a GYM nudge; "gym days" picked every day from the daily Gym block.
// Held-out phrasings (none appear in scripts/eval/gate/scenarios/). No real paths.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readPlea, readSleepTurn, slotsOf, type SleepPending } from "./sleep-plan-read.js";
import { draftArgs, runSleepTurn, type SleepRun } from "./sleep-plan-flow.js";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";

const LATE = new Date(2026, 10, 2, 23, 20);
const CONFIRM: SleepPending = { step: "confirm", draft: { wake: "06:00", days: ["mon", "wed", "thu"], rest: "09:00" } };

describe("casual yeses confirm the summary", () => {
  it.each(["ye", "yee", "yh", "bet", "aight", "sounds good", "ok bet", "ye 👍", "👍", "yeah do it", "yup!", "def"])("'%s'", (said) => {
    expect(readSleepTurn(said, { held: CONFIRM, now: LATE })).toEqual({ kind: "confirm", draft: CONFIRM.draft });
  });
  it.each(["ye but make it 6:30am", "whats the weather"])("not a plain yes: '%s'", (said) => {
    expect(readSleepTurn(said, { held: CONFIRM, now: LATE })?.kind).not.toBe("confirm");
  });
});

describe("a late-night plea for more time is the sleep plan's", () => {
  it.each(["can i get one more round in", "lemme stay up another 30 min", "one more ep then bed i promise", "just a little longer pls", "few more games then im off"])("'%s' → no exception, one grace", (said) => {
    expect(readPlea(said, LATE)).toMatchObject({ kind: "noexcept", grace: true });
  });
  it("a legit reason in the plea is an exception; daytime or a calendar request is not a plea", () => {
    expect(readPlea("need another hour on this lab report", LATE)).toEqual({ kind: "except", reason: "schoolwork" });
    expect(readPlea("one more game", new Date(2026, 10, 2, 15, 0))).toBeUndefined();
    expect(readPlea("add another hour of study", LATE)).toBeUndefined();
  });
  it("a second plea inside the grace gets none", () => {
    expect(readSleepTurn("ok literally one more round", { held: { step: "grace", draft: {} }, now: LATE })).toMatchObject({ kind: "noexcept", grace: true, again: true });
  });
});

const DAY = { date: "2026-11-03", weekday: "tue", wake: "06:00", reason: "plan", firstClass: null, evening: "2026-11-02", sleepBy: "22:00", lockdownAt: "00:00",
  wakeIso: new Date(2026, 10, 3, 6, 0).toISOString(), nudgeAtIso: new Date(2026, 10, 2, 21, 30).toISOString(), exception: null };
const planRun: SleepRun = async () => ({ stdout: JSON.stringify({ ok: true, calendar: "ok", plan: {}, days: [DAY] }), code: 0 });

describe("the grace reply: built from his plan, firm, one check-in only when it was booked", () => {
  it("late: names the alarm and the hours left, books one check-in and says so", async () => {
    const booked: string[][] = [];
    const out = await runSleepTurn({ kind: "noexcept", activity: "Gaming", grace: true }, { run: planRun, now: LATE, checkin: async (a) => { booked.push(a); return { stdout: "ok ci-1", code: 0 }; } });
    expect(out.flow).toMatchObject({ outcome: "say", text: "Not for gaming, you're up at 6:00, that's under 7h away. Finish this one and I'll check in 10." });
    expect(booked).toEqual([["add", "10", "Bed — up at 6:00", "--because", "one more before bed"]]);
    expect(out.pending).toEqual({ step: "grace", draft: {} });
  });
  it("no check-in booked: no claim of one", async () => {
    const out = await runSleepTurn({ kind: "noexcept", activity: "Staying up", grace: true }, { run: planRun, now: LATE, checkin: async () => ({ stdout: "failed", code: 1 }) });
    expect(out.flow).toMatchObject({ text: "Not tonight, you're up at 6:00, that's under 7h away. Finish this one, then bed." });
  });
  it("again: no second grace; before his nudge time: not late yet", async () => {
    expect((await runSleepTurn({ kind: "noexcept", activity: "Gaming", grace: true, again: true }, { run: planRun, now: LATE })).flow)
      .toMatchObject({ text: "That was the one. Bed now, you're up at 6:00, that's under 7h away." });
    expect((await runSleepTurn({ kind: "noexcept", activity: "Gaming", grace: true }, { run: planRun, now: new Date(2026, 10, 2, 20, 40) })).flow)
      .toMatchObject({ text: "You're fine till 10pm, then bed. You're up at 6:00." });
  });
});

describe("gym days from his plan", () => {
  it("an early wake said 'for the gym' marks those days as his gym days", () => {
    const d = slotsOf("from now on up at 6 tue thu sat for lifting, 9 otherwise");
    expect(d).toMatchObject({ wake: "06:00", days: ["tue", "thu", "sat"], rest: "09:00", forGym: true });
    expect(draftArgs(d)).toContain("--gym");
    expect(draftArgs({ wake: "06:00", days: ["gym"], forGym: true, direct: true })).not.toContain("--gym");
  });
});

// Through the hooks against the real orion-sleepplan in a sandbox, at 23:20 the night before a 6:00 day.
const SCRIPT = fileURLToPath(new URL("../../../scripts/orion-sleepplan", import.meta.url));
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
function sandbox(now: Date, extra: Array<[number, number, number, number, string]> = []): { run: SleepRun; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sleeprev2-"));
  dirs.push(dir);
  writeFileSync(join(dir, "eval-mode"), "");
  const ev = (d: number, h: number, m: number, dur: number, title: string) => { const s = new Date(2026, 10, d, h, m); return { identifier: `${title}-${d}`, title, allDay: "false", start: s.toISOString(), end: new Date(s.getTime() + dur * 60000).toISOString() }; };
  writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: now.toISOString(), events: [ev(3, 13, 30, 95, "MKTG2201 Lecture"), ev(4, 9, 0, 90, "CS2100"), ...extra.map((e) => ev(...e))] }));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
  for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"]) delete env[k];
  const run: SleepRun = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env }, (e, stdout, stderr) => resolve({ stdout: `${stdout}${e ? stderr : ""}`, code: e ? 1 : 0 })));
  return { run, dir };
}
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness(run: SleepRun, now: Date, stateDir?: string) {
  const handlers = new Map<string, Handler[]>();
  const checkins: string[][] = [];
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "sleeprev2r-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 23:20", now: () => now,
    ...(stateDir ? { stateDir } : {}),
    decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "standard" }),
    sleepPlanRun: run,
    checkinRun: async (args: string[]) => { checkins.push(args); return args[0] === "find" ? { stdout: '{"open":false}', code: 1 } : { stdout: "ok ci-abc123", code: 0 }; },
  });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `r${n += 1}`, sessionKey: "agent:main:orion-chat-rev2" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    if (direct?.reply?.text) return `DRAFT: ${direct.reply.text}`;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string; systemPrompt?: string } | undefined>;
    return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
  };
  return { turn, checkins };
}
const label = (text: string) => `[ORION context: you messaged him first, 1 min ago: "${text}". This message MAY be his answer.]\n`;

describe("through the hooks, 23:20 before a 6:00 day", () => {
  it("a plea answering ORION's bedtime line gets the plan's stakes and one booked check-in, never a gym nudge", async () => {
    const { run, dir } = sandbox(LATE);
    expect((await run(["set", "--days", "tue", "--wake", "06:00"])).code).toBe(0);
    const h = harness(run, LATE, dir);
    const reply = await h.turn(`${label("Bed at 11:45 PM. Start wrapping up.")}lemme stay up another hour, just gaming`);
    expect(reply).toBe("Not for gaming, you're up at 6:00, that's under 7h away. Finish this one and I'll check in 10.");
    expect(reply).not.toMatch(/gym/i);
    expect(h.checkins.filter((a) => a[0] === "add")).toEqual([["add", "10", "Bed — up at 6:00", "--because", "one more before bed"]]);
    expect(await h.turn("one more round tho")).toBe("That was the one. Bed now, you're up at 6:00, that's under 7h away.");
  }, 30000);

  it("'ye' to the one-shot summary saves it", async () => {
    const at = new Date(2026, 10, 2, 20, 0);
    const { run, dir } = sandbox(at);
    const h = harness(run, at);
    expect(await h.turn("going forward im up at 6:30 tue n wed for the gym, 9:30 the other days")).toMatch(/Sound right\?$/);
    expect(await h.turn("ye")).toMatch(/^Done, that's your plan now\./);
    const saved = JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan;
    expect(saved.byDay).toMatchObject({ tue: { wake: "06:30" }, wed: { wake: "06:30" }, mon: { wake: "09:30" } });
    expect(saved.gymDays).toEqual(["tue", "wed"]);
  }, 30000);

  it("gym days: a daily Gym block names no days, so ORION asks; once his plan names them, they are used", async () => {
    const at = new Date(2026, 10, 2, 20, 0);
    const daily: Array<[number, number, number, number, string]> = [3, 4, 5, 6, 7, 8].map((d) => [d, 17, 0, 90, "Gym"]);
    const { run, dir } = sandbox(at, daily);
    const h = harness(run, at, dir);
    expect(await h.turn("set my alarm for 6 on gym days")).toBe("Which days are gym days?");
    expect(await h.turn("tue sat")).toMatch(/^Done, 6:00 alarm on Tue and Sat from now on\./);
    const p = sandbox(at, daily);
    expect((await p.run(["set", "--days", "mon,thu", "--wake", "06:00", "--only", "--gym"])).code).toBe(0);
    const g = harness(p.run, at, p.dir);
    expect(await g.turn("wake me up at 5:45 on gym days")).toMatch(/^Done, 5:45 alarm on Mon and Thu from now on\./);
  }, 30000);
});
