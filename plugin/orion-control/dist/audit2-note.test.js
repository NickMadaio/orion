// w18 audit2 (item E): 11-03 22:40. "Can you make a note for me really quickly?" -> "What note would you like me to make?" -> his dictated
// sentence about ORION was taken as a claim to agree with ("Got it, I have the right tools..."). After a bare note request the next message is the note.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { runNote, isOtherCommand } from "./note-flow.js";
const SENTENCE = "Orion has the correct tools to modify wake up times.";
describe("the note about ORION is a note", () => {
    it("is not read as another command, so it stays bound", () => { expect(isOtherCommand(SENTENCE)).toBe(false); });
    it("asks for the note, then files his sentence whole through note-flow", async () => {
        const handlers = new Map();
        const calls = [];
        registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, {
            warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "a2n-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Tue 22:40",
            now: () => new Date(Date.UTC(2026, 10, 3, 22, 40)),
            decideImpl: async () => ({ move: "answer", answer: "Got it, I have the right tools to adjust your wake-up time." }),
            scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
            noteFlow: (message, bound) => runNote({ message, ...(bound ? { bound } : {}), exec: async (a) => { calls.push(a); return { stdout: 'Added to "Nick": x', code: 0 }; } }),
        });
        let n = 0;
        const say = async (prompt) => {
            const ctx = { runId: `n${n++}`, sessionKey: "agent:main:a2n" };
            for (const fn of handlers.get("before_model_resolve") ?? [])
                await fn({ prompt }, ctx);
            let text = "";
            for (const fn of handlers.get("before_prompt_build") ?? []) {
                const o = (await fn({ prompt, messages: [] }, ctx));
                text += o?.systemPrompt ?? "";
            }
            return text;
        };
        expect(await say("Can you make a note for me really quickly?")).toContain("Go ahead");
        expect(await say(SENTENCE)).toContain("Saved the note");
        expect(calls).toEqual([["learn", "Nick", "note", SENTENCE]]);
    });
});
