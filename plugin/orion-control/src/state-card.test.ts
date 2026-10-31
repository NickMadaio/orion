// The state card (2026-10-30): the 9B gets a compact card of Nick's state built by code; missing or stale state is "unknown".
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { CARD_MAX_CHARS, TONE_NOTE, clockOf, deskLine, loadCardInputs, readNowRecord, stateCard, userEssentials } from "./state-card.js";

const NOW = new Date(2026, 9, 30, 13, 20);
const at = (h: number, m = 0, d = 30) => new Date(2026, 9, d, h, m).toISOString();
const record = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, computedAt: at(13, 18),
  shouldBe: { kind: "free", title: "Free time", blockId: null, start: at(13, 20), end: at(17, 50), why: "Free until finish resume at 17:50." },
  is: { activity: "at-mac", place: null, focusSession: null, evidence: ["mac:active Safari"], confidence: "medium" },
  mismatch: null,
  next: { kind: "other", title: "finish resume", blockId: "cal-2", start: at(17, 50) },
  slipsToday: [], declared: [], strictness: "flexible",
  sensors: {}, sleepPlan: { bedtime: "00:00", wake: "09:00" }, ...extra,
});
const USER_MD = `# Nick\n\n- Name: Nick Madaio\n- Uses an M5 Pro MacBook.\n\nBe his external executive function. Talk like someone who knows him, never like a motivational chatbot.\n\nPlanning priorities, highest first: classes (fixed, never moved) → sleep → gym → deadlines.\n\nSchool: Northeastern University London, autumn term to about 11 December 2026. Weekly classes are in Apple Calendar.\n\n- 2026-09-29 — **Times are 12-hour: "8:11 PM", never "20:11".**\n`;

function stateDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "card-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  return dir;
}

describe("the state card", () => {
  it("reads the now record, today's declared facts, the week's slips, routines, the last push and USER.md essentials", () => {
    const slips = [3, 4, 5, 6].map((d) => JSON.stringify({ date: `2026-10-2${d}`, at: at(21, 0, 20 + d), planned: { title: "Gym", kind: "gym" }, reason: "gave-up" })).join("\n");
    const dir = stateDir({
      "now.json": record({ strictness: "firm", mismatch: { kind: "not-started", since: at(13, 0), minutes: 20 } }),
      "declared-facts.json": { schemaVersion: 1, facts: [{ id: "f1", date: "2026-10-30", at: at(10, 32), kind: "no-classes", text: "Just note that I don't have classes.", source: "voice" }, { id: "f0", date: "2026-10-29", kind: "ate", text: "ate", at: at(9, 0, 29) }] },
      "slips.jsonl": slips,
      "learned-routines.json": { routines: [{ label: "club", weekdayName: "Tuesday", start: 1406, status: "tentative" }, { label: "rejected one", status: "rejected" }] },
      "outreach.jsonl": [JSON.stringify({ at: at(12, 32), text: "Leave in 13 min for MKTG2201 at 1:30 PM.", channel: "mac-bubble" }), JSON.stringify({ at: at(12, 40), text: "Time to start: Gym.", channel: "hold", status: "dropped", reason: "ceiling" })].join("\n"),
      "USER.md": USER_MD,
    });
    const inputs = loadCardInputs({ stateDir: dir, userMdPath: join(dir, "USER.md"), now: NOW });
    const card = stateCard(inputs);
    expect(card).toMatch(/Should be doing: Free time until 5:50 PM/);
    expect(card).toMatch(/Is doing: at-mac \(medium confidence\)/);
    expect(card).toMatch(/Off plan: not-started for 20 min/);
    expect(card).toMatch(/Next: finish resume at 5:50 PM/);
    expect(card).toMatch(/Strictness: firm/);
    expect(card).toMatch(/He told you today: no classes today/);
    expect(card).not.toMatch(/he has eaten/);                       // yesterday's fact is not today's
    expect(card).toMatch(/gym slipped 4 times in 7 days \(another skip would be the fifth\)/);
    expect(card).toMatch(/club Tuesdays ~11:26 PM \(tentative\)/);
    expect(card).not.toMatch(/rejected one/);
    expect(card).toMatch(/Last thing you sent him \(12:32 PM\): "Leave in 13 min for MKTG2201/);
    expect(card).not.toMatch(/Time to start: Gym/);                // a held push never reached him
    expect(card).toMatch(/Priorities highest first: classes/);
    expect(card).toMatch(/Times are 12-hour/);
    expect(card.length).toBeLessThan(CARD_MAX_CHARS);
  });

  it("a missing now.json says unknown and invents nothing, but still carries what he declared", () => {
    const dir = stateDir({ "declared-facts.json": { schemaVersion: 1, facts: [{ id: "f1", date: "2026-10-30", kind: "place", place: "library", text: "im at the library" }] } });
    const card = stateCard(loadCardInputs({ stateDir: dir, now: NOW }));
    expect(card).toMatch(/His plan and what he is doing: unknown \(no record\)/);
    expect(card).not.toMatch(/Should be doing|Next:|Strictness/);
    expect(card).toMatch(/he is at library/);
  });

  it("a stale or foreign now.json is unknown too", () => {
    expect(readNowRecord(stateDir({ "now.json": record({ computedAt: at(10, 0) }) }), NOW)).toEqual({ record: null, gap: "record 200 min old" });
    expect(readNowRecord(stateDir({ "now.json": record({ schemaVersion: 2 }) }), NOW).record).toBeNull();
    expect(readNowRecord(stateDir({ "now.json": "{broken" }), NOW).record).toBeNull();
  });

  it("an unreadable calendar in the record is said as unknown, never as free", () => {
    const dir = stateDir({ "now.json": record({ shouldBe: { kind: "unknown", title: null } }) });
    expect(stateCard(loadCardInputs({ stateDir: dir, now: NOW }))).toMatch(/Should be doing: unknown \(calendar unreadable\)/);
  });

  it("the front desk gets one line", () => {
    const dir = stateDir({ "now.json": record(), "declared-facts.json": { schemaVersion: 1, facts: [{ id: "f1", date: "2026-10-30", kind: "no-classes", text: "no class today btw" }] } });
    const line = deskLine(loadCardInputs({ stateDir: dir, now: NOW }));
    expect(line).toBe("Nick now: should be Free time; next finish resume at 5:50 PM; he said today: no classes today.");
    expect(line.split("\n")).toHaveLength(1);
    expect(deskLine(loadCardInputs({ stateDir: stateDir({}), now: NOW }))).toBe("Nick now: his plan right now is unknown.");
  });

  it("an empty state dir and no USER.md never throw", () => {
    expect(() => stateCard(loadCardInputs({ stateDir: "/nonexistent/x", userMdPath: "/nonexistent/USER.md", now: NOW }))).not.toThrow();
    expect(userEssentials(null)).toEqual([]);
  });

  it("the card plus the tone note stays under ~600 tokens even with every line full", () => {
    const long = "x".repeat(400);
    const card = stateCard({ now: NOW, record: record({ shouldBe: { kind: "study", title: long, end: at(15), why: long } }) as never, declared: Array.from({ length: 9 }, () => ({ kind: "note", text: long })),
      slipsWeek: [], routines: Array.from({ length: 9 }, () => ({ label: long })), lastOutreach: { text: long, at: at(13) }, essentials: [long, long, long, long, long] });
    expect(card.length).toBeLessThanOrEqual(CARD_MAX_CHARS);
    expect(TONE_NOTE.length).toBeLessThan(600);
  });

  it("tone: specific, firm when firm, and not a productivity bot", () => {
    expect(TONE_NOTE).toMatch(/fourth gym skip this week/);
    expect(TONE_NOTE).toMatch(/Strictness firm: say no once/);
    expect(TONE_NOTE).toMatch(/not a productivity bot/);
  });

  it("clock times are 12-hour", () => {
    expect(clockOf(at(17, 50))).toBe("5:50 PM");
    expect(clockOf(at(0, 5))).toBe("12:05 AM");
    expect(clockOf("garbage")).toBeNull();
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function routed(dir: string | undefined, decide: (input: { context?: string }) => void) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const logDir = mkdtempSync(join(tmpdir(), "card-route-"));
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(logDir, "r.jsonl"), progressDir: join(logDir, "tp"), clock: () => "Fri 13:20", now: () => NOW,
    decideImpl: async (input: { context?: string }) => { decide(input); return { move: "escalate" }; }, brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
    ...(dir ? { stateDir: dir, userMdPath: join(dir, "USER.md") } : {}) } as never);
  return fire;
}

describe("the card on the live route", () => {
  it("the worker's slim prompt carries the card and the tone note before the clock; the front desk gets the one line", async () => {
    const dir = stateDir({ "now.json": record({ strictness: "firm" }), "USER.md": USER_MD });
    let context: string | undefined;
    const fire = routed(dir, (i) => { context = i.context; });
    const ctx = { runId: "card-1", sessionKey: "agent:main:orion-chat-card" };
    await fire("before_model_resolve", { prompt: "what should i be doing" }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt: "what should i be doing", messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(context).toMatch(/^Nick now: should be Free time; next finish resume at 5:50 PM\.$/);
    expect(built!.systemPrompt).toMatch(/What you know about Nick right now[\s\S]*Strictness: firm[\s\S]*How to sound:[\s\S]*Now: Fri 13:20/);
  });

  it("with no state dir (tests, shadow) the prompt is exactly as before", async () => {
    let context: string | undefined = "unset";
    const fire = routed(undefined, (i) => { context = i.context; });
    const ctx = { runId: "card-2", sessionKey: "agent:main:orion-chat-card2" };
    await fire("before_model_resolve", { prompt: "what should i be doing" }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt: "what should i be doing", messages: [] }, ctx)) as Array<{ systemPrompt: string }>;
    expect(context).toBeUndefined();
    expect(built!.systemPrompt).not.toMatch(/What you know about Nick/);
  });
});
