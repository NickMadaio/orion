// W5 (2026-10-31, gate run-1031224700 per-preference-remember-v): a stated preference is kept through orion-remember --user and the
// reply says what was kept. The phrasings below are Nick-style and held out of the gate scenarios.
import { describe, expect, it } from "vitest";
import { readPreference, savePreference } from "./preference-remember.js";
describe("readPreference: how he likes things", () => {
    it.each([
        ["i like gym in the evening", "Nick likes gym in the evening", "you like gym in the evening"],
        ["remember i hate early mornings", "Nick doesn't like early mornings", "you don't like early mornings"],
        ["id rather study in the mornings tbh", "Nick would rather study in the mornings", "you would rather study in the mornings"],
        ["i'd rather study in the mornings tbh", "Nick would rather study in the mornings", "you would rather study in the mornings"],
        ["btw i prefer my study blocks short", "Nick prefers his study blocks short", "you prefer your study blocks short"],
        ["note that i cant stand back to back classes", "Nick doesn't like back to back classes", "you don't like back to back classes"],
    ])("%s", (said, fact, echo) => {
        const p = readPreference(said);
        if (fact === undefined) {
            expect(p).toBeUndefined();
            return;
        }
        expect(p).toEqual({ fact, echo });
    });
});
describe("readPreference: how ORION talks to him", () => {
    it("stop being so formal → kept as an instruction to ORION, said back in the second person", () => {
        expect(readPreference("stop being so formal with me")).toEqual({ fact: "Nick wants ORION to stop being so formal with him", echo: "you want me to stop being so formal with you" });
    });
    it.each([
        ["dont call me bro", "Nick wants ORION not to call him bro"],
        ["no more emojis pls", "Nick wants ORION not to use emojis"],
        ["can you be more chill w me", "Nick wants ORION to be more chill w him"],
        ["ugh pls stop using exclamation marks", "Nick wants ORION to stop using exclamation marks"],
        ["pls stop using exclamation marks", "Nick wants ORION to stop using exclamation marks"],
    ])("%s", (said, fact) => {
        const p = readPreference(said);
        if (fact === undefined) {
            expect(p).toBeUndefined();
            return;
        }
        expect(p?.fact).toBe(fact);
    });
    it("a name he does not want is not said back to him", () => {
        const p = readPreference("i hate being called champ and dont use emojis");
        expect(p?.fact).toBe("Nick doesn't want to be called champ; Nick wants ORION not to use emojis");
        expect(p?.echo).not.toMatch(/champ/);
    });
});
describe("readPreference: not a preference", () => {
    it.each([
        "i love that", "i hate this", "i like it", "i'd rather do gym at 6 today", "i prefer to move gym to tmrw", "stop the timer",
        "do you like gym?", "i like gym in the evening?", "dont use my card", "stop sending the report", "i hate my life", "no more meetings",
    ])("%s", (said) => { expect(readPreference(said)).toBeUndefined(); });
});
describe("savePreference: the reply comes from the write", () => {
    it("writes with orion-remember --user and says what was kept", async () => {
        const calls = [];
        const flow = await savePreference({ fact: "Nick likes gym in the evening", echo: "you like gym in the evening" }, async (args) => { calls.push(args); return { stdout: "remembered -> ~/.openclaw/workspace/USER.md", code: 0 }; });
        expect(calls).toEqual([["--user", "Preference: Nick likes gym in the evening."]]);
        expect(flow).toMatchObject({ outcome: "done", reply: "Got it — I'll remember you like gym in the evening." });
        expect(flow.outcome === "done" ? flow.reply : "").not.toMatch(/^Saved:|I have noted/);
    });
    it("a failed write claims nothing", async () => {
        const flow = await savePreference({ fact: "Nick likes gym in the evening", echo: "you like gym in the evening" }, async () => ({ stdout: "orion-remember: USER.md is missing", code: 2 }));
        expect(flow).toMatchObject({ outcome: "say" });
        expect(flow.outcome === "say" ? flow.text : "").toMatch(/couldn't save/);
    });
});
