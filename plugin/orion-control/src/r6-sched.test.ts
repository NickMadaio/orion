// w20 r6 sched: live gate run 4 scheduling FAILs, in his words. Reader, runner over a stateful fake day, the ledger, and the chat route
// with ledgerRun and a journal wired the way production has them.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readDayEdit, type EditPart } from "./day-edit.js";
import { runDayEdit } from "./day-edit-run.js";
import { forgetEdit, resetDayEditMemory } from "./day-edit-memory.js";
import { readLedgerAsk } from "./ledger-ask.js";
import { runLedgerAsk, type LedgerDeps } from "./ledger-run.js";
import type { MadeItem } from "./made-ledger.js";
import { registerLocalRouting } from "./local-routing.js";
import { runScheduleFlow, type Day } from "./schedule-flow.js";

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const hm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const B = (title: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ title, start, end, kind: "other", fixed: false, ...extra });
const NOW = new Date(2026, 10, 5, 6, 8);
const parts = (m: string, now = NOW): EditPart[] => readDayEdit(m, now)?.parts ?? [];
beforeEach(() => { forgetEdit(); resetDayEditMemory(); });

/** A fake scheduler with a day that moves when a move or add runs, and a journal that grows with each write and shrinks on undo. */
function world(blocks: Day["blocks"], now = NOW, hold: Record<string, number> = {}) {
  let day: Day = { date: "2026-11-05", now: hm(now.getHours() * 60 + now.getMinutes()), blocks: [...blocks] };
  const calls: string[][] = []; const journal: Array<{ at: string; steps: Array<{ op: string; title: string; start: string; end: string }> }> = [];
  let tick = 0;
  const stamp = () => new Date(Date.now() + (tick += 5)).toISOString();
  const run = async (script: string, args: string[]) => {
    calls.push([script, ...args]);
    if (script !== "orion-reschedule") return { stdout: "ok", code: 0 };
    if (args[0] === "undo") { journal.pop(); return { stdout: "Undone: put back", code: 0 }; }
    if (args[0] === "move") {
      const b = day.blocks.find((x) => x.title === args[1])!; const to = toMin(args[args.indexOf("--to") + 1]!); const len = toMin(b.end) - toMin(b.start);
      journal.push({ at: stamp(), steps: [{ op: "move", title: b.title, start: new Date(2026, 10, 5, ...b.start.split(":").map(Number) as [number, number]).toISOString(), end: new Date(2026, 10, 5, ...b.end.split(":").map(Number) as [number, number]).toISOString() }] });
      const start = hold[b.title] ?? to;
      day = { ...day, blocks: day.blocks.map((x) => (x === b ? { ...x, start: hm(start), end: hm(start + len) } : x)) };
    }
    if (args[0] === "drop") {
      const id = args[args.indexOf("--id") + 1]; const gone = day.blocks.find((x) => x.id === id || x.title === args[1]);
      if (gone) { journal.push({ at: stamp(), steps: [{ op: "delete", title: gone.title, start: new Date(2026, 10, 5).toISOString(), end: new Date(2026, 10, 5).toISOString() }] }); day = { ...day, blocks: day.blocks.filter((x) => x !== gone) }; }
    }
    if (args[0] === "add") {
      const at = hold[args[1]!] ?? toMin(args[args.indexOf("--at") + 1]!); const len = Number(args[2]);
      journal.push({ at: stamp(), steps: [{ op: "create", title: args[1]!, start: new Date(2026, 10, 5).toISOString(), end: new Date(2026, 10, 5).toISOString() }] });
      day = { ...day, blocks: [...day.blocks, B(args[1]!, hm(at), hm(at + len), { made: true, id: `id-${args[1]}` })] };
    }
    return { stdout: "Changed Thursday 2026-11-05:\n  done\nWritten to his calendar.", code: 0 };
  };
  return { calls, journal, run, get day() { return day; }, deps: { run, readDay: async () => day, readDayOn: async () => day, now, source: "chat", text: "", stateDir: undefined } as never };
}

describe("#5 'and then the orion plan an hour after it' lands after leetcode, not before", () => {
  it.each([
    "move leetcode to 5pm and then the orion plan an hour after it",
    "push leetcode to 5pm and then the gym half an hour after that",
    "move study to 4 and then dinner an hour after it",
    "shift reading to 6pm, then the walk 20 mins after it",
    "move leetcode to 5pm and the orion plan an hour after that",
    "move gym to 7pm and then the reading right after it",
  ])("%s", (say) => expect(parts(say).map((p) => p.op)).toEqual(["move", "moveafter"]));
  it("runs the second from where the first ended", async () => {
    const w = world([B("practice leetcode", "11:20", "12:20"), B("Go over Orion learning plan", "12:25", "13:25")]);
    await runDayEdit(readDayEdit("move leetcode to 5pm and then the orion plan an hour after it", NOW)!, w.deps);
    expect(w.calls.filter((c) => c[1] === "move").map((c) => c.slice(2, 5))).toEqual([["practice leetcode", "--to", "17:00"], ["Go over Orion learning plan", "--to", "19:00"]]);
  });
});

describe("#8 'take that back' is a bare undo", () => {
  it.each(["take that back", "take it back", "ok take that back", "take that back pls", "take the last move back"])("%s", (say) => expect(readLedgerAsk(say)).toMatchObject({ verb: "undo", strong: true, bare: true }));
  it("'take the big mac back off' is still a meal", () => expect(readLedgerAsk("take the big mac back off, i didnt have it")?.kinds).toContain("food"));
});

describe("#103 'cancel both of those' takes off the two newest things made", () => {
  it.each(["cancel both of those", "scrap both of those", "delete both of them", "cancel those two", "ditch both of these"])("%s", (say) => expect(readLedgerAsk(say)).toMatchObject({ verb: "remove", strong: true, pointing: true, count: 2 }));
  it("drops each block by its id and says both", async () => {
    const day: Day = { date: "2026-11-05", now: "17:00", blocks: [B("Pasta prep", "19:00", "20:30", { made: true, id: "id-pasta" }), B("Remind me to buy pasta", "17:00", "18:00", { made: true, id: "id-remind" }), B("Gym", "21:00", "22:00", { made: true, id: "id-gym" })] };
    const calls: string[][] = [];
    const items: MadeItem[] = [{ kind: "block", label: "Gym", at: 1 }, { kind: "block", label: "Remind me to buy pasta", at: 2 }, { kind: "block", label: "Pasta prep", at: 3 }];
    const d: LedgerDeps = { run: async (s, a) => { calls.push([s, ...a]); if (a[0] === "drop") day.blocks.splice(day.blocks.findIndex((b) => b.id === a[2]), 1); return { stdout: "Changed Thursday:\n  removed\nWritten to his calendar.", code: 0 }; }, readDay: async () => day, items, journal: () => [], now: 10, nothingText: "NOTHING" };
    const out = (await runLedgerAsk(readLedgerAsk("cancel both of those")!, d))!;
    expect(calls.filter((c) => c[1] === "drop").map((c) => c[3])).toEqual(["id-pasta", "id-remind"]);
    expect(out.text).toMatch(/Pasta prep/); expect(out.text).toMatch(/Remind me to buy pasta/);
    expect(day.blocks.map((b) => b.title)).toEqual(["Gym"]);
  });
});

describe("#41 'i skipped the 11:20 and was in the library 2 till 4' at 6 AM is yesterday, and today's block is left alone", () => {
  it.each([
    "i skipped the 11:20 and was in the library from 2 till 4",
    "i skipped the 11:20 and i was at the library 2 till 4",
    "i didnt go to the 11:20 and was in the library from 2 to 4",
    "skipped the 11:20 and i was in the gym from 2 till 4",
  ])("%s", async (say) => {
    const w = world([B("GET A GP", "11:20", "12:05")]);
    await runDayEdit(readDayEdit(say, NOW)!, w.deps);
    expect(w.calls.some((c) => c[1] === "drop" || c[1] === "displace")).toBe(false);
    const log = w.calls.find((c) => c[1] === "log")!;
    expect(log.slice(3)).toEqual(["--from", "14:00", "--to", "16:00", "--date", "yesterday"]);
  });
});

describe("#42 a reply states the times the calendar shows, not the times asked for", () => {
  it("the scheduler kept the haircut at 4 PM, so that is what is said", async () => {
    const w = world([B("Lunch", "12:30", "13:00")], new Date(2026, 10, 5, 10, 0), { Haircut: toMin("16:00") });
    const out = await runDayEdit(readDayEdit("put a haircut in at 3 and a catch up with nan at 5 today", new Date(2026, 10, 5, 10, 0))!, w.deps);
    const reply = "reply" in out.flow ? out.flow.reply ?? "" : "";
    expect(reply).toMatch(/haircut at 4–4:30 PM/);
    expect(reply).not.toMatch(/haircut at 3/);
    expect(reply).toMatch(/catch up with nan at 5–6 PM/);
  });
  it("a block that landed where it was asked is said as asked", async () => {
    const w = world([], new Date(2026, 10, 5, 10, 0));
    const out = await runDayEdit(readDayEdit("put a haircut in at 3", new Date(2026, 10, 5, 10, 0))!, w.deps);
    expect("reply" in out.flow && out.flow.reply).toBe("I put haircut at 3–3:30 PM.");
  });
  it("a move that landed elsewhere says where", async () => {
    const w = world([B("practice leetcode", "11:20", "12:20")], new Date(2026, 10, 5, 10, 0), { "practice leetcode": toMin("17:30") });
    const out = await runDayEdit(readDayEdit("move leetcode to 5pm", new Date(2026, 10, 5, 10, 0))!, w.deps);
    expect("reply" in out.flow && out.flow.reply).toMatch(/moved practice leetcode to 5:30/);
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "r6-"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
  registerLocalRouting(api as never, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Thu 10:00", now: () => new Date(2026, 10, 5, 10, 0),
    decideImpl: async () => ({ move: "escalate" }) as never, brainSearch: async () => "",
    scheduleFlow: (m: string, c: string, o: { lastTarget?: { title: string; start?: string; dateArgs: string[] } } = {}) => runScheduleFlow({ message: m, clock: c, now: new Date(2026, 10, 5, 10, 0), exec: async (args: string[]) => (args[0] === "show" ? { stdout: JSON.stringify(w.day), code: 0 } : w.run("orion-reschedule", args)), ask: async () => null, undoTop: () => w.journal.at(-1)?.at ?? null, ...(o.lastTarget ? { lastTarget: o.lastTarget } : {}) }), readDayJson: async () => w.day, readDay: async () => JSON.stringify(w.day),
    realityRun: w.run, ledgerRun: w.run, undoJournal: () => w.journal, ...extra } as never);
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `r6-${n += 1}`, sessionKey: "agent:main:orion-app-v2" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string }>;
    return direct?.reply?.text ?? /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
  };
  /** The worker ran a tool in the turn just taken (the host reports it after the call). */
  const tool = async (command: string, result: string) => { await fire("after_tool_call", { toolName: "exec", params: { command }, result }, { runId: `r6-${n}`, sessionKey: "agent:main:orion-app-v2" }); };
  return { turn, tool };
}

describe("chat route (ledger and journal wired as in production)", () => {
  it("#6 'put everything back like it was' undoes both moves of the one turn that made them", async () => {
    const w = world([B("practice leetcode", "11:20", "12:20"), B("Go over Orion learning plan", "12:25", "13:25")], new Date(2026, 10, 5, 10, 0));
    const r = route(w);
    await r.turn("move leetcode to 5pm and then the orion plan an hour after it");
    expect(w.journal).toHaveLength(2);
    const text = await r.turn("put everything back like it was");
    expect(w.calls.filter((c) => c[1] === "undo")).toHaveLength(2);
    expect(w.journal).toHaveLength(0);
    expect(text).toMatch(/\(2\)/);
  });
  it("#8 'take that back' undoes the last change and says what the calendar shows", async () => {
    const w = world([B("practice leetcode", "11:20", "12:20")], new Date(2026, 10, 5, 10, 0));
    const r = route(w);
    await r.turn("move leetcode to 4");
    const text = await r.turn("take that back");
    expect(w.calls.filter((c) => c[1] === "undo")).toHaveLength(1);
    expect(text).toMatch(/leetcode/i);
  });
  it("#82 'put it back to normal' after a bedtime change never undoes an older calendar change", async () => {
    const w = world([B("run", "16:30", "16:50", { made: true, id: "id-run" })], new Date(2026, 10, 5, 10, 0));
    const r = route(w, { sleepPlanRun: async (args: string[]) => { w.calls.push(["orion-sleepplan", ...args]); return { stdout: JSON.stringify({ ok: true, readback: { evening: "2026-11-05", sleepBy: "23:30", nudgeAt: "23:00", wake: "06:30", wakeDate: "2026-11-06", alarmAsked: true, hours: 7, lockdownBelowHours: 6, tonightOnly: true, standing: "00:00" } }), code: 0 }; } });
    await r.turn("scrap the run block");   // an older calendar change in this chat
    w.journal.push({ at: new Date(Date.now() - 600_000).toISOString(), steps: [{ op: "delete", title: "run", start: new Date(2026, 10, 5, 16, 30).toISOString(), end: new Date(2026, 10, 5, 16, 50).toISOString() }] });
    await r.turn("bedtime tonight is half 11");
    await r.tool("orion-sleepplan bedtime 23:30 --tonight --json", JSON.stringify({ ok: true, readback: { sleepBy: "23:30", tonightOnly: true } }));
    const before = w.calls.length;
    const text = await r.turn("nah put it back to normal");
    expect(w.calls.slice(before).some((c) => c[0] === "orion-reschedule" && c[1] === "undo")).toBe(false);
    expect(text).toMatch(/bedtime/i);
  });
});
