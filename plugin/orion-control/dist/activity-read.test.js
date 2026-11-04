// w19 activity: the card line, the two questions, and the files they read. Held-out phrasings in Nick's style; no live state is touched.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activityReply, asksActivity, nowLine, nowReply, readActivity, readHistory, summarize, todayReply, dayStart } from "./activity-read.js";
import { loadCardInputs, stateCard, deskLine } from "./state-card.js";
import { registerLocalRouting } from "./local-routing.js";
const NOW = new Date(2026, 10, 4, 18, 20);
const iso = (h, m = 0, d = 4) => new Date(2026, 10, d, h, m).toISOString();
const base = (over = {}) => ({
    version: 1, at: iso(18, 19, 4), idleSeconds: 3, app: { name: "java", bundleId: null, pid: 9 }, category: "game", window: null, domain: null, siteCategory: null,
    game: { name: "Minecraft", since: iso(17, 40) }, focus: null, ...over,
});
const dirWith = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "activity-"));
    for (const [n, b] of Object.entries(files))
        writeFileSync(join(dir, n), typeof b === "string" ? b : JSON.stringify(b));
    return dir;
};
describe("the Right now line", () => {
    it("names the game and how long", () => expect(nowLine(base(), [], NOW)).toBe("Right now: playing Minecraft for 40 min"));
    it("a video site is watching, a social one is on, an app is in", () => {
        const yt = base({ app: { name: "Safari", bundleId: "com.apple.Safari", pid: 1 }, category: "browser", game: null, domain: "youtube.com", siteCategory: "video" });
        expect(nowLine(yt, [], NOW)).toBe("Right now: watching YouTube");
        expect(nowLine({ ...yt, domain: "old.reddit.com", siteCategory: "social" }, [], NOW)).toBe("Right now: on Reddit");
        expect(nowLine(base({ app: { name: "Xcode", bundleId: "com.apple.dt.Xcode", pid: 2 }, category: "work", game: null }), [], NOW)).toBe("Right now: in Xcode");
    });
    it("takes the duration from the history when there is no game", () => {
        const code = base({ app: { name: "Code", bundleId: "com.microsoft.VSCode", pid: 2 }, category: "work", game: null });
        const rows = [{ at: iso(17, 50), bundleId: "com.microsoft.VSCode", category: "work", domain: null }];
        expect(nowLine(code, rows, NOW)).toBe("Right now: in Code for 30 min");
    });
    it("away from the keys is said as away, with the focus session when there is one", () => {
        expect(nowLine(base({ idleSeconds: 900, focus: { active: true, task: "Finish resume", allowedApps: [], allowedDomains: [] } }), [], NOW))
            .toBe("Right now: away from the Mac (java left open); focus session on Finish resume");
    });
    it("is null with nothing fresh: a stale or missing file is not a guess", () => {
        expect(nowLine(null, [], NOW)).toBeNull();
        expect(readActivity(dirWith({ "activity.json": base({ at: iso(18, 10) }) }), NOW)).toBeNull(); // 10 min old
        expect(readActivity(dirWith({ "activity.json": "not json" }), NOW)).toBeNull();
        expect(readActivity(dirWith({}), NOW)).toBeNull();
        expect(readActivity(dirWith({ "activity.json": { ...base(), version: 2 } }), NOW)).toBeNull();
        expect(readActivity(dirWith({ "activity.json": base() }), NOW)?.game?.name).toBe("Minecraft");
    });
});
describe("the state card carries what he is doing", () => {
    const record = { schemaVersion: 1, computedAt: iso(18, 18), shouldBe: { kind: "other", title: "finish resume", start: iso(18), end: iso(20) }, is: { activity: "at-mac", confidence: "medium" }, mismatch: { kind: "not-started", minutes: 20 }, next: { title: "gym", start: iso(20) }, strictness: "flexible" };
    it("puts the line right under the heading, and in the one-line desk summary", () => {
        const dir = dirWith({ "now.json": record, "activity.json": base() });
        const inputs = loadCardInputs({ stateDir: dir, now: NOW });
        const lines = stateCard(inputs).split("\n");
        expect(lines[1]).toBe("- Right now: playing Minecraft for 40 min");
        expect(deskLine(inputs)).toMatch(/he is playing Minecraft for 40 min/);
    });
    it("is absent when the file is stale", () => {
        const dir = dirWith({ "now.json": record, "activity.json": base({ at: iso(17, 0) }) });
        expect(stateCard(loadCardInputs({ stateDir: dir, now: NOW }))).not.toMatch(/Right now/);
    });
});
describe("which questions are about what he is doing", () => {
    it.each(["what am i doing", "wat am i doing rn", "orion what am i doing right now", "whats am i doing lol", "what app am i on", "what game am i playing", "ok what am i up to rn", "can you see what im doing", "what am i watching"])("%s -> now", (m) => expect(asksActivity(m)).toBe("now"));
    it.each(["what have i been doing today", "what have i been up to", "what have i been doing all day", "where did my time go today", "what did i do today", "what i been doing today"])("%s -> today", (m) => expect(asksActivity(m)).toBe("today"));
    it.each(["what am i doing tomorrow", "what am i doing tonight", "what am i supposed to be doing", "what should i be doing", "what am i doing on friday", "what do i have today", "what am i doing after class",
        "what am i doing wrong", "what is the capital of france", "play minecraft"])("%s -> not about his activity", (m) => expect(asksActivity(m)).toBeNull());
});
describe("the answers", () => {
    it("now: first person from the file", () => expect(nowReply(base(), [], NOW)).toBe("You're playing Minecraft for 40 min."));
    it("now: says it cannot see rather than guess", () => expect(nowReply(null, [], NOW)).toMatch(/can't see what you're on/));
    it("now: never repeats a window title or a URL, even if an old file carried them", () => {
        const leaky = { ...base({ app: { name: "Safari", bundleId: "com.apple.Safari", pid: 1 }, category: "browser", game: null, domain: "youtube.com", siteCategory: "video", window: "my medical results - YouTube" }), url: "https://www.youtube.com/watch?v=SECRET" };
        expect(nowReply(leaky, [], NOW)).toBe("You're watching YouTube.");
        expect(nowLine(leaky, [], NOW)).toBe("Right now: watching YouTube");
        const dir = dirWith({ "activity.json": leaky });
        expect(JSON.stringify(readActivity(dir, NOW))).not.toMatch(/SECRET|medical/);
    });
    it("now: a game's window title is the one title kept, and it is not spoken as a tab", () => expect(nowReply(base({ window: "Minecraft 1.21" }), [], NOW)).toBe("You're playing Minecraft for 40 min."));
    it("today: totals by category and the top things, gaps capped at 30 min", () => {
        const rows = [
            { at: iso(9, 0), bundleId: "com.microsoft.VSCode", category: "work", domain: null },
            { at: iso(10, 0), bundleId: "com.apple.Safari", category: "browser", domain: "youtube.com" }, // 60 min gap: capped at 30 for VS Code
            { at: iso(10, 20), bundleId: "java", category: "game", domain: null },
        ];
        const s = summarize(rows, NOW, dayStart(NOW));
        expect(s.categories.find((c) => c.category === "work")?.minutes).toBe(30);
        expect(s.categories.find((c) => c.category === "game")?.minutes).toBe(30); // last row capped too
        expect(todayReply(rows, NOW)).toMatch(/^Since I started watching today: .*30 min gaming.*mostly /);
        expect(todayReply([], NOW)).toBe("I don't have anything logged for today yet.");
    });
    it("history older than seven days or unreadable lines are ignored", () => {
        const dir = dirWith({ "activity-history.jsonl": [JSON.stringify({ at: iso(9, 0, 4), bundleId: "a", category: "work", domain: null }), JSON.stringify({ at: iso(9, 0, 20).replace(/2026-11-20/, "2026-10-20"), bundleId: "b", category: "game", domain: null }), "broken"].join("\n") });
        expect(readHistory(dir, NOW).map((r) => r.bundleId)).toEqual(["a"]);
    });
    it("activityReply reads the directory", () => {
        expect(activityReply("now", dirWith({ "activity.json": base() }), NOW)).toBe("You're playing Minecraft for 40 min.");
    });
});
function chat(stateDir, desk) {
    const handlers = new Map();
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "act-log-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Wed 18:20", now: () => NOW, stateDir, decideImpl: async () => desk,
    });
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    return async (prompt) => {
        const ctx = { runId: "a1", sessionKey: "agent:main:orion-chat-activity" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        if (direct?.reply?.text)
            return direct.reply.text;
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 60) ?? ""}`;
    };
}
describe("in the chat", () => {
    it("'what am i doing' is answered from activity.json, whatever the desk said", async () => {
        const dir = dirWith({ "activity.json": base() });
        expect(await chat(dir, { move: "escalate", tier: "standard" })("wat am i doing rn lol")).toBe("You're playing Minecraft for 40 min.");
        expect(await chat(dir, { move: "ignore" })("what am i doing")).toBe("You're playing Minecraft for 40 min.");
    });
    it("'what have i been doing today' comes from the history", async () => {
        const dir = dirWith({ "activity-history.jsonl": JSON.stringify({ at: iso(18, 0), bundleId: "java", category: "game", domain: null }) });
        expect(await chat(dir, { move: "escalate", tier: "standard" })("what have i been doing today")).toMatch(/gaming/);
    });
    it("a plan question is not hijacked", async () => {
        const dir = dirWith({ "activity.json": base() });
        expect(await chat(dir, { move: "escalate", tier: "standard" })("what am i doing tomorrow")).not.toMatch(/Minecraft/);
    });
});
