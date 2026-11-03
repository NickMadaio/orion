// w18 mousechat: mouse turns read from casual phrasings, carried out through orion-mouse (a fake runner, then the real script on a temp dir),
// the one follow-up question bound to the chat, and a yes to a new-mouse outreach starting setup.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMouseTurn, type MouseTurn } from "./mouse-read.js";
import { MouseMemory, runMouseTurn, type MouseRun } from "./mouse-chat.js";
import { registerLocalRouting, instructionsFor } from "./local-routing.js";
import { GENERAL_INSTRUCTIONS, MOUSE_TOOL } from "./job-instructions.js";
import { routeForDoomedExec } from "./exec-routing.js";
import type { Decision } from "./front-desk.js";

const NOW = new Date(2026, 10, 3, 18, 0);
const dir = () => mkdtempSync(join(tmpdir(), "mouse-chat-"));

describe("readMouseTurn: held-out casual phrasings", () => {
  const set = (button: string, action: string, app?: string): MouseTurn => ({ kind: "set", button, action, ...(app ? { app } : {}) });
  it("a button and an action", () => {
    expect(readMouseTurn("yo make my back button go to the left desktop")).toEqual(set("back button", "left desktop"));
    expect(readMouseTurn("front side button should be mission control pls")).toEqual(set("front side button", "mission control"));
    expect(readMouseTurn("can u bind button 6 to a screenshot")).toEqual(set("button 6", "screenshot"));
    expect(readMouseTurn("set the mouse thumb button to cmd+shift+4")).toEqual(set("thumb button", "cmd+shift+4"));
    expect(readMouseTurn("make the forward button open spotify")).toEqual(set("forward button", "open spotify"));
  });
  it("a missing button or action is left for the script to ask about", () => {
    expect(readMouseTurn("make my side button do stage manager")).toEqual(set("side button", "stage manager"));
    expect(readMouseTurn("make the back side button do something useful")).toEqual(set("back side button", ""));
    expect(readMouseTurn("my mouse should open launchpad")).toEqual(set("", "open launchpad"));
  });
  it("only in one app", () => {
    expect(readMouseTurn("when im in safari make the back button do app expose")).toEqual(set("back button", "app expose", "safari"));
    expect(readMouseTurn("make the back button do app expose only in safari")).toEqual(set("back button", "app expose", "safari"));
  });
  it("leave a game alone, and take that back", () => {
    expect(readMouseTurn("dont do anything in minecraft")).toEqual({ kind: "passthrough", op: "add", app: "minecraft" });
    expect(readMouseTurn("leave my mouse buttons alone in photoshop")).toEqual({ kind: "passthrough", op: "add", app: "photoshop" });
    expect(readMouseTurn("stop ignoring the mouse in minecraft")).toEqual({ kind: "passthrough", op: "remove", app: "minecraft" });
    expect(readMouseTurn("turn off game detection for the mouse")).toEqual({ kind: "games", state: "off" });
    expect(readMouseTurn("turn game detection back on")).toEqual({ kind: "games", state: "on" });
  });
  it("status, clear and setup", () => {
    expect(readMouseTurn("what are my mouse buttons set to")).toEqual({ kind: "status" });
    expect(readMouseTurn("what does the back button on my mouse do rn")).toEqual({ kind: "status" });
    expect(readMouseTurn("unbind the front button")).toEqual({ kind: "clear", button: "front button" });
    expect(readMouseTurn("put my back button back to normal")).toEqual({ kind: "clear", button: "back button" });
    expect(readMouseTurn("help me set up my new mouse")).toEqual({ kind: "setup" });
  });
  it("things that are not mouse requests", () => {
    for (const m of ["dont do anything in class tomorrow", "the submit button is broken on the site", "what time is my class", "hit the back button in safari", "i need a new mouse pad", "turn off the lights in the kitchen", "did you click the button yet?"]) {
      expect(readMouseTurn(m), m).toBeNull();
    }
  });
  it("replies bind only to a waiting question; a yes needs a new-mouse outreach or the offered defaults", () => {
    expect(readMouseTurn("the front one", { pending: { ask: "button", action: "stage manager" } })).toEqual(set("front", "stage manager"));
    expect(readMouseTurn("4", { pending: { ask: "button", action: "stage manager" } })).toEqual(set("button 4", "stage manager"));
    expect(readMouseTurn("the front one", { pending: { ask: "button", clear: true } })).toEqual({ kind: "clear", button: "front" });
    expect(readMouseTurn("uhh mission control i guess", { pending: { ask: "action", button: "3" } })).toEqual(set("3", "mission control"));
    expect(readMouseTurn("never mind", { pending: { ask: "action", button: "3" } })).toEqual({ kind: "cancel" });
    expect(readMouseTurn("the front one")).toBeNull();
    expect(readMouseTurn("what's the weather", { pending: { ask: "button" } })).toBeNull();
    expect(readMouseTurn("sure")).toBeNull();
    expect(readMouseTurn("sure", { outreachAbout: true })).toEqual({ kind: "setup" });
    expect(readMouseTurn("yeah", { confirm: true })).toEqual({ kind: "apply" });
    expect(readMouseTurn("nah", { outreachAbout: true })).toEqual({ kind: "decline" });
  });
});

describe("runMouseTurn", () => {
  const fake = (answers: Record<string, unknown>, calls: string[][] = []): MouseRun => async (args) => {
    calls.push(args);
    const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
    const out = key ? answers[key] : { ok: false, error: "unexpected" };
    return { stdout: JSON.stringify(out), code: (out as { ok: boolean }).ok ? 0 : 1 };
  };
  it("maps each turn to its command and says the script's own sentence", async () => {
    const calls: string[][] = [];
    const run = fake({ status: { ok: true, say: "S" }, set: { ok: true, say: "D" }, clear: { ok: true, say: "C" }, passthrough: { ok: true, say: "P" }, games: { ok: true, say: "G" } }, calls);
    for (const t of [{ kind: "status" }, { kind: "set", button: "back", action: "screenshot", app: "safari" }, { kind: "clear", button: "3" }, { kind: "passthrough", op: "add", app: "minecraft" }, { kind: "games", state: "off" }] as MouseTurn[]) {
      expect((await runMouseTurn(t, { run })).text).toMatch(/^[SDCPG]$/);
    }
    expect(calls).toEqual([["status", "--json"], ["set", "back", "screenshot", "--app", "safari", "--json"], ["clear", "3", "--json"], ["passthrough", "add", "minecraft", "--json"], ["games", "off", "--json"]]);
  });
  it("a question from the script becomes the pending follow-up, with what is known so far", async () => {
    const run = fake({ set: { ok: true, asking: true, ask: "button", say: "Which button?" } });
    expect((await runMouseTurn({ kind: "set", button: "side button", action: "stage manager" }, { run })).pending).toEqual({ ask: "button", button: "side button", action: "stage manager" });
    const act = fake({ set: { ok: true, asking: true, ask: "action", button: 3, say: "What should it do?" } });
    expect((await runMouseTurn({ kind: "set", button: "back", action: "" }, { run: act })).pending).toEqual({ ask: "action", button: "3" });
    const setup = fake({ setup: { ok: true, asking: true, say: "Want that?" } });
    expect((await runMouseTurn({ kind: "setup" }, { run: setup })).confirm).toBe(true);
  });
  it("a failure is one honest sentence; decline and cancel run nothing", async () => {
    const calls: string[][] = [];
    const bad = await runMouseTurn({ kind: "status" }, { run: async () => { throw new Error("boom"); } });
    expect(bad.text).toMatch(/nothing was changed/);
    expect((await runMouseTurn({ kind: "set", button: "x", action: "y" }, { run: fake({ set: { ok: false, error: "no", say: "No." } }, calls) })).text).toBe("No.");
    expect((await runMouseTurn({ kind: "decline" }, { run: fake({}, calls) })).calls).toEqual([]);
    expect(MouseMemory).toBeDefined();
  });
  it("MouseMemory expires after ten minutes", () => {
    const m = new MouseMemory();
    m.wait("s", NOW.getTime(), { pending: { ask: "button" } });
    expect(m.get("s", NOW.getTime() + 60_000)).toEqual({ pending: { ask: "button" } });
    expect(m.get("s", NOW.getTime() + 11 * 60_000)).toBeUndefined();
    m.clear("s");
    expect(m.get("s", NOW.getTime())).toBeUndefined();
  });
});

// ---- through the real routing ----
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(mouseRun: MouseRun | undefined, d = dir()) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  let clock = NOW.getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Tue 18:00", now: () => new Date(clock),
    decideImpl: async () => ({ move: "answer", answer: "DESK ANSWER" }) as Decision, brainSearch: async () => "",
    scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
    readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }), listReminders: async () => [], ...(mouseRun ? { mouseRun } : {}),
  } as never);
  let n = 0;
  const turn = async (prompt: string) => {
    clock += 30_000;
    const ctx = { runId: `m-${n += 1}`, sessionKey: "agent:main:orion-chat-mouse" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    await fire("before_prompt_build", { prompt, messages: [] }, ctx);
    return direct?.reply?.text;
  };
  return { turn, dir: d, now: () => clock };
}

const script = fileURLToPath(new URL("../../../scripts/orion-mouse", import.meta.url));
const realRun = (d: string): MouseRun => (args) => new Promise((resolve) => execFile(process.execPath, [script, ...args],
  { env: { ...process.env, ORION_CONTROLLED_DIR: d, ORION_MOUSE_NO_LOOKUP: "1" } }, (e, stdout) => resolve({ stdout: String(stdout), code: e ? 1 : 0 })));
const DEVICES = { version: 1, devices: [{ id: "5426:153", name: "Razer Basilisk V3", transport: "USB", buttonCount: 11, extraButtons: [3, 4], connected: true, setupState: "asked" }] };
const bindingsOf = (d: string) => JSON.parse(readFileSync(join(d, "mouse", "bindings.json"), "utf8")) as { default: Record<string, unknown>; passthroughApps: string[] };
const seed = (d: string) => { mkdirSync(join(d, "mouse")); writeFileSync(join(d, "mouse", "devices.json"), JSON.stringify(DEVICES)); };

describe("mouse through the routing (the real orion-mouse, a temp dir)", () => {
  it("an ambiguous side button asks once, his answer sets it, and the desk answers none of it", async () => {
    const d = dir(); seed(d);
    const r = route(realRun(d), d);
    expect(await r.turn("make my side button do stage manager")).toBe("Which button, the front or the back side button?");
    expect(await r.turn("the front one")).toBe("Done: the front side button now does Stage Manager.");
    expect(bindingsOf(d).default).toEqual({ 4: { kind: "system", name: "stageManager" } });
    expect(await r.turn("back button should go to the left desktop")).toBe("Done: the back side button now does the left desktop.");
    expect(await r.turn("dont do anything in minecraft")).toBe("Done: the mouse buttons won't do anything in Minecraft.");
    expect(bindingsOf(d).passthroughApps).toEqual(["com.mojang.minecraftlauncher"]);
    expect(await r.turn("what are my mouse buttons set to")).toMatch(/front side button: Stage Manager; back side button: the left desktop|back side button: the left desktop; front side button: Stage Manager/);
  });
  it("a missing action asks, and an unrelated turn after the question unbinds it", async () => {
    const d = dir(); seed(d);
    const r = route(realRun(d), d);
    expect(await r.turn("make the back button do something")).toMatch(/^What should it do\?/);
    expect(await r.turn("what time is my class tomorrow")).not.toMatch(/Done:/);
    expect(await r.turn("stage manager")).not.toMatch(/Done:/);
    expect(() => readFileSync(join(d, "mouse", "bindings.json"))).toThrow();
  });
  it("a yes to the new-mouse outreach lists the buttons and suggests defaults; a second yes applies them", async () => {
    const d = dir(); seed(d);
    writeFileSync(join(d, "outreach.jsonl"), `${JSON.stringify({ text: "I see a new mouse, a Razer Basilisk V3. Want me to set up its extra buttons?", at: new Date(NOW.getTime() - 60_000).toISOString(), channel: "app" })}\n`);
    const r = route(realRun(d), d);
    const offer = await r.turn("sure");
    expect(offer).toMatch(/Razer Basilisk V3 has 2 extra buttons: back side button and front side button\./);
    expect(offer).toMatch(/the back side button on Mission Control and the front side button on Stage Manager\. Want that\?$/);
    expect(await r.turn("yeah")).toMatch(/^Done: the back side button on Mission Control and the front side button on Stage Manager/);
    expect(bindingsOf(d).default).toEqual({ 3: { kind: "system", name: "missionControl" }, 4: { kind: "system", name: "stageManager" } });
  });
  it("a yes with no mouse outreach is not a mouse turn, and without a runner nothing is taken", async () => {
    const calls: string[][] = [];
    const r = route(async (args) => { calls.push(args); return { stdout: "{}", code: 1 }; });
    await r.turn("sure"); await r.turn("make the side button do stage manager");
    expect(calls.map((c) => c[0])).toEqual(["set"]);
    const none = route(undefined);
    expect(await none.turn("make the front button mission control")).not.toMatch(/Done:/);
  });
});

describe("the worker's toolbelt and exec routing", () => {
  it("carries orion-mouse only on a mouse turn", () => {
    expect(instructionsFor(undefined, "what are my mouse buttons set to")).toBe(`${GENERAL_INSTRUCTIONS}\n\n${MOUSE_TOOL}`);
    expect(instructionsFor(undefined, "turn the lights on")).toBe(GENERAL_INSTRUCTIONS);
  });
  it("a bare orion-mouse in the shell is sent to its full path", () => {
    expect(routeForDoomedExec("orion-mouse status")?.reason).toMatch(/orion-mouse/);
    expect(routeForDoomedExec("/opt/orion/scripts/orion-mouse status")).toBeUndefined();
  });
});
