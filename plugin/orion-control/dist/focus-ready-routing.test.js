// "im ready to work" reaches the focus-ready flow through the real routing, whatever the front desk guessed.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
describe("routing: ready to work", () => {
    it.each(["ok im home lets get started", "time to lock in", "im ready to work"])("%s starts the session from the plan", async (said) => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const fire = async (n, e, c) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, c)); return out; };
        const calls = [];
        let pending;
        const exec = async (args) => { calls.push(args); return { stdout: args[0] === "status" ? JSON.stringify({ status: "none" }) : JSON.stringify({ ok: true, status: "running", phase: "focus", remainingSeconds: 3000 }), code: 0 }; };
        const desk = { move: "ignore" };
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "fr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Wed 18:05",
            now: () => new Date(2026, 10, 4, 18, 5), decideImpl: async () => desk, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
            readDayJson: async () => ({ date: "2026-11-04", now: "18:05", blocks: [{ title: "Finish resume", start: "18:00", end: "19:00", fixed: false, kind: "study" }] }),
            focusReady: { exec, profile: async () => ({ stdout: JSON.stringify({ ok: true, apps: [{ name: "Pages", bundleId: "com.apple.iWork.Pages" }, { name: "Safari", bundleId: "com.apple.Safari" }], domains: [] }), code: 0 }),
                sites: async () => ({ stdout: "{}", code: 0 }), tasks: async () => ({ stdout: "", code: 1 }), resolveApp: async () => null, pending: { get: () => pending, set: (p) => { pending = p; } } } });
        const ctx = { runId: "fr1", sessionKey: "agent:main:x" };
        await fire("before_model_resolve", { prompt: said }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        expect(calls.some((c) => c[0] === "start" && c[1] === "Finish resume")).toBe(true);
        expect(built?.systemPrompt).toContain("Starting 50 min on Finish resume. Allowed: Pages and Safari. Need anything else?");
    });
});
