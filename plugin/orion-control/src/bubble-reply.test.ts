// W16-d (2026-11-02): a reply typed into the Mac's proactive bubble. Nick: "I responded to a proactive message in the little bubble
// that pops up but his response didn't pop up." The app now binds the bubble reply to the message it answers (its outreach id, and
// the ask's askId in the label), and the plugin must answer it as that answer. Through the routing hooks, held-out phrasings, no real paths.
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { parseOutreach } from "./outreach-reply.js";
import { askIdOf } from "./bubble-reply.js";
import type { Decision } from "./front-desk.js";
import type { Day, FlowResult } from "./schedule-flow.js";

const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.

User message:
`;
const ASK = "You're out - is Study block still happening, or did plans change? I'll update the calendar.";
// Exactly what OutreachContext.label (native/Orion) writes for a curiosity ask row that carries an askId.
const bubbleLabel = (minutes: number, askId = "ask-7f3a91c2") =>
  `[ORION context: ${minutes} min ago you asked "${ASK}" (Study block, planned 19:00-20:00, not started, he is away), askId ${askId}. If he says what he did or is doing, log it.]\n`;
const at = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return new Date(2026, 10, 2, h!, m!); };
const DAY = (): Day => ({ date: "2026-11-02", now: null, blocks: [{ title: "Study block", start: "19:00", end: "20:00", fixed: false }] });

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function harness(now: Date) {
  const handlers = new Map<string, Handler[]>();
  const flows: string[] = [];
  const stateDir = mkdtempSync(join(tmpdir(), "bubble-state-"));
  appendFileSync(join(stateDir, "outreach.jsonl"), `${JSON.stringify({ id: "reach-1", at: new Date(now.getTime() - 60_000).toISOString(), text: ASK, channel: "mac-bubble", askId: "ask-7f3a91c2" })}\n`);
  registerLocalRouting({ on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } as never, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "bubble-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 19:10", now: () => now,
    stateDir,
    decideImpl: async (): Promise<Decision> => ({ move: "escalate", tier: "standard" }),
    scheduleFlow: async (message: string): Promise<FlowResult> => { flows.push(message); return { outcome: "done", calls: [`exec orion-reschedule (${message})`], outputs: ["Done."], marks: ["m"], reply: "Done." }; },
    readDayJson: async () => DAY(),
    checkinRun: async (args: string[]) => (args[0] === "find" ? { stdout: '{"open":false}', code: 1 } : { stdout: "ok ci-1", code: 0 }),
  });
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => { const out: unknown[] = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; };
  let n = 0;
  const turn = async (prompt: string): Promise<string> => {
    const ctx = { runId: `b${n += 1}`, sessionKey: "agent:main:orion-chat-bubble" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { prompt }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    if (direct?.reply?.text) return `DRAFT: ${direct.reply.text}`;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string } | undefined>;
    return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? "WORKER";
  };
  return { turn, flows };
}

describe("the bubble's label: what ORION asked, and which ask", () => {
  it("reads the ask id the app put in the label", () => {
    expect(askIdOf(bubbleLabel(1))).toBe("ask-7f3a91c2");
    expect(askIdOf(`${bubbleLabel(1, "ask-0bd")}${APP}ok`)).toBe("ask-0bd");
  });
  it("no ask id: a plain outreach label, or no label at all", () => {
    expect(askIdOf(`[ORION context: you messaged him first, 2 min ago: "Leave in 13 min for CS2100.". This message MAY be his answer.]\n`)).toBeUndefined();
    expect(askIdOf("askId ask-123 in his own words is not a label")).toBeUndefined();
  });
  it("the ask id does not change what the outreach parser reads from the label", () => {
    const o = parseOutreach(bubbleLabel(3));
    expect(o?.text).toBe(ASK);
    expect(o?.minutes).toBe(3);
    expect(o?.title).toBe("Study block");
    expect(o?.askId).toBe("ask-7f3a91c2");
  });
});

describe("a reply typed into the bubble gets the bound answer, not a fresh request", () => {
  it.each(["nah plans changed", "plans changed sry", "not happening tonight"])("'%s' → the off-plan offer for Study block", async (said) => {
    const h = harness(at("19:10"));
    const reply = await h.turn(`${bubbleLabel(1)}${APP}${said}`);
    expect(reply).toMatch(/Study block/);
    expect(reply).not.toBe("WORKER");
  });
  it("'yea still on' keeps the block where it is (accept), bound to Study block", async () => {
    const h = harness(at("19:10"));
    const reply = await h.turn(`${bubbleLabel(1)}${APP}yea still on`);
    expect(reply).toMatch(/Study block/);
    expect(h.flows).toEqual([]);
  });
});
