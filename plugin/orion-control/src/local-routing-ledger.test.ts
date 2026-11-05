import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting, UNDO_NOTHING_TO_UNDO } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { Day, FlowResult } from "./schedule-flow.js";
import type { StoredReminder } from "./reminder-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function fakeApi() {
  const handlers = new Map<string, Handler[]>();
  return { api: { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    fire: async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown> = {}) => { const out = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx)); return out; } };
}
const moved: FlowResult = { outcome: "done", calls: ['exec orion-reschedule move "plan" --to 12:25'], outputs: ["Changed:\n  moved plan"], marks: ["m1"] };

// w20 r3 (live gate 2026-11-05): undo and removal are code's, run for real and read back; never the model's claim.
function harness(over: { journal?: Array<{ at: string; steps: Array<Record<string, unknown>> }>; reminders?: StoredReminder[]; day?: Day } = {}) {
  const f = fakeApi(); const ran: string[] = []; const store = [...(over.reminders ?? [])];
  registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 12:00",
    decideImpl: async (): Promise<Decision> => ({ move: "ask", answer: "ok" }),
    scheduleFlow: async () => moved,
    ledgerRun: async (script, args) => { ran.push(`${script} ${args.join(" ")}`); return { stdout: script === "orion-log" ? "Took 3 bottles off: 0 of 9 today." : "Undone: put plan back.", code: 0 }; },
    undoJournal: () => (over.journal ?? []) as never,
    readDayJson: async () => over.day ?? { date: "d", now: null, blocks: [{ title: "plan", start: "12:25", end: "13:25", fixed: false }] },
    listReminders: async () => [...store], removeReminders: async (ids) => { for (const id of ids) store.splice(store.findIndex((r) => r.id === id), 1); } });
  let n = 0;
  const ctxOf = (key: string) => ({ runId: `u${n}`, sessionKey: key });
  const turn = async (prompt: string, key = "agent:main:orion-chat-1") => {
    n += 1; const ctx = ctxOf(key);
    await f.fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
    return built?.systemPrompt ?? "";
  };
  const made = async (command: string, result: string, key = "agent:main:orion-chat-1") => {
    await f.fire("after_tool_call", { toolName: "exec", params: { command }, result, runId: `u${n}` }, ctxOf(key));
    await f.fire("before_agent_finalize", { messages: [{ role: "assistant", content: "ok" }] }, ctxOf(key));
  };
  return { turn, made, ran, store };
}

describe("ledger wired into the chat", () => {
  it("undo with nothing made in this chat says so and runs nothing, even with a journal full of older entries", async () => {
    const h = harness({ journal: [{ at: new Date(Date.now() - 20 * 3600_000).toISOString(), steps: [{ op: "move", title: "Gym", start: new Date().toISOString() }] }] });
    expect(await h.turn("undo")).toContain(UNDO_NOTHING_TO_UNDO); expect(h.ran).toEqual([]);
  });
  it("undo after a move runs the real undo and says the time the calendar shows", async () => {
    const start = new Date(); start.setHours(12, 25, 0, 0);
    const h = harness({ journal: [{ at: new Date().toISOString(), steps: [{ op: "move", title: "plan", start: start.toISOString(), end: start.toISOString() }] }] });
    await h.turn("push the plan back an hour");
    const prompt = await h.turn("undo");
    expect(h.ran).toEqual(["orion-reschedule undo"]); expect(prompt).toContain("plan is back at 12:25 PM–1:25 PM.");
  });
  it("water logged here comes off when he says undo", async () => {
    const h = harness();
    await h.turn("had a big bottle of water");
    await h.made("orion-log water 3", "Logged 3 bottles: 3 of 9 today.");
    const prompt = await h.turn("undo");
    expect(h.ran).toEqual(["orion-log water-off 3"]); expect(prompt).toContain("Took 3 bottles off: 0 of 9 today.");
  });
  it("the stretch reminder is cancelled by what it is for, and a schedule clear never runs", async () => {
    const h = harness({ reminders: [{ id: "a1", label: "stretch", dueAt: Date.now() + 60_000 }] });
    const prompt = await h.turn("dont need the stretch reminder anymore");
    expect(prompt).toContain("Cancelled the reminder: stretch."); expect(h.store).toEqual([]); expect(h.ran).toEqual([]);
  });
});
