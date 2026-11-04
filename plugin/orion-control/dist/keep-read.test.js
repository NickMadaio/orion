// w18 keep: "keep vorsaint at all times" is `orion-apps game-prep keep add`, never a memory line ("Logged." on 11-03). Held-out casual phrasings,
// typos, and the lookalikes that are not keep requests. Plus the end to end route with a fake runner.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppsTurn } from "./apps-read.js";
import { argsFor } from "./apps-chat.js";
import { registerLocalRouting } from "./local-routing.js";
describe("keep add", () => {
    it("the 11-03 request and its relatives", () => {
        const cases = [
            ["keep vorsaint at all times", ["vorsaint"]], ["never close vorssaint", ["vorssaint"]], ["always leave spotify open", ["spotify"]],
            ["vorssaint stays open", ["vorssaint"]], ["pls always keep vorsaint open", ["vorsaint"]], ["keep vorsaint open always", ["vorsaint"]],
            ["dont ever close discrod", ["discrod"]], ["yo leave chrome open all the time", ["chrome"]], ["spotify should always stay open", ["spotify"]],
            ["always keep obsidian and discord open", ["obsidian", "discord"]], ["Keep Vorsaint at all times.", ["vorsaint"]], ["dont quit vorssaint ever", ["vorssaint"]],
            ["can u keep vorsaint open no matter what", ["vorsaint"]], ["never shut down slack", ["slack"]],
            ["dont close discord when i game", ["discord"]], ["never kill vorsaint pls", ["vorsaint"]],
        ];
        for (const [m, names] of cases)
            expect(readAppsTurn(m), m).toEqual({ kind: "gameKeep", op: "add", names });
    });
    it("stopping", () => {
        const cases = [["stop keeping vorsaint", ["vorsaint"]], ["stop keeping spotify open", ["spotify"]],
            ["you dont need to keep discord open anymore", ["discord"]], ["dont keep vorssaint open anymore", ["vorssaint"]], ["no longer keep slack open", ["slack"]]];
        for (const [m, names] of cases)
            expect(readAppsTurn(m), m).toEqual({ kind: "gameKeep", op: "remove", names });
    });
    it("asking what he always keeps", () => {
        for (const m of ["what do you always keep open", "what apps do you always leave open", "which apps do you never close", "whats on my keep list", "what do u always keep open rn"])
            expect(readAppsTurn(m), m).toEqual({ kind: "keepList" });
    });
    it("lookalikes are not keep requests", () => {
        for (const m of ["keep it open", "keep the door open", "i never close my eyes", "never quit smoking", "dont close the tab", "stop keeping me up", "keep my streak going", "keep going",
            "keep the window open", "the store stays open late", "dont quit on me", "never close the deal", "keep me posted", "leave me alone", "stop keeping track of my food", "always leave early",
            "keep chrome tabs open", "what do you keep in the fridge"])
            expect(readAppsTurn(m), m).toBeNull();
    });
    it("each runs its orion-apps command", () => {
        expect(argsFor({ kind: "gameKeep", op: "add", names: ["vorsaint"] })).toEqual([["game-prep", "keep", "add", "vorsaint", "--json"]]);
        expect(argsFor({ kind: "keepList" })).toEqual([["game-prep", "keep", "list", "--json"]]);
    });
});
describe("through the routing", () => {
    it("keep vorsaint at all times runs keep add and replies with the script's sentence; the desk never answers", async () => {
        const d = mkdtempSync(join(tmpdir(), "keep-chat-"));
        writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const calls = [];
        const appsRun = async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: "I'll always leave Vorssaint open." }), code: 0 }; };
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Tue 18:00", now: () => new Date(2026, 10, 3, 18, 0),
            decideImpl: async () => ({ move: "tool", tool: "brain", args: { do: "search", query: "keep vorsaint at all times" } }), brainSearch: async () => "",
            scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }),
            listReminders: async () => [], appsRun });
        const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
            o.push(await fn(e, c)); return o; };
        const ctx = { runId: "k-1", sessionKey: "agent:main:orion-chat-keep" };
        await fire("before_model_resolve", { prompt: "keep vorsaint at all times" }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: "keep vorsaint at all times" }, ctx));
        expect(direct?.reply?.text).toBe("I'll always leave Vorssaint open.");
        expect(calls).toEqual([["game-prep", "keep", "add", "vorsaint", "--json"]]);
    });
});
