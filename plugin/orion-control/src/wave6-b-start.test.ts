// Wave 6 B (gate run-1101003318, foc-start-v): "ok lets work on econ" on a day with no econ block (ECON1115 is tomorrow) and no
// deadline missed the casual focus start: "econ" was neither a work noun nor a name on today's day. One of his courses is work
// whatever day it meets, so a course he takes (course aliases from his data) counts.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { workStartTask } from "./work-start.js";
import { useCourseAliases } from "./block-names.js";

beforeEach(() => useCourseAliases(new Map([["econ1115", ["macro"]], ["mktg2201", ["marketing"]], ["cs2100", ["computer science"]]])));
afterEach(() => useCourseAliases(undefined));

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(decision: Record<string, unknown>) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => {
    const out: unknown[] = [];
    for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
    return out;
  };
  const started: Array<{ message: string; task?: string }> = [];
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w6bs-")), "r.jsonl"), brainSearch: async () => "",
    clock: () => "Mon 10:00", now: () => new Date(2026, 10, 2, 10, 0), decideImpl: async () => decision as never,
    scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
    readDayJson: async () => ({ date: "2026-11-02", now: "10:00", blocks: [{ title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" }] }) as never,
    readDeadlines: async () => ({ events: [], tasks: [] }),
    sessionFlow: async (message: string, hint?: { task?: string }) => {
      started.push({ message, ...(hint?.task ? { task: hint.task } : {}) });
      return { outcome: "done", calls: [`exec orion-session start "${hint?.task ?? "Focus"}" --json`], outputs: ["{\"ok\":true,\"status\":\"running\"}"], reply: `Started ${hint?.task ?? "Focus"}, 50 minutes, until 10:50 AM.` };
    } });
  return { fire, started };
}

describe("the desk's app_open guess does not win over a focus start", () => {
  it.each(["ok lets work on econ", "alright lemme get started on macro", "k im gonna grind marketing rn"])("%s", async (said) => {
    const r = route({ move: "tool", tool: "app_open", args: { application: "Econ" }, say: "Opening Econ on your Mac." });
    const ctx = { runId: `w6bs-${said.length}`, sessionKey: "agent:main:orion-chat-w6bs" };
    await r.fire("before_model_resolve", { prompt: said }, ctx);
    const [built] = await r.fire("before_prompt_build", { prompt: said, messages: [] }, ctx) as Array<{ systemPrompt?: string } | undefined>;
    expect(r.started).toHaveLength(1);
    expect(built?.systemPrompt ?? "").not.toMatch(/app_open/);
  });
});

describe("a course of his is work, on any day", () => {
  it.each([
    ["ok lets work on econ", "econ"],
    ["aight lemme get started on marketing rn", "marketing"],
    ["ok gonna grind macro", "macro"],
    ["yeah im gonna knock out some cs2100", "cs2100"],
  ])("%s", (said, task) => {
    expect(workStartTask(said, [])).toBe(task);
  });
  it.each(["lets work on karaoke", "lets work on sam", "gonna work on econ later", "lets work on the gym"])("not a start: %s", (said) => {
    expect(workStartTask(said, [])).toBeUndefined();
  });
  it("no course data: an unknown name stays a non-start", () => {
    useCourseAliases(new Map());
    expect(workStartTask("ok lets work on econ", [])).toBeUndefined();
  });
});
