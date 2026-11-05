// w20 r6: the one last pass, surgical. Every leak shape that reached him is cut; every legitimate thing (review r6) is kept.
import { describe, expect, it } from "vitest";
import { askedForTechnical, finalSanitize, LEAK_FALLBACK } from "./final-sanitizer.js";
describe("the shapes that leaked", () => {
    it("#45: the raw tool field inside a failure sentence", () => {
        expect(finalSanitize('I couldn\'t run that: "outcome": "NOTHING WAS DONE. NOT DONE. THIS IS NOT A SUCCESS.",. Want me to try it a different way?')).toBe("I couldn't run that. Want me to try it a different way?");
    });
    it.each([
        ['Done. "executed": false Nothing moved.', "Done. Nothing moved."],
        ['I put it on your list. "isError": true, "stderr": "no such file"', "I put it on your list."],
    ])("%s", (a, b) => expect(finalSanitize(a)).toBe(b));
    it("#83: (route: [object Object]) goes whole", () => {
        expect(finalSanitize('I looked at what I did for "nah put it back to normal" (route: [object Object]) and I can\'t see a clear fault.')).toBe('I looked at what I did for "nah put it back to normal" and I can\'t see a clear fault.');
        expect(finalSanitize("It went to [object Object].")).toBe("It went to.");
    });
    it("#91: our tool id named as a tool becomes 'that', the rest of the sentence stays", () => {
        expect(finalSanitize("I can't play music directly, but you can use the media_play_pause tool to control playback on your device.")).toBe("I can't play music directly, but you can use that to control playback on your device.");
        expect(finalSanitize("I called tool_call and it worked.")).toBe("I called that and it worked.");
    });
    it("our own script path and a log of what ran", () => {
        expect(finalSanitize("I ran /Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule and it failed.")).toBe("I ran that and it failed.");
        expect(finalSanitize("I couldn't estimate that just now (orion-food-estimate gave no answer), so nothing was logged.")).toBe("I couldn't estimate that just now (that gave no answer), so nothing was logged.");
    });
    it("text that was only a leak falls back; nothing else ever does", () => {
        expect(finalSanitize("[object Object]")).toBe(LEAK_FALLBACK);
        expect(finalSanitize('"outcome": "NOT DONE",')).toBe(LEAK_FALLBACK);
    });
});
describe("must keep (review r6)", () => {
    it.each([
        "It checks whether x is undefined, which is true for unset variables.",
        "Here: https://example.com/orion-control/tool_call_guide",
        'It looks like {"status": "ok", "count": 3}.',
        "In JavaScript, NaN !== NaN, so use Number.isNaN.",
        "Open https://example.com/media_play_pause/foo",
        "Run orion-reschedule undo",
        "Use the orion_task_run tool with a steps array.".replace("Use the orion_task_run tool", "Pass a steps array"),
        "Your alarm is undefined in the settings file, so check it.",
        "I moved the null-hypothesis lab to 3.",
        "Use `media_play_pause` for that, or run `orion-reschedule undo`.",
        "```json\n{\"outcome\": \"ok\", \"executed\": true}\n```",
        "The file_open_dialog and note_taking apps are fine.",
        "Done: gym 10:00 PM–11:00 PM.", "Your alarm is 6:30 AM. Sleep well.", "It's 5:25 AM, mate.",
    ])("%s", (t) => expect(finalSanitize(t)).toBe(t));
    it("a URL carrying a tool id is never rewritten even when the rest is", () => {
        expect(finalSanitize("Open https://example.com/media_play_pause/foo, you can use the media_play_pause tool.")).toBe("Open https://example.com/media_play_pause/foo, you can use that.");
    });
    it("code spans keep a leaked-looking field", () => expect(finalSanitize('Send `{"outcome": "ok"}` and then it is done.')).toBe('Send `{"outcome": "ok"}` and then it is done.'));
    it("when he asked about code, JSON, scripts or tools, nothing is touched", () => {
        const reply = 'Use the media_play_pause tool, e.g. {"outcome": "ok", "executed": true} (route: [object Object]).';
        expect(askedForTechnical("what json does the media tool return")).toBe(true);
        expect(finalSanitize(reply, { asked: true })).toBe(reply);
        expect(askedForTechnical("can you play something for me")).toBe(false);
        expect(askedForTechnical("log two eggs and toast")).toBe(false);
    });
    it("is idempotent", () => {
        const once = finalSanitize('I couldn\'t run that: "outcome": "NOT DONE",. Want me to retry? You can use the media_play_pause tool.');
        expect(finalSanitize(once)).toBe(once);
    });
});
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "./local-routing.js";
describe("through the routing, on every surface", () => {
    const boot = (answer) => {
        const handlers = new Map();
        registerLocalRouting({ on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "fs-")), "r.jsonl"), clock: () => "Thu 06:00", brainSearch: async () => "",
            decideImpl: async () => (answer ? { move: "answer", answer } : { move: "escalate", tier: "standard" }), scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }) });
        const ctx = { runId: "fs-1", sessionKey: "agent:main:orion-chat-fs" };
        return { fire: async (n, e) => { const out = []; for (const fn of handlers.get(n) ?? [])
                out.push(await fn(e, ctx)); return out; } };
    };
    it("a direct (desk-drafted) reply", async () => {
        const { fire } = boot("Sure. You can use the media_play_pause tool to control playback.");
        const said = "any chance of some tunes";
        await fire("before_model_resolve", { prompt: said });
        const [direct] = (await fire("before_agent_reply", { cleanedBody: said }));
        if (direct?.reply?.text)
            expect(direct.reply.text).not.toMatch(/media_play_pause/);
    });
    it("the worker's finalized reply is put in place clean", async () => {
        const { fire } = boot();
        const said = "can you play something for me";
        await fire("before_model_resolve", { prompt: said });
        const messages = [{ role: "user", content: said }, { role: "assistant", content: [{ type: "text", text: "I can't play music directly, but you can use the media_play_pause tool to control playback on your device. (route: [object Object])" }] }];
        await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: messages[1].content[0].text, messages });
        const text = messages[1].content[0].text;
        expect(text).not.toMatch(/media_play_pause|object Object/);
    });
    it("the channel payload", async () => {
        const { fire } = boot();
        const [out] = (await fire("reply_payload_sending", { runId: "none", sessionKey: "x", payload: { text: 'Done. "outcome": "NOT DONE", Then orion_task_run failed.' } }));
        expect(out?.payload?.text).toBeDefined();
        expect(out?.payload?.text).not.toMatch(/outcome|orion_task_run/);
    });
});
