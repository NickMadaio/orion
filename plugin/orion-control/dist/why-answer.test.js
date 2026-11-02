// A "why" to something ORION sent is answered by code: weather notices through a forecast lookup code asks for, the rest from their own text.
// Gate run-1102020539: "why" after the jacket heads-up got "I didn't actually do that". Held-out phrasings; fixtures only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { whyAnswer } from "./why-answer.js";
const label = (text, minutes = 5) => `[ORION context: you messaged him first, ${minutes} min ago: "${text}". This message MAY be his answer.]\n`;
const JACKET = "Heads up — take a jacket when you leave for the gym.";
const LEAVE = "Leave in 13 min for MKTG2201 at 1:30 PM.";
const BED = "Its 3 AM. CS2100 is at 9. Bed now.";
const START = "Time to start: CS Lab.";
const PLAIN = "Your phone battery is at 12%.";
function harness() {
    const handlers = new Map();
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "why-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 12:00", now: () => new Date("2026-11-02T14:00:00Z"),
        decideImpl: async () => ({ move: "escalate", tier: "standard" })
    });
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    let n = 0;
    return async (prompt) => {
        const ctx = { runId: `w${n += 1}`, sessionKey: "agent:main:orion-chat-why" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return { direct: direct?.reply?.text, built: `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
    };
}
describe("whyAnswer", () => {
    it("a weather notice asks for the forecast", () => {
        for (const text of [JACKET, "Bring an umbrella, rain from 4.", "It's freezing out, wear layers.", "Grab gloves, it's cold tonight."]) {
            const a = whyAnswer({ text, minutes: 2, kind: "info" });
            expect(a?.kind).toBe("call");
            expect(a && a.kind === "call" ? a.action : "").toBe("weather_now");
        }
    });
    it("a leave nudge, a bedtime line and a start line are explained from their own text", () => {
        expect(whyAnswer({ text: LEAVE, minutes: 1, kind: "info" })).toEqual({ kind: "say", text: expect.stringContaining("MKTG2201 is at 1:30 PM") });
        expect(whyAnswer({ text: BED, minutes: 1, kind: "bedtime" })).toEqual({ kind: "say", text: expect.stringContaining("bedtime") });
        expect(whyAnswer({ text: START, minutes: 1, kind: "start", title: "CS Lab" })).toEqual({ kind: "say", text: expect.stringContaining("CS Lab was planned") });
    });
    it("anything else is the worker's, with the context", () => expect(whyAnswer({ text: PLAIN, minutes: 1, kind: "info" })).toBeUndefined());
});
describe("the turn", () => {
    for (const said of ["why", "Why are you telling me to take a jacket?", "huh what for", "wdym"]) {
        it(`"${said}" after the jacket heads-up is a forecast lookup worded as the reason, not a refusal`, async () => {
            const out = await harness()(`${label(JACKET)}${said}`);
            expect(out.direct).toBeUndefined();
            expect(out.built).toContain("weather_now");
            expect(out.built).toMatch(/asking WHY you sent him/);
            expect(out.built).not.toMatch(/Ready to go|Just checking in/);
        });
    }
    for (const [said, text, expected] of [["why", LEAVE, /MKTG2201 is at 1:30 PM/], ["huh why tho", BED, /bedtime/], ["why are you saying that", LEAVE, /on time/]]) {
        it(`"${said}" after "${text.slice(0, 20)}" is answered in code`, async () => {
            const out = await harness()(`${label(text)}${said}`);
            expect(`${out.direct ?? ""}${out.built}`).toMatch(expected);
        });
    }
    it("a why of his own with no message before it is untouched", async () => {
        const out = await harness()("why is gym at 5 and not 6 on tuesdays when i said evenings");
        expect(out.built).not.toContain("asking WHY you sent");
    });
});
