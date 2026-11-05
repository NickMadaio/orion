// w20 r6 (live gate 4 #45 #83 #91): the one last pass. A test for every leak shape that reached him.
import { describe, expect, it } from "vitest";
import { finalSanitize, LEAK_FALLBACK } from "./final-sanitizer.js";
describe("JSON fragments", () => {
    it("#45: the raw tool field inside a failure sentence", () => {
        const out = finalSanitize('I couldn\'t run that: "outcome": "NOTHING WAS DONE. NOT DONE. THIS IS NOT A SUCCESS.",. Want me to try it a different way?');
        expect(out).toBe("I couldn't run that. Want me to try it a different way?");
    });
    it.each([
        ['Done. {"ok": true, "id": 4} Added stamps.', "Done. Added stamps."],
        ['I put it on your list. "status": "failed", "error": "no such file"', "I put it on your list."],
        ['Result: {"count": 3, "items": ["a", "b"]} so you have three.', "Result: so you have three."],
    ])("%s", (a, b) => expect(finalSanitize(a)).toBe(b));
});
describe("unfilled values", () => {
    it("#83: (route: [object Object]) goes whole", () => {
        expect(finalSanitize('I looked at what I did for "nah put it back to normal" (route: [object Object]) and I can\'t see a clear fault in the record.'))
            .toBe('I looked at what I did for "nah put it back to normal" and I can\'t see a clear fault in the record.');
    });
    it.each([
        ["Your alarm is undefined.", "Your alarm is."],
        ["You have NaN minutes left. Next is the lab at 1.", "You have minutes left. Next is the lab at 1."],
        ["Route: undefined. Everything else is fine.", "Everything else is fine."],
        ["It went to [object Object].", "It went to."],
    ])("%s", (a, b) => expect(finalSanitize(a)).toBe(b));
    it("only a leak and nothing else falls back", () => expect(finalSanitize("[object Object]")).toBe(LEAK_FALLBACK));
});
describe("tool and script names", () => {
    it("#91: a sentence telling him to use a tool is dropped", () => {
        expect(finalSanitize("I can't play music directly, but you can use the media_play_pause tool to control playback on your device.")).toBe(LEAK_FALLBACK);
        expect(finalSanitize("Sure. You can use the media_play_pause tool to control playback. Anything else?")).toBe("Sure. Anything else?");
    });
    it.each([
        ["I ran orion-reschedule and moved gym to 5.", "I ran that and moved gym to 5."],
        ["I called tool_call and it worked.", "I called that and it worked."],
        ["Opened it with browser_open_url just now.", "Opened it with that just now."],
        ["The orion_task_run step failed, so nothing was set.", "The that step failed, so nothing was set."],
    ])("%s", (a, b) => expect(finalSanitize(a)).toBe(b));
    it("a sentence about the exec tool goes", () => expect(finalSanitize("I used the exec tool to read your list. You have three items.")).toBe("You have three items."));
});
describe("clean replies are untouched", () => {
    it.each([
        "Done: gym 10:00 PM–11:00 PM.", "I moved the null-hypothesis lab to 3.", "Your alarm is 6:30 AM. Sleep well.", "I opened youtube.com in Safari. It's 6:23 AM.",
        "You've got 3 meals logged; I didn't guess calories.", "It's 5:25 AM, mate.",
    ])("%s", (t) => expect(finalSanitize(t)).toBe(t));
    it("is idempotent", () => {
        const once = finalSanitize('I couldn\'t run that: "outcome": "NOT DONE",. Want me to retry? Use the media_play_pause tool.');
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
