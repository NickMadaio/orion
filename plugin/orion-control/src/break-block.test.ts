// Live bug 2026-11-05 11:47: a break request was a nudge only; the plan still showed him in a work block. In his words, with siblings.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBreak } from "./break-intent.js";
import { runFocusMove, readFocusMove } from "./focus-moves.js";
import { registerLocalRouting } from "./local-routing.js";
import type { Day } from "./schedule-flow.js";

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const hm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const B = (title: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ title, start, end, kind: "study", fixed: false, ...extra });
const NOW = new Date(2026, 10, 5, 11, 47, 54);
const DAYBLOCKS = () => [B("CS1800 Lecture", "09:00", "10:30", { kind: "class", fixed: true }), B("DS Lab 05", "11:50", "12:50"), B("Study block", "13:00", "14:00"), B("Seminar with ben", "14:10", "15:00", { kind: "class", fixed: true })];

/** The scheduler's `now "Break, N"`, as the real one behaves: Break from now, the movable blocks after it slide in order around the fixed ones. */
function world(blocks: Day["blocks"] = DAYBLOCKS(), opts: { refuse?: boolean; keepBreakAt?: string } = {}) {
  let day: Day = { date: "2026-11-05", now: "11:47", blocks };
  const calls: string[][] = []; const journal: Array<{ at: string; steps: unknown[] }> = [];
  const run = async (script: string, args: string[]) => {
    calls.push([script, ...args]);
    if (script !== "orion-reschedule") return { stdout: "ok", code: 0 };
    if (args[0] === "undo") { journal.pop(); return { stdout: "Undone: put back", code: 0 }; }
    if (args[0] === "now") {
      if (opts.refuse) return { stdout: "NOTHING WAS CHANGED: nothing fits before your class", code: 1 };
      const len = Number(/(\d+)$/.exec(args[1]!)![1]); const start = opts.keepBreakAt ? toMin(opts.keepBreakAt) : 11 * 60 + 47;
      let cursor = start + len;
      const fixed = day.blocks.filter((b) => b.fixed);
      const moving = day.blocks.filter((b) => !b.fixed && toMin(b.end) > 11 * 60 + 47).sort((a, b) => toMin(a.start) - toMin(b.start));
      const placed = moving.map((b) => { const l = toMin(b.end) - toMin(b.start); for (const f of fixed.sort((x, y) => toMin(x.start) - toMin(y.start))) if (cursor < toMin(f.end) && cursor + l > toMin(f.start) && toMin(f.start) >= start) cursor = toMin(f.end) + 10; const r = { ...b, start: hm(cursor), end: hm(cursor + l) }; cursor += l; return r; });
      journal.push({ at: new Date(Date.now() + journal.length * 5).toISOString(), steps: [{ op: "create", title: "Break" }] });
      day = { ...day, blocks: [...day.blocks.filter((b) => b.fixed || toMin(b.end) <= 11 * 60 + 47), B("Break", hm(start), hm(start + len), { kind: "rest", made: true, id: "id-break" }), ...placed] };
      return { stdout: `Changed Thursday 2026-11-05:\n  now: Break ${hm(start)}–${hm(start + len)}\nWritten to his calendar.`, code: 0 };
    }
    return { stdout: "", code: 0 };
  };
  return { calls, journal, run, get day() { return day; } };
}
const sessionNone = async (args: string[]) => ({ stdout: JSON.stringify({ ok: true, status: args[0] === "status" ? "none" : "none" }), code: 0 });

async function ask(say: string, w = world(), exec: (a: string[]) => Promise<{ stdout: string; code: number }> = sessionNone) {
  const move = readFocusMove(say)!;
  const out = await runFocusMove(move, { exec, run: w.run as never, now: NOW, task: "DS Lab 05", readDay: async () => w.day });
  return { out, w, text: out.reminder?.say ?? (out.flow && (out.flow.outcome === "done" ? out.flow.reply ?? "" : out.flow.outcome === "say" ? out.flow.text : "")) ?? "" };
}

describe("his words: a break goes on the plan", () => {
  it("can you give me a 15 min break before my next work block", async () => {
    const { w, text, out } = await ask("can you give me a 15 min break before my next work block");
    expect(w.calls.filter((c) => c[1] === "now")).toEqual([["orion-reschedule", "now", "Break, 15"]]);
    expect(w.day.blocks.find((b) => b.title === "Break")).toMatchObject({ start: "11:47", end: "12:02" });
    expect(text).toMatch(/^Break till 12:02 PM\. DS Lab 05 now 12:02 PM–1:02 PM/);
    expect(text).toMatch(/I'll nudge you/);
    expect(out.writes).toBe(1);
  });
  it.each([
    ["i need a break", 10], ["break for 20 mins", 20], ["take 10", 10], ["give me a 15 min break", 15],
    ["gonna take a 20 min break before my next block", 20], ["can i have a 30 min break", 30], ["take five", 5],
  ])("%s", async (say, minutes) => {
    expect(readBreak(say)?.minutes).toBe(minutes);
    const { w } = await ask(say);
    expect(w.calls.filter((c) => c[1] === "now")).toEqual([["orion-reschedule", "now", `Break, ${minutes}`]]);
  });
  it("what is said is read back from the day: where the break really is", async () => {
    const { text } = await ask("give me a 15 min break", world(DAYBLOCKS(), { keepBreakAt: "11:55" }));
    expect(text).toMatch(/^Break till 12:10 PM\./);
  });
  it("a class or a plan with people never moves, and the study block goes after it", async () => {
    const { w } = await ask("give me a 20 min break");
    expect(w.day.blocks.find((b) => b.title === "Seminar with ben")).toMatchObject({ start: "14:10", end: "15:00" });
    const study = w.day.blocks.find((b) => b.title === "Study block")!;
    expect(study.end <= "14:10" || study.start >= "15:00").toBe(true);   // never on top of the seminar
  });
  it("a break that runs into a fixed block says so", async () => {
    const blocks = [B("DS Lab 05", "11:50", "12:50"), B("Seminar with ben", "12:00", "13:00", { kind: "class", fixed: true })];
    const { text } = await ask("give me a 20 min break", world(blocks));
    expect(text).toMatch(/runs into Seminar with ben/);
  });
  it("a refusal is said and nothing is claimed", async () => {
    const { text } = await ask("give me a 15 min break", world(DAYBLOCKS(), { refuse: true }));
    expect(text).toMatch(/couldn't put the break on your calendar/);
    expect(text).not.toMatch(/^Break till/);
  });
  it("a running session is put on break too, and the calendar has it", async () => {
    const calls: string[][] = [];
    const exec = async (args: string[]) => { calls.push(args); return { stdout: JSON.stringify({ ok: true, status: "running", phase: args[0] === "break" ? "rest" : "focus", task: "DS Lab 05", remainingSeconds: 600, servedFocusSeconds: 120 }), code: 0 }; };
    const w = world();
    const { text } = await ask("give me a 15 min break", w, exec);
    expect(calls.map((c) => c[0])).toContain("break");
    expect(w.calls.some((c) => c[1] === "now")).toBe(true);
    expect(text).toMatch(/Break till 12:02 PM/);
    expect(text).toMatch(/Break started/);
  });
  it("already on the break: not added twice", async () => {
    const w = world([B("Break", "11:40", "11:55", { kind: "rest" }), B("DS Lab 05", "11:55", "12:55")]);
    const { text } = await ask("give me a 15 min break", w);
    expect(w.calls.filter((c) => c[1] === "now")).toEqual([]);
    expect(text).toMatch(/already on a break till 11:55 AM/);
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
describe("chat route: undo takes the break off", () => {
  it("give me a 15 min break, then undo", async () => {
    const w = world();
    const handlers = new Map<string, Handler[]>();
    const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    registerLocalRouting(api as never, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Thu 11:47", now: () => NOW,
      decideImpl: async () => ({ move: "escalate" }) as never, brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
      readDayJson: async () => w.day, readDay: async () => JSON.stringify(w.day), realityRun: w.run, ledgerRun: w.run, undoJournal: () => w.journal as never, sessionExec: sessionNone } as never);
    let n = 0;
    const turn = async (prompt: string) => {
      const ctx = { runId: `b-${n += 1}`, sessionKey: "agent:main:orion-app-v2" };
      await fire("before_model_resolve", { prompt }, ctx);
      const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
      const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string }>;
      return direct?.reply?.text ?? `${built?.systemPrompt ?? ""}${built?.appendContext ?? ""}`;
    };
    const first = await turn("can you give me a 15 min break before my next work block");
    expect(w.calls.filter((c) => c[1] === "now")).toHaveLength(1);
    expect(first).toMatch(/Break till 12:02 PM\. DS Lab 05 now 12:02 PM/);
    await turn("undo");
    expect(w.calls.filter((c) => c[1] === "undo")).toHaveLength(1);
  });
});
