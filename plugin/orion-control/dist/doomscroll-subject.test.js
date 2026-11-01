// Wave 4 review, finding 2: a doomscroll confession may auto-start a session only when he says it of himself, now. Someone else's
// scrolling, a past time, or a quoted or forwarded message is not a confession. Time phrases never reach the task title.
// Phrasings are held out of scripts/eval/gate/scenarios.
import { describe, expect, it } from "vitest";
import { readFocusMove, runFocusMove } from "./focus-moves.js";
const NOW = new Date(2026, 10, 2, 10, 0);
const IDLE = `${JSON.stringify({ ok: true, status: "finished", phase: "abandoned", dayKey: "2026-10-30", task: "old" })}\n`;
function session() {
    const calls = [];
    const exec = async (args) => {
        calls.push(args);
        if (args[0] === "start")
            return { stdout: `${JSON.stringify({ ok: true, status: "running", phase: "focus", task: args[1], remainingSeconds: 1500 })}\n`, code: 0 };
        return { stdout: IDLE, code: 0 };
    };
    return { exec, calls };
}
describe("not his own confession, now: no doomscroll move", () => {
    it.each([
        "they keep scrolling tiktok instead of studying",
        "my brother keeps going on youtube instead of working",
        "she's been on insta for an hour instead of studying",
        "yesterday i was on tiktok instead of studying",
        "i was on reels instead of working last night",
        "earlier i was stuck on youtube instead of revising",
        "been on youtube instead of working the other day",
        "sam texted: im on tiktok instead of studying lol",
        "priya said im on insta instead of working haha",
        "she wrote \"i keep watching youtube instead of studying\"",
        "im on tiktok instead of working last night",
    ])("%s", async (said) => {
        const move = readFocusMove(said);
        expect(move?.kind).not.toBe("doomscroll");
        if (move)
            return;
        const s = session();
        expect(s.calls).toEqual([]);
    });
});
describe("his own, now: still a confession, and the title carries no time words", () => {
    it.each([
        ["im on tiktok instead of studying for my exam right now", "studying for my exam"],
        ["ugh i keep watching youtube instead of doing my essay tonight", "essay"],
        ["been scrolling insta instead of my pset today", "pset"],
    ])("%s", async (said, item) => {
        const move = readFocusMove(said);
        expect(move?.kind).toBe("doomscroll");
        const s = session();
        await runFocusMove(move, { exec: s.exec, now: NOW, mayStart: true });
        expect(s.calls.find((c) => c[0] === "start")?.[1]).toBe(item);
    });
});
