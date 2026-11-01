// Wave 4 review 3 (2026-11-01): a "preference" that negates gym or classes, or turns off check-ins or alarms, is never kept in USER.md.
// The reply says so honestly (gym stays in the plan; the wake-up alarm's own switch is in the phone app's Tonight settings).
import { describe, expect, it } from "vitest";
import { readPreference, savePreference } from "./preference-remember.js";
describe("refused: negating the anchors or turning off check-ins / alarms", () => {
    it.each([
        ["id rather skip gym", /gym stays/i], ["i prefer no gym", /gym stays/i], ["i'd rather not go to the gym", /gym stays/i], ["i hate the gym", /gym stays/i],
        ["i hate classes", /class/i], ["i like skipping class", /class/i], ["i'd rather miss lectures", /class/i],
        ["i dont like check ins", /check-ins/i], ["i hate check-ins", /check-ins/i],
        ["i hate alarms", /alarm/i], ["i'd rather have no alarms", /alarm/i],
    ])("%s", async (m, says) => {
        const pref = readPreference(m);
        expect(pref?.refuse, m).toMatch(says);
        let ran = 0;
        const flow = await savePreference(pref, async () => { ran += 1; return { stdout: "remembered", code: 0 }; });
        expect(ran).toBe(0);
        expect(flow.outcome).toBe("say");
        expect("text" in flow ? flow.text : "").toMatch(says);
        expect("text" in flow ? flow.text : "").not.toMatch(/I'll remember/i);
    });
});
describe("still kept: how he likes the anchors laid out", () => {
    it.each(["i like gym in the evening", "i'd rather study in the morning", "i dont like gym in the morning", "i prefer short check ins"])("%s", (m) => {
        const pref = readPreference(m);
        expect(pref?.fact, m).toBeTruthy();
        expect(pref?.refuse, m).toBeUndefined();
    });
});
