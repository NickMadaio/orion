// Wave 4 review MUST 1 (2026-11-01): the worker could still move a class. `--named` is code's flag (compile adds it only after his own
// words name the event), so no worker exec may carry it, by any path or wrapper; the anchor guard finds the script by its basename,
// resolves titles with the alias matcher (block-names.ts), and refuses a write when his day cannot be read.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { carriesNamedFlag, unnamedAnchorWrite } from "./anchor-write-guard.js";
import { useCourseAliases } from "./block-names.js";
import { registerLocalRouting } from "./local-routing.js";
import { compile, type Day, type DayBlock } from "./schedule-flow.js";

const ALIASES = new Map([["MKTG2201", ["marketing"]]]);
afterEach(() => useCourseAliases(undefined));
const BLOCKS: DayBlock[] = [
  { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" },
  { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
  { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
];
const DAY: Day = { date: "2026-11-02", now: "10:00", blocks: BLOCKS };
const SCRIPTS = "/opt/orion/scripts";

describe("--named is code's flag: any exec carrying it is refused, whatever the path", () => {
  it.each([
    "orion-reschedule move MKTG2201 --to 16:00 --named",
    `${SCRIPTS}/orion-reschedule move MKTG2201 --to 16:00 --named`,
    `node ${SCRIPTS}/orion-reschedule move "MKTG2201" --to 16:00 --named`,
    "ORION_X=1 orion-reschedule move marketing --to 16:00 --named",
    `env TZ=Europe/London ${SCRIPTS}/orion-reschedule move marketing --to 16:00 --named`,
    `bash -c 'orion-reschedule move "MKTG2201" --to 16:00 --named'`,
    `sh -lc "cd ${SCRIPTS}; ./orion-reschedule move marketing --to 16:00 --named"`,
    "orion-reschedule move marketing --named --to 16:00",
    "orion-reschedule move marketing --to 16:00 --named=1",
    `${SCRIPTS}/some-other-wrapper --named marketing`,
  ])("%s", (command) => expect(carriesNamedFlag(command)).toBe(true));
  it.each([
    "orion-reschedule move Gym --to 19:00",
    `${SCRIPTS}/orion-agenda today`,
    `echo "named" && ${SCRIPTS}/orion-agenda today`,
    "orion-reschedule add \"Unnamed draft\" 30 --at 19:00",
  ])("not the flag: %s", (command) => expect(carriesNamedFlag(command)).toBe(false));

  it("the plugin's own compile path adds --named itself, never through a worker exec", () => {
    expect(compile({ do: "move", what: "B1", to: "14:00" }, DAY, "move marketing to 2pm today")).toEqual({ args: ["move", "MKTG2201", "--to", "14:00", "--named"] });
  });
});

describe("the anchor guard resolves titles with the alias matcher", () => {
  it("'move marketing --to 16:00' on 'make room for gym' is refused: marketing is MKTG2201", () => {
    useCourseAliases(ALIASES);
    expect(unnamedAnchorWrite("make room for gym", ["move", "marketing", "--to", "16:00", "--named"], BLOCKS)?.title).toBe("MKTG2201");
    expect(unnamedAnchorWrite("make room for gym", ["move", "mktg lecture", "--to", "16:00"], BLOCKS)?.title).toBe("MKTG2201");
  });
  it("his own move of marketing still passes the pure check", () => {
    useCourseAliases(ALIASES);
    expect(unnamedAnchorWrite("move marketing to 4pm", ["move", "marketing", "--to", "16:00"], BLOCKS)).toBeNull();
  });
});

// Through the real chat route's before_tool_call hooks.
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(readDayJson?: (a: string[]) => Promise<Day | undefined>, dayReadMs?: number) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "rev6-named-"));
  const now = new Date(2026, 10, 2, 10, 0);
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => "10:00", now: () => now,
    decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "",
    ...(readDayJson ? { readDayJson } : {}), ...(dayReadMs ? { dayReadMs } : {}),
    scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) } as never);
  let n = 0;
  return async (prompt: string, command: string) => {
    const ctx = { runId: `rev6-${n += 1}`, sessionKey: "agent:main:orion-chat-rev6" };
    await fire("before_model_resolve", { prompt }, ctx);
    await fire("before_prompt_build", { prompt, messages: [] }, ctx);
    const out = (await fire("before_tool_call", { toolName: "exec", params: { command } }, ctx)) as Array<{ block?: boolean; blockReason?: string } | undefined>;
    return out.find((o) => o?.block);
  };
}

describe("through the chat route", () => {
  it("an absolute-path --named move is refused even when his words name the class", async () => {
    useCourseAliases(ALIASES);
    const turn = route(async () => DAY);
    expect(await turn("move marketing to 4pm", `${SCRIPTS}/orion-reschedule move MKTG2201 --to 16:00 --named`)).toBeTruthy();
    expect(await turn("make room for gym", `node ${SCRIPTS}/orion-reschedule move marketing --to 16:00 --named`)).toBeTruthy();
  });
  it("'move marketing --to 16:00' for 'make room for gym' is refused by the anchor guard (no flag)", async () => {
    useCourseAliases(ALIASES);
    const turn = route(async () => DAY);
    expect(await turn("make room for gym", `${SCRIPTS}/orion-reschedule move marketing --to 16:00`)).toBeTruthy();
  });
  it("a write is refused when his day cannot be read: no reader, a failing read, or a read that times out", async () => {
    expect(await route()("make room for gym", `${SCRIPTS}/orion-reschedule move Gym --to 19:00`)).toBeTruthy();
    expect(await route(async () => { throw new Error("calendar down"); })("move gym to 7", `${SCRIPTS}/orion-reschedule move Gym --to 19:00`)).toBeTruthy();
    expect(await route(() => new Promise(() => undefined), 20)("move gym to 7", `${SCRIPTS}/orion-reschedule move Gym --to 19:00`)).toBeTruthy();
  });
  it("his own plain move of gym, with the day read, still runs", async () => {
    const turn = route(async () => DAY);
    expect(await turn("move gym to 7pm", `${SCRIPTS}/orion-reschedule move Gym --to 19:00`)).toBeUndefined();
  });
});
