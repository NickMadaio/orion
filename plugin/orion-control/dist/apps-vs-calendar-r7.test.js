// Tube audit T4 (11-05 12:18): 'get rid of "New CS Lab"' was claimed by the app closer ('"new cs lab" isn't open.'). A calendar block named after those verbs is the calendar's.
import { describe, expect, it } from "vitest";
import { readAppsTurn } from "./apps-read.js";
describe("get rid of / ditch / clear out / clean up", () => {
    it.each(['get rid of "New CS Lab"', "get rid of New CS Lab", "ditch the DS lab", "clear out gym", "get rid of practice leetcode", "clean up study block", "ditch the orion learning plan", "get rid of the call with mum"])("%s is not an app quit", (m) => expect(readAppsTurn(m), m).toBeNull());
    it.each([["get rid of discord", ["discord"]], ["ditch spotify", ["spotify"]], ["get rid of spotify and discord", ["spotify", "discord"]], ["clear out chrome", ["chrome"]], ["clean up safari", ["safari"]]])("%s still closes the app", (m, names) => expect(readAppsTurn(m)).toEqual({ kind: "quit", names }));
    it("quit and close are unambiguous and keep their old reach", () => {
        expect(readAppsTurn("quit new cs lab")).toEqual({ kind: "quit", names: ["new cs lab"] });
        expect(readAppsTurn("close zork")).toEqual({ kind: "quit", names: ["zork"] });
    });
});
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "./local-routing.js";
describe("through the routing", () => {
    it.each(['get rid of "New CS Lab"', "ditch the DS lab", "get rid of New CS Lab"])("%s reaches the calendar, never the app closer", async (said) => {
        const handlers = new Map();
        const apps = [];
        const seen = [];
        registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "av-")), "r.jsonl"), stateDir: mkdtempSync(join(tmpdir(), "av2-")), clock: () => "Thu 12:18", now: () => new Date(2026, 10, 5, 12, 18), brainSearch: async () => "",
            decideImpl: async () => ({ move: "escalate", tier: "standard" }),
            scheduleFlow: async (m) => { seen.push(m); return { outcome: "say", kind: "plain", text: "Removed New CS Lab from your day." }; },
            appsRun: async (a) => { apps.push(a); return { stdout: JSON.stringify({ ok: true, say: "isn't open." }), code: 0 }; } });
        const ctx = { runId: "av-1", sessionKey: "agent:main:orion-chat-av" };
        const fire = async (n, e) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, ctx)); return out; };
        await fire("before_model_resolve", { prompt: said });
        await fire("before_agent_reply", { cleanedBody: said });
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }));
        expect(apps).toEqual([]);
        expect(seen.length).toBe(1);
        expect(built?.systemPrompt).toContain("Removed New CS Lab");
    });
});
