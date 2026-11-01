// Wave 8 C: a full window books the nearest free slot instead of handing the problem back. Fixtures only.
// Fixtures only: temp state dirs, a fake calendar the fake scheduler writes to, no real paths.
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { CRISIS_REPLY } from "./distress.js";
import { PendingMemory, readPendingTurn } from "./pending-reply.js";
import type { Decision } from "./front-desk.js";
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";

const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.

User message:
`;
const label = (text: string, minutes = 5) => `[ORION context: you messaged him first, ${minutes} min ago: "${text}". This message MAY be his answer.]\n`;
const b = (title: string, start: string, end: string, fixed = false, kind?: string): DayBlock => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
const at = (d: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, da] = d.split("-").map(Number); return new Date(y!, mo! - 1, da!, h!, m!); };
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** "8:35pm" / "8am" (the scheduler words pending-reply-day.ts writes) to minutes. */
const cmdMin = (t: string) => { const [, h, m, mer] = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/) ?? []; return ((Number(h) % 12) + (mer === "pm" ? 12 : 0)) * 60 + Number(m ?? 0); };

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type Opts = { now: Date; today?: Day; tomorrow?: Day; stateDir?: string; shift?: number; session?: string };
/** The routing hooks over a calendar that the fake scheduler really writes to (so a reply can be checked against a read-back). */
function harness(o: Opts) {
  const handlers = new Map<string, Handler[]>();
  const flows: string[] = [];
  const runs: string[][] = [];
  const days = { today: o.today ?? MON(), tomorrow: o.tomorrow ?? TUE() };
  const clock = { now: o.now };
  const write = (message: string) => {
    const add = message.match(/^add a (\d+) min (.+?)( tomorrow)? at (\S+)$/);
    const move = message.match(/^move (tomorrow's )?(.+?) to (\S+)$/);
    const which = (add?.[3] || move?.[1]) ? "tomorrow" : "today";
    const day = days[which];
    if (add) { const s = cmdMin(add[4]!) + (o.shift ?? 0); days[which] = { ...day, blocks: [...day.blocks, b(add[2]!, hhmm(s), hhmm(s + Number(add[1])))] }; }
    if (move) {
      const s = cmdMin(move[3]!) + (o.shift ?? 0);
      days[which] = { ...day, blocks: day.blocks.map((x) => (x.title.toLowerCase() === move[2]!.toLowerCase() ? { ...x, start: hhmm(s), end: hhmm(s + toMin(x.end) - toMin(x.start)) } : x)) };
    }
  };
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "pr4-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 12:00", now: () => clock.now,
    ...(o.stateDir ? { stateDir: o.stateDir } : {}),
    decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "standard" }),
    scheduleFlow: async (message: string): Promise<FlowResult> => { flows.push(message); write(message); return { outcome: "done", calls: [`exec orion-reschedule (${message})`], outputs: ["Done."], marks: [`m${flows.length}`], reply: "Done." }; },
    realityRun: async (_script: string, args: string[]) => { runs.push(args); return { stdout: "Written to his calendar.", code: 0 }; },
    readDayJson: async (args: string[]) => (args.includes("tomorrow") ? days.tomorrow : days.today),
    checkinRun: async (args: string[]) => (args[0] === "find" ? { stdout: '{"open":false}', code: 1 } : { stdout: "ok ci-abc123", code: 0 }),
  });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `q${n += 1}-${Math.random()}`, sessionKey: o.session ?? "agent:main:orion-chat-rev4" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    if (direct?.reply?.text) return `DRAFT: ${direct.reply.text}`;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string; systemPrompt?: string } | undefined>;
    return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
  };
  return { turn, flows, days, clock, runs };
}
const GAVE_UP = "I'll stop pinging about Gym. Tell me when you want to pick it back up.";
const MISSED = "Looks like MKTG2201 didn't happen today - it happens. Want me to fit in time to catch up on it (the recording or notes), or leave it?";
const MON = (): Day => ({ date: "2026-11-02", now: null, blocks: [b("MKTG2201 Marketing", "13:30", "15:30", true, "class"), b("Gym", "17:00", "18:30"), b("Side project", "19:30", "20:30")] });
const TUE = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("CS2100", "09:00", "10:40", true, "class"), b("Gym", "17:00", "18:30")] });
const FREE_TUE = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("Gym", "17:00", "18:30")] });
const SUN = (): Day => ({ date: "2026-11-01", now: null, blocks: [] });
const FULL_MORNING = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("CS2100", "08:00", "10:00", true, "class"), b("ECON1115", "10:15", "12:00", true, "class"), b("Side project", "14:00", "15:00")] });
const FULL_DAY = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("CS2100", "08:00", "13:00", true, "class"), b("ECON1115", "13:05", "21:55", true, "class")] });
const SPARSE = (): Day => ({ date: "2026-11-03", now: null, blocks: [b("Library", "09:00", "10:00")] });

describe("a full window books the nearest free slot", () => {
  it.each(["ill do gym tmrw morning", "gonna do gym tomorrow morning", "ok gym tmrw morning then"])("slipped gym '%s' with a full morning books just after it and says so", async (said) => {
    const h = harness({ now: at("2026-11-02", "19:30"), tomorrow: FULL_MORNING() });
    const reply = await h.turn(`${label(GAVE_UP, 10)}${APP}${said}`);
    expect(h.flows).toHaveLength(1);
    expect(h.flows[0]).toMatch(/^add a 90 min Gym tomorrow at 12:\d\dpm$/);
    expect(reply).toMatch(/Morning's full/i);
    expect(reply).toMatch(/12:\d\d PM/);
    expect(reply).not.toMatch(/Give me a time/i);
  });
  it("a sparse tomorrow still books inside the morning, with no fallback line", async () => {
    const h = harness({ now: at("2026-11-02", "19:30"), tomorrow: SPARSE() });
    const reply = await h.turn(`${label(GAVE_UP, 10)}${APP}ill do gym tmrw morning`);
    expect(h.flows[0]).toMatch(/^add a 90 min Gym tomorrow at 10:\d\dam$/);
    expect(reply).not.toMatch(/full/i);
  });
  it("nothing fits all day: it asks, and books nothing", async () => {
    const h = harness({ now: at("2026-11-02", "19:30"), tomorrow: FULL_DAY() });
    const reply = await h.turn(`${label(GAVE_UP, 10)}${APP}ill do gym tmrw morning`);
    expect(h.flows).toEqual([]);
    expect(reply).toMatch(/Give me a time/i);
  });
  it.each(["yes book 1 hour tomorrow after gym", "ya put an hour tmrw after gym pls", "sure 60 min tomorrow after gym"])("catch-up '%s' with no gym booked tomorrow books the first free hour and says gym isn't there", async (said) => {
    const h = harness({ now: at("2026-11-01", "15:50"), today: SUN(), tomorrow: { date: "2026-11-02", now: null, blocks: [b("MKTG2201 Marketing", "09:00", "10:30", true, "class")] } });
    const reply = await h.turn(`${label(MISSED, 10)}${APP}${said}`);
    expect(h.flows).toHaveLength(1);
    expect(h.flows[0]).toMatch(/^add a 60 min MKTG catch-up tomorrow at \d+:\d\dam$/);
    expect(reply).toMatch(/gym isn't on tomorrow/i);
    expect(reply).not.toMatch(/Give me a time/i);
  });
  it("catch-up after gym, gym booked tomorrow: lands right after it", async () => {
    const h = harness({ now: at("2026-11-01", "15:50"), today: SUN(), tomorrow: FREE_TUE() });
    await h.turn(`${label(MISSED, 10)}${APP}yes book 1 hour tomorrow after gym`);
    expect(h.flows[0]).toBe("add a 60 min MKTG catch-up tomorrow at 6:35pm");
  });
});
