import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting, UNDO_NOTHING_TO_UNDO } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function fakeApi() {
  const handlers = new Map<string, Handler[]>();
  return {
    api: { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    fire: async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown> = {}) => {
      const out = [];
      for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
      return out;
    },
  };
}

const UNDO_CMD = "/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule undo";
const moved: FlowResult = { outcome: "done", calls: ['exec orion-reschedule move "gym" --to 19:00'], outputs: ["Changed:\n  moved gym to 19:00"], marks: ["m1"] };

// 2026-10-16 re-run, q092: in a FRESH chat "cancel that" had the worker run `orion-reschedule undo`, which
// reversed a real change Nick made the day before ("Undone: put Review spending back"). A bare cancel or
// undo may take back a calendar change only when THIS session made one.
describe("a bare cancel or undo needs a change made in this session", () => {
  const harness = () => {
    const f = fakeApi(); const flows: string[] = [];
    registerLocalRouting(f.api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Thu 12:00",
      decideImpl: async (): Promise<Decision> => ({ move: "ask", answer: "Cancel what?" }),
      scheduleFlow: async (m) => { flows.push(m); return /gym/.test(m) ? moved : { outcome: "fallback", reason: "t" }; } });
    let n = 0;
    const turn = async (prompt: string, sessionKey = "agent:main:orion-chat-1") => {
      const ctx = { runId: `u${n += 1}`, sessionKey };
      await f.fire("before_model_resolve", { prompt }, ctx);
      const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
      return built?.systemPrompt ?? "";
    };
    const exec = async (command: string, sessionKey = "agent:main:orion-chat-1") =>
      (await f.fire("before_tool_call", { toolName: "exec", params: { command }, runId: `u${n}` }, { runId: `u${n}`, sessionKey }))[0] as { block?: boolean; blockReason?: string } | undefined;
    return { f, turn, exec, flows };
  };

  for (const msg of ["cancel that", "undo", "undo that", "put it back", "never mind that"]) {
    it(`"${msg}" in a fresh session asks what, with no tools and no undo`, async () => {
      const h = harness();
      const prompt = await h.turn(msg);
      expect(prompt).toContain(UNDO_NOTHING_TO_UNDO);
      expect(prompt).toMatch(/do not call any tools/);
      expect(h.flows).toEqual([]);
    });
  }

  it("\"move gym to 7\" then \"cancel that\" in the same session may undo", async () => {
    const h = harness();
    await h.turn("move gym to 7");
    const prompt = await h.turn("cancel that");
    expect(prompt).not.toContain(UNDO_NOTHING_TO_UNDO);
    expect((await h.exec(UNDO_CMD))).toBeUndefined();
  });

  it("another session's change does not count", async () => {
    const h = harness();
    await h.turn("move gym to 7", "agent:main:orion-chat-1");
    expect(await h.turn("cancel that", "agent:main:orion-chat-2")).toContain(UNDO_NOTHING_TO_UNDO);
  });

  it("a named object is not a bare cancel", async () => {
    const h = harness();
    expect(await h.turn("cancel the gym")).not.toContain(UNDO_NOTHING_TO_UNDO);
  });

  describe("second guard: before_tool_call refuses the undo exec", () => {
    it("refuses orion-reschedule undo when the session has no change", async () => {
      const h = harness();
      await h.turn("what's on my calendar");
      const blocked = await h.exec(UNDO_CMD);
      expect(blocked?.block).toBe(true);
      expect(blocked?.blockReason).toMatch(/Orion undo guard.*not changed his calendar/);
      expect((await h.exec("orion-reschedule undo"))?.block).toBe(true);
    });
    it("does not touch other commands", async () => {
      const h = harness();
      await h.turn("what's on my calendar");
      expect(await h.exec("/Users/nickmadaio/Desktop/ORION/scripts/orion-agenda today")).toBeUndefined();
      expect(await h.exec("/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule show")).toBeUndefined();
    });
    it("allows it after this session changed his day", async () => {
      const h = harness();
      await h.turn("move gym to 7");
      await h.turn("what's on my calendar");
      expect(await h.exec(UNDO_CMD)).toBeUndefined();
    });
    it("counts a change the worker itself made through exec", async () => {
      const h = harness();
      await h.turn("what's on my calendar");
      await h.f.fire("after_tool_call", { toolName: "exec", params: { command: '/Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule resize "gym" 30' }, result: { content: [{ type: "text", text: "Changed:\n  gym is now 30 min" }] } }, { runId: "u2", sessionKey: "agent:main:orion-chat-1" });
      expect(await h.exec(UNDO_CMD)).toBeUndefined();
    });
  });
});
