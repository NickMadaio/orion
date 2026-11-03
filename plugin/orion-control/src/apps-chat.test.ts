// w18 apps: which turns are about his apps (held-out casual phrasings, and the lookalikes that are not), how a turn runs orion-apps,
// the routing end to end with a fake runner, and the exec route that replaces the bedtime wrapper's dead end.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppsTurn } from "./apps-read.js";
import { argsFor, runAppsTurn, type AppsRun } from "./apps-chat.js";
import { registerLocalRouting } from "./local-routing.js";
import { routeForDoomedExec } from "./exec-routing.js";
import type { Decision } from "./front-desk.js";

describe("readAppsTurn", () => {
  it("closing what he is not using is quit-unused, whatever the wording", () => {
    for (const m of [
      "close the apps im not using", "can u shut all the apps i dont need", "quit everything im not using rn",
      "kill the programs im not usin", "close my unused apps", "clean up my open apps", "pls close some of my apps",
      "i have way too many apps open, close a few", "close some of the apps that are open that im not using",
    ]) expect(readAppsTurn(m), m).toMatchObject({ kind: "unused" });
  });
  it("examples after 'like' are closed too", () => {
    expect(readAppsTurn("close some of the apps that are open that im not using. things like epic games and team view"))
      .toEqual({ kind: "unused", also: ["epic games", "team view"] });
  });
  it("everything except is quit-unused with a keep list", () => {
    expect(readAppsTurn("close everything except chrome")).toEqual({ kind: "except", keep: ["chrome"] });
    expect(readAppsTurn("quit all apps but spotify and discord")).toEqual({ kind: "except", keep: ["spotify", "discord"] });
    expect(readAppsTurn("keep safari open and close the rest")).toEqual({ kind: "except", keep: ["safari"] });
  });
  it("named apps", () => {
    expect(readAppsTurn("quit spotify and discord")).toEqual({ kind: "quit", names: ["spotify", "discord"] });
    expect(readAppsTurn("can you close epic games for me")).toEqual({ kind: "quit", names: ["epic games"] });
    expect(readAppsTurn("kill teamviewer")).toEqual({ kind: "quit", names: ["teamviewer"] });
    expect(readAppsTurn("shut down steam, battle.net and roblox")).toEqual({ kind: "quit", names: ["steam", "battle.net", "roblox"] });
    expect(readAppsTurn("yo quit the minecraft launcher pls")).toEqual({ kind: "quit", names: ["minecraft launcher"] });
  });
  it("listing and hiding", () => {
    for (const m of ["what apps do i have open", "whats running on my mac", "which apps are open rn", "show me my open apps", "list my running apps", "how many apps do i have open"])
      expect(readAppsTurn(m), m).toEqual({ kind: "list" });
    expect(readAppsTurn("hide chrome")).toEqual({ kind: "hide", name: "chrome" });
  });
  it("lookalikes are not app turns", () => {
    for (const m of [
      "i need to quit smoking", "close the door", "close this tab", "close it", "quit my job lol", "how do i close an app on mac", "can you close the deal with john",
      "what time is my class", "open spotify", "turn off the lights", "i want to close out the day", "did i quit gym", "close the window", "whats open source",
      "log my workout, ran 5k", "remind me to close the oven",
      "quit checking email", "quit taking notes", "quit being lazy", "close gmail tabs", "stop closing apps lol i hate it",
    ]) expect(readAppsTurn(m), m).toBeNull();
  });
});

describe("runAppsTurn", () => {
  const ok = (say: string) => ({ stdout: JSON.stringify({ ok: true, say }), code: 0 });
  it("maps each turn to its commands, examples first", () => {
    expect(argsFor({ kind: "unused", also: ["epic games", "team view"] })).toEqual([["quit", "epic games", "team view", "--json"], ["quit-unused", "--json"]]);
    expect(argsFor({ kind: "except", keep: ["chrome", "spotify"] })).toEqual([["quit-unused", "--all", "--keep", "chrome,spotify", "--json"]]);
    expect(argsFor({ kind: "list" })).toEqual([["list", "--json"]]);
  });
  it("the reply is the script's own sentences, joined", async () => {
    const calls: string[][] = [];
    const run: AppsRun = async (a) => { calls.push(a); return ok(a[0] === "quit" ? "Closed Epic Games Launcher." : "Kept Safari (you're in it right now)."); };
    const out = await runAppsTurn({ kind: "unused", also: ["epic games"] }, { run });
    expect(out.text).toBe("Closed Epic Games Launcher. Kept Safari (you're in it right now).");
    expect(out.calls).toEqual(["orion-apps quit epic games --json", "orion-apps quit-unused --json"]);
  });
  it("a failure is one honest sentence and never claims anything closed", async () => {
    const out = await runAppsTurn({ kind: "quit", names: ["x"] }, { run: async () => { throw new Error("boom"); } });
    expect(out.text).toMatch(/couldn't reach your apps just now.*nothing was closed/);
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(appsRun: AppsRun | undefined) {
  const d = mkdtempSync(join(tmpdir(), "apps-chat-"));
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
  let clock = new Date(2026, 10, 3, 18, 0).getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Tue 18:00", now: () => new Date(clock),
    decideImpl: async () => ({ move: "answer", answer: "DESK ANSWER" }) as Decision, brainSearch: async () => "",
    scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }),
    listReminders: async () => [], ...(appsRun ? { appsRun } : {}) } as never);
  let n = 0;
  return async (prompt: string) => {
    clock += 30_000;
    const ctx = { runId: `a-${n += 1}`, sessionKey: "agent:main:orion-chat-apps" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    await fire("before_prompt_build", { prompt, messages: [] }, ctx);
    return direct?.reply?.text;
  };
}

describe("apps through the routing", () => {
  it("the 11-03 request no longer reaches the model: it runs orion-apps and says what happened", async () => {
    const calls: string[][] = [];
    const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: a[0] === "quit" ? "Closed Epic Games Launcher and TeamViewer." : "Nothing looked unused, so I closed nothing." }), code: 0 }; });
    expect(await turn("close some of the apps that are open that im not using. things like epic games and team view")).toBe("Closed Epic Games Launcher and TeamViewer. Nothing looked unused, so I closed nothing.");
    expect(calls).toEqual([["quit", "epic games", "team view", "--json"], ["quit-unused", "--json"]]);
  });
  it("named, except, list and hide each run their command and the desk answers none", async () => {
    const calls: string[][] = [];
    const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: `done ${a[0]}` }), code: 0 }; });
    expect(await turn("quit spotify and discord")).toBe("done quit");
    expect(await turn("close everything except chrome")).toBe("done quit-unused");
    expect(await turn("what apps do i have open")).toBe("done list");
    expect(await turn("hide chrome")).toBe("done hide");
    expect(calls.map((c) => c.slice(0, 3))).toEqual([["quit", "spotify", "discord"], ["quit-unused", "--all", "--keep"], ["list", "--json"], ["hide", "chrome", "--json"]]);
  });
  it("lookalikes and a missing runner never run it", async () => {
    const calls: string[][] = [];
    const turn = route(async (a) => { calls.push(a); return { stdout: "{}", code: 1 }; });
    for (const m of ["i should quit smoking", "close this tab", "what time is my class"]) await turn(m);
    expect(calls).toEqual([]);
    expect(await route(undefined)("close the apps im not using")).not.toMatch(/Closed/);
  });
});

describe("the exec route", () => {
  it("quit-app on the bedtime wrapper points at orion-apps, bare name or full path", () => {
    for (const c of ["orion-bedtime-act quit-app com.epicgames.Launcher", "/Users/nickmadaio/Desktop/ORION/scripts/orion-bedtime-act quit-app com.x.y"])
      expect(routeForDoomedExec(c)?.reason).toMatch(/orion-apps/);
    expect(routeForDoomedExec("orion-bedtime-act dim")?.reason).toMatch(/absolute path/);
  });
  it("orion-apps by bare name gets the absolute-path route", () => {
    expect(routeForDoomedExec("orion-apps list")?.reason).toMatch(/\/scripts\/orion-apps/);
  });
});

describe("game mode turns (w18 gamemode)", () => {
  it("game mode on and off, whatever the wording", () => {
    for (const m of ["game mode on", "gaming mode on pls", "turn game mode on", "can you turn on gaming mode", "enable game mode"])
      expect(readAppsTurn(m), m).toEqual({ kind: "gameMode", on: true });
    for (const m of ["game mode off", "turn off gaming mode", "gaming mode off pls", "disable game mode", "turn game mode off lol"])
      expect(readAppsTurn(m), m).toEqual({ kind: "gameMode", on: false });
  });
  it("game ready on demand, whatever the wording, names the game when it has one", () => {
    for (const m of ["make my computer game ready", "get my mac ready for gaming", "prep for gaming", "game ready pls", "prep my laptop for gaming rn", "can you make my pc game ready",
      "make my mac gaming ready", "get my computer ready to game", "make it game ready", "gameready", "gaming prep", "get ready for gaming", "mak my compter game redy pls"])
      expect(readAppsTurn(m), m).toEqual({ kind: "gameReady" });
    expect(readAppsTurn("im about to play minecraft, clean up")).toEqual({ kind: "gameReady", game: "minecraft" });
    expect(readAppsTurn("about to play fortnite get my mac ready")).toEqual({ kind: "gameReady", game: "fortnite" });
    expect(readAppsTurn("im gonna play valorant rn clean up my mac")).toEqual({ kind: "gameReady", game: "valorant" });
    expect(readAppsTurn("prep my mac for minecraft")).toEqual({ kind: "gameReady", game: "minecraft" });
    expect(readAppsTurn("get my computer ready for roblox")).toEqual({ kind: "gameReady", game: "roblox" });
  });
  it("on-demand lookalikes are not game ready", () => {
    for (const m of ["im about to play minecraft", "what does game ready mean", "get ready for bed", "prep for my exam", "game ready drivers are out", "im about to play tennis, clean up the kitchen"])
      expect(readAppsTurn(m), m).toBeNull();
  });
  it("game mode on is prep now plus auto", () => {
    expect(argsFor({ kind: "gameMode", on: true })).toEqual([["game-prep", "auto", "on", "--json"], ["game-prep", "--now", "--json"]]);
    expect(argsFor({ kind: "gameReady" })).toEqual([["game-prep", "--now", "--json"]]);
    expect(argsFor({ kind: "gameReady", game: "minecraft" })).toEqual([["game-prep", "--now", "--game", "minecraft", "--json"]]);
  });
  it("dont close X when i game keeps it, and letting it close again removes it", () => {
    expect(readAppsTurn("dont close discord when i game")).toEqual({ kind: "gameKeep", op: "add", names: ["discord"] });
    expect(readAppsTurn("pls dont quit spotify or chrome while im gaming")).toEqual({ kind: "gameKeep", op: "add", names: ["spotify", "chrome"] });
    expect(readAppsTurn("keep obsidian open when i game")).toEqual({ kind: "gameKeep", op: "add", names: ["obsidian"] });
    expect(readAppsTurn("stop closing slack when im gaming")).toEqual({ kind: "gameKeep", op: "add", names: ["slack"] });
    expect(readAppsTurn("you can close discord when i game")).toEqual({ kind: "gameKeep", op: "remove", names: ["discord"] });
    expect(readAppsTurn("let chrome close again when i play games")).toEqual({ kind: "gameKeep", op: "remove", names: ["chrome"] });
  });
  it("what did you close", () => {
    for (const m of ["what did you close", "wait what did u close when i started gaming", "what did you shut down for minecraft", "what apps did you close"])
      expect(readAppsTurn(m), m).toEqual({ kind: "gameLast" });
  });
  it("lookalikes are not game mode turns", () => {
    for (const m of ["what is game mode", "i love game mode in fortnite", "dont close the door when i leave", "what did you do today", "i wanna game later", "keep my workout streak when i travel"])
      expect(readAppsTurn(m), m).toBeNull();
  });
  it("each runs its orion-apps command and the reply is the script's sentence", async () => {
        expect(argsFor({ kind: "gameMode", on: false })).toEqual([["game-prep", "auto", "off", "--json"]]);
    expect(argsFor({ kind: "gameKeep", op: "add", names: ["discord"] })).toEqual([["game-prep", "keep", "add", "discord", "--json"]]);
    expect(argsFor({ kind: "gameKeep", op: "remove", names: ["chrome"] })).toEqual([["game-prep", "keep", "remove", "chrome", "--json"]]);
    expect(argsFor({ kind: "gameLast" })).toEqual([["game-prep", "last", "--json"]]);
    const calls: string[][] = [];
    const turn = route(async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: `done ${a.slice(0, 2).join(" ")}` }), code: 0 }; });
    expect(await turn("dont close discord when i game")).toBe("done game-prep keep");
    expect(await turn("what did you close")).toBe("done game-prep last");
    expect(calls).toEqual([["game-prep", "keep", "add", "discord", "--json"], ["game-prep", "last", "--json"]]);
  });
});
